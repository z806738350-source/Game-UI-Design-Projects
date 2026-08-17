const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { ensureDir } = require('./jsonStore.cjs');
const { renderTextLayer } = require('./typographyRenderer.cjs');

const RENDERER_VERSION = `composition-v1/sharp-${sharp.versions.sharp}/libvips-${sharp.versions.vips}`;

function hashBuffer(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function resolveProjectPath(projectPath, filePath) {
  if (!filePath || typeof filePath !== 'string') throw new Error('Composition asset path is missing.');
  const resolved = path.resolve(projectPath, filePath);
  const relative = path.relative(projectPath, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Composition asset escapes the project workspace: ${filePath}`);
  }
  return resolved;
}

function outputRect(layer, canvas) {
  if (!Array.isArray(layer.rect) || layer.rect.length !== 4 || layer.rect.some((value) => !Number.isFinite(value))) {
    throw new Error(`Layer ${layer.control_id || layer.type} has an invalid normalized rect.`);
  }
  const [x, y, width, height] = layer.rect;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    throw new Error(`Layer ${layer.control_id || layer.type} leaves the composition canvas.`);
  }
  const left = Math.round(x * canvas.width);
  const top = Math.round(y * canvas.height);
  const right = Math.round((x + width) * canvas.width);
  const bottom = Math.round((y + height) * canvas.height);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

async function verifiedAsset(projectPath, layer) {
  const assetPath = resolveProjectPath(projectPath, layer.asset_path);
  const bytes = await fs.readFile(assetPath);
  const actualHash = hashBuffer(bytes);
  if (layer.asset_hash && actualHash !== layer.asset_hash) {
    throw Object.assign(new Error(`Component asset hash changed: ${layer.component_id}`), {
      code: 'COMPONENT_ASSET_HASH_MISMATCH',
      expected_hash: layer.asset_hash,
      actual_hash: actualHash
    });
  }
  return { assetPath, bytes, actualHash };
}

async function exactRenderer({ projectPath, layer, target }) {
  const asset = await verifiedAsset(projectPath, layer);
  const metadata = await sharp(asset.bytes).metadata();
  const sourceWidth = Number(layer.intrinsic_size?.[0] || metadata.width);
  const sourceHeight = Number(layer.intrinsic_size?.[1] || metadata.height);
  if (!sourceWidth || !sourceHeight) throw new Error(`Exact component ${layer.component_id} has no intrinsic size.`);
  const scaleX = target.width / sourceWidth;
  const scaleY = target.height / sourceHeight;
  if (Math.abs(scaleX - scaleY) > 0.02) {
    throw Object.assign(new Error(`Exact component ${layer.component_id} would be stretched non-uniformly.`), {
      code: 'EXACT_NON_UNIFORM_SCALE', scale_x: scaleX, scale_y: scaleY
    });
  }
  const minimum = Number(layer.scale_policy?.min_scale ?? 1);
  const maximum = Number(layer.scale_policy?.max_scale ?? 1);
  if (scaleX < minimum - 0.001 || scaleX > maximum + 0.001) {
    throw Object.assign(new Error(`Exact component ${layer.component_id} scale ${scaleX.toFixed(4)} is outside ${minimum}-${maximum}.`), {
      code: 'EXACT_SCALE_OUT_OF_POLICY', scale: scaleX, min_scale: minimum, max_scale: maximum
    });
  }
  const input = await sharp(asset.bytes).resize(target.width, target.height, { fit: 'fill' }).png().toBuffer();
  return {
    input,
    diagnostic: {
      control_id: layer.control_id,
      component_id: layer.component_id,
      renderer: 'exact',
      source_size: [sourceWidth, sourceHeight],
      target_rect: target,
      transform: { scale_x: scaleX, scale_y: scaleY, uniform: true },
      asset_hash: asset.actualHash
    }
  };
}

async function nineSliceRenderer({ projectPath, layer, target }) {
  const asset = await verifiedAsset(projectPath, layer);
  const metadata = await sharp(asset.bytes).metadata();
  const sourceWidth = Number(metadata.width);
  const sourceHeight = Number(metadata.height);
  const margins = layer.slice?.margins;
  if (!Array.isArray(margins) || margins.length !== 4 || margins.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error(`Nine-slice component ${layer.component_id} requires integer [left,right,top,bottom] margins.`);
  }
  const [left, right, top, bottom] = margins;
  if (!sourceWidth || !sourceHeight || left + right >= sourceWidth || top + bottom >= sourceHeight) {
    throw new Error(`Nine-slice component ${layer.component_id} has invalid source margins.`);
  }
  if (target.width < left + right || target.height < top + bottom) {
    throw new Error(`Nine-slice target for ${layer.component_id} is smaller than its fixed margins.`);
  }
  const sourceColumns = [left, sourceWidth - left - right, right];
  const sourceRows = [top, sourceHeight - top - bottom, bottom];
  const targetColumns = [left, target.width - left - right, right];
  const targetRows = [top, target.height - top - bottom, bottom];
  const patches = [];
  const patchDiagnostics = [];
  let sourceTop = 0;
  let targetTop = 0;
  for (let row = 0; row < 3; row += 1) {
    let sourceLeft = 0;
    let targetLeft = 0;
    for (let column = 0; column < 3; column += 1) {
      const source = { left: sourceLeft, top: sourceTop, width: sourceColumns[column], height: sourceRows[row] };
      const destination = { left: targetLeft, top: targetTop, width: targetColumns[column], height: targetRows[row] };
      let patch = sharp(asset.bytes).extract(source);
      if (source.width !== destination.width || source.height !== destination.height) {
        patch = patch.resize(destination.width, destination.height, { fit: 'fill' });
      }
      patches.push({ input: await patch.png().toBuffer(), left: destination.left, top: destination.top });
      patchDiagnostics.push({ source, destination, fixed_corner: row !== 1 && column !== 1 });
      sourceLeft += source.width;
      targetLeft += destination.width;
    }
    sourceTop += sourceRows[row];
    targetTop += targetRows[row];
  }
  const input = await sharp({
    create: { width: target.width, height: target.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite(patches).png().toBuffer();
  return {
    input,
    diagnostic: {
      control_id: layer.control_id,
      component_id: layer.component_id,
      renderer: 'nine-slice',
      source_size: [sourceWidth, sourceHeight],
      target_rect: target,
      margins: [...margins],
      patches: patchDiagnostics,
      asset_hash: asset.actualHash
    }
  };
}

async function vectorTokenRenderer({ projectPath, layer, target }) {
  const asset = await verifiedAsset(projectPath, layer);
  if (path.extname(asset.assetPath).toLowerCase() !== '.svg') {
    throw Object.assign(new Error(`Vector-token component ${layer.component_id} must use an SVG source.`), {
      code: 'VECTOR_TOKEN_SOURCE_REQUIRED'
    });
  }
  const source = asset.bytes.toString('utf8');
  if (!/<svg(?:\s|>)/i.test(source)) throw new Error(`Vector-token source for ${layer.component_id} is not valid SVG.`);
  const input = await sharp(asset.bytes, { density: 144 }).resize(target.width, target.height, { fit: 'fill' }).png().toBuffer();
  return {
    input,
    diagnostic: {
      control_id: layer.control_id,
      component_id: layer.component_id,
      renderer: 'vector-token',
      source_format: 'svg',
      target_rect: target,
      transform: { rasterization_density: 144, scalable_vector: true },
      asset_hash: asset.actualHash
    }
  };
}

const rendererRegistry = Object.freeze({
  exact: exactRenderer,
  'nine-slice': nineSliceRenderer,
  'vector-token': vectorTokenRenderer,
  'reference-locked': exactRenderer,
  'local-generated': exactRenderer
});

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]);
}

async function watermarkOverlay(layer, canvas) {
  const content = escapeXml(layer.content || 'PREVIEW');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"><rect x="0" y="${canvas.height - 40}" width="${canvas.width}" height="40" fill="rgba(150,0,0,.72)"/><text x="20" y="${canvas.height - 14}" font-family="sans-serif" font-size="18" font-weight="700" fill="#fff">${content}</text></svg>`);
  return { input: await sharp(svg).png().toBuffer(), diagnostic: { renderer: 'preview-watermark', target_rect: { left: 0, top: 0, ...canvas } } };
}

async function sourceBuffer(projectPath, source, fetchImpl) {
  const localPath = source?.path || source?.local_path;
  if (localPath) return fs.readFile(resolveProjectPath(projectPath, localPath));
  const url = source?.image_url;
  if (!url) throw new Error('Composition underlay source is missing.');
  if (!/^https?:|^data:/i.test(url)) return fs.readFile(resolveProjectPath(projectPath, url));
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Unable to load composition underlay: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function renderComposition({ manifest, projectPath, outputPath, fetchImpl = globalThis.fetch }) {
  const [width, height] = manifest.canvas || [];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('Composition canvas is invalid.');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for remote underlays.');
  const resolvedOutput = resolveProjectPath(projectPath, outputPath);
  const underlayBytes = await sourceBuffer(projectPath, manifest.underlay, fetchImpl);
  const underlayHash = hashBuffer(underlayBytes);
  const base = await sharp(underlayBytes).resize(width, height, { fit: 'fill' }).ensureAlpha().png().toBuffer();
  const overlays = [];
  const diagnostics = [{ renderer: 'underlay', source_hash: underlayHash, target_rect: { left: 0, top: 0, width, height } }];
  for (const layer of manifest.layers || []) {
    if (layer.type === 'component') {
      const target = outputRect(layer, { width, height });
      const renderer = rendererRegistry[layer.renderer || layer.resize_mode];
      if (!renderer) throw Object.assign(new Error(`No renderer registered for ${layer.renderer || layer.resize_mode}.`), { code: 'COMPONENT_RENDERER_MISSING' });
      const rendered = await renderer({ projectPath, layer, target });
      overlays.push({ input: rendered.input, left: target.left, top: target.top });
      diagnostics.push(rendered.diagnostic);
    } else if (layer.type === 'text') {
      const target = outputRect(layer, { width, height });
      const rendered = await renderTextLayer({ projectPath, layer, target, resolveProjectPath, hashBuffer });
      overlays.push({ input: rendered.input, left: target.left, top: target.top });
      diagnostics.push(rendered.diagnostic);
    } else if (layer.type === 'watermark') {
      const rendered = await watermarkOverlay(layer, { width, height });
      overlays.push({ input: rendered.input, left: 0, top: 0 });
      diagnostics.push(rendered.diagnostic);
    }
  }
  const rendered = await sharp(base).composite(overlays).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer({ resolveWithObject: true });
  await ensureDir(path.dirname(resolvedOutput));
  const temporary = `${resolvedOutput}.${process.pid}.tmp`;
  await fs.writeFile(temporary, rendered.data);
  await fs.rename(temporary, resolvedOutput);
  const relativePath = path.relative(projectPath, resolvedOutput).split(path.sep).join('/');
  return {
    schema_version: '1.0',
    id: `${manifest.id}-output`,
    version: manifest.version,
    status: 'generated',
    source: { composition_manifest: manifest.id, composition_manifest_version: manifest.version },
    mode: manifest.mode,
    path: relativePath,
    hash: hashBuffer(rendered.data),
    width: rendered.info.width,
    height: rendered.info.height,
    byte_length: rendered.data.length,
    rendered_at: new Date().toISOString(),
    renderer_version: RENDERER_VERSION,
    underlay_hash: underlayHash,
    render_log: { deterministic_order: true, layers: diagnostics }
  };
}

async function verifyCompositionOutput(projectPath, output, { requireFinal = false } = {}) {
  const issues = [];
  if (!output) return { passed: false, issues: [{ code: 'COMPOSITION_OUTPUT_MISSING', message: 'Composition Output is missing.' }] };
  if (requireFinal && output.mode !== 'final') issues.push({ code: 'FINAL_OUTPUT_REQUIRED', message: 'A final Composition Output is required.' });
  let bytes;
  let metadata;
  try {
    bytes = await fs.readFile(resolveProjectPath(projectPath, output.path));
    metadata = await sharp(bytes).metadata();
  } catch (error) {
    issues.push({ code: 'COMPOSITION_OUTPUT_UNREADABLE', message: error.message });
  }
  if (bytes && hashBuffer(bytes) !== output.hash) issues.push({ code: 'COMPOSITION_OUTPUT_HASH_MISMATCH', message: 'Composition Output hash does not match the file.' });
  if (metadata && (metadata.format !== 'png' || metadata.width !== output.width || metadata.height !== output.height)) {
    issues.push({ code: 'COMPOSITION_OUTPUT_DIMENSION_MISMATCH', message: 'Composition Output PNG dimensions do not match its artifact.' });
  }
  return { passed: issues.length === 0, issues, actual_hash: bytes ? hashBuffer(bytes) : undefined, metadata };
}

async function exportCompositionOutput(projectPath, output, destinationPath) {
  const verification = await verifyCompositionOutput(projectPath, output, { requireFinal: true });
  if (!verification.passed) {
    throw Object.assign(new Error(`Composition Output cannot be exported: ${verification.issues.map((item) => item.message).join('; ')}`), { code: 'FINAL_EXPORT_BLOCKED' });
  }
  await fs.copyFile(resolveProjectPath(projectPath, output.path), destinationPath);
  const exportedHash = hashBuffer(await fs.readFile(destinationPath));
  if (exportedHash !== output.hash) throw Object.assign(new Error('Exported PNG hash does not match Composition Output.'), { code: 'FINAL_EXPORT_HASH_MISMATCH' });
  return { ok: true, filePath: destinationPath, hash: exportedHash };
}

module.exports = {
  RENDERER_VERSION,
  exactRenderer,
  exportCompositionOutput,
  hashBuffer,
  nineSliceRenderer,
  renderComposition,
  rendererRegistry,
  resolveProjectPath,
  vectorTokenRenderer,
  verifyCompositionOutput
};
