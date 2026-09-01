const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const {
  createVersionRouter,
  injectHtmlBeforeBody,
  validateConfiguration
} = require('./versionRouter.cjs');

const ROUTER_TEST_BODY_LIMIT = 9 * 1024;

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    port: server.address().port,
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

function routerEnvironment(classicPort, currentPort, overrides = {}) {
  return {
    ROUTER_HOST: '127.0.0.1',
    ROUTER_PORT: '9030',
    ROUTER_PUBLIC_URL: 'http://10.8.0.176:9030',
    ROUTER_CLASSIC_UPSTREAM: `http://127.0.0.1:${classicPort}`,
    ROUTER_CURRENT_UPSTREAM: `http://127.0.0.1:${currentPort}`,
    ROUTER_HEALTH_TIMEOUT_MS: '500',
    ROUTER_UPSTREAM_TIMEOUT_MS: '2000',
    ...overrides
  };
}

function request(base, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const client = http.request(new URL(pathname, base), { method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        rawHeaders: response.rawHeaders,
        body: Buffer.concat(chunks)
      }));
      response.on('error', reject);
    });
    client.on('error', reject);
    client.end(body);
  });
}

function healthHandler(label, extra = {}) {
  return (request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      return response.end(JSON.stringify({ status: 'ok', versionLabel: label, ...extra }));
    }
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(label);
  };
}

test('router configuration fixes loopback upstreams and applies the routing priority', () => {
  const config = validateConfiguration(routerEnvironment(19031, 19032));
  assert.equal(config.defaultVersion, 'classic');
  assert.equal(config.upstreams.classic.origin, 'http://127.0.0.1:19031');
  assert.equal(config.upstreams.current.origin, 'http://127.0.0.1:19032');

  const router = createVersionRouter(routerEnvironment(19031, 19032));
  assert.deepEqual(router.selectVersion({ headers: {} }), { version: 'classic', source: 'default' });
  assert.deepEqual(router.selectVersion({ headers: { cookie: 'design_copilot_session=legacy' } }), {
    version: 'classic', source: 'classic-session'
  });
  assert.deepEqual(router.selectVersion({
    headers: { cookie: 'design_copilot_session=legacy; design_copilot_version=current' }
  }), { version: 'current', source: 'cookie' });
  assert.deepEqual(router.selectVersion({
    headers: { cookie: 'design_copilot_session=legacy; design_copilot_version=tampered' }
  }), { version: 'classic', source: 'classic-session' });

  const currentDefault = createVersionRouter(routerEnvironment(19031, 19032, { ROUTER_DEFAULT_VERSION: 'current' }));
  assert.deepEqual(currentDefault.selectVersion({ headers: {} }), { version: 'current', source: 'default' });

  assert.throws(
    () => validateConfiguration(routerEnvironment(19031, 19032, { ROUTER_CURRENT_UPSTREAM: 'http://example.com:9032' })),
    /回环 HTTP origin/
  );
  assert.throws(
    () => validateConfiguration(routerEnvironment(19031, 19031)),
    /不同的上游 origin/
  );
  assert.throws(
    () => validateConfiguration(routerEnvironment(19031, 19032, { ROUTER_DEFAULT_VERSION: 'fallback' })),
    /classic 或 current/
  );
  assert.throws(
    () => validateConfiguration(routerEnvironment(19031, 19032, {
      ROUTER_VERSION_COOKIE_NAME: 'same_cookie',
      ROUTER_CLASSIC_SESSION_COOKIE_NAME: 'same_cookie'
    })),
    /必须不同/
  );
});

