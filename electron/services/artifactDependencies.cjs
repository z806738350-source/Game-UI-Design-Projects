const DEPENDENCIES = Object.freeze({
  'reference-inventory': ['reference-pack', 'style-contract', 'font-manifest', 'component-contract', 'component-bindings', 'layout-proposals', 'approved-layout', 'underlay-contract', 'underlay-critique', 'composition-manifest', 'fidelity-report'],
  'style-contract': ['component-contract', 'layout-proposals', 'approved-layout', 'underlay-contract', 'underlay-critique', 'composition-manifest', 'fidelity-report'],
  'font-manifest': ['composition-manifest', 'fidelity-report'],
  'component-contract': ['component-bindings', 'layout-proposals', 'approved-layout', 'underlay-contract', 'composition-manifest', 'fidelity-report'],
  'screen-contract': ['component-bindings', 'layout-proposals', 'approved-layout', 'underlay-contract', 'underlay-critique', 'composition-manifest', 'fidelity-report'],
  'component-bindings': ['layout-proposals', 'approved-layout', 'underlay-contract', 'underlay-critique', 'composition-manifest', 'fidelity-report'],
  'approved-layout': ['underlay-contract', 'underlay-critique', 'composition-manifest', 'fidelity-report'],
  'underlay-contract': ['underlay-critique', 'composition-manifest', 'fidelity-report'],
  'underlay-critique': ['composition-manifest', 'fidelity-report'],
  'composition-manifest': ['fidelity-report']
});

function downstreamArtifacts(kind) { return [...(DEPENDENCIES[kind] || [])]; }
module.exports = { DEPENDENCIES, downstreamArtifacts };
