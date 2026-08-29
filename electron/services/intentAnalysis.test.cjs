// PR-I0 domain tests for intentAnalysis.cjs (v1.4 §13.1).
// Positive/negative coverage for the Intent Analysis v2 contract, the
// unsupported-claim policy, the review builder/renderer and the canonical
// Intent Context hash. Deterministic only — no model, no I/O.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  UNCERTAINTY_CATEGORIES,
  normalizeIntentAnalysis,
  applyUnsupportedClaimPolicy,
  createIntentReview,
  validateIntentReview,
  renderIntentReview,
  buildCanonicalIntentContext,
  canonicalIntentContextHash,
  buildScreenContractIntentContext,
  diffIntentReviews,
  canonicalJson
} = require('./intentAnalysis.cjs');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function auditRows(overrides = {}) {
  return UNCERTAINTY_CATEGORIES.map((category) => ({
    category,
    status: 'no_gap_found',
    uncertainty_ids: [],
    rationale: '',
    ...(overrides[category] || {})
  }));
}

// UE10-shaped scene: dimmed background frame + top-level boss modal.
function validRawAnalysis(overrides = {}) {
  return {
    page_type: 'modal_overlay',
    page_purpose: '展示 BOSS 伤害进度与奖励节点，并提供挑战入口',
    player_tasks: [{ id: 'task-check-damage', text: '查看个人与全派伤害信息' }],
    core_flow: [
      { id: 'flow-open', text: '打开 BOSS 挑战弹窗' },
      { id: 'flow-challenge', text: '点击挑战按钮进入战斗' }
    ],
    screen_layers: [
      { id: 'background', kind: 'background_frame', name: '压暗的主界面', parent_id: null },
      { id: 'modal', kind: 'modal', name: 'BOSS 挑战弹窗', parent_id: null }
    ],
    visible_controls: [
      { id: 'control-challenge', layer_id: 'modal', visible_label: '挑战', visible_text: '', observed_states: ['蓝色高亮'], claimed_states: [] }
    ],
    visible_information_and_states: [
      {
        id: 'info-rewards',
        layer_id: 'modal',
        visible_label: '奖励进度',
        visible_text: '99万/999万',
        observed_states: ['前两档绿色勾', '第三档黄色高亮'],
        claimed_states: []
      }
    ],
    uncertainties: [
      {
        id: 'uncertainty-state-meaning',
        category: 'state_semantics',
        question: '绿色勾和黄色高亮分别表示什么业务状态？',
        priority: 'blocking',
        evidence_ids: ['info-rewards'],
        created_by: 'ai'
      }
    ],
    uncertainty_audit: auditRows({ state_semantics: { status: 'questions_present', uncertainty_ids: ['uncertainty-state-meaning'] } }),
    ...overrides
  };
}

function normalizedFixture(overrides = {}) {
  const { value, errors } = normalizeIntentAnalysis(validRawAnalysis(overrides));
  assert.equal(errors.length, 0, `fixture must normalize cleanly: ${errors.join('; ')}`);
  return value;
}

function reviewedFixture({ answerBlocking = true } = {}) {
  const analysis = normalizedFixture();
  const review = createIntentReview(analysis, { wireframeRevision: 1 });
  for (const u of review.uncertainties) {
    if (answerBlocking) {
      u.review_status = 'answered';
      u.note = '绿色勾=已领取，黄色高亮=进行中';
    }
  }
  return review;
}

// ---------------------------------------------------------------------------
// Positive normalization cases
// ---------------------------------------------------------------------------

test('normalizes the UE10-shaped modal + background sibling scene', () => {
  const { value, errors, warnings } = normalizeIntentAnalysis(validRawAnalysis());
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 0);
  assert.equal(value.schema_version, '2.0');
  assert.equal(value.screen_layers.length, 2);
  assert.equal(value.screen_layers[1].parent_id, null, 'top-level modal with parent_id=null is legal');
});

test('normalizes a full-screen page without overlays', () => {
  const raw = validRawAnalysis({
    page_type: 'full_screen',
    screen_layers: [{ id: 'main', kind: 'primary_content', name: '主页', parent_id: null }],
    visible_controls: [{ id: 'control-tab', layer_id: 'main', visible_label: '页签', claimed_states: [] }],
    visible_information_and_states: [{ id: 'info-title', layer_id: 'main', visible_text: '主页', claimed_states: [] }],
    uncertainties: [],
    uncertainty_audit: auditRows()
  });
  const { value, errors } = normalizeIntentAnalysis(raw);
  assert.equal(errors.length, 0);
  assert.equal(value.page_type, 'full_screen');
});

