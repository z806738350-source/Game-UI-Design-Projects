const GLOBAL_ARTIFACTS = Object.freeze({
  'reference-inventory': 'style/reference-inventory.json',
  'style-contract': 'style/style-contract.json',
  'font-manifest': 'style/font-manifest.json',
  'component-contract': 'style/component-contract.json'
});

const SCREEN_ARTIFACTS = Object.freeze({
  'screen-contract': 'screen-contract.json',
  'component-bindings': 'component-bindings.json',
  'layout-proposals': 'layout-proposals.json',
  'approved-layout': 'approved-layout.json',
  'reference-pack': 'reference-pack.json',
  'underlay-contract': 'underlay-contract.json',
  'underlay-critique': 'underlay-critique.json',
  'composition-manifest': 'composition-manifest.json',
  'fidelity-report': 'fidelity-report.json',
  'visual-task': 'visual-task.json',
  'visual-results': 'explorations/results.json'
});

function artifactRelativePath(kind, screenId = 'main') {
  if (GLOBAL_ARTIFACTS[kind]) return GLOBAL_ARTIFACTS[kind];
  if (SCREEN_ARTIFACTS[kind]) return `screens/${screenId}/${SCREEN_ARTIFACTS[kind]}`;
  throw new Error(`Unknown artifact kind: ${kind}`);
}

module.exports = { GLOBAL_ARTIFACTS, SCREEN_ARTIFACTS, artifactRelativePath };

