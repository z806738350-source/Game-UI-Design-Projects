const crypto = require('node:crypto');
const { ERROR_CODES, FIDELITY_ISSUE_CODES } = require('./errorCodes.cjs');
const fs = require('node:fs/promises');
const sharp = require('sharp');
const { hashBuffer, resolveProjectPath, verifyCompositionOutput } = require('./compositionRenderer.cjs');
const { inspectFont } = require('./typographyAssets.cjs');

const FIDELITY_CHECK_VERSION = 'pixel-fidelity-v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')}`;
}

function pixelRect(layer, canvas) {
  const [x, y, width, height] = layer.rect || [];
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return null;
  const left = Math.round(x * canvas.width); const top = Math.round(y * canvas.height);
  return { left, top, width: Math.max(1, Math.round((x + width) * canvas.width) - left), height: Math.max(1, Math.round((y + height) * canvas.height) - top) };
}

function sameRect(left, right) {
  return left && right && ['left', 'top', 'width', 'height'].every((key) => Number(left[key]) === Number(right[key]));
}

function intersectionArea(left, right) {
  const width = Math.max(0, Math.min(left.left + left.width, right.left + right.width) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.top + left.height, right.top + right.height) - Math.max(left.top, right.top));
  return width * height;
}

async function inspectFidelityEvidence({ projectPath, project, manifest, output }) {
  const issues = [];
  const add = (category, code, message, evidence = {}) => issues.push({ severity: 'blocker', category, code, message, evidence });
  const outputVerification = await verifyCompositionOutput(projectPath, output, { requireFinal: true });
  for (const item of outputVerification.issues) add('visual-fidelity', item.code, item.message);
  let outputBytes; let metadata; let stats;
  try {
    outputBytes = await fs.readFile(resolveProjectPath(projectPath, output.path));
    metadata = await sharp(outputBytes).metadata(); stats = await sharp(outputBytes).ensureAlpha().stats();
  } catch (error) {
    if (!issues.some((item) => item.code === 'COMPOSITION_OUTPUT_UNREADABLE')) add('visual-fidelity', ERROR_CODES.COMPOSITION_OUTPUT_UNREADABLE, error.message);
  }
  const canvas = { width: Number(manifest?.canvas?.[0]), height: Number(manifest?.canvas?.[1]) };
  if (metadata && (metadata.format !== 'png' || metadata.width !== canvas.width || metadata.height !== canvas.height)) add('visual-fidelity', FIDELITY_ISSUE_CODES.FINAL_CANVAS_MISMATCH, 'Decoded final PNG does not match the Composition canvas.', { format: metadata.format, width: metadata.width, height: metadata.height, canvas });
  if (metadata && metadata.hasAlpha !== true) add('visual-fidelity', FIDELITY_ISSUE_CODES.FINAL_ALPHA_MISSING, 'Final PNG must contain a real alpha channel.');
  if (stats?.channels?.[3]?.max === 0) add('visual-fidelity', FIDELITY_ISSUE_CODES.FINAL_PIXELS_EMPTY, 'Final PNG alpha channel contains no visible pixels.');
  if (output?.version !== manifest?.version || output?.source?.composition_manifest_version !== manifest?.version) add('manifest-consistency', FIDELITY_ISSUE_CODES.OUTPUT_VERSION_MISMATCH, 'Composition Output version does not match the current Manifest.');
  if (output?.source?.composition_manifest !== manifest?.id) add('manifest-consistency', FIDELITY_ISSUE_CODES.OUTPUT_SOURCE_MISMATCH, 'Composition Output references a different Manifest.');

  const diagnostics = output?.render_log?.layers || [];
  const assetEvidence = [];
  const seenAssets = new Set();
  const layoutEvidence = [];
  const componentRects = [];
  const slots = new Map((project.artifacts?.approvedLayout?.slots || []).map((slot) => [slot.id, slot]));
  const bindings = new Map((project.artifacts?.bindings?.bindings || []).map((binding) => [binding.control_id, binding]));
  for (const layer of manifest?.layers || []) {
    const rect = pixelRect(layer, canvas);
    if (!rect) { add('visual-fidelity', FIDELITY_ISSUE_CODES.LAYER_OUT_OF_BOUNDS, `${layer.control_id || layer.type} has an invalid or out-of-canvas rect.`); continue; }
    const diagnostic = diagnostics.find((item) => item.control_id === layer.control_id && (layer.type !== 'text' || item.font_role === layer.font_role));
    if (!diagnostic || !sameRect(rect, diagnostic.target_rect)) add('visual-fidelity', FIDELITY_ISSUE_CODES.RENDERED_BBOX_MISMATCH, `${layer.control_id || layer.type} lacks matching rendered bbox evidence.`, { expected: rect, actual: diagnostic?.target_rect });
    let cropHash;
    if (outputBytes) cropHash = hashBuffer(await sharp(outputBytes).extract(rect).png().toBuffer());
    layoutEvidence.push({ control_id: layer.control_id, type: layer.type, rect, crop_hash: cropHash });
    const binding = bindings.get(layer.control_id); const slot = slots.get(binding?.slot_id);
    if (slot?.safe_area_compliant === true) {
      const marginX = Math.round(canvas.width * 0.05); const marginY = Math.round(canvas.height * 0.05);
      if (rect.left < marginX || rect.top < marginY || rect.left + rect.width > canvas.width - marginX || rect.top + rect.height > canvas.height - marginY) add('visual-fidelity', FIDELITY_ISSUE_CODES.SAFE_AREA_VIOLATION, `${layer.control_id} leaves the declared 5% safe area.`, { rect, margin_x: marginX, margin_y: marginY });
    }
    if (layer.type === 'component') {
      componentRects.push({ control_id: layer.control_id, rect, allow_overlap: Boolean(slot?.allow_overlap) });
      try {
        const bytes = await fs.readFile(resolveProjectPath(projectPath, layer.asset_path)); const actual = hashBuffer(bytes);
        seenAssets.add(`component:${layer.asset_path}`);
        assetEvidence.push({ kind: 'component', id: layer.component_id, path: layer.asset_path, expected_hash: layer.asset_hash, actual_hash: actual });
        if (actual !== layer.asset_hash) add('manifest-consistency', ERROR_CODES.COMPONENT_ASSET_HASH_MISMATCH, `${layer.component_id} current file hash differs from the Manifest.`);
      } catch (error) { add('manifest-consistency', FIDELITY_ISSUE_CODES.COMPONENT_ASSET_UNREADABLE, `${layer.component_id}: ${error.message}`); }
      if (layer.renderer === 'nine-slice') {
        const fixed = diagnostic?.patches?.filter((patch) => patch.fixed_corner) || [];
        if (fixed.length !== 4) add('visual-fidelity', FIDELITY_ISSUE_CODES.NINE_SLICE_FIXED_REGIONS_MISSING, `${layer.component_id} does not record four fixed corners.`);
        for (const patch of fixed) if (patch.source.width !== patch.destination.width || patch.source.height !== patch.destination.height || patch.source_hash !== patch.rendered_hash) add('visual-fidelity', FIDELITY_ISSUE_CODES.NINE_SLICE_FIXED_REGION_DEFORMED, `${layer.component_id} changed a fixed corner.`, patch);
      }
    } else if (layer.type === 'text') {
      try {
        const inspected = await inspectFont(resolveProjectPath(projectPath, layer.font_path));
        seenAssets.add(`font:${layer.font_path}`);
        assetEvidence.push({ kind: 'font', id: layer.font_id, path: layer.font_path, expected_hash: layer.font_hash, actual_hash: inspected.file_hash, family: inspected.family_name, postscript_name: inspected.postscript_name });
        if (inspected.file_hash !== layer.font_hash) add('manifest-consistency', ERROR_CODES.FONT_ASSET_HASH_MISMATCH, `${layer.font_id} current file hash differs from the Manifest.`);
        if (inspected.family_name !== layer.font_family || inspected.postscript_name !== layer.postscript_name) add('manifest-consistency', FIDELITY_ISSUE_CODES.FONT_IDENTITY_MISMATCH, `${layer.font_id} current identity differs from the Manifest.`);
      } catch (error) { add('manifest-consistency', FIDELITY_ISSUE_CODES.FONT_ASSET_UNREADABLE, `${layer.font_id}: ${error.message}`); }
      if (!diagnostic?.ink_bounds || diagnostic.text_overflow || diagnostic.ink_bounds.touches_boundary) add('visual-fidelity', FIDELITY_ISSUE_CODES.TEXT_OVERFLOW, `${layer.control_id} text touches or exceeds its rendered slot.`, { ink_bounds: diagnostic?.ink_bounds, target_rect: rect });
    }
  }
  for (const family of project.artifacts?.componentContract?.families || []) for (const state of Object.values(family.states || {})) {
    if (!state?.asset_path || seenAssets.has(`component:${state.asset_path}`)) continue;
    seenAssets.add(`component:${state.asset_path}`);
    try {
      const bytes = await fs.readFile(resolveProjectPath(projectPath, state.asset_path)); const actual = hashBuffer(bytes);
      assetEvidence.push({ kind: 'component', id: family.id, path: state.asset_path, expected_hash: state.asset_hash, actual_hash: actual });
      if (actual !== state.asset_hash) add('manifest-consistency', ERROR_CODES.COMPONENT_ASSET_HASH_MISMATCH, `${family.id} current file hash differs from the Component Contract.`);
    } catch (error) { add('manifest-consistency', FIDELITY_ISSUE_CODES.COMPONENT_ASSET_UNREADABLE, `${family.id}: ${error.message}`); }
  }
  for (const font of project.artifacts?.fontManifest?.fonts || []) {
    if (!font?.local_path || seenAssets.has(`font:${font.local_path}`)) continue;
    seenAssets.add(`font:${font.local_path}`);
    try {
      const inspected = await inspectFont(resolveProjectPath(projectPath, font.local_path));
      assetEvidence.push({ kind: 'font', id: font.id, path: font.local_path, expected_hash: font.file_hash, actual_hash: inspected.file_hash, family: inspected.family_name, postscript_name: inspected.postscript_name });
      if (inspected.file_hash !== font.file_hash) add('manifest-consistency', ERROR_CODES.FONT_ASSET_HASH_MISMATCH, `${font.id} current file hash differs from the Font Manifest.`);
      if (inspected.family_name !== font.family_name || inspected.postscript_name !== font.postscript_name) add('manifest-consistency', FIDELITY_ISSUE_CODES.FONT_IDENTITY_MISMATCH, `${font.id} current identity differs from the Font Manifest.`);
    } catch (error) { add('manifest-consistency', FIDELITY_ISSUE_CODES.FONT_ASSET_UNREADABLE, `${font.id}: ${error.message}`); }
  }
  for (let first = 0; first < componentRects.length; first += 1) for (let second = first + 1; second < componentRects.length; second += 1) {
    const left = componentRects[first]; const right = componentRects[second];
    if (!left.allow_overlap && !right.allow_overlap && intersectionArea(left.rect, right.rect) > 0) add('visual-fidelity', FIDELITY_ISSUE_CODES.COMPONENT_OVERLAP, `${left.control_id} overlaps ${right.control_id}.`, { left: left.rect, right: right.rect });
  }
  const evidence = {
    check_version: FIDELITY_CHECK_VERSION,
    thresholds: { visible_alpha_minimum: 1, safe_area_ratio: 0.05, allowed_component_overlap_pixels: 0, text_may_touch_boundary: false, nine_slice_fixed_hash_must_match: true },
    output: outputBytes ? { path: output.path, expected_hash: output.hash, actual_hash: hashBuffer(outputBytes), format: metadata?.format, width: metadata?.width, height: metadata?.height, has_alpha: metadata?.hasAlpha, alpha_min: stats?.channels?.[3]?.min, alpha_max: stats?.channels?.[3]?.max, byte_length: outputBytes.length, version: output.version } : { path: output?.path },
    assets: assetEvidence, layout: layoutEvidence, renderer_version: output?.renderer_version, manifest: { id: manifest?.id, version: manifest?.version, hash: digest(manifest) }
  };
  return { passed: issues.length === 0, issues, evidence, evidence_digest: digest(evidence), outputVerification };
}

module.exports = { FIDELITY_CHECK_VERSION, digest, inspectFidelityEvidence };
