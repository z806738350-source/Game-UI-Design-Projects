const ROLE_PRIORITY = Object.freeze({ component: 1, primary: 2, material: 3, composition: 4, supporting: 5 });

function rank(asset) {
  return [ROLE_PRIORITY[asset.role] || 99, Number(asset.priority ?? asset.order ?? 0), String(asset.id || '')];
}

function compareAssets(left, right) {
  const a = rank(left);
  const b = rank(right);
  return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
}

function buildReferencePack({ assets = [], capabilities, purpose, structureGuides = [] }) {
  const limit = capabilities.max_reference_images;
  const approved = assets.filter((asset) => asset.approved !== false && asset.role).sort(compareAssets);
  const guides = structureGuides.filter(Boolean).map((item, index) => ({
    id: item.id || `structure-guide-${index + 1}`,
    path: item.path || item,
    role: 'structure-guide',
    reason: 'spatial-control'
  }));
  const candidates = [...guides, ...approved];
  const selected = candidates.slice(0, limit).map((asset) => ({ ...asset, selection_reason: asset.role === 'structure-guide' ? 'provider-spatial-guide' : `role-priority:${asset.role}` }));
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
    status: 'generated',
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
    capacity_decision: { used: selected.length, limit, omitted: omitted.length },
    wireframe_strategy: guides.length ? 'structured-layout-only' : 'not-included'
  };
}

module.exports = { buildReferencePack, compareAssets };

