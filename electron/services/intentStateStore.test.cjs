// PR-I1 storage/concurrency/crash-healing tests (v1.4 §13.3).
// Deterministic only — no model, no network. Fault injection drives every
// crash point of the §8.6 publish sequence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectStore } = require('./projectStore.cjs');
const { createIntentStateStore } = require('./intentStateStore.cjs');
const { ERROR_CODES } = require('./errorCodes.cjs');
const intent = require('./intentAnalysis.cjs');
const { readJson, writeJson } = require('./jsonStore.cjs');

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function auditRows(overrides = {}) {
  return intent.UNCERTAINTY_CATEGORIES.map((category) => ({
    category,
    status: 'no_gap_found',
    uncertainty_ids: [],
    rationale: '',
    ...(overrides[category] || {})
  }));
}

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
      { id: 'control-challenge', layer_id: 'modal', visible_label: '挑战', visible_text: '', observed_states: [], claimed_states: [] }
    ],
    visible_information_and_states: [
      { id: 'info-rewards', layer_id: 'modal', visible_label: '奖励进度', visible_text: '99万/999万', observed_states: [], claimed_states: [] }
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

async function setup(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intent-state-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = root;
  const projectStore = createProjectStore();
  const intentStore = createIntentStateStore({ projectStore, ...(options.processInstanceId ? { processInstanceId: options.processInstanceId } : {}) });
  projectStore.__attachIntentStore(intentStore);
  const project = await projectStore.create({ name: 'Intent State', projectType: 'new', requirement: options.requirement || '' });
  return {
    root,
    projectStore,
    intentStore,
    project,
    async cleanup() {
      if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
      else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

function inputsPath(project, screenId = 'main') {
  return path.join(project.workspacePath, 'screens', screenId, 'inputs.json');
}
function candidateFile(project, screenId = 'main') {
  return path.join(project.workspacePath, 'screens', screenId, 'inputs', 'intent-candidate.json');
}
function historyIndex(project, screenId = 'main') {
  return path.join(project.workspacePath, 'screens', screenId, 'inputs', 'intent-review-history', 'index.json');
}
function contractFile(project, screenId = 'main') {
  return path.join(project.workspacePath, 'screens', screenId, 'screen-contract.json');
}
function workflowFile(project) {
  return path.join(project.workspacePath, 'workflow', 'state.json');
}

async function readInputs(project, screenId = 'main') {
  return readJson(inputsPath(project, screenId), null);
}

async function reviewRevision(ctx, screenId = 'main') {
  const inputs = await readInputs(ctx.project, screenId);
  return Number(inputs?.input_revisions?.intent_review || 0);
}

async function rejectWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return true;
  });
}

// Drive a first-draft adoption so the screen owns a review to edit.
async function adoptFirstDraft(ctx, overrides) {
  const { requestId } = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
  const result = await ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId, rawAnalysis: validRawAnalysis(overrides) });
  assert.equal(result.adopted, 'first-draft');
  return result.inputs;
}

// Drive the candidate path (screen already has authoritative input).
async function generateCandidate(ctx) {
  const { requestId } = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
  const result = await ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId, rawAnalysis: validRawAnalysis() });
  assert.equal(result.saved, 'candidate');
  return result.candidateId;
}

// ---------------------------------------------------------------------------
// Generation: first draft, candidate, supersede, interrupted
// ---------------------------------------------------------------------------

test('first prefill on a blank project adopts the draft directly', async () => {
  const ctx = await setup();
  try {
    const inputs = await adoptFirstDraft(ctx);
    assert.equal(inputs.intent_mode, 'structured-v2');
    assert.equal(inputs.requirement_source, 'ai');
    assert.equal(inputs.requirement_confirmed, false);
    assert.ok(inputs.requirement.includes('【页面目的】'));
    assert.equal(inputs.intent_generation.status, 'ready');
    assert.equal(inputs.input_revisions.intent_review, 1);
    assert.equal(inputs.input_revisions.intent_context, 1);
    assert.ok(inputs.intent_context.hash.startsWith('sha256:'));
    const workflow = await readJson(workflowFile(ctx.project), null);
    assert.equal(workflow.stages.input.status, 'reviewed');
    // Server-owned fields stamped, analysis freshness derivable.
    assert.ok(inputs.intent_analysis.analysis_id.startsWith('analysis-'));
    assert.ok(intent.analysisIsFresh(inputs.intent_analysis, { wireframeRevision: 0, projectType: 'new' }));
  } finally {
    await ctx.cleanup();
  }
});

test('existing authoritative input sends the result to candidate only', async () => {
  const ctx = await setup({ requirement: '手工需求' });
  try {
    const before = await readInputs(ctx.project);
    const { requestId } = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    const running = await readInputs(ctx.project);
    assert.notEqual(running.intent_mode, 'structured-v2', 'generation start never flips mode (§16 G)');
    const completeResult = await ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId, rawAnalysis: validRawAnalysis() });
    assert.equal(completeResult.saved, 'candidate');
    const candidateId = completeResult.candidateId;
    const after = await readInputs(ctx.project);
    assert.equal(after.requirement, '手工需求', 'current requirement never overwritten');
    assert.equal(after.requirement_source, before.requirement_source);
    assert.equal(after.intent_review ?? null, null, 'current review untouched');
    assert.notEqual(after.intent_mode, 'structured-v2', 'mode only flips on adopt (§16 G)');
    assert.equal(after.intent_generation.status, 'ready');
    const candidate = await readJson(candidateFile(ctx.project), null);
    assert.equal(candidate.candidate_id, candidateId);
    assert.equal(candidate.status, 'ready');
    // §8.4: baseline is the commit-time revision, not the request-start one.
    assert.equal(candidate.base_current_revisions.requirement, after.input_revisions.requirement);
    assert.equal(candidate.source_context.wireframe_revision, after.input_revisions.wireframe);
  } finally {
    await ctx.cleanup();
  }
});

