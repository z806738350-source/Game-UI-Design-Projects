const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('./sharpRuntime.cjs');
const { ensureDir } = require('./jsonStore.cjs');

const METRIC_THRESHOLDS = Object.freeze({
  version: 'underlay-metrics-v1', edge_density: 0.22, local_contrast: 0.32,
  color_complexity: 0.42, highlight_density: 0.18, hard_edge_crossing: 0.2
});

function hashBuffer(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function safePath(projectPath, filePath) {
  const resolved = path.resolve(projectPath, filePath);
  const relative = path.relative(projectPath, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Underlay evidence path escapes the project workspace.');
  return resolved;
}

function pixelRect(bbox, width, height) {
  const [x, y, w, h] = bbox || [];
  if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1) throw new Error('Reserved region has an invalid normalized bbox.');
  const left = Math.round(x * width); const top = Math.round(y * height);
  return { left, top, width: Math.max(1, Math.round((x + w) * width) - left), height: Math.max(1, Math.round((y + h) * height) - top) };
}

function normalizedBbox(bbox, width, height) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((value) => !Number.isFinite(Number(value)))) return null;
  let [x, y, w, h] = bbox.map(Number);
  if ([x, y, w, h].some((value) => value > 1)) {
    x /= width; w /= width; y /= height; h /= height;
  }
  x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
  w = Math.max(0, Math.min(1 - x, w)); h = Math.max(0, Math.min(1 - y, h));
  if (w <= 0 || h <= 0) return null;
  return [x, y, w, h];
}

function normalizeSemanticEvidence(semantic = {}, width, height) {
  const normalizeFindings = (findings) => (Array.isArray(findings) ? findings : []).map((finding) => {
    const bbox = normalizedBbox(finding?.bbox, width, height);
    if (!bbox) return { ...finding, bbox: undefined, bbox_normalization: 'invalid-omitted' };
    const changed = JSON.stringify(bbox) !== JSON.stringify(finding.bbox);
    return { ...finding, bbox, ...(changed ? { source_bbox: finding.bbox, bbox_normalization: 'pixel-to-normalized-or-clamped' } : { bbox_normalization: 'already-normalized' }) };
  });
  return {
    ...semantic,
    suspected_ui_regions: normalizeFindings(semantic.suspected_ui_regions),
    text_like_regions: normalizeFindings(semantic.text_like_regions),
    coordinate_space: 'normalized-0-1'
  };
}

async function regionMetrics(bytes, rect) {
  const { data, info } = await sharp(bytes).extract(rect).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  let sum = 0; let squares = 0; let highlights = 0; let edges = 0; let comparisons = 0; let perimeterEdges = 0; let perimeterComparisons = 0;
  const colors = new Set();
  const luminance = new Float32Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * info.channels; const r = data[offset]; const g = data[offset + 1]; const b = data[offset + 2];
    const value = r * 0.2126 + g * 0.7152 + b * 0.0722;
    luminance[index] = value; sum += value; squares += value * value;
    if (value >= 224) highlights += 1;
    colors.add(`${r >> 5}:${g >> 5}:${b >> 5}`);
  }
  const compare = (first, second, perimeter) => {
    comparisons += 1;
    const hard = Math.abs(luminance[first] - luminance[second]) >= 32;
    if (hard) edges += 1;
    if (perimeter) { perimeterComparisons += 1; if (hard) perimeterEdges += 1; }
  };
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    const index = y * info.width + x;
    if (x + 1 < info.width) compare(index, index + 1, y === 0 || y === info.height - 1);
    if (y + 1 < info.height) compare(index, index + info.width, x === 0 || x === info.width - 1);
  }
  const mean = sum / Math.max(1, pixels);
  const standardDeviation = Math.sqrt(Math.max(0, squares / Math.max(1, pixels) - mean * mean));
  return {
    edge_density: edges / Math.max(1, comparisons), local_contrast: standardDeviation / 127.5,
    color_complexity: Math.min(1, colors.size / 96), highlight_density: highlights / Math.max(1, pixels),
    hard_edge_crossing: perimeterEdges / Math.max(1, perimeterComparisons), pixel_count: pixels
  };
}

async function computeDeterministicMetrics(imagePath, contract) {
  const bytes = await fs.readFile(imagePath);
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Underlay dimensions are unavailable.');
  const slots = {};
  for (const region of contract.reserved_regions || []) slots[region.slot_id] = await regionMetrics(bytes, pixelRect(region.bbox, metadata.width, metadata.height));
  return { threshold_version: METRIC_THRESHOLDS.version, thresholds: { ...METRIC_THRESHOLDS }, image_hash: hashBuffer(bytes), width: metadata.width, height: metadata.height, slots };
}

