const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAssistantRuntime, projectContext, promptFor } = require('./assistantRuntime.cjs');

function review(text) {
  return {
    page_purpose: { id: 'purpose', text, origin: 'designer' },
    player_tasks: [], core_flow: [], visible_controls: [], visible_information_and_states: [], uncertainties: []
  };
}

async function fixture(t, responses, { writeError } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-assistant-runtime-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = {
    id: 'project-a', name: '项目 A', project_type: 'new', screen_id: 'screen-a', screens: [{ id: 'screen-a', name: '主界面' }],
    status: 'draft', art_direction: '暗黑奇幻', requirement: '升级角色', requirement_confirmed: false,
    input_revisions: { intent_review: 1 }, intent_review: { goal: '升级角色' }, workflow: { current_stage: 'input' }, artifacts: {}, reference_assets: []
  };
  const opens = [];
  const requests = [];
  let writes = 0;
  const runtime = createAssistantRuntime({
    assistantRoot: root, enabled: true, kunpoConfig: { configured: true, assistantModel: 'assistant' },
    kunpoClient: { requestAssistant: async (_config, input) => { requests.push(input); return responses.shift(); } },
    projectStore: {
      listScreens: async () => ({ active_screen_id: 'screen-a', screens: structuredClone(project.screens) }),
      open: async (projectId, options) => { opens.push({ projectId, options }); return structuredClone(project); }
    },
    intentStateStore: { saveIntentReview: async (_projectId, _screenId, input) => { writes += 1; if (writeError) throw writeError; if (input.expectedIntentReviewRevision !== project.input_revisions.intent_review) throw Object.assign(new Error('conflict'), { code: 'INTENT_REVISION_CONFLICT' }); project.input_revisions.intent_review += 1; project.intent_review = input.draft; return { noop: false }; } }
  });
  return { runtime, project, opens, requests, root, writes: () => writes };
}

test('question mode persists a clean conversation and discards model actions', async (t) => {
  const { runtime, opens, writes } = await fixture(t, [{ reply: '当前意图还缺少失败状态。', proposed_action: { name: 'save_intent_review_draft', args: { draft: { goal: '改写' } } } }]);
  const created = await runtime.createConversation({ projectId: 'project-a', screenId: 'screen-a' });
  const result = await runtime.sendMessage(created.meta.conversation_id, { mode: 'qa', content: '还缺什么？', projectId: 'project-a', screenId: 'screen-a' });
  assert.deepEqual(result.messages.map((item) => item.role), ['user', 'assistant']);
  assert.equal(result.runs[0].status, 'succeeded');
  assert.equal(result.runs[0].proposed_action, null);
  assert.equal(writes(), 0);
  assert.ok(opens.every((call) => call.projectId === 'project-a' && call.options.screenId === 'screen-a' && call.options.includePreviews === false));
});

test('execute mode requires confirmation, applies CAS once and replays terminal result', async (t) => {
  const { runtime, writes } = await fixture(t, [{ reply: '我准备保存草稿。', proposed_action: { name: 'save_intent_review_draft', reason: '补齐失败状态', args: { draft: review('升级角色，补齐失败状态') } } }]);
  const created = await runtime.createConversation({ projectId: 'project-a', screenId: 'screen-a' });
  let result = await runtime.sendMessage(created.meta.conversation_id, { mode: 'execute', content: '补齐失败状态并保存', projectId: 'project-a', screenId: 'screen-a' });
  const pending = result.runs[0];
  assert.equal(pending.status, 'awaiting_confirmation');
  assert.deepEqual(pending.proposed_action.risk, { writes_project: true, replaces_content: true, reversible: false, external_cost: false });
  assert.equal(writes(), 0);
  result = await runtime.confirmAction(created.meta.conversation_id, pending.run_id, pending.proposed_action.action_id);
  assert.equal(result.runs[0].status, 'succeeded');
  assert.equal(result.runs[0].result.intent_review_revision, 2);
  assert.equal(writes(), 1);
  await runtime.confirmAction(created.meta.conversation_id, pending.run_id, pending.proposed_action.action_id);
  assert.equal(writes(), 1);
});

