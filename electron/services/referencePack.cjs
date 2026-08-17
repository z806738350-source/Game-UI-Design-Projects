const ROLE_PRIORITY = Object.freeze({ component: 1, primary: 2, material: 3, composition: 4, supporting: 5 });

function rank(asset) {
  return [ROLE_PRIORITY[asset.role] || 99, Number(asset.priority ?? asset.order ?? 0), String(asset.id || '')];
}

function compareAssets(left, right) {
  const a = rank(left);
  const b = rank(right);
  return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
}

function describeAttachment(asset, index) {
  const contains = Array.isArray(asset.contains) && asset.contains.length ? `；包含：${asset.contains.join('、')}` : '';
  const baseline = asset.baseline ? `；基线：${asset.baseline}` : '';
  return `附件 ${index + 1}：${asset.name || asset.id}；角色：${asset.role}${contains}${baseline}`;
}

function buildReferencePack({ assets = [], capabilities, purpose, structureGuides = [], omissionsConfirmed = false }) {
  const limit = capabilities.max_reference_images;
  const approved = assets.filter((asset) => asset.approved !== false && asset.role).sort(compareAssets);
  const guides = structureGuides.filter(Boolean).map((item, index) => ({
    id: item.id || `structure-guide-${index + 1}`,
    path: item.path || item,
    role: 'structure-guide',
    reason: 'spatial-control'
  }));
  const candidates = [...guides, ...approved];
  const selected = candidates.slice(0, limit).map((asset, index) => ({
    ...asset, attachment_index: index + 1,
    selection_reason: asset.role === 'structure-guide' ? 'provider-spatial-guide' : `role-priority:${asset.role}`,
    attachment_description: describeAttachment(asset, index)
  }));
  const selectedIds = new Set(selected.map((asset) => asset.id));
  const omitted = candidates.filter((asset) => !selectedIds.has(asset.id)).map((asset) => ({
    id: asset.id,
    name: asset.name,
    role: asset.role,
    reason: `provider-capacity:${limit}`
  }));
  const group = (role) => approved.filter((asset) => asset.role === role).map((asset) => asset.id);
  return {
    schema_version: '2.0',
    id: `${purpose || 'generation'}-reference-pack`,
    version: 1,
    status: omitted.length && !omissionsConfirmed ? 'reviewed' : 'approved',
    source: { provider_capabilities: { ...capabilities } },
    purpose: purpose || 'underlay-generation',
    provider_limit: limit,
    groups: {
      structure_guides: guides.map((asset) => asset.id),
      component_references: group('component'),
      style_references: group('primary'),
      material_references: group('material'),
      composition_references: group('composition'),
      supporting_references: group('supporting')
    },
    selected,
    omitted,
    attachment_order: selected.map((asset) => ({ index: asset.attachment_index, id: asset.id, path: asset.path, role: asset.role, description: asset.attachment_description })),
    omissions_confirmed: Boolean(omissionsConfirmed),
    requires_omission_confirmation: omitted.length > 0 && !omissionsConfirmed,
    capacity_decision: { used: selected.length, limit, omitted: omitted.length },
    wireframe_strategy: guides.length ? 'structured-layout-only' : 'not-included'
  };
}

module.exports = { buildReferencePack, compareAssets, describeAttachment };
