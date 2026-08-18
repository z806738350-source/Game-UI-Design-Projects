const { normalizeControls } = require('./screenControls.cjs');
const { rolePolicy } = require('./controlRolePolicy.cjs');

function controlId(control, index) {
  return normalizeControls([control])[0]?.id || `control-${index + 1}`;
}

function requiredControls(screenContract) {
  return normalizeControls(screenContract?.required_controls || []).filter((control) => control.required);
}

function controlRoles(screenContract) {
  const roles = new Map();
  for (const control of normalizeControls(screenContract?.required_controls || [])) roles.set(control.id, control.role || 'action');
  return roles;
}

// Per-binding `approved` flags are intentionally NOT trusted here: approval is
// a backend fact stamped by approveArtifact (see designPipeline.cjs), never a
// client-supplied field. Semantic compatibility follows binding-policy-v1.
function validateBindings(bindingsArtifact, screenContract, componentContract, fontManifest = null, options = {}) {
  const strict = options.strict === true;
  const errors = [];
  const warnings = [];
  const controls = requiredControls(screenContract);
  const roles = controlRoles(screenContract);
  const bindings = Array.isArray(bindingsArtifact?.bindings) ? bindingsArtifact.bindings : [];
  const families = new Map((componentContract?.families || []).map((family) => [family.id, family]));
  const fontRoles = fontManifest?.roles || {};
  const byControl = new Map();
  for (const binding of bindings) {
    if (!binding.control_id || byControl.has(binding.control_id)) errors.push(`binding control is missing or duplicated: ${binding.control_id || '<none>'}`);
    byControl.set(binding.control_id, binding);
    if (!binding.slot_id) errors.push(`${binding.control_id || '<none>'} requires slot_id`);
    if (!binding.component_id) {
      errors.push(`BINDING_COMPONENT_NOT_SELECTED: ${binding.control_id || '<none>'} has no explicitly selected component family`);
      continue;
    }
    const family = families.get(binding.component_id);
    if (!family) {
      errors.push(`${binding.control_id} references missing component ${binding.component_id}`);
      continue;
    }
    if (family.status !== 'approved') errors.push(`BINDING_COMPONENT_NOT_APPROVED: component family ${family.id} is not approved`);
    if (!family.states?.[binding.state || 'default']) errors.push(`BINDING_COMPONENT_STATE_MISSING: ${binding.control_id} references missing state ${binding.state || 'default'} on ${binding.component_id}`);
    const role = roles.get(binding.control_id);
    const policy = rolePolicy(role);
    if (role && policy) {
      const category = family.category || 'page-specific';
      if (!policy.allowed_categories.includes(category)) errors.push(`BINDING_COMPONENT_CATEGORY_MISMATCH: control ${binding.control_id} role '${role}' cannot bind component category '${category}' (family ${family.id})`);
      const missingStates = policy.required_states.filter((state) => !family.states?.[state]);
      if (missingStates.length) errors.push(`BINDING_COMPONENT_STATE_MISSING: family ${family.id} must provide states for role '${role}': ${missingStates.join(', ')}`);
      if (binding.font_role) {
        if (!policy.allowed_font_roles.includes(binding.font_role)) errors.push(`BINDING_FONT_ROLE_MISMATCH: control ${binding.control_id} role '${role}' cannot use font role '${binding.font_role}'`);
        if (fontManifest && !fontRoles[binding.font_role]) errors.push(`BINDING_FONT_ROLE_MISSING: font role '${binding.font_role}' is not defined in the Font Manifest`);
      }
    } else if (role) {
      if (strict) errors.push(`BINDING_UNKNOWN_CONTROL_ROLE: control ${binding.control_id} has unknown role '${role}'`);
      else warnings.push(`control ${binding.control_id} has unknown role '${role}'; semantic compatibility was not enforced`);
    }
  }
  const unbound = controls.filter((control) => !byControl.has(control.id)).map((control) => control.id);
  if (unbound.length) errors.push(`required controls are unbound: ${unbound.join(', ')}`);
  return { errors, warnings, coverage: { required_controls: controls.length, bound_required_controls: controls.length - unbound.length, unbound_required_controls: unbound } };
}

function withCoverage(artifact, screenContract, componentContract, fontManifest = null, options = {}) {
  const result = validateBindings(artifact, screenContract, componentContract, fontManifest, options);
  return { ...artifact, coverage: result.coverage };
}

module.exports = { controlId, requiredControls, controlRoles, validateBindings, withCoverage };
