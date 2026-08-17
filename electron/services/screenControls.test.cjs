const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeControls, validateControls } = require('./screenControls.cjs');

test('migrates legacy labels with traceable unique stable ids', () => {
  const controls = normalizeControls(['返回按钮', '返回按钮']);
  assert.deepEqual(controls.map((item) => item.id), ['control-1', 'control-2']);
  assert.deepEqual(controls.map((item) => item.migrated_from_label), ['返回按钮', '返回按钮']);
  assert.deepEqual(validateControls(controls), []);
});

test('preserves an existing id when the label changes', () => {
  const [control] = normalizeControls([{ id: 'confirm-purchase', label: '确认购买', role: 'primary-action', required: true }]);
  const [renamed] = normalizeControls([{ ...control, label: '立即兑换' }]);
  assert.equal(renamed.id, 'confirm-purchase');
  assert.equal(renamed.label, '立即兑换');
});
