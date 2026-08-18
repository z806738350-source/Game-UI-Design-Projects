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
  const evidence = { underlay: { hash: `sha256:${'a'.repeat(64)}` }, overlay: { hash: `sha256:${'b'.repeat(64)}` }, component_board: { hash: `sha256:${'c'.repeat(64)}` } };
  const critique = buildUnderlayCritique({ screenId: 'main', underlayId: 'u1', contract, evidence, deterministic: { slots: { 'bottom-primary': { edge_density: 0.5 } } }, semantic: { confidence: 0.9, suspected_ui_regions: [{ type: 'navigation-like', confidence: 0.86, bbox: [0, 0.9, 1, 0.1] }] } });
  assert.equal(critique.result, 'failed');
  assert.equal(reviewGate(critique).passed, false);
  const repair = planRepairTask(critique, { supports_inpaint: true }, { attempt: 1 });
  assert.equal(repair.repair_mode, 'inpaint');
  assert.throws(() => planRepairTask(critique, { supports_inpaint: false }, { attempt: 3, maxAutomaticAttempts: 2 }), /limit reached/);
});

test('corroborated semantic busyness, contrast, hard-edge, and low confidence become blocking issues', () => {
  const contract = contractFixture();
  const evidence = { underlay: { hash: 'h' }, overlay: { hash: 'o' }, component_board: { hash: 'c' } };
  const critique = buildUnderlayCritique({ screenId: 'main', underlayId: 'u2', contract, evidence, deterministic: { thresholds: { edge_density: 0.22, local_contrast: 0.32, color_complexity: 0.42, highlight_density: 0.18, hard_edge_crossing: 0.2 }, slots: { 'bottom-primary': { edge_density: 0.3, local_contrast: 0.4, color_complexity: 0.5, highlight_density: 0.17, hard_edge_crossing: 0.12 } } }, semantic: { confidence: 0.4, text_like_regions: [{ type: 'fake-text', confidence: 0.9, bbox: [0.2, 0.8, 0.2, 0.1] }], slot_checks: [{ slot_id: 'bottom-primary', subject_overlap: true, subject_overlap_confidence: 0.92, background_busyness: true, contrast_conflict: true, hard_edge_crossing: true }] } });
  assert.equal(critique.result, 'manual-review');
  assert.equal(critique.manual_review.required, true);
  assert.deepEqual(new Set(critique.issues.map((item) => item.type)), new Set(['text-like', 'subject-overlap', 'background-busyness', 'contrast-conflict', 'hard-edge-crossing', 'low-critique-confidence']));
  assert.equal(reviewGate(critique).passed, false);
});

test('low-confidence subject overlap is advisory while a high-confidence focal crossing blocks', () => {
  const contract = contractFixture(); const evidence = { underlay: { hash: 'h' }, overlay: { hash: 'o' }, component_board: { hash: 'c' } };
  const base = { screenId: 'main', contract, evidence, deterministic: { thresholds: { edge_density: 0.22, local_contrast: 0.32, color_complexity: 0.42, highlight_density: 0.18, hard_edge_crossing: 0.2 }, slots: { 'bottom-primary': { edge_density: 0, local_contrast: 0, color_complexity: 0, highlight_density: 0, hard_edge_crossing: 0 } } } };
  const advisory = buildUnderlayCritique({ ...base, underlayId: 'advisory', semantic: { confidence: 0.95, slot_checks: [{ slot_id: 'bottom-primary', subject_overlap: true, subject_overlap_confidence: 0.55 }] } });
  const blocking = buildUnderlayCritique({ ...base, underlayId: 'blocking', semantic: { confidence: 0.95, slot_checks: [{ slot_id: 'bottom-primary', subject_overlap: true, subject_overlap_confidence: 0.92 }] } });
  assert.equal(reviewGate(advisory).passed, true);
  assert.equal(reviewGate(blocking).passed, false);
});

test('semantic hard-edge and low-confidence architecture findings do not block when pixels contradict them', () => {
  const contract = contractFixture();
  const evidence = { underlay: { hash: 'h' }, overlay: { hash: 'o' }, component_board: { hash: 'c' } };
  const critique = buildUnderlayCritique({
    screenId: 'main', underlayId: 'clean', contract, evidence,
    deterministic: { thresholds: { edge_density: 0.22, local_contrast: 0.32, color_complexity: 0.42, highlight_density: 0.18, hard_edge_crossing: 0.2 }, slots: { 'bottom-primary': { edge_density: 0, local_contrast: 0.03, color_complexity: 0.04, highlight_density: 0, hard_edge_crossing: 0 } } },
    semantic: { confidence: 0.97, suspected_ui_regions: [{ type: 'architectural-panel', confidence: 0.63, bbox: [0.2, 0.2, 0.2, 0.2] }], text_like_regions: [], slot_checks: [{ slot_id: 'bottom-primary', subject_overlap: false, background_busyness: 0.55, contrast_conflict: true, hard_edge_crossing: true, ui_like_contamination: { detected: false, confidence: 0.98 } }] }
  });
  assert.equal(critique.result, 'passed');
  assert.equal(reviewGate(critique).passed, true);
  assert.ok(critique.issues.every((item) => item.severity === 'minor'));
});

test('strict critique cannot pass with only an Underlay and no overlay/component evidence', () => {
  const critique = buildUnderlayCritique({ screenId: 'main', underlayId: 'u3', contract: contractFixture(), evidence: { underlay: { hash: 'only-underlay' } }, semantic: { confidence: 0.95, suspected_ui_regions: [], text_like_regions: [], slot_checks: [] } });
  assert.equal(critique.result, 'manual-review');
  assert.ok(critique.issues.some((item) => item.type === 'incomplete-review-inputs'));
  assert.equal(reviewGate(critique).passed, false);
});

test('waiver must be explicit and applies by stable issue id', () => {
  const critique = { result: 'failed', issues: [{ issue_id: 'issue-1', severity: 'critical' }], manual_waivers: [{ issue_id: 'issue-1', reason: '设计负责人确认该区域属于场景元素，不构成功能入口' }] };
  assert.equal(reviewGate(critique).passed, true);
});
