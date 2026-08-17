const DIRECT_DEPENDENCIES = Object.freeze({
  'input-requirement': ['screen-contract'],
  'input-wireframe': ['screen-contract'],
  'input-references': ['reference-inventory'],
  'input-art-direction': ['style-contract'],
  'input-project-type': ['style-contract', 'visual-task'],
  'input-continuation-mode': ['style-contract', 'visual-task'],
  'reference-inventory': ['reference-pack'],
  'reference-pack': ['style-contract'],
  'style-contract': ['font-manifest', 'component-contract', 'layout-proposals', 'underlay-contract', 'visual-task'],
  'font-manifest': ['composition-manifest'],
  'component-contract': ['component-bindings'],
  'screen-contract': ['component-bindings', 'layout-proposals'],
  'component-bindings': ['layout-proposals'],
  'layout-proposals': ['approved-layout'],
  'approved-layout': ['underlay-contract', 'visual-task'],
  'underlay-contract': ['visual-task', 'underlay-critique'],
  'visual-task': ['visual-results'],
  'visual-results': ['underlay-critique', 'composition-manifest'],
  'underlay-critique': ['composition-manifest'],
  'composition-manifest': ['composition-output'],
  'composition-output': ['fidelity-report']
});

const GLOBAL_CHANGE_KINDS = new Set([
  'input-references', 'input-art-direction', 'input-project-type', 'input-continuation-mode',
  'reference-inventory', 'reference-pack', 'style-contract', 'font-manifest', 'component-contract'
]);

const INPUT_CHANGE_KINDS = Object.freeze({
  requirement: 'input-requirement',
  wireframe: 'input-wireframe',
  references: 'input-references',
  artDirection: 'input-art-direction',
  projectType: 'input-project-type',
  continuationMode: 'input-continuation-mode'
});

function downstreamArtifacts(kind) {
  const ordered = [];
  const seen = new Set();
  const queue = [...(DIRECT_DEPENDENCIES[kind] || [])];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    ordered.push(current);
    queue.push(...(DIRECT_DEPENDENCIES[current] || []));
  }
  return ordered;
}

function changedKindsForInput(changes = {}) {
  return Object.entries(INPUT_CHANGE_KINDS)
    .filter(([change]) => changes[change] === true)
    .map(([, kind]) => kind);
}

function isGlobalChange(kind) { return GLOBAL_CHANGE_KINDS.has(kind); }

module.exports = { DIRECT_DEPENDENCIES, GLOBAL_CHANGE_KINDS, INPUT_CHANGE_KINDS, changedKindsForInput, downstreamArtifacts, isGlobalChange };
