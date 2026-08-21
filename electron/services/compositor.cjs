const { createHash } = require('node:crypto');
const { reviewGate } = require('./underlayCritique.cjs');
const { ERROR_CODES, BINDING_VALIDATION_CODES } = require('./errorCodes.cjs');
const { validateFontManifest } = require('./typographyAssets.cjs');
const { validateBindings } = require('./componentBindings.cjs');
const { validateLayout } = require('./layoutValidator.cjs');

// P0-05：视觉评审指纹。Manifest 在合成时记录当前 Visual Results 的
// 版本/选择/评审 hash；最终批准与导出边界用它重验交付链是否仍对应
// 当前评审，视觉结果或评审变化后旧交付链不得继续放行。
function visualReviewHash(visualResults) {
  const review = visualResults?.review;
  if (!review) return '';
  return createHash('sha256').update(JSON.stringify({
    mode: review.mode || '',
    selected_variation_ids: review.selected_variation_ids || [],
    notes: review.notes || ''
  })).digest('hex');
}

// P0-05：最终批准与导出边界的交付链重验：Manifest 是否仍对应当前
// Visual Results 评审。只对记录了 visual_results_version 的新格式
// Manifest 强制；升级前的旧产物由 stale 失效机制保底。
function visualBindingMismatch(manifest, visualResults) {
  const source = manifest?.source || {};
  if (source.visual_results_version === undefined) return null;
  if (!visualResults) return '当前 Visual Results 已缺失';
  if (source.visual_results_version !== visualResults.version) return `视觉结果版本已变化（合成时 V${source.visual_results_version}，当前 V${visualResults.version}）`;
  if (JSON.stringify(source.selected_variation_ids || []) !== JSON.stringify(visualResults.review?.selected_variation_ids || [])) return '评审选择的视觉方向已变化';
  if (source.review_hash !== visualReviewHash(visualResults)) return '视觉评审内容已变化';
  return null;
}

function componentLayer(binding, slot, family) {
  // validateBindings rejects bindings without an explicit state before any
  // layer is built, so there is intentionally no 'default' fallback here.
  const state = binding.state;
  const asset = family.states[state];
  return {
    type: 'component', control_id: binding.control_id, component_id: family.id, state,
    asset_path: asset.asset_path, asset_hash: asset.asset_hash,
    intrinsic_size: family.intrinsic_size,
    scale_policy: family.scale_policy,
    rect: [slot.rect.x, slot.rect.y, slot.rect.width, slot.rect.height],
    anchor: slot.anchor || 'top-left', resize_mode: slot.resize_mode || family.reuse_mode,
    renderer: family.reuse_mode,
    slice: family.slice, z_index: Number(slot.z_index || 0)
  };
}

function textLayer(binding, slot, family, fontManifest, typography, strict = false) {
  const content = String(binding.text || binding.label || '').trim();
  if (!content || family.text_policy !== 'text-slot') return null;
  // Strict compositions never guess a font role: the designer's explicit
  // choice is required. Guided previews keep the legacy fallback chain.
  let roleId = binding.font_role;
  if (!roleId) {
    if (strict) throw Object.assign(new Error(`${BINDING_VALIDATION_CODES.BINDING_FONT_ROLE_REQUIRED}: ${binding.control_id} binds text-slot family ${family.id} without an explicit font role`), { code: BINDING_VALIDATION_CODES.BINDING_FONT_ROLE_REQUIRED });
    roleId = family.font_role || 'button-label';
  }
  const role = fontManifest.roles?.[roleId];
  const font = (fontManifest.fonts || []).find((item) => item.id === role?.font_id);
  return {
    type: 'text', control_id: binding.control_id, content, font_role: roleId,
    font_id: role?.font_id, font_path: font?.local_path, font_hash: font?.file_hash,
    font_family: font?.family_name, postscript_name: font?.postscript_name, font_format: font?.format,
    font_license_status: font?.license_status, font_license_confirmation: font?.license_confirmation,
    exact_confirmation: role?.exact_confirmation,
    fidelity_mode: role?.fidelity_mode || 'unresolved', typography: typography?.[roleId] || {},
    rect: [slot.rect.x, slot.rect.y, slot.rect.width, slot.rect.height], z_index: Number(slot.z_index || 0) + 1
  };
}

function createCompositionManifest({ project, underlay, layout, bindings, componentContract, fontManifest, styleContract, critique, mode = 'preview', version = 1 }) {
  const strict = project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation';
  const errors = [];
  const underlayGate = reviewGate(critique);
  if (!underlayGate.passed) errors.push(`Underlay review has ${underlayGate.blocking.length} blocking issues`);
  const bindingResult = validateBindings(bindings, project.artifacts?.screenContract, componentContract, fontManifest, { strict });
  errors.push(...bindingResult.errors);
  errors.push(...validateLayout(layout, bindings, componentContract, project.canvas_spec, { strict }));
  if (mode === 'final') errors.push(...validateFontManifest(fontManifest, { strict }));
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { code: ERROR_CODES.COMPOSITION_GATE_FAILED, missing_requirements: errors });
  const families = new Map((componentContract.families || []).map((family) => [family.id, family]));
  const slots = new Map((layout.slots || []).map((slot) => [slot.id, slot]));
  const layers = [];
  for (const binding of bindings.bindings || []) {
    const family = families.get(binding.component_id); const slot = slots.get(binding.slot_id);
    layers.push(componentLayer(binding, slot, family));
    const text = textLayer(binding, slot, family, fontManifest, styleContract.typography, strict);
    if (text) layers.push(text);
  }
  for (const layer of layers) if (layer.type === 'text') layer.composition_mode = mode;
  if (mode !== 'final' && layers.some((layer) => layer.type === 'text' && layer.fidelity_mode !== 'exact')) layers.push({ type: 'watermark', content: 'TYPOGRAPHY PREVIEW · FONT FIDELITY UNRESOLVED', z_index: 10000 });
  layers.sort((left, right) => left.z_index - right.z_index || `${left.type}:${left.control_id || ''}`.localeCompare(`${right.type}:${right.control_id || ''}`));
  const visualResults = project.artifacts?.visualResults;
  return {
    schema_version: '2.0', id: `${project.screen_id}-composition-${mode}`, version, status: 'draft',
    source: { screen_contract: project.artifacts?.screenContract?.id, approved_layout: layout.id, component_bindings: bindings.id, component_contract: componentContract.id, font_manifest: fontManifest.id, style_contract: styleContract.id, underlay_critique: critique.id, visual_results: visualResults?.id, visual_results_version: visualResults?.version, selected_variation_ids: visualResults?.review?.selected_variation_ids || [], review_hash: visualReviewHash(visualResults) },
    mode, canvas: [project.canvas_spec.width, project.canvas_spec.height], underlay,
    layers, coverage: bindingResult.coverage, renderer: { engine: 'sharp-libvips', deterministic_order: true, registry: ['exact', 'nine-slice', 'vector-token'] }
  };
}

module.exports = { createCompositionManifest, textLayer, visualBindingMismatch, visualReviewHash };