test('domain write failure is persisted without a false success message or local path', async (t) => {
  const domainError = Object.assign(new Error('项目目录 /private/workspace/project-a 不可写'), { code: 'PROJECT_WRITE_FAILED' });
  const { runtime, writes } = await fixture(t, [{
    reply: '已准备草稿，等待你确认后才会写入。',
    proposed_action: { name: 'save_intent_review_draft', args: { draft: review('新目标') } }
  }], { writeError: domainError });
  const created = await runtime.createConversation({ projectId: 'project-a', screenId: 'screen-a' });
  const proposed = await runtime.sendMessage(created.meta.conversation_id, { mode: 'execute', content: '保存新目标', projectId: 'project-a', screenId: 'screen-a' });
  const run = proposed.runs[0];
  const failed = await runtime.confirmAction(created.meta.conversation_id, run.run_id, run.proposed_action.action_id);
  assert.equal(writes(), 1);
  assert.equal(failed.runs[0].status, 'failed');
  assert.equal(failed.runs[0].error.code, 'PROJECT_WRITE_FAILED');
  assert.equal(failed.runs[0].error.message, '动作执行失败，请检查项目状态后重试。');
  assert.doesNotMatch(JSON.stringify(failed.runs[0]), /private\/workspace/);
  assert.doesNotMatch(failed.messages.at(-1).content, /已完成|成功写入/);
});

test('revision drift makes confirmation stale and never writes', async (t) => {
  const { runtime, project, writes } = await fixture(t, [{ reply: '准备保存。', proposed_action: { name: 'save_intent_review_draft', args: { draft: review('新目标') } } }]);
  const created = await runtime.createConversation({ projectId: 'project-a', screenId: 'screen-a' });
  let result = await runtime.sendMessage(created.meta.conversation_id, { mode: 'execute', content: '保存新目标', projectId: 'project-a', screenId: 'screen-a' });
  const pending = result.runs[0];
  project.input_revisions.intent_review = 2;
  result = await runtime.confirmAction(created.meta.conversation_id, pending.run_id, pending.proposed_action.action_id);
  assert.equal(result.runs[0].status, 'stale');
  assert.deepEqual(result.runs[0].error.changed, [{ kind: 'input_revision', key: 'intent_review', expected: 1, actual: 2 }]);
  assert.equal(writes(), 0);
});

test('one unfinished run blocks every conversation and unknown actions fail closed', async (t) => {
  const { runtime } = await fixture(t, [
    { reply: '准备保存。', proposed_action: { name: 'save_intent_review_draft', args: { draft: review('一') } } },
    { reply: '越权动作。', proposed_action: { name: 'approve_artifact', args: {} } }
  ]);
  const first = await runtime.createConversation({ projectId: 'project-a', screenId: 'screen-a' });
  const second = await runtime.createConversation({ projectId: 'project-a', screenId: 'screen-a' });
  const pending = await runtime.sendMessage(first.meta.conversation_id, { mode: 'execute', content: '先保存', projectId: 'project-a', screenId: 'screen-a' });
  await assert.rejects(runtime.sendMessage(second.meta.conversation_id, { mode: 'execute', content: '并行执行', projectId: 'project-a', screenId: 'screen-a' }), { code: 'ASSISTANT_RUN_IN_PROGRESS' });
  await runtime.cancelAction(first.meta.conversation_id, pending.runs[0].run_id, pending.runs[0].proposed_action.action_id);
  const rejected = await runtime.sendMessage(second.meta.conversation_id, { mode: 'execute', content: '批准产物', projectId: 'project-a', screenId: 'screen-a' });
  assert.equal(rejected.runs[0].status, 'failed');
  assert.equal(rejected.runs[0].error.code, 'ASSISTANT_ACTION_NOT_ALLOWED');
  assert.deepEqual(rejected.messages.map((message) => message.role), ['user']);
});

test('send rejects a UI target that no longer matches the immutable conversation binding', async (t) => {
  const { runtime } = await fixture(t, []);
  const created = await runtime.createConversation({ projectId: 'project-a', screenId: 'screen-a' });
  await assert.rejects(runtime.sendMessage(created.meta.conversation_id, {
    mode: 'qa', content: '不应发送', projectId: 'project-b', screenId: 'screen-b'
  }), { code: 'ASSISTANT_MESSAGE_INVALID', status: 409 });
  assert.equal((await runtime.openConversation(created.meta.conversation_id)).messages.length, 0);
});

test('conversation creation validates screen ownership before any screen-scoped project read', async (t) => {
  const { runtime, opens } = await fixture(t, []);
  await assert.rejects(runtime.createConversation({ projectId: 'project-a', screenId: '../../escape' }), { code: 'ASSISTANT_MESSAGE_INVALID' });
  assert.equal(opens.length, 0);
});

