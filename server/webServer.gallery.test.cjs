// 图库 Web 路由（v1.1 §7.3/§7.5）：租户级路由先于项目路由、隐藏恢复闭环、
// 下载门禁只认登记时 continuation_mode 快照（fail-closed）、租户隔离、
// 同源代理不重定向。
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createApplication } = require('./webServer.cjs');

async function startApplication() {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-web-gallery-'));
  const app = createApplication({
    HOST: '127.0.0.1',
    PORT: '0',
    PUBLIC_URL: 'http://127.0.0.1:9030',
    DESIGN_COPILOT_DATA_ROOT: dataRoot,
    SESSION_SECRET: 'gallery-route-test-secret-0123456789abcdef' // gitleaks:allow 仅测试用假值，非真实密钥
  });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const tenantId = await app.identityStore.tenantFor('tenant-gallery', 'user-gallery');
  const sessionId = await app.identityStore.createSession(tenantId);
  return {
    app,
    base: `http://127.0.0.1:${server.address().port}`,
    cookie: `design_copilot_session=${sessionId}`,
    context: app.tenantContext(tenantId),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(dataRoot, { recursive: true, force: true });
    }
  };
}

function registerAsset(context, overrides = {}) {
  return context.galleryStore.registerVariation(
    {
      projectId: 'gallery-project', screenId: 'main', screenName: '主页面',
      continuationMode: 'exploration', projectName: '图库项目', projectStatus: 'draft',
      originKind: 'visual_exploration', ...(overrides.context || {})
    },
    {
      id: overrides.variationId || 'variation-1',
      image_url: overrides.url || 'https://kunpoapiimg.ziy.cc/gallery-route-tests/asset.png',
      provider_task_id: 'task-1', strategy: 'conservative', storageMode: 'provider_cdn',
      created_at: '2026-08-20T10:00:00.000Z', output_width: 1920, output_height: 1080
    }
  );
}

test('未认证请求访问 /api/gallery 返回 401', async () => {
  const runtime = await startApplication();
  try {
    const response = await fetch(`${runtime.base}/api/gallery`);
    assert.equal(response.status, 401);
  } finally { await runtime.close(); }
});

test('list/hide/restore 通过 HTTP 闭环', async () => {
  const runtime = await startApplication();
  try {
    const asset = await registerAsset(runtime.context);
    const listed = await (await fetch(`${runtime.base}/api/gallery`, { headers: { cookie: runtime.cookie } })).json();
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0].id, asset.id);

    const hiddenResponse = await fetch(`${runtime.base}/api/gallery/${asset.id}/hide`, { method: 'POST', headers: { cookie: runtime.cookie }, body: '{}' });
    assert.equal(hiddenResponse.status, 200);
    const afterHide = await (await fetch(`${runtime.base}/api/gallery`, { headers: { cookie: runtime.cookie } })).json();
    assert.equal(afterHide.total, 0);
    const hiddenScope = await (await fetch(`${runtime.base}/api/gallery?scope=hidden`, { headers: { cookie: runtime.cookie } })).json();
    assert.equal(hiddenScope.total, 1);

    const restoreResponse = await fetch(`${runtime.base}/api/gallery/${asset.id}/restore`, { method: 'POST', headers: { cookie: runtime.cookie }, body: '{}' });
    assert.equal(restoreResponse.status, 200);
    const afterRestore = await (await fetch(`${runtime.base}/api/gallery`, { headers: { cookie: runtime.cookie } })).json();
    assert.equal(afterRestore.total, 1);
  } finally { await runtime.close(); }
});

test('严格路线快照的资产下载被 409 阻断，且不发起上游请求', async () => {
  const runtime = await startApplication();
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async (...args) => {
    if (String(args[0]).includes('kunpoapiimg.ziy.cc')) upstreamCalls += 1;
    return originalFetch(...args);
  };
  try {
    const asset = await registerAsset(runtime.context, { context: { continuationMode: 'existing-strict' } });
    const response = await fetch(`${runtime.base}/api/gallery/${asset.id}/download`, { headers: { cookie: runtime.cookie } });
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.ok(/严格继承/.test(payload.error));
    assert.equal(upstreamCalls, 0, '门禁阻断时不得访问上游');
  } finally {
    globalThis.fetch = originalFetch;
    await runtime.close();
  }
});

