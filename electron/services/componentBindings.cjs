function controlId(control, index) {
  if (typeof control === 'string') return control.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || `control-${index + 1}`;
  return String(control?.id || `control-${index + 1}`);
}

function requiredControls(screenContract) {
  return (screenContract?.required_controls || []).map((control, index) => ({
    id: controlId(control, index), label: typeof control === 'string' ? control : control.label || control.id,
    required: typeof control === 'string' ? true : control.required !== false
  })).filter((control) => control.required);
}

function validateBindings(bindingsArtifact, screenContract, componentContract) {
  const errors = [];
  const controls = requiredControls(screenContract);
  const bindings = Array.isArray(bindingsArtifact?.bindings) ? bindingsArtifact.bindings : [];
  const families = new Map((componentContract?.families || []).map((family) => [family.id, family]));
  const byControl = new Map();
  for (const binding of bindings) {
    if (!binding.control_id || byControl.has(binding.control_id)) errors.push(`binding control is missing or duplicated: ${binding.control_id || '<none>'}`);
    byControl.set(binding.control_id, binding);
    const family = families.get(binding.component_id);
    if (!family) errors.push(`${binding.control_id} references missing component ${binding.component_id || '<none>'}`);
    else if (!family.states?.[binding.state || 'default']) errors.push(`${binding.control_id} references missing state ${binding.state || 'default'} on ${binding.component_id}`);
    if (!binding.slot_id) errors.push(`${binding.control_id} requires slot_id`);
    if (binding.approved !== true) errors.push(`${binding.control_id} is not approved`);
  }
  const unbound = controls.filter((control) => !byControl.has(control.id)).map((control) => control.id);
  if (unbound.length) errors.push(`required controls are unbound: ${unbound.join(', ')}`);
  return { errors, coverage: { required_controls: controls.length, bound_required_controls: controls.length - unbound.length, unbound_required_controls: unbound } };
}

function withCoverage(artifact, screenContract, componentContract) {
  const result = validateBindings(artifact, screenContract, componentContract);
  return { ...artifact, coverage: result.coverage };
}

module.exports = { controlId, requiredControls, validateBindings, withCoverage };

