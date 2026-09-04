const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAssistantStore } = require('./assistantStore.cjs');

async function temporaryStore(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-assistant-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store: createAssistantStore({ assistantRoot: root }) };
}

test('creates and lists conversations without a second index', async (t) => {
  const { root, store } = await temporaryStore(t);
  const [one, two] = await Promise.all([
    store.createConversation({ projectId: 'project-a', screenId: 'main', title: '一' }),
    store.createConversation({ projectId: 'project-a', screenId: 'main', title: '二' })
  ]);
  const listed = await store.listConversations();
  assert.deepEqual(new Set(listed.conversations.map((item) => item.conversation_id)), new Set([one.meta.conversation_id, two.meta.conversation_id]));
  assert.deepEqual(one.messages, []);
  assert.deepEqual(one.runs, []);
  assert.equal(one.summary, null);
  const metaPath = path.join(root, 'conversations', one.meta.conversation_id, 'meta.json');
  await fs.writeFile(metaPath, JSON.stringify({ ...one.meta, future_field: '保留' }), 'utf8');
  const renamed = await store.renameConversation(one.meta.conversation_id, '重命名');
  assert.equal(renamed.project_id, 'project-a');
  assert.equal(renamed.screen_id, 'main');
  assert.equal(renamed.future_field, '保留');
  await assert.rejects(fs.access(path.join(root, 'index.json')));
});

test('serializes concurrent JSONL appends and a rejected append does not poison the queue', async (t) => {
  const { store } = await temporaryStore(t);
  const conversation = await store.createConversation({ projectId: 'project-a', screenId: 'main' });
  const id = conversation.meta.conversation_id;
  await assert.rejects(store.appendMessage(id, { role: 'user', content: '' }), { code: 'ASSISTANT_MESSAGE_INVALID' });
  await Promise.all(Array.from({ length: 12 }, (_, index) => store.appendMessage(id, { role: index % 2 ? 'assistant' : 'user', content: `消息 ${index}` })));
  const opened = await store.openConversation(id);
  assert.deepEqual(opened.messages.map((item) => item.seq), Array.from({ length: 12 }, (_, index) => index + 1));
});

