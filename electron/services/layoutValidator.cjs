function rectErrors(rect, prefix) {
  const errors = [];
  for (const key of ['x', 'y', 'width', 'height']) if (!Number.isFinite(rect?.[key])) errors.push(`${prefix}.${key} must be numeric`);
  if (errors.length) return errors;
  if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > 1 || rect.y + rect.height > 1) errors.push(`${prefix} must stay inside normalized canvas bounds`);
  return errors;
}

function validateLayout(layout, bindingsArtifact, componentContract, canvasSpec, { strict = false } = {}) {
  const errors = [];
  const slots = Array.isArray(layout?.slots) ? layout.slots : [];
  const bindings = bindingsArtifact?.bindings || [];
  const families = new Map((componentContract?.families || []).map((family) => [family.id, family]));
  const slotIds = new Set();
  for (const [index, slot] of slots.entries()) {
    if (!slot.id || slotIds.has(slot.id)) errors.push(`slot id is missing or duplicated at index ${index}`);
    slotIds.add(slot.id);
    errors.push(...rectErrors(slot.rect, `slots[${index}].rect`));
    if (strict && (!slot.underlay_policy || slot.underlay_policy.keep_clear !== true)) errors.push(`${slot.id} requires a keep-clear underlay policy`);
    // 组件绑定只存在于严格继承路线：探索/引导路线没有 bindings 资产，
    // 布局批准与修复不得被绑定校验误拦截（route-cycle 阻断根因）。
    if (!strict) continue;
    const binding = bindings.find((item) => item.slot_id === slot.id);
    if (!binding) errors.push(`${slot.id} has no component binding`);
    const family = families.get(binding?.component_id);
    if (!family || !canvasSpec || !slot.rect) continue;
    const width = slot.rect.width * canvasSpec.width;
    const height = slot.rect.height * canvasSpec.height;
    if (family.reuse_mode === 'exact') {
      const sx = width / family.intrinsic_size[0]; const sy = height / family.intrinsic_size[1];
      if (Math.abs(sx - sy) > 0.02) errors.push(`${slot.id} distorts exact component ${family.id}`);
      if (sx < (family.scale_policy?.min_scale ?? 1) || sx > (family.scale_policy?.max_scale ?? 1)) errors.push(`${slot.id} scale is outside ${family.id} policy`);
    }
    if (family.reuse_mode === 'nine-slice' && family.slice?.margins) {
      const [left, right, top, bottom] = family.slice.margins;
      if (width < left + right || height < top + bottom) errors.push(`${slot.id} is smaller than ${family.id} 9-slice fixed margins`);
    }
  }
  if (strict) for (const binding of bindings) if (!slotIds.has(binding.slot_id)) errors.push(`binding ${binding.control_id} is missing slot ${binding.slot_id}`);
  return errors;
}

module.exports = { validateLayout };