test('normalizes a genuinely nested drawer under a primary content layer', () => {
  const raw = validRawAnalysis({
    page_type: 'inner_page',
    screen_layers: [
      { id: 'main', kind: 'primary_content', name: '主内容', parent_id: null },
      { id: 'drawer', kind: 'drawer', name: '侧边抽屉', parent_id: 'main' }
    ],
    visible_controls: [{ id: 'control-close', layer_id: 'drawer', visible_label: '关闭', claimed_states: [] }],
    visible_information_and_states: [{ id: 'info-title', layer_id: 'main', visible_text: '主页标题', claimed_states: [] }]
  });
  const { value, errors } = normalizeIntentAnalysis(raw);
  assert.equal(errors.length, 0);
  assert.equal(value.screen_layers[1].parent_id, 'main');
});

test('accepts empty uncertainties when the eight-category audit is complete', () => {
  const raw = validRawAnalysis({ uncertainties: [], uncertainty_audit: auditRows() });
  const { value, errors } = normalizeIntentAnalysis(raw);
  assert.equal(errors.length, 0);
  assert.equal(value.uncertainties.length, 0);
  assert.equal(value.uncertainty_audit.length, 8);
});

test('drops dangling evidence references with a warning instead of blocking', () => {
  const raw = validRawAnalysis();
  raw.uncertainties[0].evidence_ids = ['info-rewards', 'ghost-entity'];
  const { value, errors, warnings } = normalizeIntentAnalysis(raw);
  assert.equal(errors.length, 0);
  assert.deepEqual(value.uncertainties[0].evidence_ids, ['info-rewards']);
  assert.ok(warnings.some((w) => w.includes('dangling evidence')));
});

test('normalizes NFC and CRLF text without changing exact OCR wording', () => {
  const raw = validRawAnalysis();
  raw.visible_information_and_states[0].visible_text = '99万/999万\r\n';
  const { value } = normalizeIntentAnalysis(raw);
  assert.equal(value.visible_information_and_states[0].visible_text, '99万/999万');
});

// ---------------------------------------------------------------------------
// Negative normalization cases
// ---------------------------------------------------------------------------

test('rejects non-object payloads', () => {
  for (const bad of [null, 'text', [1, 2]]) {
    const { value, errors } = normalizeIntentAnalysis(bad);
    assert.equal(value, null);
    assert.ok(errors.length > 0);
  }
});

test('rejects unknown page_type and missing page_purpose', () => {
  const { errors } = normalizeIntentAnalysis(validRawAnalysis({ page_type: 'wizard', page_purpose: '' }));
  assert.ok(errors.some((e) => e.includes('page_type')));
  assert.ok(errors.some((e) => e.includes('page_purpose')));
});

test('rejects duplicate entity ids and malformed ids', () => {
  const raw = validRawAnalysis();
  raw.player_tasks.push({ id: 'task-check-damage', text: '重复任务' });
  raw.core_flow.push({ id: 'Bad_ID', text: '非法 ID' });
  const { errors } = normalizeIntentAnalysis(raw);
  assert.ok(errors.some((e) => e.includes('duplicate id "task-check-damage"')));
  assert.ok(errors.some((e) => e.includes('"Bad_ID" does not match')));
});

test('rejects layer parent cycles and unknown parents', () => {
  const raw = validRawAnalysis({
    screen_layers: [
      { id: 'a', kind: 'region', name: 'A', parent_id: 'b' },
      { id: 'b', kind: 'region', name: 'B', parent_id: 'a' },
      { id: 'primary', kind: 'primary_content', name: '主', parent_id: 'ghost' }
    ]
  });
  const { errors } = normalizeIntentAnalysis(raw);
  assert.ok(errors.some((e) => e.includes('cycle')));
  assert.ok(errors.some((e) => e.includes('unknown parent_id "ghost"')));
});

test('rejects a modal scene without any backdrop context', () => {
  const raw = validRawAnalysis({
    screen_layers: [{ id: 'modal', kind: 'modal', name: '弹窗', parent_id: null }]
  });
  const { errors } = normalizeIntentAnalysis(raw);
  assert.ok(errors.some((e) => e.includes('require a background_frame or primary_content')));
});

