const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createApplication } = require('./webServer.cjs');

const originalFetch = globalThis.fetch;

async function startApplication(enabled) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-web-assistant-'));
  const app = createApplication({
    HOST: '127.0.0.1', PORT: '0', PUBLIC_URL: 'http://127.0.0.1:9032',
    DESIGN_COPILOT_DATA_ROOT: dataRoot,
    SESSION_SECRET: 'assistant-http-test-secret-0123456789abcdef', // gitleaks:allow 仅测试用假值，非真实密钥
    KUNPO_GATEWAY_BASE_URL: 'https://gateway.example.test',
    GAME_UI_ASSISTANT_ENABLED: enabled ? 'true' : 'false'
  });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const tenantA = await app.identityStore.tenantFor('tenant-assistant', 'user-a');
  const tenantB = await app.identityStore.tenantFor('tenant-assistant', 'user-b');
  const sessionA = await app.identityStore.createSession(tenantA);
  const sessionB = await app.identityStore.createSession(tenantB);
  return {
    app, dataRoot, base: `http://127.0.0.1:${server.address().port}`,
    tenantA, tenantB,
    cookieA: `design_copilot_session=${sessionA}`,
    cookieB: `design_copilot_session=${sessionB}`,
    async close() {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(dataRoot, { recursive: true, force: true });
    }
  };
}

async function request(runtime, pathname, { cookie = runtime.cookieA, method = 'GET', body, origin } = {}) {
  const response = await originalFetch(`${runtime.base}${pathname}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  return { response, payload: await response.json().catch(() => ({})) };
}

test('assistant HTTP routes preserve auth, origin and tenant boundaries', async () => {
  const runtime = await startApplication(true);
  try {
    const contextA = runtime.app.tenantContext(runtime.tenantA);
    const project = await contextA.projectStore.create({ name: 'Assistant tenant A', projectType: 'new', requirement: '设计一个主页' });

    const config = await request(runtime, '/api/config');
    assert.equal(config.response.status, 200);
    assert.equal(config.payload.features.assistant, true);

    const unauthenticated = await request(runtime, '/api/assistant/conversations', { cookie: '' });
    assert.equal(unauthenticated.response.status, 401);

    const crossSite = await request(runtime, '/api/assistant/conversations', {
      method: 'POST', origin: 'https://evil.example', body: { projectId: project.id, screenId: 'main' }
    });
    assert.equal(crossSite.response.status, 403);

    const created = await request(runtime, '/api/assistant/conversations', {
      method: 'POST', body: { projectId: project.id, screenId: 'main' }
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.response.headers.get('cache-control'), 'no-store');
    assert.equal(created.payload.meta.project_id, project.id);

    const leaked = await request(runtime, `/api/assistant/conversations/${created.payload.meta.conversation_id}`, { cookie: runtime.cookieB });
    assert.equal(leaked.response.status, 404);
    assert.equal(leaked.payload.code, 'ASSISTANT_CONVERSATION_NOT_FOUND');
    assert.doesNotMatch(JSON.stringify(leaked.payload), /Assistant tenant A/);
  } finally {
    await runtime.close();
  }
});

test('assistant HTTP QA uses the shared runtime and model config save preserves its feature flag', async () => {
  const runtime = await startApplication(true);
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://gateway.example.test/')) {
      const requestBody = JSON.parse(options.body);
      assert.equal(requestBody.model, 'assistant-text-x');
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: '当前项目尚未生成视觉产物。', proposed_action: null }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(url, options);
  };
  try {
    const context = runtime.app.tenantContext(runtime.tenantA);
    const project = await context.projectStore.create({ name: 'Assistant QA', projectType: 'new', requirement: '设计一个主页' });
    const saved = await request(runtime, '/api/config/models', {
      method: 'POST', body: { assistantModel: 'assistant-text-x', visionModel: 'vision-x', imageModel: 'image-x' }
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.payload.features.assistant, true);
    assert.equal(saved.payload.kunpo.assistantModel, 'assistant-text-x');

    const created = await request(runtime, '/api/assistant/conversations', { method: 'POST', body: { projectId: project.id, screenId: 'main' } });
    const sent = await request(runtime, `/api/assistant/conversations/${created.payload.meta.conversation_id}/messages`, {
      method: 'POST', body: { mode: 'qa', content: '当前进度是什么？', projectId: project.id, screenId: 'main' }
    });
    assert.equal(sent.response.status, 200);
    assert.equal(sent.payload.messages.at(-1).content, '当前项目尚未生成视觉产物。');
    assert.equal(sent.payload.runs.at(-1).status, 'succeeded');
  } finally {
    globalThis.fetch = originalFetch;
    await runtime.close();
  }
});

test('disabled assistant remains absent from tenant storage and rejects every route', async () => {
  const runtime = await startApplication(false);
  try {
    const config = await request(runtime, '/api/config');
    assert.equal(config.payload.features.assistant, false);
    const response = await request(runtime, '/api/assistant/conversations');
    assert.equal(response.response.status, 404);
    assert.equal(response.payload.code, 'ASSISTANT_DISABLED');
    await assert.rejects(fs.stat(path.join(runtime.dataRoot, 'tenants', runtime.tenantA, 'assistant')), { code: 'ENOENT' });
  } finally {
    await runtime.close();
  }
});
