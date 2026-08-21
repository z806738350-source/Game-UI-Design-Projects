// Pipeline route profile: the single backend source of truth for which
// continuation route a project follows. Every stage CTA, dependency graph
// and style-basis decision must derive from profileOf(project) instead of
// ad-hoc if/else chains scattered across workbenches and pipeline stages.
//
// Routes:
// - exploration: 新项目。布局先行：Contract → Layout → Style → Visual。
// - guided: 已有项目引导继承。与 exploration 同序，最终产出 underlay-only 方向。
// - strict: 已有项目严格继承 / locked-continuation。风格先行：
//   Contract → Style → Font/Component/Binding → Layout → Underlay → Composition。

const PIPELINE_PROFILES = Object.freeze(['exploration', 'guided', 'strict']);

function profileOf(project) {
  const mode = project?.continuation_mode;
  if (mode === 'existing-strict' || mode === 'locked-continuation') return 'strict';
  if (mode === 'existing-guided') return 'guided';
  return 'exploration';
}

// Declarative route facts consumed by the pipeline and mirrored by the
// frontend (src/features/shared/pipelineRoute.ts). A consistency test keeps
// the two implementations in lockstep.
const PROFILE_FACTS = Object.freeze({
  exploration: Object.freeze({
    nextStageAfterContract: 'layout_design',
    styleBasisKind: 'approved-layout',
    requiresReferenceInventory: true,
    usesStrictAssets: false
  }),
  guided: Object.freeze({
    nextStageAfterContract: 'layout_design',
    styleBasisKind: 'approved-layout',
    requiresReferenceInventory: true,
    usesStrictAssets: false
  }),
  strict: Object.freeze({
    nextStageAfterContract: 'style_resolution',
    styleBasisKind: 'screen-contract',
    requiresReferenceInventory: true,
    usesStrictAssets: true
  })
});

function profileFacts(profile) {
  const facts = PROFILE_FACTS[profile];
  if (!facts) throw new Error(`Unknown pipeline profile: ${profile}`);
  return facts;
}

module.exports = { PIPELINE_PROFILES, PROFILE_FACTS, profileOf, profileFacts };