test('rejects visible entries referencing unknown layers but not silently dropping them', () => {
  const raw = validRawAnalysis();
  raw.visible_controls[0].layer_id = 'nowhere';
  const { value, errors } = normalizeIntentAnalysis(raw);
  assert.equal(value, null);
  assert.ok(errors.some((e) => e.includes('unknown layer_id "nowhere"')));
});

test('rejects audit rows that reference unknown uncertainties', () => {
  const raw = validRawAnalysis({
    uncertainty_audit: auditRows({ reward_rules: { status: 'questions_present', uncertainty_ids: ['ghost-question'] } })
  });
  const { errors } = normalizeIntentAnalysis(raw);
  assert.ok(errors.some((e) => e.includes('unknown uncertainty id(s): ghost-question')));
});

test('rejects incomplete eight-category audits', () => {
  const raw = validRawAnalysis();
  raw.uncertainty_audit = raw.uncertainty_audit.slice(0, 5);
  const { errors } = normalizeIntentAnalysis(raw);
  assert.equal(errors.filter((e) => e.includes('missing category')).length, 3);
});

test('enforces structural limits as errors, never silent truncation', () => {
  const raw = validRawAnalysis();
  raw.screen_layers = Array.from({ length: 13 }, (_, i) => ({
    id: i === 0 ? 'primary' : `layer-${i}`,
    kind: i === 0 ? 'primary_content' : 'region',
    name: `层${i}`,
    parent_id: null
  }));
  const { errors } = normalizeIntentAnalysis(raw);
  assert.ok(errors.some((e) => e.includes('screen_layers exceeds 12')));
});

test('ignores model-provided server-owned fields with a warning', () => {
  const raw = validRawAnalysis({ analysis_id: 'forged', generated_at: '1970', provider: { model: 'x' } });
  const { value, warnings } = normalizeIntentAnalysis(raw);
  assert.ok(!('analysis_id' in value));
  assert.equal(warnings.filter((w) => w.includes('server field')).length, 3);
});

// ---------------------------------------------------------------------------
// Unsupported claim policy
// ---------------------------------------------------------------------------

test('policy: same-entity visible text supports the claimed state', () => {
  const analysis = normalizedFixture();
  analysis.visible_information_and_states[0].claimed_states = [{ state: '已领取', support: ['99万/999万'] }];
  const { value, demoted } = applyUnsupportedClaimPolicy(analysis);
  assert.equal(demoted.length, 0);
  assert.equal(value.visible_information_and_states[0].claimed_states.length, 1);
});

test('policy: a business word elsewhere on the page never supports an unrelated claim', () => {
  const analysis = normalizedFixture();
  // "领取" appears nowhere in info-rewards' own label/text; another control
  // having that word must not count.
  analysis.visible_controls.push({
    id: 'control-claim',
    layer_id: 'modal',
    visible_label: '领取',
    visible_text: '',
    observed_states: [],
    claimed_states: [],
    summary: ''
  });
  analysis.visible_information_and_states[0].claimed_states = [{ state: '已领取', support: ['领取'] }];
  const { value, demoted, warnings } = applyUnsupportedClaimPolicy(analysis);
  assert.deepEqual(demoted, ['policy-state_semantics-info-rewards-1']);
  assert.equal(value.visible_information_and_states[0].claimed_states.length, 0);
  const added = value.uncertainties.find((u) => u.id === 'policy-state_semantics-info-rewards-1');
  assert.equal(added.created_by, 'policy');
  assert.equal(added.priority, 'important');
  assert.deepEqual(added.evidence_ids, ['info-rewards']);
  const auditRow = value.uncertainty_audit.find((row) => row.category === 'state_semantics');
  assert.equal(auditRow.status, 'questions_present');
  assert.ok(auditRow.uncertainty_ids.includes('policy-state_semantics-info-rewards-1'));
  assert.ok(warnings.some((w) => w.includes('demoted')));
});

test('policy: claims without any support array are demoted too', () => {
  const analysis = normalizedFixture();
  analysis.visible_controls[0].claimed_states = [{ state: '可重复挑战', support: [] }];
  const { demoted } = applyUnsupportedClaimPolicy(analysis);
  assert.equal(demoted.length, 1);
});

