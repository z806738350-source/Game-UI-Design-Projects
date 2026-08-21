const test = require('node:test');
const assert = require('node:assert/strict');
const { validateBindings } = require('./componentBindings.cjs');
const { textLayer } = require('./compositor.cjs');
const { CONTROL_ROLE_POLICIES, BINDING_POLICY_VERSION } = require('./controlRolePolicy.cjs');
const { BINDING_VALIDATION_CODES } = require('./errorCodes.cjs');
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
  assert.ok(downstreamArtifacts('font-manifest', { profile: 'strict' }).includes('component-bindings'));
  assert.ok(downstreamArtifacts('screen-contract', { profile: 'strict' }).includes('component-bindings'));
});

test('binding validation codes are frozen in the shared registry', () => {
  assert.ok(Object.isFrozen(BINDING_VALIDATION_CODES));
  for (const code of ['BINDING_COMPONENT_NOT_SELECTED', 'BINDING_COMPONENT_NOT_APPROVED', 'BINDING_COMPONENT_STATE_MISSING', 'BINDING_COMPONENT_CATEGORY_MISMATCH', 'BINDING_FONT_ROLE_MISMATCH', 'BINDING_FONT_ROLE_MISSING', 'BINDING_UNKNOWN_CONTROL_ROLE', 'BINDING_STATE_REQUIRED', 'BINDING_FONT_ROLE_REQUIRED', 'BINDING_GENERIC_ROLE_UNRESOLVED']) {
    assert.equal(BINDING_VALIDATION_CODES[code], code);
  }
});

test('an explicit state is always required; there is no default fallback', () => {
  const noState = compatibleBindings();
  delete noState.bindings[0].state;
  for (const strict of [true, false]) {
    const result = validateBindings(noState, screen, componentContract, fontManifest, { strict });
    assert.ok(result.errors.some((error) => error.startsWith('BINDING_STATE_REQUIRED')), `strict=${strict} must reject a missing state`);
  }
  const bogusState = compatibleBindings();
  bogusState.bindings[0].state = 'hover';
  assert.ok(validateBindings(bogusState, screen, componentContract, fontManifest, { strict: true }).errors.some((error) => error.startsWith('BINDING_COMPONENT_STATE_MISSING')));
});

test('text-slot families require an explicit font role; none/baked families do not', () => {
  const textScreen = { required_controls: [{ id: 'panel', label: '内容面板', role: 'content-panel', required: true }, { id: 'icon', label: '图标', role: 'icon-action', required: true }] };
  const textFamilies = {
    families: [
      { id: 'panel.body', category: 'content-panel', status: 'approved', text_policy: 'text-slot', states: { default: { asset_path: 'p.png' } } },
      { id: 'icon.flat', category: 'icon', status: 'approved', text_policy: 'none', states: { default: { asset_path: 'i.png' } } }
    ]
  };
  const missingRole = { bindings: [{ control_id: 'panel', component_id: 'panel.body', state: 'default', slot_id: 'panel-slot' }, { control_id: 'icon', component_id: 'icon.flat', state: 'default', slot_id: 'icon-slot' }] };
  const rejected = validateBindings(missingRole, textScreen, textFamilies, fontManifest, { strict: true });
  assert.ok(rejected.errors.some((error) => error.startsWith('BINDING_FONT_ROLE_REQUIRED')));
  assert.ok(!rejected.errors.some((error) => error.includes('icon')));
  const resolved = { bindings: [{ control_id: 'panel', component_id: 'panel.body', state: 'default', slot_id: 'panel-slot', font_role: 'body' }, { control_id: 'icon', component_id: 'icon.flat', state: 'default', slot_id: 'icon-slot' }] };
  assert.deepEqual(validateBindings(resolved, textScreen, textFamilies, fontManifest, { strict: true }).errors, []);
});

test('the generic action role fails closed in strict mode but stays a warning otherwise', () => {
  const migrated = { required_controls: [{ id: 'legacy', label: '旧控件', role: 'action', required: true }] };
  const legacyComponents = { families: [{ id: 'button.primary', category: 'button', status: 'approved', states: { default: { asset_path: 'a.png' } } }] };
  const artifact = { bindings: [{ control_id: 'legacy', component_id: 'button.primary', state: 'default', slot_id: 'legacy-slot' }] };
  const strict = validateBindings(artifact, migrated, legacyComponents, fontManifest, { strict: true });
  assert.ok(strict.errors.some((error) => error.startsWith('BINDING_GENERIC_ROLE_UNRESOLVED')));
  const guided = validateBindings(artifact, migrated, legacyComponents, fontManifest, { strict: false });
  assert.deepEqual(guided.errors, []);
  assert.ok(guided.warnings.some((warning) => warning.includes("generic 'action' role")));
});

test('direct API submissions with empty state or font role cannot be approved', () => {
  // Simulates a hostile updateArtifact payload: approval runs validateBindings
  // with the project mode, so both strict and guided must reject it.
  const textScreen = { required_controls: [{ id: 'panel', label: '内容面板', role: 'content-panel', required: true }] };
  const textFamilies = { families: [{ id: 'panel.body', category: 'content-panel', status: 'approved', text_policy: 'text-slot', states: { default: { asset_path: 'p.png' } } }] };
  const hostile = { bindings: [{ control_id: 'panel', component_id: 'panel.body', state: '', font_role: '', slot_id: 'panel-slot' }] };
  for (const strict of [true, false]) {
    const result = validateBindings(hostile, textScreen, textFamilies, fontManifest, { strict });
    assert.ok(result.errors.some((error) => error.startsWith('BINDING_STATE_REQUIRED')));
    assert.ok(result.errors.some((error) => error.startsWith('BINDING_FONT_ROLE_REQUIRED')));
  }
});

test('the strict compositor throws instead of silently falling back to button-label', () => {
  const family = { id: 'panel.body', text_policy: 'text-slot', font_role: 'body' };
  const slot = { rect: { x: 0, y: 0, width: 10, height: 10 }, z_index: 1 };
  const binding = { control_id: 'panel', text: '内容', slot_id: 'panel-slot' };
  assert.throws(
    () => textLayer(binding, slot, family, fontManifest, {}, true),
    (error) => error.code === 'BINDING_FONT_ROLE_REQUIRED'
  );
  // Guided previews keep the documented fallback chain for legacy drafts.
  const guided = textLayer(binding, slot, family, fontManifest, {}, false);
  assert.equal(guided.font_role, 'body');
  const explicit = textLayer({ ...binding, font_role: 'numeric' }, slot, family, fontManifest, {}, true);
  assert.equal(explicit.font_role, 'numeric');
});

test('binding edits invalidate composition and fidelity downstream', () => {
  const downstream = downstreamArtifacts('component-bindings', { profile: 'strict' });
  assert.ok(downstream.includes('composition-manifest'));
  assert.ok(downstream.includes('fidelity-report'));
});
