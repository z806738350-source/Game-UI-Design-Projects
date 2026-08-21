const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBindings } = require('./componentBindings.cjs');
const { validateLayout } = require('./layoutValidator.cjs');
const { downstreamArtifacts } = require('./artifactDependencies.cjs');

const screen = { required_controls: [{ id: 'save', label: '保存', required: true }, { id: 'help', label: '帮助', required: false }] };
const components = { families: [{ id: 'button.primary', category: 'button', status: 'approved', reuse_mode: 'nine-slice', intrinsic_size: [200, 80], slice: { margins: [20, 20, 12, 12] }, states: { default: { asset_path: 'button.png', asset_hash: 'hash' } } }] };

test('bindings require 100 percent coverage and an existing component state', () => {
  const incomplete = validateBindings({ bindings: [] }, screen, components);
  assert.deepEqual(incomplete.coverage.unbound_required_controls, ['save']);
  const complete = validateBindings({ bindings: [{ control_id: 'save', component_id: 'button.primary', state: 'default', slot_id: 'bottom-primary', approved: true }] }, screen, components);
  assert.deepEqual(complete.errors, []);
  assert.equal(complete.coverage.bound_required_controls, 1);
});

test('strict layout validates normalized slots and underlay policy', () => {
  const bindings = { bindings: [{ control_id: 'save', component_id: 'button.primary', state: 'default', slot_id: 'bottom-primary', approved: true }] };
  const layout = { slots: [{ id: 'bottom-primary', rect: { x: 0.25, y: 0.8, width: 0.5, height: 0.1 }, underlay_policy: { keep_clear: true } }] };
  assert.deepEqual(validateLayout(layout, bindings, components, { width: 400, height: 800 }, { strict: true }), []);
  const invalid = structuredClone(layout); invalid.slots[0].underlay_policy.keep_clear = false;
  assert.match(validateLayout(invalid, bindings, components, { width: 400, height: 800 }, { strict: true })[0], /keep-clear/);
});

test('component contract invalidates bindings through fidelity', () => {
  const downstream = downstreamArtifacts('component-contract', { profile: 'strict' });
  assert.ok(downstream.includes('component-bindings'));
  assert.ok(downstream.includes('underlay-contract'));
  assert.ok(downstream.includes('fidelity-report'));
});

test('label-only control edits keep bindings valid while role edits do not', () => {
  const legacy = { required_controls: [{ id: 'save', label: '保存', required: true }] };
  const complete = validateBindings({ bindings: [{ control_id: 'save', component_id: 'button.primary', state: 'default', slot_id: 'bottom-primary' }] }, legacy, components);
  assert.deepEqual(complete.errors, []);
  const relabeled = { required_controls: [{ id: 'save', label: '保存阵容', required: true }] };
  assert.deepEqual(validateBindings({ bindings: [{ control_id: 'save', component_id: 'button.primary', state: 'default', slot_id: 'bottom-primary' }] }, relabeled, components).errors, []);
  const reRole = { required_controls: [{ id: 'save', label: '保存', role: 'resource', required: true }] };
  const mismatched = validateBindings({ bindings: [{ control_id: 'save', component_id: 'button.primary', state: 'default', slot_id: 'bottom-primary' }] }, reRole, components, null, { strict: true });
  assert.ok(mismatched.errors.some((error) => error.startsWith('BINDING_COMPONENT_CATEGORY_MISMATCH')));
});