test('a blank first-draft request whose screen became non-blank saves a candidate', async () => {
  const ctx = await setup();
  try {
    const { requestId } = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    // Simulate user content landing while the model is running.
    const current = await readInputs(ctx.project);
    await writeJson(inputsPath(ctx.project), { ...current, requirement: '用户手填', requirement_source: 'user' });
    const result = await ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId, rawAnalysis: validRawAnalysis() });
    assert.equal(result.saved, 'candidate');
    const after = await readInputs(ctx.project);
    assert.equal(after.requirement, '用户手填');
  } finally {
    await ctx.cleanup();
  }
});

test('a second request supersedes the first', async () => {
  const ctx = await setup();
  try {
    const first = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    const second = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    assert.notEqual(first.requestId, second.requestId);
    await rejectWithCode(
      ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId: first.requestId, rawAnalysis: validRawAnalysis() }),
      ERROR_CODES.INTENT_REQUEST_SUPERSEDED
    );
    const result = await ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId: second.requestId, rawAnalysis: validRawAnalysis() });
    assert.equal(result.adopted, 'first-draft');
  } finally {
    await ctx.cleanup();
  }
});

test('a late failure of the old request never corrupts the new running slot', async () => {
  const ctx = await setup();
  try {
    const first = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    const second = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    await rejectWithCode(
      ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId: first.requestId, failure: { status: 'failed', error_code: 'PROVIDER_ERROR' } }),
      ERROR_CODES.INTENT_REQUEST_SUPERSEDED
    );
    const inputs = await readInputs(ctx.project);
    assert.equal(inputs.intent_generation.request_id, second.requestId);
    assert.equal(inputs.intent_generation.status, 'running');
    assert.equal(inputs.intent_generation.finished_at, null);
    assert.equal(inputs.intent_generation.error_code, null);
  } finally {
    await ctx.cleanup();
  }
});

test('a late success of the old request never writes candidate or current inputs', async () => {
  const ctx = await setup({ requirement: '手工需求' });
  try {
    const first = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    const second = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    await rejectWithCode(
      ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId: first.requestId, rawAnalysis: validRawAnalysis() }),
      ERROR_CODES.INTENT_REQUEST_SUPERSEDED
    );
    assert.equal(await readJson(candidateFile(ctx.project), null), null);
    const inputs = await readInputs(ctx.project);
    assert.equal(inputs.intent_generation.request_id, second.requestId);
    assert.equal(inputs.intent_generation.status, 'running');
  } finally {
    await ctx.cleanup();
  }
});

test('process restart converts a stale running generation into interrupted', async () => {
  const ctx = await setup();
  try {
    await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    // A new process instance takes over (store re-attachment).
    const restarted = createIntentStateStore({ projectStore: ctx.projectStore, processInstanceId: 'process-restarted' });
    ctx.projectStore.__attachIntentStore(restarted);
    const opened = await ctx.projectStore.open(ctx.project.id);
    assert.equal(opened.intent_generation.status, 'interrupted');
    assert.equal(opened.intent_generation.error_code, ERROR_CODES.INTENT_GENERATION_INTERRUPTED);
    const inputs = await readInputs(ctx.project);
    assert.equal(inputs.intent_generation.status, 'interrupted');
    assert.equal(inputs.requirement, '', 'current input untouched by the conversion');
    const workflow = await readJson(workflowFile(ctx.project), null);
    assert.notEqual(workflow.stages.input.status, 'failed');
  } finally {
    await ctx.cleanup();
  }
});

test('an existing ready candidate blocks a new generation', async () => {
  const ctx = await setup({ requirement: '手工需求' });
  try {
    await generateCandidate(ctx);
    await rejectWithCode(
      ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main'),
      ERROR_CODES.INTENT_CANDIDATE_REPLACEMENT_REQUIRED
    );
  } finally {
    await ctx.cleanup();
  }
});

test('a wireframe revision change during the request stale-rejects the result', async () => {
  const ctx = await setup();
  try {
    const { requestId } = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    const current = await readInputs(ctx.project);
    await writeJson(inputsPath(ctx.project), { ...current, input_revisions: { ...current.input_revisions, wireframe: 1 } });
    await rejectWithCode(
      ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId, rawAnalysis: validRawAnalysis() }),
      ERROR_CODES.INTENT_ANALYSIS_STALE
    );
    const inputs = await readInputs(ctx.project);
    assert.equal(inputs.intent_generation.status, 'failed');
    assert.equal(inputs.intent_generation.error_code, ERROR_CODES.INTENT_ANALYSIS_STALE);
    assert.equal(inputs.intent_analysis ?? null, null, 'authority unchanged');
  } finally {
    await ctx.cleanup();
  }
});

test('a project type change during the request stale-rejects the result', async () => {
  const ctx = await setup();
  try {
    const { requestId } = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    await ctx.projectStore.saveProject(ctx.project.id, { projectType: 'existing' });
    await rejectWithCode(
      ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId, rawAnalysis: validRawAnalysis() }),
      ERROR_CODES.INTENT_ANALYSIS_STALE
    );
    const inputs = await readInputs(ctx.project);
    assert.equal(inputs.intent_generation.error_code, ERROR_CODES.INTENT_ANALYSIS_STALE);
  } finally {
    await ctx.cleanup();
  }
});

test('an analysis that stays invalid is rejected without touching authority', async () => {
  const ctx = await setup();
  try {
    const { requestId } = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    await rejectWithCode(
      ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId, rawAnalysis: { page_type: 'wizard' } }),
      ERROR_CODES.INTENT_ANALYSIS_INVALID
    );
    const inputs = await readInputs(ctx.project);
    assert.equal(inputs.intent_generation.status, 'failed');
    assert.equal(inputs.intent_generation.error_code, ERROR_CODES.INTENT_ANALYSIS_INVALID);
    assert.equal(inputs.intent_analysis ?? null, null);
    const workflow = await readJson(workflowFile(ctx.project), null);
    assert.equal(workflow.stages.input.status, 'failed', 'first-draft failure surfaces on the input stage');
  } finally {
    await ctx.cleanup();
  }
});

