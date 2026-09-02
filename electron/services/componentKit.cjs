const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('./sharpRuntime.cjs');
const { ensureDir } = require('./jsonStore.cjs');
const { readImageMetadata } = require('./imageMetadata.cjs');

async function assetHash(filePath) {
  return `sha256:${crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex')}`;
}

async function importComponentAsset(projectPath, sourcePath, input = {}) {
  const componentId = String(input.componentId || '').trim();
  const state = String(input.state || 'default').trim();
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i.test(componentId)) throw new Error('componentId must be a stable dotted or dashed id.');
  if (!/^[a-z0-9-]+$/i.test(state)) throw new Error('state must be a stable id.');
  const extension = path.extname(sourcePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(extension)) throw new Error('Unsupported component asset type.');
  const directory = path.join(projectPath, 'style', 'components', componentId.replaceAll('.', '-'));
  await ensureDir(directory);
  const targetPath = path.join(directory, `${state}${extension}`);
  await fs.copyFile(sourcePath, targetPath);
  const metadata = extension === '.svg' ? null : await readImageMetadata(targetPath);
  const rasterMetadata = await sharp(targetPath).metadata().catch(() => null);
  const width = metadata?.width || rasterMetadata?.width;
  const height = metadata?.height || rasterMetadata?.height;
  if (!width || !height) throw new Error('Component asset dimensions could not be read.');
  return {
    state, asset_path: path.relative(projectPath, targetPath), asset_hash: await assetHash(targetPath),
    source_bbox: Array.isArray(input.sourceBBox) && Number(input.sourceBBox[2]) > 0 && Number(input.sourceBBox[3]) > 0
      ? input.sourceBBox.map(Number) : [0, 0, width, height],
    alpha_channel: extension === '.svg' || Boolean(rasterMetadata?.hasAlpha),
    intrinsic_size: [width, height],
    mime: extension === '.svg' ? 'image/svg+xml' : metadata.mime
  };
}

function validateComponentContract(contract, { strict = false } = {}) {
  const errors = [];
  const families = Array.isArray(contract?.families) ? contract.families : [];
  const ids = new Set();
  if (!families.length) errors.push('families must contain at least one component');
  for (const family of families) {
    if (!family.id || ids.has(family.id)) errors.push(`component id is missing or duplicated: ${family.id || '<none>'}`);
    ids.add(family.id);
    if (!['exact', 'nine-slice', 'vector-token', 'reference-locked', 'local-generated'].includes(family.reuse_mode)) errors.push(`${family.id} has invalid reuse_mode`);
    if (!family.states?.default?.asset_path || !family.states.default.asset_hash) errors.push(`${family.id} requires an identified default asset`);
    if (strict && ['button', 'navigation', 'tab'].includes(family.category)) {
      if (!family.states?.disabled) errors.push(`${family.id} requires a disabled state`);
      if (!family.states?.pressed && !family.states?.selected) errors.push(`${family.id} requires a pressed or selected state`);
    }
    if (!Array.isArray(family.intrinsic_size) || family.intrinsic_size.some((value) => !Number.isFinite(value) || value <= 0)) errors.push(`${family.id} requires intrinsic_size`);
    if (family.reuse_mode === 'nine-slice') {
      const margins = family.slice?.margins;
      if (!Array.isArray(margins) || margins.length !== 4 || margins.some((value) => !Number.isInteger(value) || value < 0)) errors.push(`${family.id} requires four integer 9-slice margins`);
      else if (margins[0] + margins[1] >= family.intrinsic_size[0] || margins[2] + margins[3] >= family.intrinsic_size[1]) errors.push(`${family.id} 9-slice margins leave no scalable center`);
    }
    if (strict && ['button', 'navigation', 'tab', 'resource-bar', 'icon'].includes(family.category) && family.reuse_mode === 'local-generated') errors.push(`${family.id} cannot be local-generated in strict mode`);
    if (strict && family.status !== 'approved') errors.push(`${family.id} is not approved`);
  }
  return errors;
}

