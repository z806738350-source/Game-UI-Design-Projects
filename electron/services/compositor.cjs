const { reviewGate } = require('./underlayCritique.cjs');
const { ERROR_CODES } = require('./errorCodes.cjs');
const { validateFontManifest } = require('./typographyAssets.cjs');
const { validateBindings } = require('./componentBindings.cjs');
const { validateLayout } = require('./layoutValidator.cjs');

function componentLayer(binding, slot, family) {
  const state = binding.state || 'default';
  const asset = family.states[state];
  return {
    type: 'component', control_id: binding.control_id, component_id: family.id, state,
    asset_path: asset.asset_path, asset_hash: asset.asset_hash,
    intrinsic_size: family.intrinsic_size,
    scale_policy: family.scale_policy,
    rect: [slot.rect.x, slot.rect.y, slot.rect.width, slot.rect.height],
    anchor: slot.anchor || 'top-left', resize_mode: slot.resize_mode || family.reuse_mode,
    renderer: family.reuse_mode,
    slice: family.slice, z_index: Number(slot.z_index || 0)
  };
}

function textLayer(binding, slot, family, fontManifest, typography) {
  const content = String(binding.text || binding.label || '').trim();
  if (!content || family.text_policy !== 'text-slot') return null;
  const roleId = binding.font_role || family.font_role || 'button-label';
  const role = fontManifest.roles?.[roleId];
  const font = (fontManifest.fonts || []).find((item) => item.id === role?.font_id);
  return {
    type: 'text', control_id: binding.control_id, content, font_role: roleId,
    font_id: role?.font_id, font_path: font?.local_path, font_hash: font?.file_hash,
    font_family: font?.family_name, postscript_name: font?.postscript_name, font_format: font?.format,
    font_license_status: font?.license_status, font_license_confirmation: font?.license_confirmation,
    exact_confirmation: role?.exact_confirmation,
    fidelity_mode: role?.fidelity_mode || 'unresolved', typography: typography?.[roleId] || {},
    rect: [slot.rect.x, slot.rect.y, slot.rect.width, slot.rect.height], z_index: Number(slot.z_index || 0) + 1
  };
}

function createCompositionManifest({ project, underlay, layout, bindings, componentContract, fontManifest, styleContract, critique, mode = 'preview', version = 1 }) {
  const strict = project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation';
  const errors = [];
  const underlayGate = reviewGate(critique);
  if (!underlayGate.passed) errors.push(`Underlay review has ${underlayGate.blocking.length} blocking issues`);
  const bindingResult = validateBindings(bindings, project.artifacts?.screenContract, componentContract, fontManifest, { strict });
  errors.push(...bindingResult.errors);
  errors.push(...validateLayout(layout, bindings, componentContract, project.canvas_spec, { strict }));
  if (mode === 'final') errors.push(...validateFontManifest(fontManifest, { strict }));
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { code: ERROR_CODES.COMPOSITION_GATE_FAILED, missing_requirements: errors });
  const families = new Map((componentContract.families || []).map((family) => [family.id, family]));
  const slots = new Map((layout.slots || []).map((slot) => [slot.id, slot]));
  const layers = [];
  for (const binding of bindings.bindings || []) {
    const family = families.get(binding.component_id); const slot = slots.get(binding.slot_id);
    layers.push(componentLayer(binding, slot, family));
    const text = textLayer(binding, slot, family, fontManifest, styleContract.typography);
    if (text) layers.push(text);
  }
  for (const layer of layers) if (layer.type === 'text') layer.composition_mode = mode;
  if (mode !== 'final' && layers.some((layer) => layer.type === 'text' && layer.fidelity_mode !== 'exact')) layers.push({ type: 'watermark', content: 'TYPOGRAPHY PREVIEW · FONT FIDELITY UNRESOLVED', z_index: 10000 });
  layers.sort((left, right) => left.z_index - right.z_index || `${left.type}:${left.control_id || ''}`.localeCompare(`${right.type}:${right.control_id || ''}`));
  return {
    schema_version: '2.0', id: `${project.screen_id}-composition-${mode}`, version, status: 'draft',
    source: { screen_contract: project.artifacts?.screenContract?.id, approved_layout: layout.id, component_bindings: bindings.id, component_contract: componentContract.id, font_manifest: fontManifest.id, style_contract: styleContract.id, underlay_critique: critique.id },
    mode, canvas: [project.canvas_spec.width, project.canvas_spec.height], underlay,
    layers, coverage: bindingResult.coverage, renderer: { engine: 'sharp-libvips', deterministic_order: true, registry: ['exact', 'nine-slice', 'vector-token'] }
  };
}

module.exports = { createCompositionManifest };
