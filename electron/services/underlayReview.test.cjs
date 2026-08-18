const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { computeDeterministicMetrics, normalizeSemanticEvidence, writeComponentBoard, writeRepairMask, writeReviewOverlay } = require('./underlayReview.cjs');

test('real pixels produce deterministic slot metrics, review overlay, component board, and repair mask', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-review-'));
  try {
    const width = 160; const height = 80; const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const value = x < 80 ? 80 : ((x + y) % 2 ? 255 : 0); const offset = (y * width + x) * 3;
      raw[offset] = value; raw[offset + 1] = value; raw[offset + 2] = value;
    }
    const image = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const imagePath = path.join(root, 'underlay.png'); await fs.writeFile(imagePath, image);
    const contract = { reserved_regions: [{ slot_id: 'quiet', bbox: [0, 0, 0.5, 1] }, { slot_id: 'busy', bbox: [0.5, 0, 0.5, 1] }] };
    const metrics = await computeDeterministicMetrics(imagePath, contract);
    assert.equal(metrics.threshold_version, 'underlay-metrics-v1');
    assert.ok(metrics.slots.busy.edge_density > metrics.slots.quiet.edge_density);
    assert.ok(metrics.slots.busy.local_contrast > metrics.slots.quiet.local_contrast);
    assert.ok(metrics.slots.busy.color_complexity > metrics.slots.quiet.color_complexity);
    assert.ok(metrics.slots.busy.highlight_density > metrics.slots.quiet.highlight_density);
    assert.ok(metrics.slots.busy.hard_edge_crossing > metrics.slots.quiet.hard_edge_crossing);
    const overlay = await writeReviewOverlay(root, 'main', imagePath, contract, { text_like_regions: [{ type: 'fake-text', bbox: [0.6, 0.2, 0.2, 0.2] }] });
    assert.match(overlay.hash, /^sha256:/); assert.notEqual(overlay.hash, metrics.image_hash); assert.equal((await sharp(path.join(root, overlay.path)).metadata()).width, width);
    const componentRelative = 'style/components/button.png'; const componentPath = path.join(root, componentRelative); await fs.mkdir(path.dirname(componentPath), { recursive: true });
    await fs.writeFile(componentPath, await sharp({ create: { width: 80, height: 30, channels: 4, background: '#5b8cffff' } }).png().toBuffer());
    const board = await writeComponentBoard(root, 'main', { families: [{ id: 'button.primary', states: { default: { asset_path: componentRelative } } }] }); assert.equal(board.count, 1); assert.match(board.hash, /^sha256:/);
    const mask = await writeRepairMask(root, 'main', { id: 'repair-1', target_regions: ['busy'], preserve_regions: [] }, contract, width, height);
    const maskStats = await sharp(path.join(root, mask.path)).stats(); assert.ok(maskStats.channels[0].max > maskStats.channels[0].min);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('semantic review normalizes pixel-space model boxes before overlay rendering', () => {
  const normalized = normalizeSemanticEvidence({
    confidence: 0.97,
    suspected_ui_regions: [
      { type: 'row-like', bbox: [40, 320, 280, 56], confidence: 0.7 },
      { type: 'clamped', bbox: [980, 980, 100, 100], confidence: 0.8 },
      { type: 'invalid', bbox: ['bad', 0, 1, 1], confidence: 0.3 }
    ]
  }, 1024, 1024);
  assert.deepEqual(normalized.suspected_ui_regions[0].bbox, [40 / 1024, 320 / 1024, 280 / 1024, 56 / 1024]);
  assert.deepEqual(normalized.suspected_ui_regions[1].bbox, [980 / 1024, 980 / 1024, 44 / 1024, 44 / 1024]);
  assert.equal(normalized.suspected_ui_regions[2].bbox, undefined);
  assert.equal(normalized.coordinate_space, 'normalized-0-1');
});
