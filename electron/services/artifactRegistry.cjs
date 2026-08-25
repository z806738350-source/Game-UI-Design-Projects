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
  'underlay-repair-task': 'underlay-repair-task.json',
  'composition-manifest': 'composition-manifest.json',
  'composition-output': 'composition-output.json',
  'fidelity-report': 'fidelity-report.json',
  'visual-task': 'visual-task.json',
  'visual-results': 'explorations/results.json'
});

// AUD-13：Screen Clone 逐类字段声明。references 列出该 Artifact 内引用
// Screen 作用域 ID 的字段（含嵌套对象与数组元素），按生产管线真实写入
// 逐类枚举；重写器仅在这些 key 上做 ID 前缀替换，且仍以“值以原 Screen
// id 为前缀”为硬守卫。identity（id/screen_id）与 screens/<id>/ 路径由
// 重写器统一处理，不在此重复声明；duplicated_from_screen_id 等 provenance
// 字段刻意保留原 Screen 指向，同样不列入。
const CLONE_FIELD_SCHEMA = Object.freeze({
  'screen-contract': Object.freeze({ references: Object.freeze([]) }),
  'component-bindings': Object.freeze({ references: Object.freeze(['screen_contract', 'approved_layout']) }),
  'layout-proposals': Object.freeze({ references: Object.freeze(['screen_contract']) }),
  'approved-layout': Object.freeze({ references: Object.freeze(['layout_proposals', 'screen_contract']) }),
  // groups.structure_guides 内是 `${screen}-underlay-layout-guide` ID。
  'reference-pack': Object.freeze({ references: Object.freeze(['structure_guides']) }),
  'underlay-contract': Object.freeze({ references: Object.freeze(['approved_layout', 'style_contract', 'screen_contract']) }),
  // critique.source.underlay 是 Variation ID；visual_results_id 绑定审查时的
  // Visual Results 身份（AUD-05 像素 hash 链的一部分）。
  // M4-H1：issues[].issue_id 与 manual_waivers[].issue_id 由生产管线按
  // `${underlayId}-issue-N` 生成（Screen 前缀），豁免也按该 id 引用，克隆
  // 时必须一并重写到目标 Screen。
  'underlay-critique': Object.freeze({ references: Object.freeze(['underlay', 'underlay_contract', 'visual_results_id', 'critique_id', 'issue_id']) }),
  // source.critique 指向 Critique ID；output.underlay_id 是修复产物 Variation，
  // parent_underlay_id 是被修复的父 Variation。
  'underlay-repair-task': Object.freeze({ references: Object.freeze(['critique', 'underlay', 'underlay_id', 'parent_underlay_id', 'critique_id', 'visual_results_id']) }),
  // M4-H1：生产 Compositor 在 source.underlay_critique 写入 Critique ID，
  // output.artifact_id 由 renderComposition 按 `${manifest.id}-output` 生成，
  // 克隆时均必须重写到目标 Screen。
  'composition-manifest': Object.freeze({ references: Object.freeze(['visual_results', 'visual_results_id', 'selected_variation_ids', 'underlay', 'critique_id', 'underlay_critique', 'approved_layout', 'style_contract', 'artifact_id']) }),
  'composition-output': Object.freeze({ references: Object.freeze(['composition_manifest', 'underlay', 'variation_id']) }),
  // M4-H1：生产 Fidelity 在 source.underlay_critique 与 underlay.critique_id
  // 写入 Critique ID，并内嵌 underlay.manual_waivers[].issue_id，三处均需重写。
  'fidelity-report': Object.freeze({ references: Object.freeze(['composition_manifest', 'composition_output', 'underlay_critique', 'critique_id', 'issue_id']) }),
  // tasks[].task_id 同时是 visual-results Variation 的 id（Screen 前缀）。
  'visual-task': Object.freeze({ references: Object.freeze(['task_id', 'approved_layout', 'style_contract', 'underlay_contract']) }),
  // source.visual_tasks 引用 visual-task Artifact；Variation 的 layout_version/
  // style_version 冻结当时的布局/风格身份；修复 Variation 携带
  // parent_underlay_id 与 repair_task_id。
  'visual-results': Object.freeze({ references: Object.freeze(['visual_tasks', 'layout_version', 'style_version', 'parent_underlay_id', 'repair_task_id', 'approved_layout', 'style_contract']) })
});

function artifactRelativePath(kind, screenId = 'main') {
  if (GLOBAL_ARTIFACTS[kind]) return GLOBAL_ARTIFACTS[kind];
  if (SCREEN_ARTIFACTS[kind]) return `screens/${screenId}/${SCREEN_ARTIFACTS[kind]}`;
  throw new Error(`Unknown artifact kind: ${kind}`);
}

module.exports = { GLOBAL_ARTIFACTS, SCREEN_ARTIFACTS, CLONE_FIELD_SCHEMA, artifactRelativePath };