function resolveAssetPath(projectPath, relativePath) {
  const root = path.resolve(projectPath);
  const resolved = path.resolve(root, String(relativePath || ''));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('Component asset path escapes the project workspace.');
  return resolved;
}

async function validateComponentAssets(projectPath, contract) {
  const errors = [];
  for (const family of contract?.families || []) {
    for (const [stateId, state] of Object.entries(family.states || {})) {
      if (!state?.asset_path) continue;
      let filePath;
      try { filePath = resolveAssetPath(projectPath, state.asset_path); }
      catch (error) { errors.push(`${family.id}:${stateId} ${error.message}`); continue; }
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile()) { errors.push(`${family.id}:${stateId} asset file is missing`); continue; }
      const hash = await assetHash(filePath);
      if (hash !== state.asset_hash) errors.push(`${family.id}:${stateId} asset hash does not match the current file`);
      const extension = path.extname(filePath).toLowerCase();
      if (extension === '.svg') {
        if (state.mime !== 'image/svg+xml') errors.push(`${family.id}:${stateId} MIME does not match SVG`);
        const vector = await sharp(filePath).metadata().catch(() => null);
        if (!vector?.width || !vector?.height) errors.push(`${family.id}:${stateId} is not a readable SVG`);
        else if (JSON.stringify(state.intrinsic_size) !== JSON.stringify([vector.width, vector.height])) errors.push(`${family.id}:${stateId} dimensions do not match the current SVG`);
        if (state.alpha_channel !== true) errors.push(`${family.id}:${stateId} alpha metadata does not match SVG`);
      } else {
        const metadata = await readImageMetadata(filePath).catch(() => null);
        const raster = await sharp(filePath).metadata().catch(() => null);
        if (!metadata || !raster) errors.push(`${family.id}:${stateId} is not a readable image`);
        else {
          if (state.mime !== metadata.mime) errors.push(`${family.id}:${stateId} MIME does not match the current file`);
          if (JSON.stringify(state.intrinsic_size) !== JSON.stringify([metadata.width, metadata.height])) errors.push(`${family.id}:${stateId} dimensions do not match the current file`);
          if (state.alpha_channel !== Boolean(raster.hasAlpha)) errors.push(`${family.id}:${stateId} alpha metadata does not match the current file`);
        }
      }
      if (!Array.isArray(state.source_bbox) || state.source_bbox.length !== 4) errors.push(`${family.id}:${stateId} requires source_bbox`);
    }
  }
  return errors;
}

async function importForgeManifest(projectPath, manifestPath) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const entries = Array.isArray(manifest.components) ? manifest.components : Array.isArray(manifest.assets) ? manifest.assets : [];
  if (!entries.length) throw new Error('Game UI Forge Manifest does not contain components or assets.');
  const families = new Map();
  for (const entry of entries) {
    const componentId = String(entry.component_id || entry.componentId || entry.family || entry.id || '').trim();
    if (!componentId) throw new Error('Forge component entry is missing component_id.');
    const state = String(entry.state || 'default');
    const sourcePath = path.resolve(path.dirname(manifestPath), String(entry.path || entry.asset_path || entry.file || ''));
    const imported = await importComponentAsset(projectPath, sourcePath, { componentId, state, sourceBBox: entry.source_bbox });
    const previous = families.get(componentId) || {
      id: componentId, name: entry.name || componentId, category: entry.category || 'page-specific',
      status: 'reviewed', source: { type: 'game-ui-forge', manifest: path.basename(manifestPath) },
      reuse_mode: entry.reuse_mode || 'exact', text_policy: entry.text_policy || 'none',
      scale_policy: entry.scale_policy || { uniform_only: true, min_scale: 1, max_scale: 1 },
      locked_properties: entry.locked_properties || [], states: {}
    };
    previous.intrinsic_size ||= imported.intrinsic_size;
    previous.states[state] = imported;
    if (entry.slice) previous.slice = entry.slice;
    families.set(componentId, previous);
  }
  return [...families.values()];
}

module.exports = { assetHash, importComponentAsset, importForgeManifest, validateComponentAssets, validateComponentContract };
