const test = require('node:test');
const assert = require('node:assert/strict');
const { imageMetadataFromBuffer } = require('./imageMetadata.cjs');
const { generateUnderlayContract } = require('./underlayContract.cjs');
const { renderLayoutGuide } = require('./layoutGuideRenderer.cjs');
const { buildUnderlayCritique, reviewGate } = require('./underlayCritique.cjs');
const { planRepairTask } = require('./underlayRepair.cjs');

function contractFixture() {
  const project = { screen_id: 'main', canvas_spec: { width: 1536, height: 864 } };
  const bindings = { id: 'bindings', status: 'approved', bindings: [{ control_id: 'save', slot_id: 'bottom-primary' }] };
  const layout = { id: 'layout', status: 'approved', slots: [{ id: 'bottom-primary', rect: { x: 0.2, y: 0.8, width: 0.6, height: 0.1 }, keep_clear_margin: { top: 0.03 }, underlay_policy: { keep_clear: true, detail_level: 'low', preferred_treatment: 'darkened-soft-gradient', visual_noise_budget: 0.2 } }] };
  return generateUnderlayContract(project, layout, bindings);
}

test('underlay contract produces a real grayscale PNG layout guide with provenance hash', () => {
  const contract = contractFixture();
  assert.deepEqual(contract.reserved_regions[0].bbox, [0.2, 0.77, 0.6, 0.13]);
  const guide = renderLayoutGuide(contract);
  const metadata = imageMetadataFromBuffer(guide.buffer);
  assert.deepEqual({ width: metadata.width, height: metadata.height, format: metadata.format }, { width: 384, height: 216, format: 'png' });
  assert.match(guide.hash, /^sha256:[a-f0-9]{64}$/);
});

test('critique blocks known UI contamination and bounded repair uses provider capability', () => {
  const contract = contractFixture();
  const critique = buildUnderlayCritique({ screenId: 'main', underlayId: 'u1', contract, deterministic: { slots: { 'bottom-primary': { edge_density: 0.5 } } }, semantic: { confidence: 0.9, suspected_ui_regions: [{ type: 'navigation-like', confidence: 0.86, bbox: [0, 0.9, 1, 0.1] }] } });
  assert.equal(critique.result, 'failed');
  assert.equal(reviewGate(critique).passed, false);
  const repair = planRepairTask(critique, { supports_inpaint: true }, { attempt: 1 });
  assert.equal(repair.repair_mode, 'inpaint');
  assert.throws(() => planRepairTask(critique, { supports_inpaint: false }, { attempt: 3, maxAutomaticAttempts: 2 }), /limit reached/);
});

test('waiver must be explicit and applies by stable issue id', () => {
  const critique = { result: 'failed', issues: [{ issue_id: 'issue-1', severity: 'critical' }], manual_waivers: [{ issue_id: 'issue-1', reason: '设计负责人确认该区域属于场景元素，不构成功能入口' }] };
  assert.equal(reviewGate(critique).passed, true);
});
