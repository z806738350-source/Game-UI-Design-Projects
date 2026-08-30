// Intent prefill v2 state store (v1.4 execution baseline, PR-I1).
// Screen-scoped Intent mutations: single publish point (§8.6), read-time
// self-healing (§8.7), candidate/history files, revision CAS, UE/Project
// Type freshness, request-id CAS and clone guards.
//
// Crash-safety model (ADR-009): no transaction log. Every mutation writes
// orphan-safe append/overwrite files first, then publishes screens/<id>/
// inputs.json as the sole authority point via jsonStore's atomic replace.
// Partial state always leans conservative-stale; hydrate() heals forward.
//
// Locking: every public mutation enters the SAME project write lock owned
// by projectStore and only calls *Unsafe primitives inside it — calling a
// public (auto-locking) method from within the lock would self-wait (§8.8).
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readJson, writeJson } = require('./jsonStore.cjs');
const { ERROR_CODES } = require('./errorCodes.cjs');
const intent = require('./intentAnalysis.cjs');

const HISTORY_MAX_ENTRIES = 100;
const HISTORY_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const HISTORY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERATION_STATUSES = Object.freeze(['running', 'ready', 'failed', 'superseded', 'interrupted', 'provider-timeout', 'validation-failed']);

function intentError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

function screenDirPath(projectPath, screenId) {
  return path.join(projectPath, 'screens', screenId);
}
function screenInputsPath(projectPath, screenId) {
  return path.join(screenDirPath(projectPath, screenId), 'inputs.json');
}
function candidatePath(projectPath, screenId) {
  return path.join(screenDirPath(projectPath, screenId), 'inputs', 'intent-candidate.json');
}
function historyDirPath(projectPath, screenId) {
  return path.join(screenDirPath(projectPath, screenId), 'inputs', 'intent-review-history');
}
function historyIndexPath(projectPath, screenId) {
  return path.join(historyDirPath(projectPath, screenId), 'index.json');
}
function requirementMdPath(projectPath, screenId) {
  return path.join(screenDirPath(projectPath, screenId), 'inputs', 'requirement.md');
}

function rev(inputs, key) {
  return Number(inputs?.input_revisions?.[key] || 0);
}

// Structured-v2 screens own Intent state; legacy screens never enter heal or
// freshness mutations (no-op everywhere).
function structuredMode(inputs) {
  return inputs?.intent_mode === 'structured-v2'
    || Boolean(inputs?.intent_review || inputs?.intent_analysis || inputs?.intent_generation);
}

