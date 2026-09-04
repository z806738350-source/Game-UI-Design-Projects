const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ERROR_CODES } = require('./errorCodes.cjs');
const { ensureDir, readJson, writeJson } = require('./jsonStore.cjs');

const MESSAGE_LIMIT = 20_000;
const SUMMARY_MESSAGE_LIMIT = 30;
const SUMMARY_CHARACTER_LIMIT = 60_000;
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const UNFINISHED = new Set(['queued', 'running', 'awaiting_confirmation', 'executing']);
const TERMINAL = new Set(['succeeded', 'failed', 'stale', 'cancelled', 'interrupted']);
const RUN_STATUSES = new Set([...UNFINISHED, ...TERMINAL]);
const RUN_TRANSITIONS = Object.freeze({
  queued: new Set(['running', 'failed', 'cancelled', 'interrupted']),
  running: new Set(['awaiting_confirmation', 'succeeded', 'failed', 'interrupted']),
  awaiting_confirmation: new Set(['executing', 'cancelled']),
  executing: new Set(['succeeded', 'failed', 'stale', 'interrupted'])
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function cleanText(value, limit, label) {
  const text = String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim();
  if (!text || text.length > limit) throw fail(ERROR_CODES.ASSISTANT_MESSAGE_INVALID, `${label}不能为空且不能超过 ${limit} 个字符。`, { status: 400 });
  return text;
}

function validId(value, label) {
  const id = String(value || '');
  if (!UUID.test(id)) throw fail(ERROR_CODES.ASSISTANT_CONVERSATION_NOT_FOUND, `${label}无效。`, { status: 404 });
  return id;
}

function createAssistantStore({ assistantRoot }) {
  if (!assistantRoot) throw new Error('assistantStore requires assistantRoot.');
  const conversationsRoot = path.join(assistantRoot, 'conversations');
  const trashRoot = path.join(assistantRoot, '.trash');
  const queues = new Map();
  let ready;

  function enqueue(key, operation) {
    const previous = queues.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(operation);
    const tail = run.catch(() => {});
    queues.set(key, tail);
    void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return run;
  }

  function conversationPath(conversationId) {
    return path.join(conversationsRoot, validId(conversationId, '对话 ID'));
  }

  function runPath(conversationId, runId) {
    return path.join(conversationPath(conversationId), 'runs', `${validId(runId, '运行 ID')}.json`);
  }

  async function readMeta(conversationId) {
    const meta = await readJson(path.join(conversationPath(conversationId), 'meta.json'), null);
    if (!meta) throw fail(ERROR_CODES.ASSISTANT_CONVERSATION_NOT_FOUND, '对话不存在或已删除。', { status: 404 });
    if (meta.schema_version !== '1.0'
      || meta.conversation_id !== conversationId
      || typeof meta.title !== 'string'
      || !meta.title
      || typeof meta.project_id !== 'string'
      || !meta.project_id
      || typeof meta.screen_id !== 'string'
      || !meta.screen_id
      || typeof meta.created_at !== 'string'
      || !Number.isFinite(Date.parse(meta.created_at))
      || typeof meta.updated_at !== 'string'
      || !Number.isFinite(Date.parse(meta.updated_at))) {
      throw fail(ERROR_CODES.ASSISTANT_CONVERSATION_CORRUPT, '对话元数据损坏，请从列表中删除后重建。', { status: 409 });
    }
    return meta;
  }

  function validateMessage(value, conversationId) {
    if (!value || typeof value !== 'object' || !UUID.test(value.id) || !Number.isSafeInteger(value.seq) || value.seq < 1 || !['user', 'assistant'].includes(value.role) || typeof value.content !== 'string' || value.content.length > MESSAGE_LIMIT || typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at))) {
      throw fail(ERROR_CODES.ASSISTANT_CONVERSATION_CORRUPT, `对话 ${conversationId} 的消息记录损坏。`, { status: 409 });
    }
    return value;
  }

  async function readMessages(conversationId, { recoverTail = true } = {}) {
    const filePath = path.join(conversationPath(conversationId), 'messages.jsonl');
    let source;
    try { source = await fs.readFile(filePath, 'utf8'); }
    catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
    if (!source) return [];
    const trailingNewline = source.endsWith('\n');
    const lines = source.split('\n');
    if (trailingNewline) lines.pop();
    const messages = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index]) throw fail(ERROR_CODES.ASSISTANT_CONVERSATION_CORRUPT, `对话 ${conversationId} 的消息记录中间存在空行。`, { status: 409 });
      let parsed;
      try { parsed = JSON.parse(lines[index]); }
      catch (error) {
        if (recoverTail && index === lines.length - 1 && !trailingNewline) {
          const cut = source.lastIndexOf('\n') + 1;
          await fs.truncate(filePath, Buffer.byteLength(source.slice(0, cut), 'utf8'));
          break;
        }
        throw fail(ERROR_CODES.ASSISTANT_CONVERSATION_CORRUPT, `对话 ${conversationId} 的消息记录无法解析。`, { status: 409 });
      }
      messages.push(validateMessage(parsed, conversationId));
    }
    messages.sort((a, b) => a.seq - b.seq);
    for (let index = 0; index < messages.length; index += 1) {
      if (messages[index].seq !== index + 1) throw fail(ERROR_CODES.ASSISTANT_CONVERSATION_CORRUPT, `对话 ${conversationId} 的消息序号不连续。`, { status: 409 });
    }
    return messages;
  }

  function validateRun(run, conversationId) {
    if (!run || typeof run !== 'object'
      || run.schema_version !== '1.0'
      || !UUID.test(run.run_id)
      || run.conversation_id !== conversationId
      || !RUN_STATUSES.has(run.status)
      || !['qa', 'execute'].includes(run.mode)
      || (run.request_message_id !== null && !UUID.test(run.request_message_id))
      || !run.context
      || typeof run.context !== 'object'
      || Array.isArray(run.context)
      || typeof run.created_at !== 'string'
      || !Number.isFinite(Date.parse(run.created_at))
      || typeof run.updated_at !== 'string'
      || !Number.isFinite(Date.parse(run.updated_at))) {
      throw fail(ERROR_CODES.ASSISTANT_CONVERSATION_CORRUPT, `对话 ${conversationId} 的运行记录损坏。`, { status: 409 });
    }
    return run;
  }

  async function listRuns(conversationId) {
    const directory = path.join(conversationPath(conversationId), 'runs');
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => error?.code === 'ENOENT' ? [] : Promise.reject(error));
    const runs = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const run = await readJson(path.join(directory, entry.name), null);
      runs.push(validateRun(run, conversationId));
    }
    return runs.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.run_id.localeCompare(b.run_id));
  }

  async function readSummary(conversationId) {
    let summary;
    try { summary = await readJson(path.join(conversationPath(conversationId), 'summary.json'), null); }
    catch (error) { if (error instanceof SyntaxError) return null; throw error; }
    if (!summary) return null;
    return summary.schema_version === '1.0'
      && Number.isSafeInteger(summary.through_seq)
      && summary.through_seq > 0
      && typeof summary.summary === 'string'
      && summary.summary.length <= 8_000
      && typeof summary.updated_at === 'string' ? summary : null;
  }

  async function cleanupTrash(now = Date.now()) {
    const entries = await fs.readdir(trashRoot, { withFileTypes: true }).catch((error) => error?.code === 'ENOENT' ? [] : Promise.reject(error));
    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
      const target = path.join(trashRoot, entry.name);
      const stats = await fs.stat(target).catch(() => null);
      if (stats && now - stats.mtimeMs >= TRASH_RETENTION_MS) await fs.rm(target, { recursive: true, force: true });
    }
  }

  async function initialize() {
    await ensureDir(conversationsRoot);
    await ensureDir(trashRoot);
    await cleanupTrash().catch(() => undefined);
    const listed = await listConversationsRaw();
    for (const meta of listed.conversations) {
      let runs;
      try { runs = await listRuns(meta.conversation_id); }
      catch { continue; }
      for (const run of runs) {
        if (!['queued', 'running', 'executing'].includes(run.status)) continue;
        const now = new Date().toISOString();
        await writeJson(runPath(meta.conversation_id, run.run_id), {
          ...run,
          status: 'interrupted',
          error: { code: ERROR_CODES.ASSISTANT_RUN_INTERRUPTED, message: run.status === 'executing' ? '应用重启，动作执行结果未知，请刷新项目状态后重新生成计划。' : '应用重启，本次助手运行已中断，请重新发起。' },
          updated_at: now
        });
      }
    }
  }

  function ensureReady() {
    ready ||= initialize();
    return ready;
  }

  async function listConversationsRaw() {
    const entries = await fs.readdir(conversationsRoot, { withFileTypes: true }).catch((error) => error?.code === 'ENOENT' ? [] : Promise.reject(error));
    const conversations = [];
    const warnings = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
      try { conversations.push(await readMeta(entry.name)); }
      catch (error) { warnings.push({ conversation_id: entry.name, code: error.code || ERROR_CODES.ASSISTANT_CONVERSATION_CORRUPT, message: '一条对话记录已损坏，未加入列表。' }); }
    }
    conversations.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return { conversations, warnings };
  }

  async function listConversations() {
    await ensureReady();
    const listed = await listConversationsRaw();
    const conversations = [];
    for (const meta of listed.conversations) {
      try {
        const runs = await listRuns(meta.conversation_id);
        const has_pending_action = runs.some((run) => run.status === 'awaiting_confirmation');
        conversations.push({ ...meta, has_pending_action });
      } catch (error) {
        listed.warnings.push({ conversation_id: meta.conversation_id, code: error.code || ERROR_CODES.ASSISTANT_CONVERSATION_CORRUPT, message: '一条对话的运行记录已损坏，未加入列表。' });
      }
    }
    return { conversations, warnings: listed.warnings };
  }

  async function createConversation({ projectId, screenId, title = '新对话' } = {}) {
    await ensureReady();
    const project_id = cleanText(projectId, 200, '项目 ID');
    const screen_id = cleanText(screenId, 200, 'Screen ID');
    const safeTitle = cleanText(title, 80, '对话标题');
    for (;;) {
      const conversation_id = randomUUID();
      const directory = conversationPath(conversation_id);
      try { await fs.mkdir(directory, { recursive: false }); }
      catch (error) { if (error?.code === 'EEXIST') continue; throw error; }
      const now = new Date().toISOString();
      const meta = { schema_version: '1.0', conversation_id, title: safeTitle, project_id, screen_id, created_at: now, updated_at: now };
      await ensureDir(path.join(directory, 'runs'));
      await writeJson(path.join(directory, 'meta.json'), meta);
      await fs.writeFile(path.join(directory, 'messages.jsonl'), '', { encoding: 'utf8', flag: 'wx' });
      return openConversation(conversation_id);
    }
  }

  async function openConversation(conversationId) {
    await ensureReady();
    const meta = await readMeta(conversationId);
    const [messages, runs, summary] = await Promise.all([
      readMessages(conversationId),
      listRuns(conversationId),
      readSummary(conversationId)
    ]);
    const lastSeq = messages.at(-1)?.seq || 0;
    return { meta, messages, runs, summary: summary && summary.through_seq <= lastSeq ? summary : null };
  }

  async function renameConversation(conversationId, title) {
    await ensureReady();
    return enqueue(conversationId, async () => {
      const meta = await readMeta(conversationId);
      const next = { ...meta, title: cleanText(title, 80, '对话标题'), updated_at: new Date().toISOString() };
      await writeJson(path.join(conversationPath(conversationId), 'meta.json'), next);
      return next;
    });
  }

  async function refreshSummary(conversationId, messages) {
    const characters = messages.reduce((sum, message) => sum + message.content.length, 0);
    if (messages.length < SUMMARY_MESSAGE_LIMIT && characters < SUMMARY_CHARACTER_LIMIT) return;
    const keep = 12;
    const covered = messages.slice(0, Math.max(1, messages.length - keep));
    const summary = covered.map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`).join('\n').slice(-8_000);
    await writeJson(path.join(conversationPath(conversationId), 'summary.json'), {
      schema_version: '1.0', through_seq: covered.at(-1).seq, summary, updated_at: new Date().toISOString()
    });
  }

  async function appendMessage(conversationId, { role, content }) {
    await ensureReady();
    return enqueue(conversationId, async () => {
      if (!['user', 'assistant'].includes(role)) throw fail(ERROR_CODES.ASSISTANT_MESSAGE_INVALID, '消息角色无效。', { status: 400 });
      const meta = await readMeta(conversationId);
      const messages = await readMessages(conversationId);
      const message = { id: randomUUID(), seq: (messages.at(-1)?.seq || 0) + 1, role, content: cleanText(content, MESSAGE_LIMIT, '消息'), created_at: new Date().toISOString() };
      const filePath = path.join(conversationPath(conversationId), 'messages.jsonl');
      const existing = await fs.readFile(filePath, 'utf8').catch((error) => error?.code === 'ENOENT' ? '' : Promise.reject(error));
      await fs.appendFile(filePath, `${existing && !existing.endsWith('\n') ? '\n' : ''}${JSON.stringify(message)}\n`, 'utf8');
      await writeJson(path.join(conversationPath(conversationId), 'meta.json'), { ...meta, updated_at: message.created_at });
      // 摘要只是可重建缓存；失败不能推翻已成功追加的消息。
      await refreshSummary(conversationId, [...messages, message]).catch(() => undefined);
      return message;
    });
  }

  async function findUnfinishedRun() {
    // ponytail: 首版按目录 O(n) 扫描；只有真实规模测出瓶颈时才换 SQLite/可重建索引。
    const { conversations } = await listConversationsRaw();
    for (const meta of conversations) {
      let runs;
      try { runs = await listRuns(meta.conversation_id); }
      catch { continue; }
      const run = runs.find((item) => UNFINISHED.has(item.status));
      if (run) return run;
    }
    return null;
  }

  async function createRun(conversationId, input) {
    await ensureReady();
    // ponytail: 首版每个应用实例/租户只允许一个未完成 run；出现真实并行需求且
    // job 级取消与领域 CAS 完整后，再升级为按项目队列。
    return enqueue('__runtime__', async () => {
      const active = await findUnfinishedRun();
      if (active) throw fail(ERROR_CODES.ASSISTANT_RUN_IN_PROGRESS, '已有助手任务尚未完成，请先确认或取消。', { status: 409, run_id: active.run_id, conversation_id: active.conversation_id });
      return enqueue(conversationId, async () => {
        await readMeta(conversationId);
        const previousRuns = await listRuns(conversationId);
        const latestCreatedAt = Date.parse(previousRuns.at(-1)?.created_at || '') || 0;
        const now = new Date(Math.max(Date.now(), latestCreatedAt + 1)).toISOString();
        const run = {
          schema_version: '1.0', run_id: randomUUID(), conversation_id: conversationId,
          status: 'queued', mode: input.mode, request_message_id: input.requestMessageId,
          context: input.context || {}, proposed_action: null, result: null, error: null,
          created_at: now, updated_at: now
        };
        validateRun(run, conversationId);
        await writeJson(runPath(conversationId, run.run_id), run);
        return run;
      });
    });
  }

  async function getRun(conversationId, runId) {
    await ensureReady();
    const run = await readJson(runPath(conversationId, runId), null);
    if (!run) throw fail(ERROR_CODES.ASSISTANT_ACTION_NOT_ALLOWED, '运行记录不存在。', { status: 404 });
    return validateRun(run, conversationId);
  }

  async function updateRun(conversationId, runId, patch) {
    await ensureReady();
    return enqueue(conversationId, async () => {
      const run = await getRun(conversationId, runId);
      if (TERMINAL.has(run.status) && patch.status && patch.status !== run.status) {
        throw fail(ERROR_CODES.ASSISTANT_ACTION_NOT_ALLOWED, '运行已经结束，不能再次改变状态。', { status: 409 });
      }
      if (patch.status && patch.status !== run.status && !RUN_TRANSITIONS[run.status]?.has(patch.status)) {
        throw fail(ERROR_CODES.ASSISTANT_ACTION_NOT_ALLOWED, `不允许从 ${run.status} 跳转到 ${patch.status}。`, { status: 409 });
      }
      const next = { ...run, ...patch, run_id: run.run_id, conversation_id: run.conversation_id, schema_version: '1.0', updated_at: new Date().toISOString() };
      validateRun(next, conversationId);
      if (JSON.stringify(next).length > 64_000) throw fail(ERROR_CODES.ASSISTANT_RESPONSE_INVALID, '助手运行结果过大，已拒绝保存。', { status: 502 });
      await writeJson(runPath(conversationId, runId), next);
      return next;
    });
  }

  async function claimRun(conversationId, runId, actionId) {
    await ensureReady();
    return enqueue(conversationId, async () => {
      const run = await getRun(conversationId, runId);
      if (!run.proposed_action || run.proposed_action.action_id !== actionId) throw fail(ERROR_CODES.ASSISTANT_ACTION_NOT_ALLOWED, '动作标识不匹配。', { status: 409 });
      if (TERMINAL.has(run.status)) return { claimed: false, run };
      if (run.status === 'executing') throw fail(ERROR_CODES.ASSISTANT_ACTION_IN_PROGRESS, '动作正在执行，请等待当前结果。', { status: 409 });
      if (run.status !== 'awaiting_confirmation') throw fail(ERROR_CODES.ASSISTANT_ACTION_NOT_ALLOWED, '当前运行没有可确认的动作。', { status: 409 });
      const next = { ...run, status: 'executing', updated_at: new Date().toISOString() };
      await writeJson(runPath(conversationId, runId), next);
      return { claimed: true, run: next };
    });
  }

  async function cancelRun(conversationId, runId) {
    await ensureReady();
    return enqueue(conversationId, async () => {
      const run = await getRun(conversationId, runId);
      if (TERMINAL.has(run.status)) return run;
      if (!['queued', 'awaiting_confirmation'].includes(run.status)) throw fail(ERROR_CODES.ASSISTANT_ACTION_IN_PROGRESS, '当前运行已经开始，无法安全取消。', { status: 409 });
      const next = { ...run, status: 'cancelled', error: null, updated_at: new Date().toISOString() };
      await writeJson(runPath(conversationId, runId), next);
      return next;
    });
  }

  async function deleteConversation(conversationId) {
    await ensureReady();
    return enqueue(conversationId, async () => {
      await readMeta(conversationId);
      if ((await listRuns(conversationId)).some((run) => UNFINISHED.has(run.status))) throw fail(ERROR_CODES.ASSISTANT_RUN_IN_PROGRESS, '请先结束当前助手任务，再删除对话。', { status: 409 });
      await ensureDir(trashRoot);
      const target = path.join(trashRoot, conversationId);
      await fs.rename(conversationPath(conversationId), target);
      const deletedAt = new Date();
      await fs.utimes(target, deletedAt, deletedAt).catch(() => undefined);
      return { deleted: true, conversation_id: conversationId };
    });
  }

  return {
    assistantRoot, initialize: ensureReady, listConversations, createConversation, openConversation,
    renameConversation, deleteConversation, appendMessage, createRun, getRun, updateRun,
    claimRun, cancelRun, findUnfinishedRun
  };
}

module.exports = { createAssistantStore, MESSAGE_LIMIT, RUN_STATUSES, TERMINAL, UNFINISHED };