test('policy: confidence or summary text cannot bypass the same-entity rule', () => {
  const analysis = normalizedFixture();
  analysis.visible_information_and_states[0].claimed_states = [{ state: '已领取', support: [] }];
  analysis.visible_information_and_states[0].summary = '高置信度：已领取';
  const { demoted } = applyUnsupportedClaimPolicy(analysis);
  assert.equal(demoted.length, 1, 'summary text is not evidence');
});

// ---------------------------------------------------------------------------
// Review builder + confirmation gate
// ---------------------------------------------------------------------------

test('createIntentReview maps visible facts, inferences and uncertainties with stable ids', () => {
  const review = createIntentReview(normalizedFixture(), { wireframeRevision: 3 });
  assert.equal(review.page_purpose.origin, 'ai_inference');
  assert.equal(review.visible_controls[0].origin, 'ai_visible');
  assert.equal(review.player_tasks[0].id, 'task-check-damage');
  assert.equal(review.uncertainties[0].review_status, 'unreviewed');
  assert.equal(review.confirmed_at, null);
  assert.equal(review.source_wireframe_revision, 3);
});

test('builder is deterministic for identical analyses', () => {
  const a = createIntentReview(normalizedFixture(), { wireframeRevision: 1 });
  const b = createIntentReview(normalizedFixture(), { wireframeRevision: 1 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('confirmation gate rejects unreviewed uncertainties', () => {
  const review = reviewedFixture({ answerBlocking: false });
  const { errors } = validateIntentReview(review, { forConfirmation: true });
  assert.ok(errors.some((e) => e.includes('still unreviewed')));
});

test('confirmation gate rejects blocking uncertainty deferred', () => {
  const review = reviewedFixture({ answerBlocking: false });
  review.uncertainties[0].review_status = 'deferred';
  const { errors } = validateIntentReview(review, { forConfirmation: true });
  assert.ok(errors.some((e) => e.includes('cannot be deferred')));
});

test('confirmation gate requires a rationale when blocking is not_applicable', () => {
  const review = reviewedFixture({ answerBlocking: false });
  review.uncertainties[0].review_status = 'not_applicable';
  review.uncertainties[0].note = '';
  const { errors } = validateIntentReview(review, { forConfirmation: true });
  assert.ok(errors.some((e) => e.includes('requires a rationale note')));
});

test('confirmation gate rejects answered without note', () => {
  const review = reviewedFixture();
  review.uncertainties[0].note = '   ';
  const { errors } = validateIntentReview(review, { forConfirmation: false });
  assert.ok(errors.some((e) => e.includes('answered but has an empty note')));
});

test('confirmation gate rejects content deleted empty', () => {
  const review = reviewedFixture();
  review.player_tasks = [];
  review.core_flow = [];
  review.visible_controls = [];
  review.visible_information_and_states = [];
  const { errors } = validateIntentReview(review, { forConfirmation: true });
  assert.ok(errors.some((e) => e.includes('player tasks')));
  assert.ok(errors.some((e) => e.includes('core flow')));
  assert.ok(errors.some((e) => e.includes('visible controls')));
});

test('draft validation allows empty sections; confirmation does not', () => {
  const review = reviewedFixture();
  review.player_tasks = [];
  assert.equal(validateIntentReview(review, { forConfirmation: false }).errors.length, 0);
  assert.ok(validateIntentReview(review, { forConfirmation: true }).errors.length > 0);
});

// ---------------------------------------------------------------------------
// Deterministic renderer
// ---------------------------------------------------------------------------

test('renderer emits the fixed six sections and is byte-stable', () => {
  const review = reviewedFixture();
  const first = renderIntentReview(review);
  const second = renderIntentReview(JSON.parse(JSON.stringify(review)));
  assert.equal(first, second);
  for (const heading of ['【页面目的】', '【玩家任务】', '【核心流程】', '【可见控件】', '【可见信息与状态】', '【待确认项】']) {
    assert.ok(first.includes(heading), `missing ${heading}`);
  }
  assert.ok(first.includes('已回答：绿色勾=已领取，黄色高亮=进行中'));
});

test('renderer marks deferred and not_applicable items explicitly', () => {
  const review = reviewedFixture({ answerBlocking: false });
  review.uncertainties[0].review_status = 'deferred';
  review.uncertainties.push({ ...review.uncertainties[0], id: 'u2', priority: 'optional', review_status: 'not_applicable', note: '本页无此规则' });
  const rendered = renderIntentReview(review);
  assert.ok(rendered.includes('暂保留，尚未定案'));
  assert.ok(rendered.includes('设计师确认不适用（理由：本页无此规则）'));
});

test('renderer placeholder cannot pass the confirmation gate', () => {
  const review = reviewedFixture();
  review.player_tasks = [];
  const rendered = renderIntentReview(review);
  assert.ok(rendered.includes('（暂无内容）'));
  assert.ok(validateIntentReview(review, { forConfirmation: true }).errors.length > 0);
});

// ---------------------------------------------------------------------------
// Canonical Intent Context + hash
// ---------------------------------------------------------------------------

function contextInputs(overrides = {}) {
  const analysis = normalizedFixture();
  analysis.source_revision = { wireframe: 4, project_type: 'new' };
  const review = reviewedFixture();
  return {
    review,
    analysis,
    wireframeRevision: 4,
    projectType: 'new',
    ...overrides
  };
}

test('hash is stable across key order and ignores audit-only fields', () => {
  const a = buildCanonicalIntentContext(contextInputs());
  const shuffledReview = JSON.parse(JSON.stringify(contextInputs().review));
  shuffledReview.player_tasks = shuffledReview.player_tasks.map(({ text, id, ...rest }) => ({ text, id, ...rest }));
  const b = buildCanonicalIntentContext(contextInputs({ review: shuffledReview }));
  assert.equal(canonicalIntentContextHash(a), canonicalIntentContextHash(b));
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
});

test('hash changes when effective content changes', () => {
  const base = canonicalIntentContextHash(buildCanonicalIntentContext(contextInputs()));
  const editedReview = reviewedFixture();
  editedReview.player_tasks[0].text = '查看伤害并领取奖励';
  assert.notEqual(canonicalIntentContextHash(buildCanonicalIntentContext(contextInputs({ review: editedReview }))), base);
  assert.notEqual(canonicalIntentContextHash(buildCanonicalIntentContext(contextInputs({ wireframeRevision: 5 }))), base);
  assert.notEqual(canonicalIntentContextHash(buildCanonicalIntentContext(contextInputs({ projectType: 'existing' }))), base);
});

test('stale analysis is fully excluded from the context', () => {
  const context = buildCanonicalIntentContext(contextInputs({ wireframeRevision: 5 }));
  assert.equal(context.visible_facts, null);
  assert.equal(context.analysis_context_excluded, true);
  assert.equal(context.analysis_context_excluded_reason, 'wireframe_revision_mismatch');
  const projectContext = buildScreenContractIntentContext({
    input_revisions: { wireframe: 5 },
    project_type: 'new',
    intent_analysis: contextInputs().analysis,
    intent_review: contextInputs().review
  });
  assert.equal(projectContext.meta.analysis_context_excluded, true);
  assert.equal(projectContext.meta.reason, 'wireframe_revision_mismatch');
});

test('project_type mismatch also excludes analysis facts', () => {
  const context = buildCanonicalIntentContext(contextInputs({ projectType: 'existing' }));
  assert.equal(context.visible_facts, null);
  assert.equal(context.analysis_context_excluded_reason, 'project_type_mismatch');
});

test('deferred uncertainties travel with the context as unresolved', () => {
  const review = reviewedFixture({ answerBlocking: false });
  review.uncertainties[0].review_status = 'deferred';
  const context = buildCanonicalIntentContext(contextInputs({ review }));
  assert.equal(context.deferred_uncertainties.length, 1);
  assert.equal(context.deferred_uncertainties[0].id, 'uncertainty-state-meaning');
});

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

test('diff matches by stable id first, then text, and flags add/remove', () => {
  const current = reviewedFixture();
  const candidate = reviewedFixture();
  candidate.player_tasks[0].text = '查看个人与全派伤害并领取奖励'; // same id → modified
  candidate.core_flow[0].id = 'flow-open-v2'; // same text → moved
  candidate.visible_controls.push({ id: 'control-new', text: '新增控件', origin: 'designer', source_evidence_ids: [], designer_modified: false });
  candidate.visible_information_and_states = []; // removed
  const diff = diffIntentReviews(current, candidate);
  assert.equal(diff.player_tasks[0].section_kind, 'modified');
  assert.equal(diff.core_flow.find((d) => d.current_id === 'flow-open').section_kind, 'moved');
  assert.equal(diff.visible_controls.find((d) => d.candidate_id === 'control-new').section_kind, 'added');
  assert.equal(diff.visible_information_and_states[0].section_kind, 'removed');
});
