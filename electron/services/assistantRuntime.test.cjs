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
  let writes = 0;
  const runtime = createAssistantRuntime({
    assistantRoot: root, enabled: true, kunpoConfig: { configured: true, assistantModel: 'assistant' },
    kunpoClient: { requestAssistant: async () => responses.shift() },
    projectStore: {
      listScreens: async () => ({ active_screen_id: 'screen-a', screens: structuredClone(project.screens) }),
      open: async (projectId, options) => { opens.push({ projectId, options }); return structuredClone(project); }
    },
    intentStateStore: { saveIntentReview: async (_projectId, _screenId, input) => { writes += 1; if (writeError) throw writeError; if (input.expectedIntentReviewRevision !== project.input_revisions.intent_review) throw Object.assign(new Error('conflict'), { code: 'INTENT_REVISION_CONFLICT' }); project.input_revisions.intent_review += 1; project.intent_review = input.draft; return { noop: false }; } }
  });
  return { runtime, project, opens, writes: () => writes };
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