test('version management endpoints expose safe health and enforce same-origin bounded selection', async () => {
  const classic = await startServer(healthHandler('经典版'));
  const current = await startServer(healthHandler('新版', { releaseId: 'release-current' }));
  const router = createVersionRouter(routerEnvironment(classic.port, current.port));
  const publicServer = await startServer(router.handler);
  try {
    const status = await request(publicServer.base, '/__versions/status', {
      headers: { cookie: 'design_copilot_session=legacy-session' }
    });
    assert.equal(status.status, 200);
    const payload = JSON.parse(status.body.toString('utf8'));
    assert.deepEqual(payload.selected, { version: 'classic', source: 'classic-session' });
    assert.equal(payload.defaultVersion, 'classic');
    assert.equal(payload.upstreams.classic.available, true);
    assert.equal(payload.upstreams.current.available, true);
    assert.equal(payload.upstreams.current.releaseId, 'release-current');
    const statusText = status.body.toString('utf8');
    assert.doesNotMatch(statusText, /127\.0\.0\.1|ROUTER_/);
    assert.ok(!statusText.includes(String(classic.port)));
    assert.ok(!statusText.includes(String(current.port)));

    const page = await request(publicServer.base, '/__versions', {
      headers: { cookie: 'design_copilot_version=current' }
    });
    assert.equal(page.status, 200);
    assert.match(page.body.toString('utf8'), /当前：新版/);
    assert.match(page.body.toString('utf8'), /两版工作区相互独立，项目不会自动同步/);

    const missingOrigin = await request(publicServer.base, '/__versions/select', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 'current' })
    });
    assert.equal(missingOrigin.status, 403);

    const invalidVersion = await request(publicServer.base, '/__versions/select', {
      method: 'POST',
      headers: { origin: 'http://10.8.0.176:9030', 'content-type': 'application/json' },
      body: JSON.stringify({ version: 'other' })
    });
    assert.equal(invalidVersion.status, 400);

    const oversized = await request(publicServer.base, '/__versions/select', {
      method: 'POST',
      headers: { origin: 'http://10.8.0.176:9030', 'content-type': 'application/x-www-form-urlencoded' },
      body: `version=classic&padding=${'x'.repeat(ROUTER_TEST_BODY_LIMIT)}`
    });
    assert.equal(oversized.status, 413);

    const selected = await request(publicServer.base, '/__versions/select', {
      method: 'POST',
      headers: { origin: 'http://10.8.0.176:9030', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'version=current'
    });
    assert.equal(selected.status, 303);
    assert.equal(selected.headers.location, '/');
    assert.match(selected.headers['set-cookie'][0], /^design_copilot_version=current; Path=\/; HttpOnly; SameSite=Lax$/);
  } finally {
    await publicServer.close();
    await current.close();
    await classic.close();
  }
});

test('proxy preserves external semantics, streams binary bodies and filters hop-by-hop headers', async () => {
  let observed;
  const classic = await startServer(healthHandler('经典版'));
  const current = await startServer(async (incoming, response) => {
    if (incoming.url === '/healthz') return healthHandler('新版')(incoming, response);
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    observed = {
      method: incoming.method,
      url: incoming.url,
      headers: incoming.headers,
      body: Buffer.concat(chunks)
    };
    response.writeHead(207, {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="payload.bin"',
      'set-cookie': ['current_one=1; Path=/', 'current_two=2; Path=/'],
      connection: 'x-upstream-hop',
      'x-upstream-hop': 'remove-me',
      'x-end-to-end': 'kept'
    });
    response.write(observed.body.subarray(0, 3));
    response.end(observed.body.subarray(3));
  });
  const router = createVersionRouter(routerEnvironment(classic.port, current.port));
  const publicServer = await startServer(router.handler);
  try {
    const binary = Buffer.from([0, 1, 2, 3, 250, 251, 252, 253]);
    const proxied = await request(publicServer.base, '/api/upload?kind=binary%20asset', {
      method: 'PATCH',
      headers: {
        cookie: 'design_copilot_version=current',
        origin: 'http://10.8.0.176:9030',
        connection: 'x-client-hop',
        'x-client-hop': 'remove-me',
        'x-forwarded-host': 'attacker.invalid',
        'x-forwarded-proto': 'https',
        'content-type': 'application/octet-stream',
        'content-length': String(binary.length)
      },
      body: binary
    });
    assert.equal(proxied.status, 207);
    assert.deepEqual(proxied.body, binary);
    assert.equal(proxied.headers['content-disposition'], 'attachment; filename="payload.bin"');
    assert.deepEqual(proxied.headers['set-cookie'], ['current_one=1; Path=/', 'current_two=2; Path=/']);
    assert.equal(proxied.headers['x-end-to-end'], 'kept');
    assert.equal(proxied.headers['x-upstream-hop'], undefined);

    assert.equal(observed.method, 'PATCH');
    assert.equal(observed.url, '/api/upload?kind=binary%20asset');
    assert.deepEqual(observed.body, binary);
    assert.equal(observed.headers.host, '10.8.0.176:9030');
    assert.equal(observed.headers.origin, 'http://10.8.0.176:9030');
    assert.equal(observed.headers['x-forwarded-host'], '10.8.0.176:9030');
    assert.equal(observed.headers['x-forwarded-proto'], 'http');
    assert.equal(observed.headers['x-client-hop'], undefined);
  } finally {
    await publicServer.close();
    await current.close();
    await classic.close();
  }
});