test('two concurrent confirmations claim once before the domain write', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-assistant-confirm-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = { id: 'project-a', name: '项目 A', project_type: 'new', screen_id: 'screen-a', screens: [{ id: 'screen-a' }], input_revisions: { intent_review: 1 }, workflow: {}, artifacts: {} };
  let releaseWrite;
  let enteredWrite;
  const waitForWrite = new Promise((resolve) => { enteredWrite = resolve; });
  const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
  let writes = 0;
  const runtime = createAssistantRuntime({
    assistantRoot: root, kunpoConfig: { configured: true }, enabled: true,
    kunpoClient: { requestAssistant: async () => ({ reply: '准备保存。', proposed_action: { name: 'save_intent_review_draft', args: { draft: { page_purpose: { id: 'purpose', text: '目标', origin: 'designer' }, player_tasks: [], core_flow: [], visible_controls: [], visible_information_and_states: [], uncertainties: [] } } } }) },
    projectStore: {
      listScreens: async () => ({ active_screen_id: 'screen-a', screens: structuredClone(project.screens) }),
      open: async () => structuredClone(project)
    },
    intentStateStore: { saveIntentReview: async () => { enteredWrite(); await writeGate; writes += 1; project.input_revisions.intent_review += 1; return { noop: false }; } }
  });
  const conversation = await runtime.createConversation({ projectId: 'project-a', screenId: 'screen-a' });
  const proposed = await runtime.sendMessage(conversation.meta.conversation_id, { mode: 'execute', content: '保存', projectId: 'project-a', screenId: 'screen-a' });
  const run = proposed.runs[0];
  const first = runtime.confirmAction(conversation.meta.conversation_id, run.run_id, run.proposed_action.action_id);
  await waitForWrite;
  await assert.rejects(runtime.confirmAction(conversation.meta.conversation_id, run.run_id, run.proposed_action.action_id), { code: 'ASSISTANT_ACTION_IN_PROGRESS' });
  releaseWrite();
  const finished = await first;
  assert.equal(finished.runs[0].status, 'succeeded');
  assert.equal(writes, 1);
});

test('disabled runtime rejects before creating assistant storage', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-assistant-disabled-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runtime = createAssistantRuntime({
    assistantRoot: root, enabled: false, kunpoConfig: {},
    kunpoClient: { requestAssistant: async () => ({}) }, projectStore: { open: async () => ({}), listScreens: async () => ({ screens: [] }) },
    intentStateStore: { saveIntentReview: async () => ({}) }
  });
  await assert.rejects(runtime.listConversations(), { code: 'ASSISTANT_DISABLED' });
  await assert.rejects(fs.access(path.join(root, 'conversations')));
});

test('context budgets mark truncation while preserving stage, error and version facts', () => {
  const context = projectContext({
    id: 'project-a', name: '项目 A', project_type: 'new', status: 'draft', art_direction: '暗黑', screen_id: 'main', screens: [{ id: 'main', name: '主页' }],
    requirement: '长'.repeat(8_000), requirement_confirmed: false,
    intent_review: { page_purpose: { text: '内容'.repeat(20_000) } }, intent_context: null,
    input_revisions: { intent_review: 7 },
    workflow: { current_stage: 'layout_design', global_stages: {}, screen_stages: { main: { layout_design: { status: 'failed', error: { code: 'LAYOUT_CONSTRAINT_VIOLATION', file_path: '/private/project/secret.json' } } } } },
    reference_assets: [], artifacts: { layouts: { id: 'layout-1', version: 4, status: 'failed', source: { access_token: 'do-not-send', approved_layout: 'layout-0' } } }
  });
  assert.equal(context.requirement.truncated, true);
  assert.equal(context.intent_review.truncated, true);
  assert.equal(context.workflow.current_stage, 'layout_design');
  assert.equal(context.workflow.screen_stages.layout_design.error.code, 'LAYOUT_CONSTRAINT_VIOLATION');
  assert.equal(context.artifacts.layouts.version, 4);
  assert.doesNotMatch(JSON.stringify(context), /private\/project|do-not-send/);
  assert.equal(context.artifacts.layouts.source.approved_layout, 'layout-0');
});

