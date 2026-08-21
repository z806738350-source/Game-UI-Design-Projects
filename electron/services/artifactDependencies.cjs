// Route-aware artifact dependency graphs. Upstream change makes every
// transitive downstream artifact stale; arrow direction differs per route:
// - exploration/guided: layout 先行，approved-layout → style-contract，
//   Style 生成/变化绝不回指 Layout（否则形成 Layout—Style stale 死循环）。
// - strict: 风格先行，style-contract → font/component/bindings/layout，
//   approved-layout 不得反向指向 style-contract。
// downstreamArtifacts 必须显式携带 profile，禁止路线无关的旧签名。

const COMMON_DEPENDENCIES = Object.freeze({
  'input-requirement': ['screen-contract'],
  'input-wireframe': ['screen-contract'],
  'input-references': ['reference-inventory'],
  'input-art-direction': ['style-contract'],
  'input-project-type': ['style-contract', 'visual-task'],
  'input-continuation-mode': ['style-contract', 'visual-task'],
  'reference-inventory': ['reference-pack'],
  'reference-pack': ['style-contract'],
  'layout-proposals': ['approved-layout'],
  'visual-task': ['visual-results'],
  'composition-manifest': ['composition-output'],
  'composition-output': ['fidelity-report']
});

// 布局先行：Style 建立在已批准布局之上，Style 下游只剩视觉任务。
const NON_STRICT_DEPENDENCIES = Object.freeze({
  ...COMMON_DEPENDENCIES,
  'screen-contract': ['layout-proposals'],
  'approved-layout': ['style-contract', 'visual-task'],
  'style-contract': ['visual-task']
});

// 风格先行：严格生产链（字体/组件/绑定/底层/合成）全部挂在 Style 下游。
const STRICT_DEPENDENCIES = Object.freeze({
  ...COMMON_DEPENDENCIES,
  'style-contract': ['font-manifest', 'component-contract', 'layout-proposals', 'underlay-contract', 'visual-task'],
  'font-manifest': ['component-bindings', 'composition-manifest'],
  'component-contract': ['component-bindings'],
  'screen-contract': ['component-bindings', 'layout-proposals'],
  'component-bindings': ['layout-proposals'],
  'approved-layout': ['underlay-contract', 'visual-task'],
  'underlay-contract': ['visual-task', 'underlay-critique'],
  'visual-results': ['underlay-critique', 'composition-manifest'],
  'underlay-critique': ['composition-manifest']
});

const PROFILE_DEPENDENCIES = Object.freeze({
  exploration: NON_STRICT_DEPENDENCIES,
  guided: NON_STRICT_DEPENDENCIES,
  strict: STRICT_DEPENDENCIES
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

function dependencyGraphFor(profile) {
  const graph = PROFILE_DEPENDENCIES[profile];
  if (!graph) throw new Error(`Unknown pipeline profile: ${profile}`);
  return graph;
}

function downstreamArtifacts(kind, options = {}) {
  const graph = dependencyGraphFor(options.profile);
  const ordered = [];
  const seen = new Set();
  const queue = [...(graph[kind] || [])];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    ordered.push(current);
    queue.push(...(graph[current] || []));
  }
  return ordered;
}

function changedKindsForInput(changes = {}) {
  return Object.entries(INPUT_CHANGE_KINDS)
    .filter(([change]) => changes[change] === true)
    .map(([, kind]) => kind);
}

function isGlobalChange(kind) { return GLOBAL_CHANGE_KINDS.has(kind); }

module.exports = { COMMON_DEPENDENCIES, PROFILE_DEPENDENCIES, GLOBAL_CHANGE_KINDS, INPUT_CHANGE_KINDS, changedKindsForInput, dependencyGraphFor, downstreamArtifacts, isGlobalChange };
