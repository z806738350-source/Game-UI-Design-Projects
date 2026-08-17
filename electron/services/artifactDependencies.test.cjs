const test = require('node:test');
const assert = require('node:assert/strict');
const { changedKindsForInput, downstreamArtifacts, isGlobalChange } = require('./artifactDependencies.cjs');

test('every audited input change maps to one dependency-graph root', () => {
  assert.deepEqual(changedKindsForInput({
    requirement: true, wireframe: true, references: true, artDirection: true, projectType: true, continuationMode: true
  }), [
    'input-requirement', 'input-wireframe', 'input-references',
    'input-art-direction', 'input-project-type', 'input-continuation-mode'
  ]);
  assert.equal(isGlobalChange('input-requirement'), false);
  assert.equal(isGlobalChange('input-wireframe'), false);
  for (const kind of ['input-references', 'input-art-direction', 'input-project-type', 'input-continuation-mode']) assert.equal(isGlobalChange(kind), true);
});

test('continuation mode and reference changes reach all incompatible final artifacts', () => {
  for (const root of ['input-continuation-mode', 'input-references']) {
    const downstream = downstreamArtifacts(root);
    for (const kind of ['visual-task', 'visual-results', 'underlay-critique', 'composition-manifest', 'composition-output', 'fidelity-report']) {
      assert.equal(downstream.includes(kind), true, `${root} must invalidate ${kind}`);
    }
    assert.equal(new Set(downstream).size, downstream.length);
  }
});