test('prompt sends the saved summary plus only messages after its through_seq', () => {
  const prompt = promptFor({
    mode: 'qa', context: {}, summary: { through_seq: 2, summary: '旧轮摘要' },
    messages: [
      { seq: 1, role: 'user', content: '不应重复进入上下文' },
      { seq: 2, role: 'assistant', content: '同样已被摘要覆盖' },
      { seq: 3, role: 'user', content: '最新问题' }
    ]
  });
  assert.match(prompt, /旧轮摘要/);
  assert.match(prompt, /最新问题/);
  assert.doesNotMatch(prompt, /不应重复进入上下文/);
});


test('screenshots persist, reach model pixels, survive reopening and follow-up, with bounded history', async (t) => {
  const { runtime, requests, root } = await fixture(t, Array.from({ length: 4 }, () => ({ reply: '截图中的按钮需要调整。', proposed_action: null })));
  const sharp = require('sharp');
  const images = await Promise.all(['red', 'green', 'blue', 'yellow', 'white'].map(async (background, i) => ({ name: `截图${i}.png`, dataUrl: `data:image/png;base64,${(await sharp({ create: { width: 8, height: 8, channels: 3, background } }).png().toBuffer()).toString('base64')}` })));
  const created = await runtime.createConversation({ projectId: 'project-a', screenId: 'screen-a' });
  const id = created.meta.conversation_id;
  const input = { mode: 'qa', content: '', projectId: 'project-a', screenId: 'screen-a' };
  const first = await runtime.sendMessage(id, { ...input, attachments: images.slice(0, 4) });
  assert.equal(first.runs[0].status, 'succeeded');
  assert.deepEqual(first.messages[0].attachments, images.slice(0, 4));
  assert.deepEqual(requests[0].imageDataUrls, images.slice(0, 4).map((image) => image.dataUrl));
  assert.doesNotMatch(requests[0].prompt, /base64,/);
  assert.match(requests[0].prompt, /image_index/);
  const reopenedStore = require('./assistantStore.cjs').createAssistantStore({ assistantRoot: root });
  assert.deepEqual((await reopenedStore.openConversation(id)).messages[0].attachments, images.slice(0, 4));
  await runtime.sendMessage(id, { ...input, content: '那应该怎么改？' });
  assert.deepEqual(requests[1].imageDataUrls, requests[0].imageDataUrls);
  await runtime.sendMessage(id, { ...input, attachments: [images[4]] });
  assert.equal(requests[2].imageDataUrls.length, 4);
  assert.equal(requests[2].imageDataUrls[0], images[4].dataUrl);
  assert.match(requests[2].prompt, /"image_index":null/);
});

