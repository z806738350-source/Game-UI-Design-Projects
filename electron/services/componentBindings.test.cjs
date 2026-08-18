const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBindings } = require('./componentBindings.cjs');
const { CONTROL_ROLE_POLICIES, BINDING_POLICY_VERSION } = require('./controlRolePolicy.cjs');
const { downstreamArtifacts } = require('./artifactDependencies.cjs');

const screen = {
  required_controls: [
    { id: 'primary', label: '主操作', role: 'primary-action', required: true },
    { id: 'nav', label: '导航', role: 'navigation', required: true },
    { id: 'gold', label: '金币', role: 'resource', required: true }
  ]
};
const families = [
  { id: 'button.primary', category: 'button', status: 'approved', states: { default: { asset_path: 'a.png' }, pressed: { asset_path: 'a.png' }, disabled: { asset_path: 'a.png' } } },
  { id: 'nav.bar', category: 'navigation', status: 'approved', states: { default: { asset_path: 'n.png' }, selected: { asset_path: 'n.png' }, disabled: { asset_path: 'n.png' } } },
  { id: 'bar.gold', category: 'resource-bar', status: 'approved', states: { default: { asset_path: 'g.png' } } }
];
const componentContract = { families };
const fontManifest = { roles: { 'button-label': {}, 'navigation-label': {}, numeric: {}, body: {} } };

function binding(controlId, componentId, extra = {}) {
  return { control_id: controlId, component_id: componentId, state: 'default', slot_id: `${controlId}-slot`, ...extra };
}

function compatibleBindings() {
  return {
    bindings: [
      binding('primary', 'button.primary', { font_role: 'button-label' }),
      binding('nav', 'nav.bar', { font_role: 'navigation-label' }),
      binding('gold', 'bar.gold', { font_role: 'numeric' })
    ]
  };
}

test('binding policy vocabulary is frozen and versioned', () => {
  assert.equal(BINDING_POLICY_VERSION, 'binding-policy-v1');
  assert.ok(Object.isFrozen(CONTROL_ROLE_POLICIES));
  for (const role of ['primary-action', 'secondary-action', 'action', 'navigation', 'tab', 'resource', 'icon-action', 'status-badge', 'list-row', 'content-panel']) {
    assert.ok(CONTROL_ROLE_POLICIES[role], `missing role policy for ${role}`);
  }
});

test('100 percent coverage with fully compatible bindings passes', () => {
  const result = validateBindings(compatibleBindings(), screen, componentContract, fontManifest, { strict: true });
  assert.deepEqual(result.errors, []);
  assert.equal(result.coverage.bound_required_controls, 3);
});

test('an unselected component is rejected instead of defaulting', () => {
  const artifact = compatibleBindings();
  artifact.bindings[0].component_id = '';
  const result = validateBindings(artifact, screen, componentContract, fontManifest, { strict: true });
  assert.ok(result.errors.some((error) => error.startsWith('BINDING_COMPONENT_NOT_SELECTED')));
});

test('primary action cannot bind a resource-bar family', () => {
  const artifact = compatibleBindings();
  artifact.bindings[0] = binding('primary', 'bar.gold');
  const result = validateBindings(artifact, screen, componentContract, fontManifest, { strict: true });
  assert.ok(result.errors.some((error) => error.startsWith('BINDING_COMPONENT_CATEGORY_MISMATCH')));
});

test('navigation control cannot bind a plain button family', () => {
  const artifact = compatibleBindings();
  artifact.bindings[1] = binding('nav', 'button.primary', { font_role: 'navigation-label' });
  const result = validateBindings(artifact, screen, componentContract, fontManifest, { strict: true });
  assert.ok(result.errors.some((error) => error.startsWith('BINDING_COMPONENT_CATEGORY_MISMATCH')));
});

test('100 percent coverage with a semantic mismatch cannot be approved', () => {
  const artifact = compatibleBindings();
  artifact.bindings[2] = binding('gold', 'button.primary');
  const result = validateBindings(artifact, screen, componentContract, fontManifest, { strict: true });
  assert.equal(result.coverage.unbound_required_controls.length, 0);
  assert.ok(result.errors.length > 0, 'semantic mismatch must block approval even at full coverage');
});

test('font role must exist in the Font Manifest and match the control role', () => {
  const missing = compatibleBindings();
  missing.bindings[0].font_role = 'nonexistent-role';
  assert.ok(validateBindings(missing, screen, componentContract, fontManifest, { strict: true }).errors.some((error) => error.startsWith('BINDING_FONT_ROLE_MISSING')));
  const mismatch = compatibleBindings();
  mismatch.bindings[0].font_role = 'numeric';
  assert.ok(validateBindings(mismatch, screen, componentContract, fontManifest, { strict: true }).errors.some((error) => error.startsWith('BINDING_FONT_ROLE_MISMATCH')));
});

test('removing a component state or revoking approval fails the binding', () => {
  const stripped = structuredClone(componentContract);
  delete stripped.families[0].states.pressed;
  assert.ok(validateBindings(compatibleBindings(), screen, stripped, fontManifest, { strict: true }).errors.some((error) => error.startsWith('BINDING_COMPONENT_STATE_MISSING')));
  const revoked = structuredClone(componentContract);
  revoked.families[1].status = 'reviewed';
  assert.ok(validateBindings(compatibleBindings(), screen, revoked, fontManifest, { strict: true }).errors.some((error) => error.startsWith('BINDING_COMPONENT_NOT_APPROVED')));
});

test('unknown control role fails closed in strict mode but warns otherwise', () => {
  const exotic = { required_controls: [{ id: 'mystery', label: '神秘控件', role: 'quantum-toggle', required: true }] };
  const artifact = { bindings: [binding('mystery', 'button.primary')] };
  const strict = validateBindings(artifact, exotic, componentContract, fontManifest, { strict: true });
  assert.ok(strict.errors.some((error) => error.startsWith('BINDING_UNKNOWN_CONTROL_ROLE')));
  const guided = validateBindings(artifact, exotic, componentContract, fontManifest, { strict: false });
  assert.deepEqual(guided.errors, []);
  assert.ok(guided.warnings.length > 0);
});

test('client-supplied approved flags are not part of the validation gate', () => {
  const hostile = compatibleBindings();
  hostile.bindings.forEach((item) => { item.approved = true; });
  const withFlag = validateBindings(hostile, screen, componentContract, fontManifest, { strict: true });
  hostile.bindings.forEach((item) => { delete item.approved; });
  const withoutFlag = validateBindings(hostile, screen, componentContract, fontManifest, { strict: true });
  assert.deepEqual(withFlag.errors, withoutFlag.errors);
});

test('font manifest changes invalidate bindings downstream', () => {
  assert.ok(downstreamArtifacts('font-manifest').includes('component-bindings'));
  assert.ok(downstreamArtifacts('screen-contract').includes('component-bindings'));
});
