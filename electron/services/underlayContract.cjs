function expandRect(rect, margin = {}) {
  const left = margin.left || 0; const right = margin.right || 0; const top = margin.top || 0; const bottom = margin.bottom || 0;
  const x = Math.max(0, rect.x - left); const y = Math.max(0, rect.y - top);
  return [x, y, Math.min(1 - x, rect.width + left + right), Math.min(1 - y, rect.height + top + bottom)];
}

function generateUnderlayContract(project, layout, bindings) {
  if (layout?.status !== 'approved') throw new Error('Approved Layout is required.');
  if (bindings?.status !== 'approved') throw new Error('Approved Component Bindings are required.');
  const reserved = (layout.slots || []).map((slot) => ({
    slot_id: slot.id,
    binding_id: slot.binding_id || bindings.bindings.find((binding) => binding.slot_id === slot.id)?.control_id,
    bbox: expandRect(slot.rect, slot.keep_clear_margin),
    treatment: slot.underlay_policy?.preferred_treatment || 'low-detail',
    subject_overlap: slot.underlay_policy?.subject_overlap !== 'forbidden' ? false : false,
    hard_edge_overlap: false, text_like_shapes: false, ui_like_shapes: false,
    detail_level: slot.underlay_policy?.detail_level || 'low',
    contrast_role: slot.underlay_policy?.contrast_role || 'surface-behind-ui',
    visual_noise_budget: Number(slot.underlay_policy?.visual_noise_budget ?? 0.25)
  }));
  return {
    schema_version: '2.0', id: `${project.screen_id}-underlay-contract`, version: 1, status: 'generated',
    source: { approved_layout: layout.id, component_bindings: bindings.id },
    canvas: [project.canvas_spec?.width || 1536, project.canvas_spec?.height || 864],
    focal_regions: layout.focal_regions || [], reserved_regions: reserved,
    global_rules: { do_not_render_shared_ui: true, do_not_render_formal_text: true, do_not_place_main_subject_inside_reserved_regions: true }
  };
}

module.exports = { expandRect, generateUnderlayContract };