function createIntentStateStore(options = {}) {
  const projectStore = options.projectStore;
  if (!projectStore?.__unsafe) throw new Error('createIntentStateStore requires a projectStore exposing __unsafe primitives');
  const unsafe = projectStore.__unsafe;
  // A new process instance id per store: heal converts running generations
  // stamped by a different instance into interrupted (§8.5). Tests override
  // this to simulate process restarts.
  const processInstanceId = options.processInstanceId || `process-${randomUUID()}`;
  let faultAt = options.faultAt || (() => {});

  function setFaultAt(hook) {
    faultAt = hook || (() => {});
  }

  async function requireScreen(projectPath, screenId) {
    const registry = await readJson(path.join(projectPath, 'screens', 'index.json'), { screens: [] });
    const screen = (registry.screens || []).find((entry) => entry.id === screenId);
    if ((registry.screens || []).length && !screen) {
      throw intentError(ERROR_CODES.SCREEN_NOT_FOUND, `Screen not found: ${screenId}`);
    }
    if (screen?.status === 'archived') throw new Error(`Screen is archived: ${screenId}`);
    return readJson(screenInputsPath(projectPath, screenId), null);
  }

  // Screen Contract supporting context (§6.8/§9.2): stale analysis is
  // mechanically excluded by the canonical builder, never by ad-hoc checks.
  function computeIntentContext(inputs, project) {
    return intent.buildScreenContractIntentContext({
      intent_review: inputs.intent_review || null,
      intent_analysis: inputs.intent_analysis || null,
      input_revisions: { wireframe: rev(inputs, 'wireframe') },
      project_type: project.project_type
    });
  }

  // ---------------------------------------------------------------------
  // History (§4.4)
  // ---------------------------------------------------------------------

  function buildHistorySnapshot(inputs, screenId, reason, now) {
    return {
      schema_version: '1.0',
      history_id: randomUUID(),
      screen_id: screenId,
      created_at: now,
      reason,
      analysis: inputs.intent_analysis || null,
      review: inputs.intent_review || null,
      requirement: inputs.requirement || '',
      requirement_source: inputs.requirement_source || 'none',
      was_confirmed: Boolean(inputs.requirement_confirmed),
      wireframe_revision: rev(inputs, 'wireframe'),
      requirement_revision: rev(inputs, 'requirement'),
      intent_review_revision: rev(inputs, 'intent_review'),
      intent_context_revision: rev(inputs, 'intent_context'),
      intent_context_hash: inputs.intent_context?.hash || null
    };
  }

  // Append-only write BEFORE the publish point: a crash here leaves a
  // harmless orphan that heal aligns with the index. Limits are checked
  // BEFORE touching the current inputs (§4.4, §13.3).
  async function writeHistorySnapshot(projectPath, screenId, snapshot) {
    await faultAt('history-snapshot');
    const indexPath = historyIndexPath(projectPath, screenId);
    const index = await readJson(indexPath, { schema_version: '1.0', entries: [] });
    const serialized = JSON.stringify(snapshot);
    const size = Buffer.byteLength(serialized, 'utf8');
    if (size > intent.LIMITS.candidateBytes) {
      throw intentError(ERROR_CODES.INTENT_HISTORY_LIMIT_REACHED, `history snapshot exceeds ${intent.LIMITS.candidateBytes} bytes`);
    }
    if ((index.entries || []).length + 1 > HISTORY_MAX_ENTRIES) {
      throw intentError(ERROR_CODES.INTENT_HISTORY_LIMIT_REACHED, `history entries exceed ${HISTORY_MAX_ENTRIES}; delete or export old history first`, { limit: 'entries' });
    }
    let total = 0;
    for (const entry of index.entries || []) {
      const stat = await fs.stat(path.join(historyDirPath(projectPath, screenId), `${entry.history_id}.json`)).catch(() => null);
      if (stat) total += stat.size;
    }
    if (total + size > HISTORY_MAX_TOTAL_BYTES) {
      throw intentError(ERROR_CODES.INTENT_HISTORY_LIMIT_REACHED, `history total size exceeds ${HISTORY_MAX_TOTAL_BYTES} bytes; delete or export old history first`, { limit: 'bytes' });
    }
    await writeJson(path.join(historyDirPath(projectPath, screenId), `${snapshot.history_id}.json`), snapshot);
    index.entries = [
      { history_id: snapshot.history_id, screen_id: screenId, created_at: snapshot.created_at, reason: snapshot.reason, was_confirmed: snapshot.was_confirmed, wireframe_revision: snapshot.wireframe_revision },
      ...(index.entries || [])
    ];
    await writeJson(indexPath, index);
    return snapshot.history_id;
  }

  // ---------------------------------------------------------------------
  // Single publish point (§8.6 nine-step write order)
  // ---------------------------------------------------------------------

  // Conservative downstream pre-mark: the Screen Contract artifact is the
  // root of the production chain; marking it stale is strictly conservative
  // (never falsely fresh). No version bump — heal/pre-marks must stay
  // idempotent and never duplicate history/version (§13.3).
  async function markDownstreamStale(projectPath, screenId, nextInputs) {
    const contractPath = path.join(screenDirPath(projectPath, screenId), 'screen-contract.json');
    const artifact = await readJson(contractPath, null);
    if (!artifact || artifact.status === 'stale') return false;
    // §9.2 绑定形状：{ wireframe_revision, intent_context_revision,
    // intent_context_hash }；.hash 为 PR-I1 早期形状的兼容回退。
    const boundHash = artifact.source?.intent_context?.intent_context_hash ?? artifact.source?.intent_context?.hash ?? null;
    const currentHash = nextInputs.intent_context?.hash ?? null;
    if (boundHash === currentHash) return false;
    await writeJson(contractPath, { ...artifact, status: 'stale', stale_at: new Date().toISOString(), stale_reason: 'intent_context_changed' });
    return true;
  }

  // ctx: { projectPath, projectId, screenId, nextInputs, snapshot?,
  //        candidateWrite?, candidateDelete?, workflow? }
  async function runPublishSequence(ctx) {
    const { projectPath, projectId, screenId, nextInputs } = ctx;
    // Step 3: history snapshot + index (append-only, orphan-safe).
    if (ctx.snapshot) await writeHistorySnapshot(projectPath, screenId, ctx.snapshot);
    await faultAt('after-history');
    // Step 4: candidate file (atomic overwrite, orphan-safe; heal GCs it
    // unless the published generation slot references it as ready).
    if (ctx.candidateWrite) await writeJson(candidatePath(projectPath, screenId), ctx.candidateWrite);
    await faultAt('after-candidate');
    // Step 5: requirement.md compatibility projection.
    await fs.mkdir(path.dirname(requirementMdPath(projectPath, screenId)), { recursive: true });
    await fs.writeFile(requirementMdPath(projectPath, screenId), `${nextInputs.requirement || ''}\n`, 'utf8');
    await faultAt('after-requirement-md');
    // Step 6: project.json compatibility projection (active screen only).
    const projectJsonPath = path.join(projectPath, 'project.json');
    const project = await readJson(projectJsonPath, null);
    if (project && (project.active_screen_id === screenId || project.screen_id === screenId)) {
      await writeJson(projectJsonPath, {
        ...project,
        requirement: nextInputs.requirement || '',
        requirement_source: nextInputs.requirement_source || 'none',
        requirement_confirmed: Boolean(nextInputs.requirement_confirmed),
        intent_analysis: nextInputs.intent_analysis ?? null,
        updated_at: new Date().toISOString()
      });
    }
    await faultAt('after-project-json');
    // Step 7: conservative downstream stale pre-mark (before publish; a crash
    // here only leans more stale, never falsely fresh).
    await markDownstreamStale(projectPath, screenId, nextInputs);
    await faultAt('after-stale-mark');
    // Adopted-candidate cleanup is part of the pre-publish state: an adopted
    // candidate must not be observable once the new authority is visible.
    if (ctx.candidateDelete) await fs.rm(candidatePath(projectPath, screenId), { force: true });
    await faultAt('before-publish');
    // Step 8: THE sole authoritative publish point — atomic single-file
    // replace. From here on the new inputs are authority and NEVER roll back.
    await writeJson(screenInputsPath(projectPath, screenId), nextInputs);
    await faultAt('after-publish');
    // Step 9: idempotent post-publish workflow update; anything missed is
    // completed forward by read-time healing (§8.7).
    if (ctx.workflow) {
      await unsafe.updateWorkflowUnsafe(projectId, ctx.workflow.stage, ctx.workflow.status, undefined, { screenId });
    }
    await faultAt('after-finalize');
  }

  // ---------------------------------------------------------------------
  // Two-phase generation (§8.3)
  // ---------------------------------------------------------------------

  // Phase 1 (short lock): record the running task, never wait for a model.
  async function beginIntentGeneration(projectId, screenId) {
    return unsafe.withProjectWriteLock(projectId, async () => {
      const project = await projectStore.resolveProject(projectId);
      const inputs = (await requireScreen(project.workspacePath, screenId)) || {};
      const candidate = await readJson(candidatePath(project.workspacePath, screenId), null);
      if (candidate?.status === 'ready') {
        throw intentError(ERROR_CODES.INTENT_CANDIDATE_REPLACEMENT_REQUIRED, '已存在待处理的 Intent candidate，请先采用或丢弃后再重新生成。', { candidate_id: candidate.candidate_id });
      }
      const wireframeRevision = rev(inputs, 'wireframe');
      const requestId = randomUUID();
      const hadInput = Boolean(String(inputs.requirement || '').trim()) || Boolean(inputs.intent_review);
      const now = new Date().toISOString();
      // §16 G：intent_mode 只在首稿直采 / 采用 candidate / 恢复结构化历史时切换；
      // 生成中或失败都不得把既有项目提前翻入 structured 分支。
      const nextInputs = {
        ...inputs,
        screen_id: screenId,
        intent_generation: {
          request_id: requestId,
          process_instance_id: processInstanceId,
          purpose: hadInput ? 'candidate' : 'first-draft',
          status: 'running',
          started_at: now,
          finished_at: null,
          error_code: null,
          wireframe_revision: wireframeRevision,
          project_type: project.project_type,
          had_authoritative_input: hadInput
        },
        updated_at: now
      };
      await writeJson(screenInputsPath(project.workspacePath, screenId), nextInputs);
      if (!hadInput) await unsafe.updateWorkflowUnsafe(projectId, 'input', 'in_progress', undefined, { screenId });
      return { requestId, wireframeRevision, projectType: project.project_type, purpose: hadInput ? 'candidate' : 'first-draft' };
    });
  }

  // Phase 3 (short lock): commit or fail the finished model call.
  async function completeIntentGeneration(projectId, screenId, input = {}) {
    return unsafe.withProjectWriteLock(projectId, async () => {
      const project = await projectStore.resolveProject(projectId);
      const projectPath = project.workspacePath;
      const inputs = (await requireScreen(projectPath, screenId)) || {};
      const gen = inputs.intent_generation;
      const { requestId, failure } = input;
      if (!gen || gen.request_id !== requestId) {
        throw intentError(ERROR_CODES.INTENT_REQUEST_SUPERSEDED, '该请求已被更新的 Intent 请求替代，结果不再落盘。', { request_id: requestId });
      }
      const terminalFailed = async (errorCode, message) => {
        const now = new Date().toISOString();
        const nextInputs = {
          ...inputs,
          intent_generation: { ...gen, status: 'failed', error_code: errorCode, finished_at: now },
          updated_at: now
        };
        await writeJson(screenInputsPath(projectPath, screenId), nextInputs);
        if (gen.purpose === 'first-draft') {
          await unsafe.updateWorkflowUnsafe(projectId, 'input', 'failed', undefined, { screenId });
        }
        throw intentError(errorCode, message);
      };
      if (failure) {
        const status = GENERATION_STATUSES.includes(failure.status) && failure.status !== 'running' ? failure.status : 'failed';
        const now = new Date().toISOString();
        const nextInputs = {
          ...inputs,
          intent_generation: { ...gen, status, error_code: failure.error_code || null, finished_at: now },
          updated_at: now
        };
        await writeJson(screenInputsPath(projectPath, screenId), nextInputs);
        if (gen.purpose === 'first-draft' && status === 'failed') {
          await unsafe.updateWorkflowUnsafe(projectId, 'input', 'failed', undefined, { screenId });
        }
        return { status };
      }
      // Freshness: UE / Project Type changed since Phase 1 → stale result.
      if (rev(inputs, 'wireframe') !== Number(gen.wireframe_revision)) {
        await terminalFailed(ERROR_CODES.INTENT_ANALYSIS_STALE, '提交结果时 UE 已替换，分析结果作废，请基于当前 UE 重新预填。');
      }
      if (project.project_type !== gen.project_type) {
        await terminalFailed(ERROR_CODES.INTENT_ANALYSIS_STALE, '提交结果时 Project Type 已变化，分析结果作废，请重新预填。');
      }
      const existing = await readJson(candidatePath(projectPath, screenId), null);
      if (existing?.status === 'ready') {
        throw intentError(ERROR_CODES.INTENT_CANDIDATE_REPLACEMENT_REQUIRED, '已存在待处理的 Intent candidate，请先采用或丢弃。', { candidate_id: existing.candidate_id });
      }
      // Normalize + unsupported-claim policy are authoritative server-side.
      const normalized = intent.normalizeIntentAnalysis(input.rawAnalysis);
      if (!normalized.value) {
        await terminalFailed(ERROR_CODES.INTENT_ANALYSIS_INVALID, `Intent 分析纠正后仍非法：${normalized.errors.join('；')}`);
      }
      const { value: analyzed, warnings: policyWarnings } = intent.applyUnsupportedClaimPolicy(normalized.value);
      const now = new Date().toISOString();
      const wireframeRevision = rev(inputs, 'wireframe');
      const analysis = {
        ...analyzed,
        analysis_id: `analysis-${randomUUID()}`,
        generated_at: now,
        source_revision: { wireframe: wireframeRevision, project_type: project.project_type },
        provider: input.provider || null,
        warnings: [...normalized.warnings, ...policyWarnings, ...(input.warnings || [])]
      };
      const review = intent.createIntentReview(analysis, { wireframeRevision });
      const stillBlank = !Boolean(String(inputs.requirement || '').trim()) && !inputs.intent_review;
      if (gen.purpose === 'first-draft' && stillBlank) {
        // First draft adoption: no designer work exists, so adopt directly.
        const nextReview = { ...review, revision: rev(inputs, 'intent_review') + 1, confirmed_at: null };
        const requirement = intent.renderIntentReview(nextReview);
        const candidateInputs = { ...inputs, intent_review: nextReview, intent_analysis: analysis };
        const ctx = computeIntentContext(candidateInputs, project);
        const nextInputs = {
          ...inputs,
          intent_mode: 'structured-v2',
          intent_analysis: analysis,
          intent_review: nextReview,
          requirement,
          requirement_source: 'ai',
          requirement_confirmed: false,
          intent_context: { revision: rev(inputs, 'intent_context') + 1, hash: ctx.hash },
          intent_generation: { ...gen, status: 'ready', finished_at: now, error_code: null },
          input_revisions: {
            ...inputs.input_revisions,
            requirement: rev(inputs, 'requirement') + 1,
            intent_review: rev(inputs, 'intent_review') + 1,
            intent_context: rev(inputs, 'intent_context') + 1
          },
          updated_at: now
        };
        await runPublishSequence({ projectPath, projectId, screenId, nextInputs, workflow: { stage: 'input', status: 'reviewed' } });
        return { adopted: 'first-draft', inputs: nextInputs };
      }
      // Designer work exists (or appeared during the request): never
      // overwrite — save as candidate with a commit-time baseline (§8.4).
      const candidate = {
        schema_version: '1.0',
        candidate_id: randomUUID(),
        request_id: requestId,
        screen_id: screenId,
        status: 'ready',
        generated_at: now,
        source_context: { wireframe_revision: wireframeRevision, project_type: project.project_type },
        base_current_revisions: {
          requirement: rev(inputs, 'requirement'),
          intent_review: rev(inputs, 'intent_review'),
          intent_context: rev(inputs, 'intent_context')
        },
        analysis,
        review,
        warnings: analysis.warnings
      };
      const nextInputs = {
        ...inputs,
        intent_generation: { ...gen, status: 'ready', finished_at: now, error_code: null },
        updated_at: now
      };
      await runPublishSequence({ projectPath, projectId, screenId, nextInputs, candidateWrite: candidate });
      return { saved: 'candidate', candidateId: candidate.candidate_id };
    });
  }

  // ---------------------------------------------------------------------
  // Review save / confirm (§8.9, §8.10)
  // ---------------------------------------------------------------------

  // Server-stamped review fields are never trusted from the client.
  function stripServerReviewFields(review) {
    if (!review) return null;
    const { revision, confirmed_at, ...rest } = review;
    return rest;
  }

  // §11.1：所有 Intent mutation 的 expected revision 必填。缺失时显式报
  // 冲突（而非 NaN≠current 的隐式冲突），让客户端明确知道要刷新。
  function assertExpectedRevision(value, current, action) {
    if (!Number.isFinite(Number(value))) {
      throw intentError(ERROR_CODES.INTENT_REVISION_CONFLICT, `缺少 expectedIntentReviewRevision，无法${action}；请刷新后基于最新版本重试。`, { expected: null, current });
    }
  }

  async function saveIntentReview(projectId, screenId, input = {}) {
    return unsafe.withProjectWriteLock(projectId, async () => {
      const project = await projectStore.resolveProject(projectId);
      const projectPath = project.workspacePath;
      const inputs = (await requireScreen(projectPath, screenId)) || {};
      if (!structuredMode(inputs)) throw new Error('Screen is not in structured-v2 mode.');
      assertExpectedRevision(input.expectedIntentReviewRevision, rev(inputs, 'intent_review'), '保存 Intent Review');
      if (Number(input.expectedIntentReviewRevision) !== rev(inputs, 'intent_review')) {
        throw intentError(ERROR_CODES.INTENT_REVISION_CONFLICT, 'Intent Review 已被更新，请刷新后基于最新版本保存。', { expected: Number(input.expectedIntentReviewRevision), current: rev(inputs, 'intent_review') });
      }
      const { errors } = intent.validateIntentReview(input.draft);
      if (errors.length) {
        throw intentError(ERROR_CODES.INTENT_REVIEW_INCOMPLETE, `Intent Review 校验未通过：${errors.join('；')}`, { errors });
      }
      const now = new Date().toISOString();
      const wireframeRevision = rev(inputs, 'wireframe');
      const nextReview = {
        ...input.draft,
        revision: rev(inputs, 'intent_review') + 1,
        source_analysis_id: input.draft.source_analysis_id ?? inputs.intent_review?.source_analysis_id ?? null,
        source_wireframe_revision: wireframeRevision,
        confirmed_at: null
      };
      // No-op: identical review content never writes files nor bumps any
      // revision (§8.9 step 5).
      if (intent.canonicalJson(stripServerReviewFields(nextReview)) === intent.canonicalJson(stripServerReviewFields(inputs.intent_review))) {
        return { noop: true, inputs };
      }
      const requirement = intent.renderIntentReview(nextReview);
      const candidateInputs = { ...inputs, intent_review: nextReview, intent_analysis: inputs.intent_analysis };
      const ctx = computeIntentContext(candidateInputs, project);
      const contextChanged = ctx.hash !== (inputs.intent_context?.hash ?? null);
      const revisions = { ...inputs.input_revisions, intent_review: rev(inputs, 'intent_review') + 1 };
      if (requirement !== (inputs.requirement || '')) revisions.requirement = rev(inputs, 'requirement') + 1;
      if (contextChanged) revisions.intent_context = rev(inputs, 'intent_context') + 1;
      // Any persisted user modification cancels confirmation and marks the
      // requirement as designer-owned (§8.9 steps 10–11).
      const nextInputs = {
        ...inputs,
        intent_review: nextReview,
        requirement,
        requirement_source: 'user',
        requirement_confirmed: false,
        input_revisions: revisions,
        intent_context: { revision: Number(revisions.intent_context || 0), hash: ctx.hash },
        updated_at: now
      };
      const snapshot = inputs.intent_review ? buildHistorySnapshot(inputs, screenId, 'review-save', now) : null;
      await runPublishSequence({ projectPath, projectId, screenId, nextInputs, snapshot });
      return { noop: false, contextChanged, inputs: nextInputs };
    });
  }

  async function confirmIntentReview(projectId, screenId, input = {}) {
    return unsafe.withProjectWriteLock(projectId, async () => {
      const project = await projectStore.resolveProject(projectId);
      const projectPath = project.workspacePath;
      const inputs = (await requireScreen(projectPath, screenId)) || {};
      if (!inputs.intent_review) throw intentError(ERROR_CODES.INTENT_REVIEW_INCOMPLETE, '当前 Screen 没有可确认的 Intent Review。');
      assertExpectedRevision(input.expectedIntentReviewRevision, rev(inputs, 'intent_review'), '确认 Intent Review');
      if (Number(input.expectedIntentReviewRevision) !== rev(inputs, 'intent_review')) {
        throw intentError(ERROR_CODES.INTENT_REVISION_CONFLICT, 'Intent Review 已被更新，请刷新后再确认。', { expected: Number(input.expectedIntentReviewRevision), current: rev(inputs, 'intent_review') });
      }
      const { errors } = intent.validateIntentReview(inputs.intent_review, { forConfirmation: true });
      if (errors.length) {
        throw intentError(ERROR_CODES.INTENT_REVIEW_INCOMPLETE, `确认门禁未通过：${errors.join('；')}`, { errors });
      }
      if (inputs.requirement_confirmed && inputs.intent_review.confirmed_at) return { noop: true, inputs };
      const now = new Date().toISOString();
      const nextInputs = {
        ...inputs,
        intent_review: { ...inputs.intent_review, confirmed_at: now },
        requirement_confirmed: true,
        updated_at: now
      };
      await writeJson(screenInputsPath(projectPath, screenId), nextInputs);
      return { noop: false, inputs: nextInputs };
    });
  }

  // ---------------------------------------------------------------------
  // Candidate adopt / discard (§8.11, §8.4)
  // ---------------------------------------------------------------------

  function designerModifiedReview(review) {
    const sections = ['player_tasks', 'core_flow', 'visible_controls', 'visible_information_and_states'];
    if (review?.page_purpose?.designer_modified) return true;
    for (const section of sections) {
      if ((review?.[section] || []).some((item) => item.designer_modified)) return true;
    }
    return (review?.uncertainties || []).some((u) => u.designer_modified);
  }

  async function adoptIntentCandidate(projectId, screenId, input = {}) {
    return unsafe.withProjectWriteLock(projectId, async () => {
      const project = await projectStore.resolveProject(projectId);
      const projectPath = project.workspacePath;
      const inputs = (await requireScreen(projectPath, screenId)) || {};
      const candidate = await readJson(candidatePath(projectPath, screenId), null);
      // §8.4 CAS: id/status/wireframe/baseline all must match; this also
      // mechanically blocks re-adoption of a crash-leftover candidate.
      const baseline = candidate?.base_current_revisions || {};
      const stale = !candidate
        || candidate.candidate_id !== input.candidateId
        || candidate.status !== 'ready'
        || Number(candidate.source_context?.wireframe_revision) !== rev(inputs, 'wireframe')
        || Number(baseline.requirement) !== rev(inputs, 'requirement')
        || Number(baseline.intent_review) !== rev(inputs, 'intent_review')
        || Number(baseline.intent_context) !== rev(inputs, 'intent_context');
      if (stale) {
        throw intentError(ERROR_CODES.INTENT_CANDIDATE_STALE, 'Intent candidate 已过期（基线或来源与当前输入不一致），请丢弃后重新生成。', { candidate_id: input.candidateId });
      }
      assertExpectedRevision(input.expectedIntentReviewRevision, rev(inputs, 'intent_review'), '采用 Intent candidate');
      if (Number(input.expectedIntentReviewRevision) !== rev(inputs, 'intent_review')) {
        throw intentError(ERROR_CODES.INTENT_REVISION_CONFLICT, 'Intent Review 已被更新，请刷新后再采用。');
      }
      const { errors } = intent.validateIntentReview(candidate.review);
      if (errors.length) {
        throw intentError(ERROR_CODES.INTENT_REVIEW_INCOMPLETE, `candidate review 校验未通过：${errors.join('；')}`, { errors });
      }
      const now = new Date().toISOString();
      // Snapshot the current version FIRST; a snapshot failure must leave
      // the current inputs untouched (§4.4, §13.3).
      const snapshot = buildHistorySnapshot(inputs, screenId, 'candidate-adopt', now);
      const nextReview = { ...candidate.review, revision: rev(inputs, 'intent_review') + 1, confirmed_at: null };
      const requirement = intent.renderIntentReview(nextReview);
      const ctx = computeIntentContext({ ...inputs, intent_review: nextReview, intent_analysis: candidate.analysis }, project);
      const contextChanged = ctx.hash !== (inputs.intent_context?.hash ?? null);
      const revisions = {
        ...inputs.input_revisions,
        requirement: rev(inputs, 'requirement') + 1,
        intent_review: rev(inputs, 'intent_review') + 1
      };
      if (contextChanged) revisions.intent_context = rev(inputs, 'intent_context') + 1;
      const nextInputs = {
        ...inputs,
        intent_mode: 'structured-v2',
        intent_analysis: candidate.analysis,
        intent_review: nextReview,
        requirement,
        requirement_source: designerModifiedReview(candidate.review) ? 'user' : 'ai',
        requirement_confirmed: false,
        input_revisions: revisions,
        intent_context: { revision: Number(revisions.intent_context || 0), hash: ctx.hash },
        intent_generation: inputs.intent_generation && inputs.intent_generation.request_id === candidate.request_id
          ? { ...inputs.intent_generation, status: 'superseded' }
          : inputs.intent_generation,
        updated_at: now
      };
      await runPublishSequence({ projectPath, projectId, screenId, nextInputs, snapshot, candidateDelete: true });
      return { adopted: true, inputs: nextInputs };
    });
  }

  async function discardIntentCandidate(projectId, screenId, input = {}) {
    return unsafe.withProjectWriteLock(projectId, async () => {
      const project = await projectStore.resolveProject(projectId);
      const projectPath = project.workspacePath;
      const inputs = (await requireScreen(projectPath, screenId)) || {};
      const candidate = await readJson(candidatePath(projectPath, screenId), null);
      if (!candidate || candidate.candidate_id !== input.candidateId) {
        throw intentError(ERROR_CODES.INTENT_CANDIDATE_STALE, 'Intent candidate 不存在或已被处理。', { candidate_id: input.candidateId });
      }
      await fs.rm(candidatePath(projectPath, screenId), { force: true });
      const gen = inputs.intent_generation;
      if (gen && gen.request_id === candidate.request_id && gen.status === 'ready') {
        const nextInputs = { ...inputs, intent_generation: { ...gen, status: 'superseded' }, updated_at: new Date().toISOString() };
        await writeJson(screenInputsPath(projectPath, screenId), nextInputs);
        return { discarded: true, inputs: nextInputs };
      }
      return { discarded: true, inputs };
    });
  }

  async function getIntentCandidate(projectId, screenId) {
    const project = await projectStore.resolveProject(projectId);
    return readJson(candidatePath(project.workspacePath, screenId), null);
  }

  // ---------------------------------------------------------------------
  // History list / restore / delete (§8.12, §4.4)
  // ---------------------------------------------------------------------

  async function listIntentHistory(projectId, screenId) {
    const project = await projectStore.resolveProject(projectId);
    const index = await readJson(historyIndexPath(project.workspacePath, screenId), { schema_version: '1.0', entries: [] });
    return index.entries || [];
  }

  function assertValidHistoryId(historyId) {
    // Server-generated UUIDs only: this rejects path traversal and arbitrary
    // client paths before any join (§4.4).
    if (typeof historyId !== 'string' || !HISTORY_ID_PATTERN.test(historyId)) {
      throw intentError(ERROR_CODES.INTENT_HISTORY_VERSION_NOT_FOUND, `非法的历史 ID：${historyId}`);
    }
  }

  async function restoreIntentHistory(projectId, screenId, input = {}) {
    return unsafe.withProjectWriteLock(projectId, async () => {
      const project = await projectStore.resolveProject(projectId);
      const projectPath = project.workspacePath;
      assertValidHistoryId(input.historyId);
      const inputs = (await requireScreen(projectPath, screenId)) || {};
      const index = await readJson(historyIndexPath(projectPath, screenId), { entries: [] });
      const entry = (index.entries || []).find((item) => item.history_id === input.historyId);
      if (!entry) {
        throw intentError(ERROR_CODES.INTENT_HISTORY_VERSION_NOT_FOUND, `历史不存在：${input.historyId}`);
      }
      const snapshot = await readJson(path.join(historyDirPath(projectPath, screenId), `${input.historyId}.json`), null);
      if (!snapshot || snapshot.screen_id !== screenId) {
        throw intentError(ERROR_CODES.INTENT_HISTORY_VERSION_NOT_FOUND, `历史不属于当前 Screen：${input.historyId}`);
      }
      assertExpectedRevision(input.expectedIntentReviewRevision, rev(inputs, 'intent_review'), '恢复历史版本');
      if (Number(input.expectedIntentReviewRevision) !== rev(inputs, 'intent_review')) {
        throw intentError(ERROR_CODES.INTENT_REVISION_CONFLICT, 'Intent Review 已被更新，请刷新后再恢复。');
      }
      const now = new Date().toISOString();
      // Snapshot current version before restoring (undo support); the
      // snapshot is written before any current-input mutation.
      const preSnapshot = buildHistorySnapshot(inputs, screenId, 'restore-before', now);
      const restoredReview = snapshot.review
        ? { ...snapshot.review, revision: rev(inputs, 'intent_review') + 1, confirmed_at: null }
        : null;
      const requirement = typeof snapshot.requirement === 'string'
        ? snapshot.requirement
        : (restoredReview ? intent.renderIntentReview(restoredReview) : '');
      const ctx = computeIntentContext({ ...inputs, intent_review: restoredReview, intent_analysis: snapshot.analysis }, project);
      const contextChanged = ctx.hash !== (inputs.intent_context?.hash ?? null);
      const revisions = { ...inputs.input_revisions, intent_review: rev(inputs, 'intent_review') + 1 };
      if (requirement !== (inputs.requirement || '')) revisions.requirement = rev(inputs, 'requirement') + 1;
      if (contextChanged) revisions.intent_context = rev(inputs, 'intent_context') + 1;
      // Restoration never revives confirmation (§4.4, GAP-06). A snapshot
      // from an older wireframe revision restores as a stale draft: the
      // analysis source_revision mismatch is derived, not stored.
      // §16 C：无评审的历史是采用 structured 前的自由文本版本，恢复时回到
      // legacy 分支；带评审的版本才留在 structured-v2。
      const nextInputs = {
        ...inputs,
        intent_mode: restoredReview ? 'structured-v2' : undefined,
        intent_analysis: snapshot.analysis || null,
        intent_review: restoredReview,
        requirement,
        requirement_source: snapshot.requirement_source || 'none',
        requirement_confirmed: false,
        input_revisions: revisions,
        intent_context: { revision: Number(revisions.intent_context || 0), hash: ctx.hash },
        updated_at: now
      };
      await runPublishSequence({ projectPath, projectId, screenId, nextInputs, snapshot: preSnapshot });
      return { restored: true, inputs: nextInputs };
    });
  }

  async function deleteIntentHistory(projectId, screenId, input = {}) {
    return unsafe.withProjectWriteLock(projectId, async () => {
      const project = await projectStore.resolveProject(projectId);
      const projectPath = project.workspacePath;
      assertValidHistoryId(input.historyId);
      const indexPath = historyIndexPath(projectPath, screenId);
      const index = await readJson(indexPath, { entries: [] });
      const before = (index.entries || []).length;
      index.entries = (index.entries || []).filter((entry) => entry.history_id !== input.historyId);
      if (index.entries.length === before) {
        throw intentError(ERROR_CODES.INTENT_HISTORY_VERSION_NOT_FOUND, `历史不存在：${input.historyId}`);
      }
      await fs.rm(path.join(historyDirPath(projectPath, screenId), `${input.historyId}.json`), { force: true });
      await writeJson(indexPath, index);
      return { deleted: true };
    });
  }

  // ---------------------------------------------------------------------
  // UE replacement / Project Type freshness (§8.13, §8.14)
  // ---------------------------------------------------------------------

  // Shared freshness mutation: requirement/review text is preserved, the
  // analysis is derived-stale via source_revision mismatch (the canonical
  // context builder mechanically excludes it), confirmation is cancelled,
  // ready candidates go stale and the context hash is recomputed.
  async function applyFreshnessMutation(projectId, screenId, reason) {
    const project = await projectStore.resolveProject(projectId);
    const projectPath = project.workspacePath;
    const inputs = await readJson(screenInputsPath(projectPath, screenId), null);
    if (!inputs || !structuredMode(inputs)) return { changed: false };
    const now = new Date().toISOString();
    const candidate = await readJson(candidatePath(projectPath, screenId), null);
    if (candidate?.status === 'ready') {
      await writeJson(candidatePath(projectPath, screenId), { ...candidate, status: 'stale', stale_reason: reason });
    }
    const review = inputs.intent_review ? { ...inputs.intent_review, confirmed_at: null } : null;
    const ctx = computeIntentContext({ ...inputs, intent_review: review }, project);
    const contextChanged = ctx.hash !== (inputs.intent_context?.hash ?? null);
    const revisions = { ...inputs.input_revisions };
    if (contextChanged) revisions.intent_context = rev(inputs, 'intent_context') + 1;
    const nextInputs = {
      ...inputs,
      intent_review: review,
      requirement_confirmed: false,
      input_revisions: revisions,
      intent_context: { revision: Number(revisions.intent_context || 0), hash: ctx.hash },
      updated_at: now
    };
    await runPublishSequence({ projectPath, projectId, screenId, nextInputs });
    return { changed: true, contextChanged, inputs: nextInputs };
  }

  // Called from projectStore.importFileUnsafe inside the project lock.
  async function applyWireframeReplacementUnsafe(projectId, screenId) {
    return applyFreshnessMutation(projectId, screenId, 'wireframe-replaced');
  }

  // Called from projectStore.saveProjectUnsafe inside the project lock.
  async function applyProjectTypeChangeUnsafe(projectId, screenId) {
    return applyFreshnessMutation(projectId, screenId, 'project-type-changed');
  }

  // ---------------------------------------------------------------------
  // Read-time self-healing (§8.7)
  // ---------------------------------------------------------------------

  // Idempotent, forward-only, never rolls back authority and never revives
  // confirmation; hydrate() never Fail-Closes on half state. Runs without
  // the project lock: every write is an atomic single-file replace derived
  // purely from the published inputs.json, so concurrent heals converge.
  async function healScreenIntentState(projectPath, screenId, inputs) {
    if (!inputs || !structuredMode(inputs)) return inputs;
    let healed = inputs;
    let inputsChanged = false;
    // 4. Interrupted conversion (§8.5): a running task stamped by another
    // process instance becomes interrupted; current review/requirement and
    // candidates are untouched, no retry, input stage not failed.
    const gen = healed.intent_generation;
    if (gen && gen.status === 'running' && gen.process_instance_id !== processInstanceId) {
      healed = {
        ...healed,
        intent_generation: { ...gen, status: 'interrupted', error_code: ERROR_CODES.INTENT_GENERATION_INTERRUPTED, finished_at: new Date().toISOString() },
        updated_at: new Date().toISOString()
      };
      inputsChanged = true;
    }
    // 2. Candidate GC: an adopted candidate is removed; a ready candidate
    // not referenced by the published generation slot is an orphan (crash
    // before the publish point) and is removed; a ready candidate based on
    // an outdated wireframe revision is marked stale (view/discard only).
    const candidateFile = candidatePath(projectPath, screenId);
    const candidate = await readJson(candidateFile, null);
    if (candidate) {
      const adopted = healed.intent_review?.source_analysis_id
        && candidate.analysis?.analysis_id === healed.intent_review.source_analysis_id;
      const referenced = healed.intent_generation?.status === 'ready'
        && healed.intent_generation?.request_id === candidate.request_id;
      if (adopted || (candidate.status === 'ready' && !referenced)) {
        await fs.rm(candidateFile, { force: true });
      } else if (candidate.status === 'ready' && Number(candidate.source_context?.wireframe_revision) !== rev(healed, 'wireframe')) {
        await writeJson(candidateFile, { ...candidate, status: 'stale', stale_reason: 'wireframe-revision-outdated' });
      }
    } else if (gen?.status === 'ready' && gen?.purpose === 'candidate') {
      // Crash between publishing a ready candidate generation slot and the
      // candidate file write: the file can never appear, so complete the
      // terminal state forward (never roll the published inputs back).
      healed = {
        ...healed,
        intent_generation: { ...healed.intent_generation, status: 'failed', error_code: ERROR_CODES.INTENT_GENERATION_INTERRUPTED, finished_at: new Date().toISOString() },
        updated_at: new Date().toISOString()
      };
      inputsChanged = true;
    }
    // 3. Stale re-derivation: downstream artifacts whose source binding no
    // longer matches the published Intent Context are mechanically stale.
    const contractPath = path.join(screenDirPath(projectPath, screenId), 'screen-contract.json');
    const contract = await readJson(contractPath, null);
    if (contract && contract.status !== 'stale' && contract.source?.intent_context
      && (contract.source.intent_context.intent_context_hash ?? contract.source.intent_context.hash) !== (healed.intent_context?.hash ?? null)) {
      await writeJson(contractPath, { ...contract, status: 'stale', stale_at: new Date().toISOString(), stale_reason: 'intent_context_mismatch' });
    }
    // 1. Projection alignment: requirement.md and the project.json active
    // screen projection are re-derived from the authoritative inputs.json.
    const expectedRequirement = `${healed.requirement || ''}\n`;
    const currentRequirement = await fs.readFile(requirementMdPath(projectPath, screenId), 'utf8').catch(() => null);
    if (currentRequirement !== expectedRequirement) {
      await fs.mkdir(path.dirname(requirementMdPath(projectPath, screenId)), { recursive: true });
      await fs.writeFile(requirementMdPath(projectPath, screenId), expectedRequirement, 'utf8');
    }
    const projectJsonPath = path.join(projectPath, 'project.json');
    const project = await readJson(projectJsonPath, null);
    if (project && (project.active_screen_id === screenId || project.screen_id === screenId)) {
      const drifted = project.requirement !== (healed.requirement || '')
        || project.requirement_source !== (healed.requirement_source || 'none')
        || Boolean(project.requirement_confirmed) !== Boolean(healed.requirement_confirmed);
      if (drifted) {
        await writeJson(projectJsonPath, {
          ...project,
          requirement: healed.requirement || '',
          requirement_source: healed.requirement_source || 'none',
          requirement_confirmed: Boolean(healed.requirement_confirmed),
          updated_at: new Date().toISOString()
        });
      }
    }
    // 5. Workflow alignment: a crash between the publish point (step 8) and
    // the idempotent step-9 workflow update leaves the input stage behind
    // the authoritative review; complete it forward. in_progress only —
    // never resurrect over failed/blocked, never roll anything back.
    if (healed.intent_review) {
      const workflowPath = path.join(projectPath, 'workflow', 'state.json');
      const workflow = await readJson(workflowPath, null);
      const screenStage = workflow?.screen_stages?.[screenId]?.input;
      if (workflow && (workflow.stages?.input?.status === 'in_progress' || screenStage?.status === 'in_progress')) {
        if (workflow.stages?.input?.status === 'in_progress') workflow.stages.input.status = 'reviewed';
        if (screenStage?.status === 'in_progress') screenStage.status = 'reviewed';
        await writeJson(workflowPath, { ...workflow, updated_at: new Date().toISOString() });
      }
    }
    if (inputsChanged) {
      await writeJson(screenInputsPath(projectPath, screenId), healed);
    }
    return healed;
  }

  // ---------------------------------------------------------------------
  // Clone guards (§4.5) — called from projectStore inside the source
  // project write lock, so in-flight adopt/restore composite operations are
  // already excluded; only the cross-lock running generation needs checks.
  // ---------------------------------------------------------------------

  async function assertProjectCloneable(projectPath) {
    const registry = await readJson(path.join(projectPath, 'screens', 'index.json'), { screens: [] });
    for (const screen of registry.screens || []) {
      const inputs = await readJson(screenInputsPath(projectPath, screen.id), null);
      if (inputs?.intent_generation?.status === 'running') {
        throw new Error(`Screen ${screen.id} 有进行中的 Intent 预填任务，请等待完成后再复制项目。`);
      }
    }
  }

  // The copy keeps review/history/confirmation (a still workspace snapshot)
  // but zeroes the runtime: no active request/process ids, generation idle,
  // ready candidates become stale and non-adoptable.
  async function sanitizeProjectClone(destinationPath) {
    const registry = await readJson(path.join(destinationPath, 'screens', 'index.json'), { screens: [] });
    const now = new Date().toISOString();
    for (const screen of registry.screens || []) {
      const inputsPath = screenInputsPath(destinationPath, screen.id);
      const inputs = await readJson(inputsPath, null);
      if (!inputs || !structuredMode(inputs)) continue;
      await writeJson(inputsPath, { ...inputs, intent_generation: null, updated_at: now });
      const file = candidatePath(destinationPath, screen.id);
      const candidate = await readJson(file, null);
      if (candidate?.status === 'ready') {
        await writeJson(file, {
          ...candidate,
          status: 'stale',
          stale_reason: 'project-duplicated',
          request_id: null,
          duplicated_from_candidate_id: candidate.candidate_id
        });
      }
    }
  }

  async function assertScreenCloneable(projectPath, screenId) {
    const inputs = await readJson(screenInputsPath(projectPath, screenId), null);
    if (inputs?.intent_generation?.status === 'running') {
      throw new Error(`Screen ${screenId} 有进行中的 Intent 预填任务，请等待完成后再复制。`);
    }
  }

  // Screen Duplicate never inherits confirmation or runtime; the copied
  // candidate is stale and must be regenerated (§4.5).
  async function sanitizeScreenClone(projectPath, targetScreenId) {
    const inputsPath = screenInputsPath(projectPath, targetScreenId);
    const inputs = await readJson(inputsPath, null);
    if (!inputs || !structuredMode(inputs)) return;
    const now = new Date().toISOString();
    const review = inputs.intent_review ? { ...inputs.intent_review, confirmed_at: null } : null;
    await writeJson(inputsPath, {
      ...inputs,
      intent_review: review,
      requirement_confirmed: false,
      intent_generation: null,
      updated_at: now
    });
    const file = candidatePath(projectPath, targetScreenId);
    const candidate = await readJson(file, null);
    if (candidate?.status === 'ready') {
      await writeJson(file, {
        ...candidate,
        status: 'stale',
        stale_reason: 'screen-duplicated',
        request_id: null,
        duplicated_from_candidate_id: candidate.candidate_id
      });
    }
  }

  return {
    processInstanceId,
    setFaultAt,
    beginIntentGeneration,
    completeIntentGeneration,
    saveIntentReview,
    confirmIntentReview,
    adoptIntentCandidate,
    discardIntentCandidate,
    getIntentCandidate,
    listIntentHistory,
    restoreIntentHistory,
    deleteIntentHistory,
    healScreenIntentState,
    applyWireframeReplacementUnsafe,
    applyProjectTypeChangeUnsafe,
    assertProjectCloneable,
    sanitizeProjectClone,
    assertScreenCloneable,
    sanitizeScreenClone
  };
}

module.exports = { createIntentStateStore };