function escapeXml(value) { return String(value).replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]); }

async function writeReviewOverlay(projectPath, screenId, imagePath, contract, semantic = {}, fileName = 'underlay-review-overlay.png') {
  const bytes = await fs.readFile(imagePath); const metadata = await sharp(bytes).metadata();
  const width = metadata.width; const height = metadata.height;
  const regions = (contract.reserved_regions || []).map((region) => {
    const rect = pixelRect(region.bbox, width, height);
    return `<rect x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}" fill="rgba(0,170,255,.12)" stroke="#00d9ff" stroke-width="3"/><rect x="${rect.left}" y="${rect.top}" width="${Math.min(rect.width, 220)}" height="28" fill="rgba(0,0,0,.78)"/><text x="${rect.left + 8}" y="${rect.top + 20}" fill="#fff" font-family="sans-serif" font-size="16">${escapeXml(region.slot_id)}</text>`;
  }).join('');
  const findings = [...(semantic.suspected_ui_regions || []), ...(semantic.text_like_regions || [])].map((finding) => {
    const bbox = normalizedBbox(finding.bbox, width, height);
    if (!bbox) return '';
    const rect = pixelRect(bbox, width, height);
    return `<rect x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}" fill="rgba(255,0,70,.1)" stroke="#ff1744" stroke-width="3" stroke-dasharray="8 5"/><text x="${rect.left + 6}" y="${Math.max(18, rect.top - 5)}" fill="#ff1744" font-family="sans-serif" font-size="15">${escapeXml(finding.type || 'semantic')}</text>`;
  }).join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="rgba(0,0,0,.18)"/>${regions}${findings}</svg>`);
  const output = await sharp(bytes).composite([{ input: svg }]).png().toBuffer();
  const relative = `screens/${screenId}/underlays/${fileName}`;
  const target = safePath(projectPath, relative); await ensureDir(path.dirname(target)); await fs.writeFile(target, output);
  return { path: relative, hash: hashBuffer(output), width, height };
}

async function writeComponentBoard(projectPath, screenId, componentContract) {
  const assets = [];
  for (const family of componentContract?.families || []) {
    const state = family.states?.default || Object.values(family.states || {})[0];
    if (!state?.asset_path) continue;
    const bytes = await fs.readFile(safePath(projectPath, state.asset_path));
    assets.push({ id: family.id, input: await sharp(bytes).resize(180, 100, { fit: 'contain', background: '#121620ff' }).png().toBuffer() });
  }
  const rows = Math.max(1, Math.ceil(assets.length / 4)); const width = 800; const height = rows * 140;
  const layers = [];
  for (let index = 0; index < assets.length; index += 1) {
    const left = (index % 4) * 200 + 10; const top = Math.floor(index / 4) * 140 + 8;
    layers.push({ input: assets[index].input, left, top });
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="190" height="28"><text x="4" y="20" fill="#fff" font-family="sans-serif" font-size="14">${escapeXml(assets[index].id)}</text></svg>`);
    layers.push({ input: label, left, top: top + 104 });
  }
  const output = await sharp({ create: { width, height, channels: 4, background: '#121620ff' } }).composite(layers).png().toBuffer();
  const relative = `screens/${screenId}/underlays/component-review-board.png`; const target = safePath(projectPath, relative);
  await ensureDir(path.dirname(target)); await fs.writeFile(target, output);
  return { path: relative, hash: hashBuffer(output), count: assets.length, width, height };
}

async function writeRepairMask(projectPath, screenId, task, contract, width, height) {
  const targetIds = new Set(task.target_regions || []); const preserveIds = new Set(task.preserve_regions || []);
  const rects = (contract.reserved_regions || []).filter((region) => targetIds.has(region.slot_id) && !preserveIds.has(region.slot_id)).map((region) => {
    const rect = pixelRect(region.bbox, width, height); return `<rect x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}" fill="#fff"/>`;
  }).join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#000"/>${rects}</svg>`);
  const output = await sharp(svg).png().toBuffer(); const relative = `screens/${screenId}/underlays/${task.id}-mask.png`; const target = safePath(projectPath, relative);
  await ensureDir(path.dirname(target)); await fs.writeFile(target, output);
  return { path: relative, hash: hashBuffer(output), width, height };
}

module.exports = { METRIC_THRESHOLDS, computeDeterministicMetrics, hashBuffer, normalizeSemanticEvidence, safePath, writeComponentBoard, writeRepairMask, writeReviewOverlay };