test('repairs only a half-written tail and rejects corruption in the middle', async (t) => {
  const { root, store } = await temporaryStore(t);
  const conversation = await store.createConversation({ projectId: 'project-a', screenId: 'main' });
  const id = conversation.meta.conversation_id;
  await store.appendMessage(id, { role: 'user', content: '完整消息' });
  const file = path.join(root, 'conversations', id, 'messages.jsonl');
  await fs.appendFile(file, '{"id":"partial"', 'utf8');
  assert.equal((await store.openConversation(id)).messages.length, 1);
  await fs.appendFile(file, JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', role: 'user', content: '字段损坏', created_at: new Date().toISOString() }), 'utf8');
  await assert.rejects(store.openConversation(id), { code: 'ASSISTANT_CONVERSATION_CORRUPT' });
  await fs.appendFile(file, 'not-json\n', 'utf8');
  await assert.rejects(store.openConversation(id), { code: 'ASSISTANT_CONVERSATION_CORRUPT' });
});

test('a corrupt conversation is isolated and a corrupt summary cache never blocks history', async (t) => {
  const { root, store } = await temporaryStore(t);
  const healthy = await store.createConversation({ projectId: 'project-a', screenId: 'main', title: '正常' });
  const corrupt = await store.createConversation({ projectId: 'project-a', screenId: 'main', title: '损坏' });
  const badMeta = await store.createConversation({ projectId: 'project-a', screenId: 'main', title: '坏元数据' });
  await fs.writeFile(path.join(root, 'conversations', healthy.meta.conversation_id, 'summary.json'), '{broken', 'utf8');
  assert.equal((await store.openConversation(healthy.meta.conversation_id)).summary, null);
  await fs.writeFile(path.join(root, 'conversations', healthy.meta.conversation_id, 'summary.json'), JSON.stringify({
    schema_version: '1.0', through_seq: 99, summary: '越界缓存', updated_at: new Date().toISOString()
  }), 'utf8');
  assert.equal((await store.openConversation(healthy.meta.conversation_id)).summary, null);
  await fs.writeFile(path.join(root, 'conversations', badMeta.meta.conversation_id, 'meta.json'), JSON.stringify({
    ...badMeta.meta, updated_at: { invalid: true }
  }), 'utf8');
  const run = await store.createRun(corrupt.meta.conversation_id, { mode: 'qa', requestMessageId: null, context: {} });
  await store.updateRun(corrupt.meta.conversation_id, run.run_id, { status: 'running' });
  await store.updateRun(corrupt.meta.conversation_id, run.run_id, { status: 'succeeded' });
  await fs.writeFile(path.join(root, 'conversations', corrupt.meta.conversation_id, 'runs', `${run.run_id}.json`), '{broken', 'utf8');

  const restarted = createAssistantStore({ assistantRoot: root });
  const listed = await restarted.listConversations();
  assert.deepEqual(listed.conversations.map((item) => item.conversation_id), [healthy.meta.conversation_id]);
  assert.deepEqual(new Set(listed.warnings.map((item) => item.conversation_id)), new Set([corrupt.meta.conversation_id, badMeta.meta.conversation_id]));
  const next = await restarted.createConversation({ projectId: 'project-a', screenId: 'main', title: '仍可使用' });
  assert.equal((await restarted.createRun(next.meta.conversation_id, { mode: 'qa', requestMessageId: null, context: {} })).status, 'queued');
});

test('terminal runs cannot be resurrected and creation order remains monotonic', async (t) => {
  const { store } = await temporaryStore(t);
  const conversation = await store.createConversation({ projectId: 'project-a', screenId: 'main' });
  const first = await store.createRun(conversation.meta.conversation_id, { mode: 'qa', requestMessageId: null, context: {} });
  await assert.rejects(store.updateRun(conversation.meta.conversation_id, first.run_id, { status: 'succeeded' }), { code: 'ASSISTANT_ACTION_NOT_ALLOWED' });
  await store.cancelRun(conversation.meta.conversation_id, first.run_id);
  await assert.rejects(store.updateRun(conversation.meta.conversation_id, first.run_id, { status: 'running' }), { code: 'ASSISTANT_ACTION_NOT_ALLOWED' });
  const second = await store.createRun(conversation.meta.conversation_id, { mode: 'qa', requestMessageId: null, context: {} });
  const runs = (await store.openConversation(conversation.meta.conversation_id)).runs;
  assert.deepEqual(runs.map((item) => item.run_id), [first.run_id, second.run_id]);
  assert.ok(Date.parse(second.created_at) > Date.parse(first.created_at));
});

test('restart marks active work interrupted while awaiting confirmation remains recoverable', async (t) => {
  const { root, store } = await temporaryStore(t);
  const first = await store.createConversation({ projectId: 'project-a', screenId: 'main' });
  const run = await store.createRun(first.meta.conversation_id, { mode: 'qa', requestMessageId: null, context: {} });
  await store.updateRun(first.meta.conversation_id, run.run_id, { status: 'running' });
  const restarted = createAssistantStore({ assistantRoot: root });
  await restarted.initialize();
  assert.equal((await restarted.getRun(first.meta.conversation_id, run.run_id)).status, 'interrupted');

  const pending = await restarted.createRun(first.meta.conversation_id, { mode: 'execute', requestMessageId: null, context: {} });
  await restarted.updateRun(first.meta.conversation_id, pending.run_id, { status: 'running' });
  await restarted.updateRun(first.meta.conversation_id, pending.run_id, { status: 'awaiting_confirmation' });
  const restartedAgain = createAssistantStore({ assistantRoot: root });
  await restartedAgain.initialize();
  assert.equal((await restartedAgain.getRun(first.meta.conversation_id, pending.run_id)).status, 'awaiting_confirmation');
});

test('deletion moves a finished conversation to trash and traversal ids are rejected', async (t) => {
  const { root, store } = await temporaryStore(t);
  const conversation = await store.createConversation({ projectId: 'project-a', screenId: 'main' });
  const id = conversation.meta.conversation_id;
  await store.deleteConversation(id);
  await assert.rejects(store.openConversation(id), { code: 'ASSISTANT_CONVERSATION_NOT_FOUND' });
  assert.ok((await fs.stat(path.join(root, '.trash', id))).isDirectory());
  await assert.rejects(store.openConversation('../project-a'), { code: 'ASSISTANT_CONVERSATION_NOT_FOUND' });
});

test('startup removes only assistant trash entries older than seven days', async (t) => {
  const { root, store } = await temporaryStore(t);
  const conversation = await store.createConversation({ projectId: 'project-a', screenId: 'main' });
  const id = conversation.meta.conversation_id;
  await store.deleteConversation(id);
  const target = path.join(root, '.trash', id);
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000);
  await fs.utimes(target, old, old);
  await createAssistantStore({ assistantRoot: root }).initialize();
  await assert.rejects(fs.access(target), { code: 'ENOENT' });
});