test('explicit failure terminal write-back uses request-id CAS first', async () => {
  const ctx = await setup();
  try {
    const { requestId } = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    const result = await ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId, failure: { status: 'provider-timeout', error_code: 'PROVIDER_TIMEOUT' } });
    assert.equal(result.status, 'provider-timeout');
    const inputs = await readInputs(ctx.project);
    assert.equal(inputs.intent_generation.status, 'provider-timeout');
    assert.equal(inputs.intent_generation.error_code, 'PROVIDER_TIMEOUT');
    assert.ok(inputs.intent_generation.finished_at);
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Review save / confirm (§8.9, §8.10)
// ---------------------------------------------------------------------------

function cloneReview(review) {
  return JSON.parse(JSON.stringify(review));
}

function answeredDraft(review, note = '绿色勾表示已领取，黄色高亮表示可领取。') {
  const draft = cloneReview(review);
  draft.uncertainties[0].review_status = 'answered';
  draft.uncertainties[0].note = note;
  draft.uncertainties[0].designer_modified = true;
  return draft;
}

function saveDraft(ctx, draft, expectedRevision) {
  return ctx.intentStore.saveIntentReview(ctx.project.id, 'main', { expectedIntentReviewRevision: expectedRevision, draft });
}

async function writeContract(project, hash, version = 3, screenId = 'main') {
  await writeJson(contractFile(project, screenId), {
    schema_version: '1.0', version, status: 'generated', source: { intent_context: { hash } }
  });
}

// adopt → answer the blocking uncertainty → confirm. Returns confirmed inputs.
async function adoptAndConfirm(ctx) {
  const inputs = await adoptFirstDraft(ctx);
  const saved = await saveDraft(ctx, answeredDraft(inputs.intent_review), inputs.input_revisions.intent_review);
  const confirmed = await ctx.intentStore.confirmIntentReview(ctx.project.id, 'main', { expectedIntentReviewRevision: saved.inputs.input_revisions.intent_review });
  assert.equal(confirmed.inputs.requirement_confirmed, true);
  return confirmed.inputs;
}

test('saving identical review content is a no-op (no writes, no revision bump)', async () => {
  const ctx = await setup();
  try {
    const inputs = await adoptFirstDraft(ctx);
    const beforeBytes = await fs.readFile(inputsPath(ctx.project), 'utf8');
    const result = await saveDraft(ctx, cloneReview(inputs.intent_review), inputs.input_revisions.intent_review);
    assert.equal(result.noop, true);
    assert.equal(await fs.readFile(inputsPath(ctx.project), 'utf8'), beforeBytes, 'no-op never rewrites inputs.json');
    assert.equal(await readJson(historyIndex(ctx.project), { entries: [] }).then((index) => index.entries.length), 0, 'no-op never writes history');
  } finally {
    await ctx.cleanup();
  }
});

test('client-injected revision/confirmed_at are stripped and re-stamped server-side', async () => {
  const ctx = await setup();
  try {
    const inputs = await adoptFirstDraft(ctx);
    const draft = cloneReview(inputs.intent_review);
    draft.revision = 999;
    draft.confirmed_at = '1970-01-01T00:00:00.000Z';
    draft.page_purpose.text = '调整后的页面目的';
    draft.page_purpose.designer_modified = true;
    const result = await saveDraft(ctx, draft, inputs.input_revisions.intent_review);
    assert.equal(result.inputs.intent_review.revision, inputs.input_revisions.intent_review + 1);
    assert.equal(result.inputs.intent_review.confirmed_at, null);
    assert.equal(result.inputs.requirement_source, 'user');
    assert.equal(result.inputs.requirement_confirmed, false);
  } finally {
    await ctx.cleanup();
  }
});

test('saveIntentReview enforces the expected revision (CAS)', async () => {
  const ctx = await setup();
  try {
    const inputs = await adoptFirstDraft(ctx);
    const draft = answeredDraft(inputs.intent_review);
    await rejectWithCode(
      saveDraft(ctx, draft, inputs.input_revisions.intent_review + 5),
      ERROR_CODES.INTENT_REVISION_CONFLICT
    );
  } finally {
    await ctx.cleanup();
  }
});

test('missing expected revision is an explicit conflict on every intent mutation (§11.1)', async () => {
  const ctx = await setup();
  try {
    const inputs = await adoptFirstDraft(ctx);
    const draft = answeredDraft(inputs.intent_review);
    // save / confirm / restore：缺失或非数字的 expected revision 必须显式报
    // 冲突，而不是隐式落入 NaN≠current。
    await assert.rejects(
      ctx.intentStore.saveIntentReview(ctx.project.id, 'main', { draft }),
      (error) => {
        assert.equal(error.code, ERROR_CODES.INTENT_REVISION_CONFLICT);
        assert.equal(error.expected, null);
        assert.equal(error.current, inputs.input_revisions.intent_review);
        assert.match(error.message, /缺少 expectedIntentReviewRevision/);
        return true;
      }
    );
    await rejectWithCode(
      ctx.intentStore.confirmIntentReview(ctx.project.id, 'main', { expectedIntentReviewRevision: 'not-a-number' }),
      ERROR_CODES.INTENT_REVISION_CONFLICT
    );
    const entries = await ctx.intentStore.listIntentHistory(ctx.project.id, 'main');
    assert.ok(entries.length === 0, 'no history yet; restore still requires the revision first');
    // adopt / restore：先制造候选与历史，再验证必填门禁。
    const before = await readInputs(ctx.project);
    await saveDraft(ctx, answeredDraft(before.intent_review, '制造历史'), before.input_revisions.intent_review);
    const [entry] = await ctx.intentStore.listIntentHistory(ctx.project.id, 'main');
    await rejectWithCode(
      ctx.intentStore.restoreIntentHistory(ctx.project.id, 'main', { historyId: entry.history_id }),
      ERROR_CODES.INTENT_REVISION_CONFLICT
    );
  } finally {
    await ctx.cleanup();
  }
});

test('adopting a candidate without expected revision is rejected even when the baseline matches', async () => {
  const ctx = await setup({ requirement: '手工需求' });
  try {
    const candidateId = await generateCandidate(ctx);
    await rejectWithCode(
      ctx.intentStore.adoptIntentCandidate(ctx.project.id, 'main', { candidateId }),
      ERROR_CODES.INTENT_REVISION_CONFLICT
    );
    // 补上必填字段后同一候选仍可正常采用。
    const result = await ctx.intentStore.adoptIntentCandidate(ctx.project.id, 'main', { candidateId, expectedIntentReviewRevision: await reviewRevision(ctx) });
    assert.equal(result.adopted, true);
  } finally {
    await ctx.cleanup();
  }
});

test('answering an uncertainty keeps the Intent Context stable and downstream fresh', async () => {
  const ctx = await setup();
  try {
    const inputs = await adoptFirstDraft(ctx);
    await writeContract(ctx.project, inputs.intent_context.hash);
    const result = await saveDraft(ctx, answeredDraft(inputs.intent_review), inputs.input_revisions.intent_review);
    assert.equal(result.contextChanged, false);
    assert.equal(result.inputs.input_revisions.intent_context, inputs.input_revisions.intent_context, 'context revision not bumped');
    assert.equal(result.inputs.input_revisions.intent_review, inputs.input_revisions.intent_review + 1);
    const contract = await readJson(contractFile(ctx.project), null);
    assert.equal(contract.status, 'generated', 'downstream not staled when the context hash is stable');
  } finally {
    await ctx.cleanup();
  }
});

test('a deferred uncertainty bumps the context and pre-marks downstream stale without a version bump', async () => {
  const ctx = await setup();
  try {
    const inputs = await adoptFirstDraft(ctx);
    await writeContract(ctx.project, inputs.intent_context.hash, 7);
    const draft = cloneReview(inputs.intent_review);
    draft.uncertainties[0].review_status = 'deferred';
    const result = await saveDraft(ctx, draft, inputs.input_revisions.intent_review);
    assert.equal(result.contextChanged, true);
    assert.equal(result.inputs.input_revisions.intent_context, inputs.input_revisions.intent_context + 1);
    const contract = await readJson(contractFile(ctx.project), null);
    assert.equal(contract.status, 'stale');
    assert.equal(contract.stale_reason, 'intent_context_changed');
    assert.equal(contract.version, 7, 'pre-mark never bumps the artifact version');
  } finally {
    await ctx.cleanup();
  }
});

test('confirmation rejects while a blocking uncertainty is unreviewed', async () => {
  const ctx = await setup();
  try {
    const inputs = await adoptFirstDraft(ctx);
    await rejectWithCode(
      ctx.intentStore.confirmIntentReview(ctx.project.id, 'main', { expectedIntentReviewRevision: inputs.input_revisions.intent_review }),
      ERROR_CODES.INTENT_REVIEW_INCOMPLETE
    );
  } finally {
    await ctx.cleanup();
  }
});

test('repeated confirm is a no-op and a stale confirm is CAS-rejected', async () => {
  const ctx = await setup();
  try {
    const inputs = await adoptAndConfirm(ctx);
    assert.ok(inputs.intent_review.confirmed_at);
    const again = await ctx.intentStore.confirmIntentReview(ctx.project.id, 'main', { expectedIntentReviewRevision: inputs.input_revisions.intent_review });
    assert.equal(again.noop, true);
    await rejectWithCode(
      ctx.intentStore.confirmIntentReview(ctx.project.id, 'main', { expectedIntentReviewRevision: inputs.input_revisions.intent_review + 9 }),
      ERROR_CODES.INTENT_REVISION_CONFLICT
    );
  } finally {
    await ctx.cleanup();
  }
});

test('any persisted modification after confirm cancels the confirmation', async () => {
  const ctx = await setup();
  try {
    const confirmed = await adoptAndConfirm(ctx);
    const draft = cloneReview(confirmed.intent_review);
    draft.player_tasks[0].text = '新增：查看排行榜';
    draft.player_tasks[0].designer_modified = true;
    const result = await saveDraft(ctx, draft, confirmed.input_revisions.intent_review);
    assert.equal(result.inputs.requirement_confirmed, false);
    assert.equal(result.inputs.intent_review.confirmed_at, null);
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Candidate adopt / discard (§8.11, §8.4)
// ---------------------------------------------------------------------------

test('adopting a ready candidate replaces the authority atomically', async () => {
  const ctx = await setup({ requirement: '手工需求' });
  try {
    const candidateId = await generateCandidate(ctx);
    const result = await ctx.intentStore.adoptIntentCandidate(ctx.project.id, 'main', { candidateId, expectedIntentReviewRevision: await reviewRevision(ctx) });
    assert.equal(result.adopted, true);
    const inputs = result.inputs;
    assert.ok(inputs.requirement.includes('【页面目的】'));
    assert.equal(inputs.requirement_source, 'ai', 'untouched candidate review stays AI-owned');
    assert.equal(inputs.requirement_confirmed, false);
    assert.equal(inputs.intent_generation.status, 'superseded');
    assert.equal(await readJson(candidateFile(ctx.project), null), null, 'adopted candidate deleted before publish');
    const index = await readJson(historyIndex(ctx.project), null);
    assert.equal(index.entries[0].reason, 'candidate-adopt');
    assert.equal(index.entries[0].was_confirmed, true, 'manual requirement starts confirmed; snapshot records it');
  } finally {
    await ctx.cleanup();
  }
});

test('a consumed candidate cannot be adopted again', async () => {
  const ctx = await setup({ requirement: '手工需求' });
  try {
    const candidateId = await generateCandidate(ctx);
    await ctx.intentStore.adoptIntentCandidate(ctx.project.id, 'main', { candidateId, expectedIntentReviewRevision: await reviewRevision(ctx) });
    await rejectWithCode(
      ctx.intentStore.adoptIntentCandidate(ctx.project.id, 'main', { candidateId, expectedIntentReviewRevision: await reviewRevision(ctx) }),
      ERROR_CODES.INTENT_CANDIDATE_STALE
    );
  } finally {
    await ctx.cleanup();
  }
});

test('editing the review after a candidate landed stale-blocks adoption', async () => {
  const ctx = await setup({ requirement: '手工需求' });
  try {
    const candidateId = await generateCandidate(ctx);
    const candidate = await readJson(candidateFile(ctx.project), null);
    const before = await readInputs(ctx.project);
    await saveDraft(ctx, answeredDraft(candidate.review), before.input_revisions.intent_review || 0);
    await rejectWithCode(
      ctx.intentStore.adoptIntentCandidate(ctx.project.id, 'main', { candidateId, expectedIntentReviewRevision: await reviewRevision(ctx) }),
      ERROR_CODES.INTENT_CANDIDATE_STALE
    );
  } finally {
    await ctx.cleanup();
  }
});

test('discarding a candidate frees regeneration', async () => {
  const ctx = await setup({ requirement: '手工需求' });
  try {
    const candidateId = await generateCandidate(ctx);
    const result = await ctx.intentStore.discardIntentCandidate(ctx.project.id, 'main', { candidateId });
    assert.equal(result.discarded, true);
    assert.equal(result.inputs.intent_generation.status, 'superseded');
    assert.equal(await readJson(candidateFile(ctx.project), null), null);
    const nextCandidateId = await generateCandidate(ctx);
    assert.ok(nextCandidateId);
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// History (§8.12, §4.4)
// ---------------------------------------------------------------------------

test('restoring history never revives confirmation and records a restore-before entry', async () => {
  const ctx = await setup();
  try {
    await adoptAndConfirm(ctx);
    const current = await readInputs(ctx.project);
    const draft = cloneReview(current.intent_review);
    draft.core_flow[0].text = '重做后的核心流程';
    draft.core_flow[0].designer_modified = true;
    await saveDraft(ctx, draft, current.input_revisions.intent_review);
    const entries = await ctx.intentStore.listIntentHistory(ctx.project.id, 'main');
    const target = entries.find((entry) => entry.reason === 'review-save');
    assert.ok(target);
    assert.equal(target.was_confirmed, true, 'the snapshotted version was confirmed');
    const result = await ctx.intentStore.restoreIntentHistory(ctx.project.id, 'main', { historyId: target.history_id, expectedIntentReviewRevision: await reviewRevision(ctx) });
    assert.equal(result.inputs.requirement_confirmed, false, 'restore never revives confirmation');
    assert.equal(result.inputs.intent_review.confirmed_at, null);
    const after = await ctx.intentStore.listIntentHistory(ctx.project.id, 'main');
    assert.equal(after[0].reason, 'restore-before');
  } finally {
    await ctx.cleanup();
  }
});

test('restore enforces revision CAS and rejects non-UUID history ids', async () => {
  const ctx = await setup();
  try {
    await adoptAndConfirm(ctx);
    const current = await readInputs(ctx.project);
    const draft = cloneReview(current.intent_review);
    draft.page_purpose.text = '再改一次目的';
    draft.page_purpose.designer_modified = true;
    await saveDraft(ctx, draft, current.input_revisions.intent_review);
    const [entry] = await ctx.intentStore.listIntentHistory(ctx.project.id, 'main');
    await rejectWithCode(
      ctx.intentStore.restoreIntentHistory(ctx.project.id, 'main', { historyId: entry.history_id, expectedIntentReviewRevision: 999 }),
      ERROR_CODES.INTENT_REVISION_CONFLICT
    );
    await rejectWithCode(
      ctx.intentStore.restoreIntentHistory(ctx.project.id, 'main', { historyId: '../index.json' }),
      ERROR_CODES.INTENT_HISTORY_VERSION_NOT_FOUND
    );
    await rejectWithCode(
      ctx.intentStore.restoreIntentHistory(ctx.project.id, 'main', { historyId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
      ERROR_CODES.INTENT_HISTORY_VERSION_NOT_FOUND
    );
  } finally {
    await ctx.cleanup();
  }
});

test('a snapshot write failure aborts restore without touching current inputs', async () => {
  const ctx = await setup();
  try {
    await adoptAndConfirm(ctx);
    const current = await readInputs(ctx.project);
    const draft = cloneReview(current.intent_review);
    draft.core_flow[0].text = '制造一条历史';
    draft.core_flow[0].designer_modified = true;
    await saveDraft(ctx, draft, current.input_revisions.intent_review);
    const before = await readInputs(ctx.project);
    const [entry] = await ctx.intentStore.listIntentHistory(ctx.project.id, 'main');
    ctx.intentStore.setFaultAt((point) => {
      if (point === 'history-snapshot') throw new Error('injected snapshot crash');
    });
    await assert.rejects(
      ctx.intentStore.restoreIntentHistory(ctx.project.id, 'main', { historyId: entry.history_id, expectedIntentReviewRevision: await reviewRevision(ctx) }),
      /injected snapshot crash/
    );
    const untouched = await readInputs(ctx.project);
    assert.equal(untouched.input_revisions.intent_review, before.input_revisions.intent_review);
    assert.equal(untouched.requirement, before.requirement);
    ctx.intentStore.setFaultAt(null);
    const result = await ctx.intentStore.restoreIntentHistory(ctx.project.id, 'main', { historyId: entry.history_id, expectedIntentReviewRevision: await reviewRevision(ctx) });
    assert.equal(result.restored, true);
  } finally {
    await ctx.cleanup();
  }
});

test('restoring a pre-wireframe snapshot restores a derived-stale draft', async () => {
  const ctx = await setup();
  try {
    await adoptAndConfirm(ctx);
    const current = await readInputs(ctx.project);
    const draft = cloneReview(current.intent_review);
    draft.player_tasks[0].text = '旧版本任务';
    draft.player_tasks[0].designer_modified = true;
    await saveDraft(ctx, draft, current.input_revisions.intent_review);
    const entries = await ctx.intentStore.listIntentHistory(ctx.project.id, 'main');
    const target = entries.find((entry) => entry.reason === 'review-save');
    assert.equal(target.wireframe_revision, 0);
    const sourceImage = path.join(ctx.root, 'ue-v2.png');
    await fs.writeFile(sourceImage, pngHeader(1080, 1920));
    await ctx.projectStore.importFile(ctx.project.id, sourceImage, 'wireframe');
    const now = await readInputs(ctx.project);
    assert.equal(now.input_revisions.wireframe, 1);
    const result = await ctx.intentStore.restoreIntentHistory(ctx.project.id, 'main', { historyId: target.history_id, expectedIntentReviewRevision: await reviewRevision(ctx) });
    assert.equal(intent.analysisIsFresh(result.inputs.intent_analysis, { wireframeRevision: 1, projectType: 'new' }), false, 'old-wireframe analysis is derived-stale');
    const recomputed = intent.buildScreenContractIntentContext({
      intent_review: result.inputs.intent_review,
      intent_analysis: result.inputs.intent_analysis,
      input_revisions: { wireframe: 1 },
      project_type: 'new'
    });
    assert.equal(recomputed.meta.analysis_context_excluded, true);
    assert.equal(result.inputs.intent_context.hash, recomputed.hash);
    assert.equal(result.inputs.requirement_confirmed, false);
  } finally {
    await ctx.cleanup();
  }
});

test('history deletion removes the entry and the snapshot file', async () => {
  const ctx = await setup();
  try {
    await adoptAndConfirm(ctx);
    const current = await readInputs(ctx.project);
    const draft = cloneReview(current.intent_review);
    draft.page_purpose.text = '删除测试';
    draft.page_purpose.designer_modified = true;
    await saveDraft(ctx, draft, current.input_revisions.intent_review);
    const entries = await ctx.intentStore.listIntentHistory(ctx.project.id, 'main');
    assert.equal(entries.length, 2, 'the confirm-flow save and this save each snapshot');
    await ctx.intentStore.deleteIntentHistory(ctx.project.id, 'main', { historyId: entries[0].history_id });
    assert.equal((await ctx.intentStore.listIntentHistory(ctx.project.id, 'main')).length, 1);
    await ctx.intentStore.deleteIntentHistory(ctx.project.id, 'main', { historyId: entries[1].history_id });
    assert.equal((await ctx.intentStore.listIntentHistory(ctx.project.id, 'main')).length, 0);
    await assert.rejects(fs.stat(path.join(ctx.project.workspacePath, 'screens', 'main', 'inputs', 'intent-review-history', `${entries[0].history_id}.json`)));
    await rejectWithCode(
      ctx.intentStore.deleteIntentHistory(ctx.project.id, 'main', { historyId: entries[0].history_id }),
      ERROR_CODES.INTENT_HISTORY_VERSION_NOT_FOUND
    );
  } finally {
    await ctx.cleanup();
  }
});

test('the 101st history entry is rejected before any mutation; freeing a slot unblocks', async () => {
  const ctx = await setup();
  try {
    await adoptFirstDraft(ctx);
    let current = await readInputs(ctx.project);
    for (let i = 1; i <= 100; i += 1) {
      const result = await saveDraft(ctx, answeredDraft(current.intent_review, `note-${i}`), current.input_revisions.intent_review);
      assert.equal(result.noop, false);
      current = result.inputs;
    }
    const entries = await ctx.intentStore.listIntentHistory(ctx.project.id, 'main');
    assert.equal(entries.length, 100);
    const blocked = answeredDraft(current.intent_review, 'note-101');
    await rejectWithCode(
      saveDraft(ctx, blocked, current.input_revisions.intent_review),
      ERROR_CODES.INTENT_HISTORY_LIMIT_REACHED
    );
    const untouched = await readInputs(ctx.project);
    assert.equal(untouched.input_revisions.intent_review, current.input_revisions.intent_review, 'limit rejection leaves current inputs untouched');
    await ctx.intentStore.deleteIntentHistory(ctx.project.id, 'main', { historyId: entries[entries.length - 1].history_id });
    const freed = await saveDraft(ctx, blocked, current.input_revisions.intent_review);
    assert.equal(freed.noop, false);
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Crash injection across the §8.6 publish sequence
// ---------------------------------------------------------------------------

test('crashes before the publish point never mutate authority; heal GCs the orphan', async () => {
  const ctx = await setup({ requirement: '手工需求' });
  try {
    const { requestId } = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    const before = await readInputs(ctx.project);
    for (const point of ['after-history', 'after-candidate', 'after-requirement-md', 'after-project-json', 'after-stale-mark']) {
      // Simulate the previous crash's orphan being healed away before retry.
      await fs.rm(candidateFile(ctx.project), { force: true });
      ctx.intentStore.setFaultAt((candidatePoint) => {
        if (candidatePoint === point) throw new Error(`crash at ${point}`);
      });
      await assert.rejects(
        ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId, rawAnalysis: validRawAnalysis() }),
        new RegExp(`crash at ${point}`)
      );
      const after = await readInputs(ctx.project);
      assert.deepEqual(after.input_revisions, before.input_revisions);
      assert.equal(after.requirement, before.requirement);
      assert.equal(after.intent_generation.status, 'running');
      assert.equal(after.intent_generation.request_id, requestId);
    }
    ctx.intentStore.setFaultAt(null);
    // The last crash (after-stale-mark) left no candidate; redo one crash that
    // leaves a ready orphan, then verify heal removes it.
    await fs.rm(candidateFile(ctx.project), { force: true });
    ctx.intentStore.setFaultAt((candidatePoint) => {
      if (candidatePoint === 'after-candidate') throw new Error('crash at after-candidate');
    });
    await assert.rejects(
      ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId, rawAnalysis: validRawAnalysis() }),
      /crash at after-candidate/
    );
    ctx.intentStore.setFaultAt(null);
    assert.ok(await fs.stat(candidateFile(ctx.project)).catch(() => null), 'orphan candidate exists pre-heal');
    await ctx.projectStore.open(ctx.project.id);
    assert.equal(await readJson(candidateFile(ctx.project), null), null, 'orphan candidate healed away');
    const healed = await readInputs(ctx.project);
    assert.equal(healed.intent_generation.status, 'running', 'heal never invents terminal states for the live process request');
  } finally {
    await ctx.cleanup();
  }
});

test('a crash after candidate deletion completes the terminal generation state forward', async () => {
  const ctx = await setup({ requirement: '手工需求' });
  try {
    const candidateId = await generateCandidate(ctx);
    ctx.intentStore.setFaultAt((point) => {
      if (point === 'before-publish') throw new Error('injected crash');
    });
    await assert.rejects(
      ctx.intentStore.adoptIntentCandidate(ctx.project.id, 'main', { candidateId, expectedIntentReviewRevision: await reviewRevision(ctx) }),
      /injected crash/
    );
    ctx.intentStore.setFaultAt(null);
    assert.equal(await readJson(candidateFile(ctx.project), null), null, 'candidate was deleted before the crash');
    const before = await readInputs(ctx.project);
    assert.equal(before.intent_generation.status, 'ready');
    assert.equal(before.intent_generation.purpose, 'candidate');
    await ctx.projectStore.open(ctx.project.id);
    const healed = await readInputs(ctx.project);
    assert.equal(healed.intent_generation.status, 'failed');
    assert.equal(healed.intent_generation.error_code, ERROR_CODES.INTENT_GENERATION_INTERRUPTED);
    assert.equal(healed.requirement, before.requirement, 'authority never rolls back');
  } finally {
    await ctx.cleanup();
  }
});

test('a crash after the publish point keeps the new authority and heals the workflow forward', async () => {
  const ctx = await setup();
  try {
    const { requestId } = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    ctx.intentStore.setFaultAt((point) => {
      if (point === 'after-publish') throw new Error('injected crash');
    });
    await assert.rejects(
      ctx.intentStore.completeIntentGeneration(ctx.project.id, 'main', { requestId, rawAnalysis: validRawAnalysis() }),
      /injected crash/
    );
    ctx.intentStore.setFaultAt(null);
    const published = await readInputs(ctx.project);
    assert.ok(published.intent_review, 'new authority already published');
    assert.ok(published.requirement.includes('【页面目的】'));
    let workflow = await readJson(workflowFile(ctx.project), null);
    assert.equal(workflow.stages.input.status, 'in_progress', 'step 9 was skipped by the crash');
    await ctx.projectStore.open(ctx.project.id);
    workflow = await readJson(workflowFile(ctx.project), null);
    assert.equal(workflow.stages.input.status, 'reviewed', 'heal completed step 9 forward');
  } finally {
    await ctx.cleanup();
  }
});

test('healing converges: a second heal over healed state writes identical bytes', async () => {
  const ctx = await setup();
  try {
    await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    const restarted = createIntentStateStore({ projectStore: ctx.projectStore, processInstanceId: 'process-other' });
    ctx.projectStore.__attachIntentStore(restarted);
    await ctx.projectStore.open(ctx.project.id); // converts running → interrupted
    const first = await fs.readFile(inputsPath(ctx.project), 'utf8');
    await ctx.projectStore.open(ctx.project.id); // heal again — must be a no-op
    assert.equal(await fs.readFile(inputsPath(ctx.project), 'utf8'), first);
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Freshness: UE replacement / Project Type (§8.13, §8.14)
// ---------------------------------------------------------------------------

test('UE replacement cancels confirmation, stales downstream and the candidate', async () => {
  const ctx = await setup();
  try {
    const confirmed = await adoptAndConfirm(ctx);
    await writeContract(ctx.project, confirmed.intent_context.hash);
    const sourceImage = path.join(ctx.root, 'ue-v2.png');
    await fs.writeFile(sourceImage, pngHeader(720, 1280));
    await ctx.projectStore.importFile(ctx.project.id, sourceImage, 'wireframe');
    const inputs = await readInputs(ctx.project);
    assert.equal(inputs.input_revisions.wireframe, 1);
    assert.equal(inputs.requirement_confirmed, false);
    assert.equal(inputs.intent_review.confirmed_at, null);
    assert.equal(inputs.requirement, confirmed.requirement, 'review text preserved');
    assert.equal(inputs.input_revisions.intent_context, confirmed.input_revisions.intent_context + 1);
    assert.equal(intent.analysisIsFresh(inputs.intent_analysis, { wireframeRevision: 1, projectType: 'new' }), false);
    const contract = await readJson(contractFile(ctx.project), null);
    assert.equal(contract.status, 'stale');
    // A later candidate also goes stale on the next UE replacement.
    await generateCandidate(ctx);
    const sourceImage2 = path.join(ctx.root, 'ue-v3.png');
    await fs.writeFile(sourceImage2, pngHeader(720, 1280));
    await ctx.projectStore.importFile(ctx.project.id, sourceImage2, 'wireframe');
    const candidate = await readJson(candidateFile(ctx.project), null);
    assert.equal(candidate.status, 'stale');
    assert.equal(candidate.stale_reason, 'wireframe-replaced');
    const { requestId } = await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    assert.ok(requestId, 'a stale candidate does not block regeneration');
  } finally {
    await ctx.cleanup();
  }
});

test('a reference-only import never touches confirmation or the Intent Context', async () => {
  const ctx = await setup();
  try {
    const confirmed = await adoptAndConfirm(ctx);
    const refImage = path.join(ctx.root, 'reference.png');
    await fs.writeFile(refImage, pngHeader(256, 256));
    await ctx.projectStore.importFile(ctx.project.id, refImage, 'reference');
    const inputs = await readInputs(ctx.project);
    assert.equal(inputs.requirement_confirmed, true);
    assert.ok(inputs.intent_review.confirmed_at);
    assert.equal(inputs.input_revisions.intent_context, confirmed.input_revisions.intent_context);
    assert.equal(inputs.input_revisions.wireframe, 0);
  } finally {
    await ctx.cleanup();
  }
});

test('Project Type change runs the full freshness mutation', async () => {
  const ctx = await setup();
  try {
    const confirmed = await adoptAndConfirm(ctx);
    await ctx.projectStore.saveProject(ctx.project.id, { projectType: 'existing' });
    const inputs = await readInputs(ctx.project);
    assert.equal(inputs.requirement_confirmed, false);
    assert.equal(inputs.intent_review.confirmed_at, null);
    assert.equal(inputs.input_revisions.intent_context, confirmed.input_revisions.intent_context + 1);
    assert.equal(intent.analysisIsFresh(inputs.intent_analysis, { wireframeRevision: 0, projectType: 'existing' }), false);
  } finally {
    await ctx.cleanup();
  }
});

test('structured-v2 fields are read-only through the plain saveProject path', async () => {
  const ctx = await setup();
  try {
    const before = await adoptFirstDraft(ctx);
    await ctx.projectStore.saveProject(ctx.project.id, {
      requirement: '试图覆盖', requirementConfirmed: true, intentAnalysis: { page_type: 'hacked' }
    });
    const after = await readInputs(ctx.project);
    assert.equal(after.requirement, before.requirement);
    assert.equal(after.requirement_confirmed, false);
    assert.equal(after.intent_analysis.page_type, before.intent_analysis.page_type);
    assert.equal(after.intent_mode, 'structured-v2');
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Clone guards (§4.5)
// ---------------------------------------------------------------------------

test('intent mutations are screen-scoped', async () => {
  const ctx = await setup();
  try {
    await ctx.projectStore.createScreen(ctx.project.id, { id: 'second', name: 'Second' });
    await adoptFirstDraft(ctx);
    const second = await readInputs(ctx.project, 'second');
    assert.equal(second.requirement, '');
    assert.notEqual(second.intent_mode, 'structured-v2');
  } finally {
    await ctx.cleanup();
  }
});

test('Screen Duplicate rejects while a generation is running', async () => {
  const ctx = await setup({ requirement: '手工需求' });
  try {
    await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    await assert.rejects(
      ctx.projectStore.duplicateScreen(ctx.project.id, 'main', { id: 'main-copy' }),
      /进行中的 Intent 预填任务/
    );
  } finally {
    await ctx.cleanup();
  }
});

test('Screen Duplicate sanitizes the clone: no confirmation, no runtime, stale candidate', async () => {
  const ctx = await setup({ requirement: '手工需求' });
  try {
    const candidateId = await generateCandidate(ctx);
    await ctx.projectStore.duplicateScreen(ctx.project.id, 'main', { id: 'main-copy' });
    const cloneInputs = await readInputs(ctx.project, 'main-copy');
    assert.equal(cloneInputs.requirement_confirmed, false);
    assert.equal(cloneInputs.intent_generation, null);
    assert.equal(cloneInputs.requirement, '手工需求');
    const cloneCandidate = await readJson(candidateFile(ctx.project, 'main-copy'), null);
    assert.equal(cloneCandidate.status, 'stale');
    assert.equal(cloneCandidate.stale_reason, 'screen-duplicated');
    assert.equal(cloneCandidate.request_id, null);
    assert.equal(cloneCandidate.duplicated_from_candidate_id, candidateId);
    const source = await readJson(candidateFile(ctx.project), null);
    assert.equal(source.status, 'ready', 'source candidate untouched');
  } finally {
    await ctx.cleanup();
  }
});

test('Project Duplicate rejects while any screen generation is running', async () => {
  const ctx = await setup({ requirement: '手工需求' });
  try {
    await ctx.intentStore.beginIntentGeneration(ctx.project.id, 'main');
    await assert.rejects(ctx.projectStore.duplicate(ctx.project.id), /进行中的 Intent 预填任务/);
  } finally {
    await ctx.cleanup();
  }
});

test('Project Duplicate zeroes runtime and stales candidates but keeps review and confirmation', async () => {
  const ctx = await setup();
  try {
    await adoptAndConfirm(ctx);
    const candidateId = await generateCandidate(ctx);
    const clone = await ctx.projectStore.duplicate(ctx.project.id);
    const cloneInputs = await readInputs(clone, 'main');
    assert.equal(cloneInputs.intent_generation, null);
    assert.equal(cloneInputs.requirement_confirmed, true, 'project copies keep confirmation');
    const cloneCandidate = await readJson(candidateFile(clone), null);
    assert.equal(cloneCandidate.status, 'stale');
    assert.equal(cloneCandidate.stale_reason, 'project-duplicated');
    assert.equal(cloneCandidate.duplicated_from_candidate_id, candidateId);
    const cloneIndex = await readJson(historyIndex(clone), null);
    assert.ok(cloneIndex.entries.length >= 1, 'history survives the copy');
    const source = await readInputs(ctx.project);
    assert.equal(source.intent_generation.status, 'ready', 'source untouched');
  } finally {
    await ctx.cleanup();
  }
});
