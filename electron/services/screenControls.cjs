function slugControlId(value, fallback = 'control') {
  const slug = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function normalizeControls(items = []) {
  const used = new Set();
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const legacy = typeof item === 'string';
    const source = legacy ? { label: item } : (item && typeof item === 'object' ? item : { label: String(item || '') });
    const label = String(source.label || source.id || `控件 ${index + 1}`).trim();
    const requested = slugControlId(source.id || label, `control-${index + 1}`);
    let id = requested;
    let suffix = 2;
    while (used.has(id)) id = `${requested}-${suffix++}`;
    used.add(id);
    return {
      ...source,
      id,
      label,
      role: String(source.role || 'action'),
      required: source.required !== false,
      ...(legacy ? { migrated_from_label: label } : {})
    };
  });
}

function validateControls(items) {
  const errors = [];
  if (!Array.isArray(items)) return ['required_controls must be an array'];
  const ids = new Set();
  items.forEach((control, index) => {
    if (!control || typeof control !== 'object' || Array.isArray(control)) {
      errors.push(`required_controls[${index}] must be an object`);
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(control.id || ''))) errors.push(`required_controls[${index}].id must be a kebab-case stable id`);
    else if (ids.has(control.id)) errors.push(`required_controls contains duplicate id: ${control.id}`);
    ids.add(control.id);
    if (!String(control.label || '').trim()) errors.push(`required_controls[${index}].label is required`);
    if (!String(control.role || '').trim()) errors.push(`required_controls[${index}].role is required`);
    if (typeof control.required !== 'boolean') errors.push(`required_controls[${index}].required must be boolean`);
  });
  return errors;
}

module.exports = { normalizeControls, slugControlId, validateControls };
