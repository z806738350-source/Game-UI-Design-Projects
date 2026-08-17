const DEPENDENCIES = Object.freeze({
  'reference-inventory': ['reference-pack', 'style-contract', 'font-manifest', 'component-contract', 'component-bindings', 'layout-proposals', 'approved-layout', 'underlay-contract', 'underlay-critique', 'composition-manifest', 'composition-output', 'fidelity-report'],
  'style-contract': ['component-contract', 'layout-proposals', 'approved-layout', 'underlay-contract', 'underlay-critique', 'composition-manifest', 'composition-output', 'fidelity-report'],
  'font-manifest': ['composition-manifest', 'composition-output', 'fidelity-report'],
  'component-contract': ['component-bindings', 'layout-proposals', 'approved-layout', 'underlay-contract', 'composition-manifest', 'composition-output', 'fidelity-report'],
  'screen-contract': ['component-bindings', 'layout-proposals', 'approved-layout', 'underlay-contract', 'underlay-critique', 'composition-manifest', 'composition-output', 'fidelity-report'],
  'component-bindings': ['layout-proposals', 'approved-layout', 'underlay-contract', 'underlay-critique', 'composition-manifest', 'composition-output', 'fidelity-report'],
  'approved-layout': ['underlay-contract', 'underlay-critique', 'composition-manifest', 'composition-output', 'fidelity-report'],
  'underlay-contract': ['underlay-critique', 'composition-manifest', 'composition-output', 'fidelity-report'],
  'underlay-critique': ['composition-manifest', 'composition-output', 'fidelity-report'],
  'composition-manifest': ['composition-output', 'fidelity-report'],
  'composition-output': ['fidelity-report']
});

function downstreamArtifacts(kind) { return [...(DEPENDENCIES[kind] || [])]; }
module.exports = { DEPENDENCIES, downstreamArtifacts };