test('an unavailable selected upstream returns an error page without silent fallback', async () => {
  let classicRequests = 0;
  const classic = await startServer((incoming, response) => {
    if (incoming.url === '/healthz') return healthHandler('经典版')(incoming, response);
    classicRequests += 1;
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('classic');
  });
  const temporary = await startServer(healthHandler('temporary'));
  const unavailablePort = temporary.port;
  await temporary.close();
  const router = createVersionRouter(routerEnvironment(classic.port, unavailablePort));
  const publicServer = await startServer(router.handler);
  try {
    const unavailable = await request(publicServer.base, '/project/demo', {
      headers: { cookie: 'design_copilot_version=current' }
    });
    assert.equal(unavailable.status, 502);
    assert.match(unavailable.body.toString('utf8'), /新版暂不可用/);
    assert.match(unavailable.body.toString('utf8'), /没有把本次请求自动降级/);
    assert.equal(classicRequests, 0);

    const defaultClassic = await request(publicServer.base, '/project/demo');
    assert.equal(defaultClassic.status, 200);
    assert.equal(defaultClassic.body.toString('utf8'), 'classic');
    assert.equal(classicRequests, 1);
  } finally {
    await publicServer.close();
    await classic.close();
  }
});

test('HTML injection is bounded and fails open for unsupported or incomplete responses', async () => {
  const small = Buffer.from('<html><body>small</body></html>');
  const incomplete = Buffer.from('<html><body>incomplete');
  const compressed = Buffer.from('<html><body>compressed</body></html>');
  const large = Buffer.from(`<html><body>${'x'.repeat(180)}</body></html>`);
  const chunkedLarge = Buffer.from(`<html><body>${'y'.repeat(180)}</body></html>`);
  const classic = await startServer((incoming, response) => {
    if (incoming.url === '/healthz') return healthHandler('经典版')(incoming, response);
    const bodies = { '/html': small, '/incomplete': incomplete, '/compressed': compressed, '/large': large, '/chunked-large': chunkedLarge, '/throw': small };
    const body = bodies[incoming.url] || small;
    const headers = { 'content-type': 'text/html; charset=utf-8', etag: 'old-etag' };
    if (incoming.url !== '/chunked-large') headers['content-length'] = String(body.length);
    if (incoming.url === '/compressed') headers['content-encoding'] = 'gzip';
    response.writeHead(200, headers);
    if (incoming.url === '/chunked-large') {
      response.write(body.subarray(0, 40));
      return response.end(body.subarray(40));
    }
    response.end(body);
  });
  const current = await startServer(healthHandler('新版'));
  const router = createVersionRouter(
    routerEnvironment(classic.port, current.port, { ROUTER_MAX_HTML_BYTES: '64' }),
    {
      htmlInjector(body, context) {
        if (context.pathname === '/throw') throw new Error('test injector failure');
        return injectHtmlBeforeBody(body, '<aside>router-hook</aside>');
      }
    }
  );
  const publicServer = await startServer(router.handler);
  try {
    const rewritten = await request(publicServer.base, '/html');
    assert.equal(rewritten.status, 200);
    assert.match(rewritten.body.toString('utf8'), /<aside>router-hook<\/aside><\/body>/);
    assert.equal(Number(rewritten.headers['content-length']), rewritten.body.length);
    assert.equal(rewritten.headers.etag, undefined);

    const incompleteResponse = await request(publicServer.base, '/incomplete');
    assert.deepEqual(incompleteResponse.body, incomplete);
    assert.equal(incompleteResponse.headers.etag, 'old-etag');

    const compressedResponse = await request(publicServer.base, '/compressed');
    assert.deepEqual(compressedResponse.body, compressed);
    assert.equal(compressedResponse.headers['content-encoding'], 'gzip');

    const largeResponse = await request(publicServer.base, '/large');
    assert.deepEqual(largeResponse.body, large);
    assert.equal(largeResponse.headers.etag, 'old-etag');

    const chunkedResponse = await request(publicServer.base, '/chunked-large');
    assert.deepEqual(chunkedResponse.body, chunkedLarge);

    const thrown = await request(publicServer.base, '/throw');
    assert.deepEqual(thrown.body, small);
    assert.equal(thrown.headers.etag, 'old-etag');
  } finally {
    await publicServer.close();
    await current.close();
    await classic.close();
  }
});
