const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
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
  return {
    state, asset_path: path.relative(projectPath, targetPath), asset_hash: await assetHash(targetPath),
    ...(metadata ? { intrinsic_size: [metadata.width, metadata.height], mime: metadata.mime } : { mime: 'image/svg+xml' })
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
    if (!Array.isArray(family.intrinsic_size) || family.intrinsic_size.some((value) => !Number.isFinite(value) || value <= 0)) errors.push(`${family.id} requires intrinsic_size`);
    if (family.reuse_mode === 'nine-slice') {
      const margins = family.slice?.margins;
      if (!Array.isArray(margins) || margins.length !== 4 || margins.some((value) => !Number.isFinite(value) || value < 0)) errors.push(`${family.id} requires four valid 9-slice margins`);
    }
    if (strict && ['button', 'navigation', 'tab', 'resource-bar', 'icon'].includes(family.category) && family.reuse_mode === 'local-generated') errors.push(`${family.id} cannot be local-generated in strict mode`);
    if (strict && family.status !== 'approved') errors.push(`${family.id} is not approved`);
  }
  return errors;
}

module.exports = { assetHash, importComponentAsset, validateComponentContract };
