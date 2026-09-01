const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createApplication } = require('./webServer.cjs');

const ORIGINAL_FETCH = global.fetch;

function baseEnvironment(dataRoot, overrides = {}) {
  return {
    HOST: '127.0.0.1',
    PORT: '0',
    PUBLIC_URL: 'http://127.0.0.1:9030',
    DESIGN_COPILOT_DATA_ROOT: dataRoot,
    SESSION_SECRET: 'runtime-namespace-test-secret-0123456789abcdef', // gitleaks:allow 仅测试用假值，非真实密钥
    ...overrides
  };
}

async function startApplication(overrides = {}) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-runtime-'));
  const app = createApplication(baseEnvironment(dataRoot, overrides));
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    app,
    dataRoot,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(dataRoot, { recursive: true, force: true });
    }
  };
}

function cookiePair(setCookie, name) {
  const match = String(setCookie || '').match(new RegExp(`(?:^|,\\s*)${name}=([^;,]*)`));
  return match ? `${name}=${match[1]}` : '';
}

test('runtime namespace keeps the historical Cookie names by default', async () => {
  const runtime = await startApplication({
    FEISHU_APP_ID: 'cli_default_cookie_test',
    FEISHU_APP_SECRET: 'default-cookie-app-secret-test-only' // gitleaks:allow 仅测试用假值，非真实密钥
  });
  try {
    assert.equal(runtime.app.config.sessionCookieName, 'design_copilot_session');
    assert.equal(runtime.app.config.oauthCookieName, 'design_copilot_oauth');

    const tenantId = await runtime.app.identityStore.tenantFor('tenant-default', 'user-default');
    const sessionId = await runtime.app.identityStore.createSession(tenantId);
    const status = await ORIGINAL_FETCH(`${runtime.base}/auth/status`, {
      headers: { cookie: `design_copilot_session=${sessionId}` }
    });
    assert.deepEqual(await status.json(), { loggedIn: true, configured: true });

    const start = await ORIGINAL_FETCH(`${runtime.base}/auth/feishu/start`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    assert.match(start.headers.get('set-cookie') || '', /^design_copilot_oauth=/);
  } finally {
    await runtime.close();
  }
});

test('runtime namespace rejects empty, separated, controlled and colliding Cookie names', () => {
  const dataRoot = path.join(os.tmpdir(), 'design-copilot-invalid-cookie-name');
  for (const [key, value] of [
    ['SESSION_COOKIE_NAME', ''],
    ['SESSION_COOKIE_NAME', 'session name'],
    ['SESSION_COOKIE_NAME', 'session;name'],
    ['OAUTH_COOKIE_NAME', 'oauth,name'],
    ['OAUTH_COOKIE_NAME', 'oauth\nname']
  ]) {
    assert.throws(
      () => createApplication(baseEnvironment(dataRoot, { [key]: value })),
      new RegExp(`${key} 必须是非空`)
    );
  }
  assert.throws(
    () => createApplication(baseEnvironment(dataRoot, {
      SESSION_COOKIE_NAME: 'same_cookie',
      OAUTH_COOKIE_NAME: 'same_cookie'
    })),
    /必须不同/
  );
});

test('custom runtime namespace isolates authentication, OAuth callback and logout', async () => {
  const runtime = await startApplication({
    SESSION_COOKIE_NAME: 'design_copilot_v2_session',
    OAUTH_COOKIE_NAME: 'design_copilot_v2_oauth',
    DESIGN_COPILOT_RELEASE_ID: '20260831-pr02',
    DESIGN_COPILOT_VERSION_LABEL: '新版',
    FEISHU_APP_ID: 'cli_v2_cookie_test',
    FEISHU_APP_SECRET: 'v2-cookie-app-secret-test-only' // gitleaks:allow 仅测试用假值，非真实密钥
  });
  const externalCalls = [];
  try {
    const health = await ORIGINAL_FETCH(`${runtime.base}/healthz`);
    assert.deepEqual(await health.json(), {
      status: 'ok',
      service: 'game-ui-design-copilot',
      releaseId: '20260831-pr02',
      versionLabel: '新版'
    });
    const healthText = await (await ORIGINAL_FETCH(`${runtime.base}/healthz`)).text();
    assert.doesNotMatch(healthText, /SESSION_SECRET|FEISHU_APP_SECRET|runtime-namespace-test-secret|v2-cookie-app-secret|design-copilot-runtime-/);

    const legacyTenant = await runtime.app.identityStore.tenantFor('tenant-legacy', 'user-legacy');
    const legacySession = await runtime.app.identityStore.createSession(legacyTenant);
    const ignoredLegacy = await ORIGINAL_FETCH(`${runtime.base}/auth/status`, {
      headers: { cookie: `design_copilot_session=${legacySession}` }
    });
    assert.deepEqual(await ignoredLegacy.json(), { loggedIn: false, configured: true });

    const acceptedCustom = await ORIGINAL_FETCH(`${runtime.base}/auth/status`, {
      headers: { cookie: `design_copilot_v2_session=${legacySession}` }
    });
    assert.deepEqual(await acceptedCustom.json(), { loggedIn: true, configured: true });

    const start = await ORIGINAL_FETCH(`${runtime.base}/auth/feishu/start`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const authorize = new URL(start.headers.get('location'));
    const oauthCookie = cookiePair(start.headers.get('set-cookie'), 'design_copilot_v2_oauth');
    assert.ok(authorize.searchParams.get('state'));
    assert.ok(oauthCookie);
    assert.doesNotMatch(start.headers.get('set-cookie') || '', /design_copilot_oauth=/);

    global.fetch = async (input, init) => {
      const target = String(input);
      if (target === 'https://accounts.feishu.cn/oauth/v3/token') {
        externalCalls.push(target);
        const body = JSON.parse(init.body);
        assert.equal(body.code, 'one-time-code');
        assert.equal(body.redirect_uri, 'http://127.0.0.1:9030/auth/feishu/callback');
        return new Response(JSON.stringify({ code: 0, access_token: 'user-access-token-test-only' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (target === 'https://open.feishu.cn/open-apis/authen/v1/user_info') {
        externalCalls.push(target);
        assert.equal(init.headers.Authorization, 'Bearer user-access-token-test-only');
        return new Response(JSON.stringify({
          code: 0,
          data: { tenant_key: 'tenant-v2', open_id: 'user-v2' }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return ORIGINAL_FETCH(input, init);
    };

    const callbackUrl = new URL('/auth/feishu/callback', runtime.base);
    callbackUrl.searchParams.set('code', 'one-time-code');
    callbackUrl.searchParams.set('state', authorize.searchParams.get('state'));
    const callback = await ORIGINAL_FETCH(callbackUrl, {
      redirect: 'manual',
      headers: { cookie: oauthCookie }
    });
    assert.equal(callback.status, 302);
    assert.deepEqual(externalCalls, [
      'https://accounts.feishu.cn/oauth/v3/token',
      'https://open.feishu.cn/open-apis/authen/v1/user_info'
    ]);
    const callbackCookies = callback.headers.get('set-cookie') || '';
    const sessionCookie = cookiePair(callbackCookies, 'design_copilot_v2_session');
    assert.ok(sessionCookie);
    assert.match(callbackCookies, /design_copilot_v2_oauth=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0/);
    assert.doesNotMatch(callbackCookies, /design_copilot_session=/);

    const loggedIn = await ORIGINAL_FETCH(`${runtime.base}/auth/status`, { headers: { cookie: sessionCookie } });
    assert.deepEqual(await loggedIn.json(), { loggedIn: true, configured: true });

    const logout = await ORIGINAL_FETCH(`${runtime.base}/auth/logout`, {
      method: 'POST',
      headers: { cookie: sessionCookie, origin: 'http://127.0.0.1:9030' }
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie') || '', /^design_copilot_v2_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0/);
    assert.doesNotMatch(logout.headers.get('set-cookie') || '', /design_copilot_session=/);

    const loggedOut = await ORIGINAL_FETCH(`${runtime.base}/auth/status`, { headers: { cookie: sessionCookie } });
    assert.deepEqual(await loggedOut.json(), { loggedIn: false, configured: true });
  } finally {
    global.fetch = ORIGINAL_FETCH;
    await runtime.close();
  }
});