test('invalid screenshot inputs fail before reaching provider or saving a user message', async (t) => {
  const { runtime, requests } = await fixture(t, []);
  const created = await runtime.createConversation({ projectId: 'project-a', screenId: 'screen-a' });
  const bytes = await require('sharp')({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).png().toBuffer();
  const image = { name: '截图.png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
  for (const attachments of [
    [{ name: 'remote', dataUrl: 'https://example.test/private.png' }],
    [{ ...image, dataUrl: image.dataUrl.replace('image/png', 'image/jpeg') }],
    [{ ...image, dataUrl: `data:image/png;base64,${bytes.subarray(0, 24).toString('base64')}` }],
    Array(5).fill(image), [{ ...image, dataUrl: 'data:image/png;base64,' + 'A'.repeat(7_000_000) }],
    { dataUrl: image.dataUrl }
  ]) {
    const result = await runtime.sendMessage(created.meta.conversation_id, { mode: 'qa', content: '检查', projectId: 'project-a', screenId: 'screen-a', attachments });
    assert.equal(result.runs.at(-1).status, 'failed');
    assert.equal(result.runs.at(-1).error.code, 'ASSISTANT_MESSAGE_INVALID');
    assert.equal(result.messages.length, 0);
  }
  assert.equal(requests.length, 0);
});

test('new project draft uses the real domain save, keeps history and confirms only once', async (t) => {
  const { createProjectStore } = require('./projectStore.cjs');
  const { createIntentStateStore } = require('./intentStateStore.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-new-project-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const projectStore = createProjectStore({ workspaceRoot: path.join(root, 'projects') });
  const intentStateStore = createIntentStateStore({ projectStore });
  projectStore.__attachIntentStore(intentStateStore);
  const project = await projectStore.create({ name: '装备升级', projectType: 'new', requirement: '原需求：免费升级装备' });
  const runtime = createAssistantRuntime({ assistantRoot: path.join(root, 'assistant'), projectStore, intentStateStore, kunpoConfig: {}, kunpoClient: { requestAssistant: async () => ({ reply: '请检查草稿。', proposed_action: { name: 'save_intent_review_draft', args: { draft: review('免费升级装备，材料不足时提示') } } }) } });
  const conversation = await runtime.createConversation({ projectId: project.id, screenId: project.screen_id });
  const pending = await runtime.sendMessage(conversation.meta.conversation_id, { projectId: project.id, screenId: project.screen_id, mode: 'execute', content: '完善草稿' });
  const run = pending.runs.at(-1);
  assert.equal(run.status, 'awaiting_confirmation');
  assert.equal(run.proposed_action.args.initialize, true);
  assert.match(run.proposed_action.review.before, /免费升级/);
  assert.equal(run.proposed_action.review.project_name, '装备升级');
  const confirmed = await runtime.confirmAction(conversation.meta.conversation_id, run.run_id, run.proposed_action.action_id);
  assert.equal(confirmed.runs.at(-1).status, 'succeeded');
  let saved = await projectStore.open(project.id, { screenId: project.screen_id, includePreviews: false });
  assert.equal(saved.intent_mode, 'structured-v2');
  assert.equal(saved.requirement_confirmed, false);
  assert.match(saved.requirement, /材料不足/);
  const revision = saved.input_revisions.intent_review;
  await runtime.confirmAction(conversation.meta.conversation_id, run.run_id, run.proposed_action.action_id);
  saved = await projectStore.open(project.id, { screenId: project.screen_id, includePreviews: false });
  assert.equal(saved.input_revisions.intent_review, revision);
  const history = await intentStateStore.listIntentHistory(project.id, project.screen_id);
  assert.equal(history.length, 1);
  await intentStateStore.restoreIntentHistory(project.id, project.screen_id, { expectedIntentReviewRevision: revision, historyId: history[0].history_id });
  saved = await projectStore.open(project.id, { screenId: project.screen_id, includePreviews: false });
  assert.equal(saved.requirement, '原需求：免费升级装备');
  assert.equal(saved.intent_review, null);
  await assert.rejects(intentStateStore.saveIntentReview(project.id, project.screen_id, { initialize: true, expectedRequirementRevision: -1, expectedIntentReviewRevision: saved.input_revisions.intent_review, draft: review('覆盖') }), { code: 'INTENT_REVISION_CONFLICT' });
});

test('legacy requirement changes stale a first draft before any write', async (t) => {
  const { runtime, project, writes } = await fixture(t, [{ reply: '草稿', proposed_action: { name: 'save_intent_review_draft', args: { draft: review('新需求') } } }]);
  delete project.intent_review;
  project.input_revisions = { intent_review: 0, requirement: 2 };
  const conversation = await runtime.createConversation({ projectId: project.id, screenId: project.screen_id });
  const pending = await runtime.sendMessage(conversation.meta.conversation_id, { projectId: project.id, screenId: project.screen_id, mode: 'execute', content: '新草稿' });
  const run = pending.runs.at(-1);
  project.input_revisions.requirement = 3;
  const result = await runtime.confirmAction(conversation.meta.conversation_id, run.run_id, run.proposed_action.action_id);
  assert.equal(result.runs.at(-1).status, 'stale');
  assert.equal(result.runs.at(-1).error.changed[0].key, 'requirement');
  assert.equal(writes(), 0);
});

test('damaged messages remain recoverable and cancellable without blocking healthy conversations', async (t) => {
  const { runtime, root } = await fixture(t, [{ reply: '草稿', proposed_action: { name: 'save_intent_review_draft', args: { draft: review('草稿') } } }, { reply: '可以继续', proposed_action: null }]);
  const input = { projectId: 'project-a', screenId: 'screen-a', mode: 'execute', content: '准备草稿' };
  const bad = await runtime.createConversation(input);
  const pending = await runtime.sendMessage(bad.meta.conversation_id, input);
  const run = pending.runs.at(-1);
  const file = path.join(root, 'conversations', bad.meta.conversation_id, 'messages.jsonl');
  await fs.writeFile(file, 'broken\n');
  const healthy = await runtime.createConversation(input);
  const list = await runtime.listConversations();
  assert.equal(list.conversations.length, 2);
  assert.equal(list.warnings.length, 1);
  assert.ok((await runtime.openConversation(bad.meta.conversation_id)).message_error);
  await assert.rejects(runtime.confirmAction(bad.meta.conversation_id, run.run_id, run.proposed_action.action_id), { code: 'ASSISTANT_CONVERSATION_CORRUPT' });
  await assert.rejects(runtime.sendMessage(bad.meta.conversation_id, input), { code: 'ASSISTANT_CONVERSATION_CORRUPT' });
  await runtime.cancelAction(bad.meta.conversation_id, run.run_id, run.proposed_action.action_id);
  assert.equal(await fs.readFile(file, 'utf8'), 'broken\n');
  const result = await runtime.sendMessage(healthy.meta.conversation_id, { ...input, mode: 'qa' });
  assert.equal(result.runs.at(-1).status, 'succeeded');
  await runtime.deleteConversation(bad.meta.conversation_id);
  assert.equal((await runtime.listConversations()).conversations.length, 1);
});

test('diagnostic content reaches the model with UI location but excludes sensitive fields', () => {
  const context = projectContext({ id: 'project', screen_id: 'main', artifacts: { fidelityReport: { issues: [{ message: '购买按钮文字未渲染', localPath: '/private/test', api_key: 'secret' }] } } });
  const prompt = promptFor({ mode: 'qa', context, messages: [], currentStage: 'visual_exploration' });
  assert.match(prompt, /购买按钮文字未渲染/);
  assert.match(prompt, /visual_exploration/);
  assert.doesNotMatch(prompt, /private\/test|api_key|secret/);
});

test('archiving the bound screen never prevents cancelling an old action', async (t) => {
  const { runtime, project, writes } = await fixture(t, [{ reply: '草稿', proposed_action: { name: 'save_intent_review_draft', args: { draft: review('草稿') } } }, { reply: '新目标可用', proposed_action: null }]);
  const c = await runtime.createConversation({ projectId: project.id, screenId: project.screen_id });
  const pending = await runtime.sendMessage(c.meta.conversation_id, { projectId: project.id, screenId: project.screen_id, mode: 'execute', content: '草稿' });
  const run = pending.runs.at(-1);
  project.screens[0].status = 'archived';
  await runtime.cancelAction(c.meta.conversation_id, run.run_id, run.proposed_action.action_id);
  project.screens.push({ id: 'screen-b', name: '新页面' });
  project.screen_id = 'screen-b';
  const next = await runtime.createConversation({ projectId: project.id, screenId: project.screen_id });
  const response = await runtime.sendMessage(next.meta.conversation_id, { projectId: project.id, screenId: project.screen_id, mode: 'qa', content: '怎么继续' });
  assert.equal(response.runs.at(-1).status, 'succeeded');
  assert.equal(writes(), 0);
});

test('rejection persists once, prevents later confirmation and informs the next model turn', async (t) => {
  const { runtime, requests, root, writes } = await fixture(t, [
    { reply: 'Please review', proposed_action: { name: 'save_intent_review_draft', reason: 'Change purpose', args: { draft: review('Proposed new purpose') } } },
    { reply: 'The previous proposal was rejected.', proposed_action: null }
  ]);
  const input = { projectId: 'project-a', screenId: 'screen-a', mode: 'execute', content: 'Prepare a draft' };
  const conversation = await runtime.createConversation(input);
  const pending = await runtime.sendMessage(conversation.meta.conversation_id, input);
  const run = pending.runs.at(-1);
  const args = [conversation.meta.conversation_id, run.run_id, run.proposed_action.action_id];
  const rejected = await runtime.cancelAction(...args);
  assert.equal(rejected.runs.at(-1).result.user_decision, 'rejected');
  assert.equal(requests.length, 1);
  const again = await runtime.cancelAction(...args);
  assert.deepEqual(again.runs.at(-1), rejected.runs.at(-1));
  await runtime.confirmAction(...args);
  assert.equal(writes(), 0);
  const { createAssistantStore } = require('./assistantStore.cjs');
  const restored = await createAssistantStore({ assistantRoot: root }).openConversation(args[0]);
  assert.equal(restored.runs.at(-1).result.user_decision, 'rejected');
  await runtime.sendMessage(args[0], { ...input, content: 'What happened to that proposal?' });
  const prompt = requests.at(-1).prompt;
  const context = JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n') + 2));
  assert.equal(context.recent_actions[0].user_decision, 'rejected');
  assert.equal(context.recent_actions[0].status, 'cancelled');
  assert.equal(context.recent_actions[0].draft.page_purpose.text, 'Proposed new purpose');
  assert.equal(writes(), 0);
});
