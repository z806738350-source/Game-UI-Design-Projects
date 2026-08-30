// v1.4 PR-I3：Web Intent 同义接口的 HTTP 级集成测试。
// 覆盖 §11.1（九条 /intent/* 路由与桌面端共用同一 intentStateStore /
// pipeline 业务方法，mutation 后回传最新项目）与 §11.2（Intent 错误码 →
// HTTP 状态：并发/陈旧类 409、校验/门禁类 422、历史不存在 404、请求体
// 超限由 readBody 直接 413）。
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const intent = require('../electron/services/intentAnalysis.cjs');
const { createApplication } = require('./webServer.cjs');

async function startApplication() {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-web-intent-'));
  const app = createApplication({
    HOST: '127.0.0.1',
    PORT: '0',
    PUBLIC_URL: 'http://127.0.0.1:9030',
    DESIGN_COPILOT_DATA_ROOT: dataRoot,
    SESSION_SECRET: 'intent-http-test-secret-0123456789abcdef' // gitleaks:allow 仅测试用假值，非真实密钥
  });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const tenantId = await app.identityStore.tenantFor('tenant-web', 'user-web');
  const sessionId = await app.identityStore.createSession(tenantId);
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    cookie: `design_copilot_session=${sessionId}`,
    context: app.tenantContext(tenantId),
    async close() {
      // 413 提前响应会留下未读完请求体的连接，必须先断开才能关闭服务。
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(dataRoot, { recursive: true, force: true });
    }
  };
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

function validRawAnalysis() {
  return {
    page_type: 'modal_overlay',
    page_purpose: '展示 BOSS 伤害进度与奖励节点，并提供挑战入口',
    player_tasks: [{ id: 'task-check-damage', text: '查看个人与全派伤害信息' }],
    core_flow: [{ id: 'flow-open', text: '打开 BOSS 挑战弹窗' }],
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
    uncertainties: [],
    uncertainty_audit: auditRows()
  };
}

