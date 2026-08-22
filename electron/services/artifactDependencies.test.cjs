const test = require('node:test');
const assert = require('node:assert/strict');
const { PIPELINE_PROFILES } = require('./pipelineProfile.cjs');
const { changedKindsForInput, dependencyGraphFor, downstreamArtifacts, isGlobalChange } = require('./artifactDependencies.cjs');

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

test('continuation mode and reference changes reach all incompatible final artifacts on every route', () => {
  for (const profile of PIPELINE_PROFILES) {
    for (const root of ['input-continuation-mode', 'input-references']) {
      const downstream = downstreamArtifacts(root, { profile });
      for (const kind of ['style-contract', 'visual-task', 'visual-results']) {
        assert.equal(downstream.includes(kind), true, `${root} (${profile}) must invalidate ${kind}`);
      }
      assert.equal(new Set(downstream).size, downstream.length);
    }
  }
});

test('downstreamArtifacts rejects a missing profile (route-aware API is mandatory)', () => {
  assert.throws(() => downstreamArtifacts('style-contract'), /Unknown pipeline profile/);
  assert.throws(() => downstreamArtifacts('style-contract', {}), /Unknown pipeline profile/);
});

test('exploration/guided routes never let style changes reach back into layout', () => {
  for (const profile of ['exploration', 'guided']) {
    const styleDownstream = downstreamArtifacts('style-contract', { profile });
    assert.equal(styleDownstream.includes('layout-proposals'), false, `${profile}: style must not stale layout proposals`);
    assert.equal(styleDownstream.includes('approved-layout'), false, `${profile}: style must not stale approved layout`);
    assert.equal(styleDownstream.includes('visual-task'), true, `${profile}: style must stale visual tasks`);
    assert.equal(styleDownstream.includes('visual-results'), true, `${profile}: style must stale visual results`);
    const layoutDownstream = downstreamArtifacts('approved-layout', { profile });
    assert.equal(layoutDownstream.includes('style-contract'), true, `${profile}: approved layout sits upstream of style`);
  }
});

test('strict route keeps style upstream of layout without a layout→style back edge', () => {
  const styleDownstream = downstreamArtifacts('style-contract', { profile: 'strict' });
  for (const kind of ['font-manifest', 'component-contract', 'layout-proposals', 'approved-layout', 'underlay-contract', 'visual-task', 'composition-manifest', 'fidelity-report']) {
    assert.equal(styleDownstream.includes(kind), true, `strict: style must invalidate ${kind}`);
  }
  const layoutDownstream = downstreamArtifacts('approved-layout', { profile: 'strict' });
  assert.equal(layoutDownstream.includes('style-contract'), false, 'strict: approved layout must never stale style');
});

// AUD-01：Strict 的 Style Basis 是 Screen Contract，功能契约变化必须使
// Style 与全部严格下游 stale，旧 Style 不得继续建立在旧契约之上。
test('AUD-01: strict screen-contract change stales style and the whole strict chain', () => {
  const graph = dependencyGraphFor('strict');
  assert.equal(graph['screen-contract'].includes('style-contract'), true, 'strict: screen-contract must sit upstream of style-contract');
  const downstream = downstreamArtifacts('screen-contract', { profile: 'strict' });
  for (const kind of ['style-contract', 'font-manifest', 'component-contract', 'component-bindings', 'layout-proposals', 'approved-layout', 'underlay-contract', 'visual-task', 'composition-manifest', 'composition-output', 'fidelity-report']) {
    assert.equal(downstream.includes(kind), true, `strict: screen-contract change must stale ${kind}`);
  }
});

// 任何路线出现依赖环都会让 stale 传播形成死循环（本次事故根因），
// 用 DFS 三色标记对所有 Profile 强制做环检测。
test('every profile dependency graph is acyclic, duplicate-free, and terminates correctly', () => {
  for (const profile of PIPELINE_PROFILES) {
    const graph = dependencyGraphFor(profile);
    const WHITE = 0; const GRAY = 1; const BLACK = 2;
    const color = Object.create(null);
    const visit = (kind) => {
      color[kind] = GRAY;
      for (const next of graph[kind] || []) {
        if (color[next] === GRAY) throw new Error(`dependency cycle detected in ${profile}: ${kind} -> ${next}`);
        if (color[next] === WHITE || color[next] === undefined) visit(next);
      }
      color[kind] = BLACK;
    };
    for (const kind of Object.keys(graph)) {
      if (color[kind] === WHITE || color[kind] === undefined) visit(kind);
    }
    for (const [kind, edges] of Object.entries(graph)) {
      assert.equal(new Set(edges).size, edges.length, `${profile}: ${kind} lists duplicate downstream kinds`);
      assert.equal(edges.includes(kind), false, `${profile}: ${kind} must not depend on itself`);
    }
    // 终端节点：各自路线的交付终点不再有下游。
    assert.deepEqual(graph['fidelity-report'], undefined, `${profile}: fidelity-report is terminal`);
    if (profile === 'strict') assert.deepEqual(graph['visual-results'], ['underlay-critique', 'composition-manifest']);
    else assert.deepEqual(graph['visual-results'], undefined, `${profile}: visual-results is terminal`);
  }
});