test('缺失路线快照按 fail-closed 阻断下载', async () => {
  const runtime = await startApplication();
  try {
    const asset = await registerAsset(runtime.context, { context: { continuationMode: undefined } });
    const response = await fetch(`${runtime.base}/api/gallery/${asset.id}/download`, { headers: { cookie: runtime.cookie } });
    assert.equal(response.status, 409);
  } finally { await runtime.close(); }
});

test('fail-closed 历史资产经豁免后放行下载，短理由与严格路线被拒', async () => {
  const runtime = await startApplication();
  const originalFetch = globalThis.fetch;
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('kunpoapiimg.ziy.cc')) return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } });
    return originalFetch(url, init);
  };
  try {
    const historical = await registerAsset(runtime.context, {
      url: 'https://kunpoapiimg.ziy.cc/gallery-route-tests/history.png',
      context: { continuationMode: undefined, modeProvenance: 'fail-closed' }
    });
    const blocked = await fetch(`${runtime.base}/api/gallery/${historical.id}/download`, { headers: { cookie: runtime.cookie } });
    assert.equal(blocked.status, 409);

    const shortReason = await fetch(`${runtime.base}/api/gallery/${historical.id}/waive`, { method: 'POST', headers: { cookie: runtime.cookie }, body: JSON.stringify({ reason: '太短' }) });
    assert.equal(shortReason.status, 400);

    const waived = await fetch(`${runtime.base}/api/gallery/${historical.id}/waive`, { method: 'POST', headers: { cookie: runtime.cookie }, body: JSON.stringify({ reason: '该历史方案已确认复用，需要导出原图归档。' }) });
    assert.equal(waived.status, 200);
    const waivedPayload = await waived.json();
    assert.ok(waivedPayload.download_waiver.at);
    assert.equal(waivedPayload.download_waiver.reason, '该历史方案已确认复用，需要导出原图归档。');

    const download = await fetch(`${runtime.base}/api/gallery/${historical.id}/download`, { headers: { cookie: runtime.cookie }, redirect: 'error' });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);

    // 有明确生成时路线证据的严格资产不提供豁免口子。
    const strict = await registerAsset(runtime.context, {
      url: 'https://kunpoapiimg.ziy.cc/gallery-route-tests/strict.png',
      context: { continuationMode: 'existing-strict' }
    });
    const strictWaive = await fetch(`${runtime.base}/api/gallery/${strict.id}/waive`, { method: 'POST', headers: { cookie: runtime.cookie }, body: JSON.stringify({ reason: '理由足够长的豁免说明' }) });
    assert.equal(strictWaive.status, 409);
  } finally {
    globalThis.fetch = originalFetch;
    await runtime.close();
  }
});

test('可下载路线经同源代理流式返回，绝不重定向到远端', async () => {
  const runtime = await startApplication();
  const originalFetch = globalThis.fetch;
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('kunpoapiimg.ziy.cc')) {
      return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return originalFetch(url, init);
  };
  try {
    const asset = await registerAsset(runtime.context);
    const response = await fetch(`${runtime.base}/api/gallery/${asset.id}/download`, { headers: { cookie: runtime.cookie }, redirect: 'error' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.ok(/attachment/.test(response.headers.get('content-disposition') || ''));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  } finally {
    globalThis.fetch = originalFetch;
    await runtime.close();
  }
});

test('租户隔离：其他租户看不到也下载不了本租户资产', async () => {
  const runtime = await startApplication();
  try {
    const asset = await registerAsset(runtime.context);
    const otherTenant = await runtime.app.identityStore.tenantFor('tenant-other', 'user-other');
    const otherSession = await runtime.app.identityStore.createSession(otherTenant);
    const otherCookie = `design_copilot_session=${otherSession}`;
    const listed = await (await fetch(`${runtime.base}/api/gallery`, { headers: { cookie: otherCookie } })).json();
    assert.equal(listed.total, 0);
    const download = await fetch(`${runtime.base}/api/gallery/${asset.id}/download`, { headers: { cookie: otherCookie } });
    assert.equal(download.status, 404);
  } finally { await runtime.close(); }
});
