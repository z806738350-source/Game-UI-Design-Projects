const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildUnderlayCritique, reviewGate } = require('./underlayCritique.cjs');

const sampleRoot = path.join(__dirname, '..', '..', 'docs', 'golden-samples');
for (const file of ['functional-dense.json', 'visual-hero.json', 'existing-continuation.json']) {
  test(`golden sample ${file} never auto-passes known critical contamination`, () => {
    const sample = JSON.parse(fs.readFileSync(path.join(sampleRoot, file), 'utf8'));
    const contract = { id: `${sample.id}-underlay`, reserved_regions: [{ slot_id: 'primary', bbox: [0.2, 0.8, 0.6, 0.15] }] };
    const semantic = {
      confidence: 0.95,
      suspected_ui_regions: sample.known_issues.some((item) => /button|navigation|text/.test(item)) ? [{ type: sample.known_issues[0], confidence: 0.9, bbox: [0.1, 0.8, 0.8, 0.15] }] : [],
      slot_checks: [{ slot_id: 'primary', subject_overlap: sample.known_issues.some((item) => /subject/.test(item)), ui_like_contamination: { detected: sample.known_issues.some((item) => /button|navigation/.test(item)), type: sample.known_issues[0], confidence: 0.9 } }]
    };
    const critique = buildUnderlayCritique({ screenId: sample.id, underlayId: 'known-bad', contract, semantic });
    assert.equal(reviewGate(critique).passed, false);
    assert.notEqual(critique.result, 'passed');
  });
}