async function postJson(app, urlPath, body) {
  const response = await fetch(`${app.base}${urlPath}`, {
    method: 'POST',
    headers: { cookie: app.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function getJson(app, urlPath) {
  const response = await fetch(`${app.base}${urlPath}`, { headers: { cookie: app.cookie } });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

// 用真实业务方法种入 structured-v2 状态（空需求 → 首稿直接采用）。
async function seedFirstDraft(app, name) {
  const { projectStore, intentStateStore } = app.context;
  const project = await projectStore.create({ name, projectType: 'new', requirement: '' });
  const { requestId } = await intentStateStore.beginIntentGeneration(project.id, 'main');
  const result = await intentStateStore.completeIntentGeneration(project.id, 'main', { requestId, rawAnalysis: validRawAnalysis() });
  assert.equal(result.adopted, 'first-draft');
  return project;
}

// 已有设计师输入 → 生成结果只能落为 candidate。
async function seedCandidate(app, name) {
  const { projectStore, intentStateStore } = app.context;
  const project = await projectStore.create({ name, projectType: 'new', requirement: '手工需求' });
  const { requestId } = await intentStateStore.beginIntentGeneration(project.id, 'main');
  const result = await intentStateStore.completeIntentGeneration(project.id, 'main', { requestId, rawAnalysis: validRawAnalysis() });
  assert.equal(result.saved, 'candidate');
  return { project, candidateId: result.candidateId };
}

const projectUrl = (id, suffix) => `/api/projects/${encodeURIComponent(id)}${suffix}`;

test('web intent mutations map CAS conflicts to 409 and gate failures to 422 (§11.2)', async () => {
  const app = await startApplication();
  try {
    const project = await seedFirstDraft(app, 'Web Intent CAS');
    const url = projectUrl(project.id, '/intent/review/save');
    const opened = await app.context.projectStore.open(project.id);
    const draft = structuredClone(opened.intent_review);
    draft.page_purpose.text = '改过的页面目的';
    draft.page_purpose.designer_modified = true;
    // 落后的 expected revision → 409 INTENT_REVISION_CONFLICT。
    const stale = await postJson(app, url, { screenId: 'main', expectedIntentReviewRevision: 99, draft });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.payload.code, 'INTENT_REVISION_CONFLICT');
    // 缺失必填的 expected revision → 显式 409（而不是隐式冲突）。
    const missing = await postJson(app, url, { screenId: 'main', draft });
    assert.equal(missing.response.status, 409);
    assert.equal(missing.payload.code, 'INTENT_REVISION_CONFLICT');
    assert.match(missing.payload.error, /缺少 expectedIntentReviewRevision/);
    // 确认门禁：合法草稿可直接确认，但没有 review 的项目必须 422。
    const blank = await app.context.projectStore.create({ name: 'Web Intent Blank', projectType: 'new', requirement: '' });
    const incomplete = await postJson(app, projectUrl(blank.id, '/intent/review/confirm'), { screenId: 'main', expectedIntentReviewRevision: 0 });
    assert.equal(incomplete.response.status, 422);
    assert.equal(incomplete.payload.code, 'INTENT_REVIEW_INCOMPLETE');
    // 请求体超限 → 413（readBody 在解析前拦截）。
    const oversized = await fetch(`${app.base}${url}`, {
      method: 'POST',
      headers: { cookie: app.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ screenId: 'main', expectedIntentReviewRevision: 1, draft: { filler: 'x'.repeat(3 * 1024 * 1024) } })
    });
    assert.equal(oversized.status, 413);
  } finally {
    await app.close();
  }
});

test('web intent routes run the same store methods and return the fresh project (§11.1)', async () => {
  const app = await startApplication();
  try {
    const project = await seedFirstDraft(app, 'Web Intent Save');
    const opened = await app.context.projectStore.open(project.id);
    const revision = Number(opened.input_revisions.intent_review || 1);
    const draft = structuredClone(opened.intent_review);
    draft.player_tasks[0].text = 'HTTP 保存的玩家任务';
    draft.player_tasks[0].designer_modified = true;
    // save：200 且回传最新项目（revision+1、确认被取消、需求转设计师所有）。
    const saved = await postJson(app, projectUrl(project.id, '/intent/review/save'), { screenId: 'main', expectedIntentReviewRevision: revision, draft });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.payload.id, project.id);
    assert.equal(saved.payload.intent_review.revision, revision + 1);
    assert.equal(saved.payload.intent_review.player_tasks[0].text, 'HTTP 保存的玩家任务');
    assert.equal(saved.payload.requirement_source, 'user');
    assert.equal(saved.payload.requirement_confirmed, false);
    // confirm：同一业务门禁，确认后回传项目。
    const confirmed = await postJson(app, projectUrl(project.id, '/intent/review/confirm'), { screenId: 'main', expectedIntentReviewRevision: revision + 1 });
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.payload.requirement_confirmed, true);
    assert.ok(confirmed.payload.intent_review.confirmed_at);
  } finally {
    await app.close();
  }
});

test('web candidate and history endpoints expose store state with mapped errors', async () => {
  const app = await startApplication();
  try {
    const { project, candidateId } = await seedCandidate(app, 'Web Intent Candidate');
    // GET candidate：返回待处理候选。
    const listed = await getJson(app, projectUrl(project.id, '/intent/candidate?screenId=main'));
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.candidate_id, candidateId);
    assert.equal(listed.payload.status, 'ready');
    // adopt 缺失 expected revision → 409；补齐后 200 且候选被消费。
    const missingRevision = await postJson(app, projectUrl(project.id, '/intent/candidate/adopt'), { screenId: 'main', candidateId });
    assert.equal(missingRevision.response.status, 409);
    assert.equal(missingRevision.payload.code, 'INTENT_REVISION_CONFLICT');
    const adopted = await postJson(app, projectUrl(project.id, '/intent/candidate/adopt'), { screenId: 'main', candidateId, expectedIntentReviewRevision: 0 });
    assert.equal(adopted.response.status, 200);
    assert.equal(adopted.payload.intent_mode, 'structured-v2');
    assert.equal(adopted.payload.intent_review.revision, 1);
    const consumed = await getJson(app, projectUrl(project.id, '/intent/candidate?screenId=main'));
    assert.equal(consumed.payload, null);
    // 历史：adopt 留下 candidate-adopt 快照；不存在的历史删除 → 404。
    const history = await getJson(app, projectUrl(project.id, '/intent/history?screenId=main'));
    assert.equal(history.response.status, 200);
    assert.ok(history.payload.some((entry) => entry.reason === 'candidate-adopt'));
    const missingHistory = await postJson(app, projectUrl(project.id, '/intent/history/delete'), { screenId: 'main', historyId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
    assert.equal(missingHistory.response.status, 404);
    assert.equal(missingHistory.payload.code, 'INTENT_HISTORY_VERSION_NOT_FOUND');
    // discard 一个不存在的候选 → 409。
    const staleDiscard = await postJson(app, projectUrl(project.id, '/intent/candidate/discard'), { screenId: 'main', candidateId: 'nonexistent' });
    assert.equal(staleDiscard.response.status, 409);
    assert.equal(staleDiscard.payload.code, 'INTENT_CANDIDATE_STALE');
  } finally {
    await app.close();
  }
});
