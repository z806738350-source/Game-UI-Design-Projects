const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { IdentityStore, safeStaticPath, sanitizeForClient, signValue, verifySignedValue } = require('./webServer.cjs');

test('signed values reject tampering', () => {
  const secret = 'a'.repeat(64);
  const signed = signValue({ state: 'one', expiresAt: 10 }, secret);
  assert.deepEqual(verifySignedValue(signed, secret), { state: 'one', expiresAt: 10 });
  assert.equal(verifySignedValue(`${signed}x`, secret), null);
});

test('static paths stay inside dist root', () => {
  assert.equal(safeStaticPath('/srv/app/dist', '/assets/app.js'), '/srv/app/dist/assets/app.js');
  assert.equal(safeStaticPath('/srv/app/dist', '/../secret'), null);
});

test('client payload hides physical tenant paths', () => {
  const value = sanitizeForClient({
    workspacePath: '/var/lib/app/tenants/private/user/projects/demo',
    wireframe_path: '/var/lib/app/tenants/private/user/projects/demo/inputs/wireframe.png',
    reference_paths: ['/var/lib/app/tenants/private/user/projects/demo/style/references/a.png'],
    reference_assets: [{ path: '/var/lib/app/tenants/private/user/projects/demo/style/references/a.png' }]
  });
  assert.equal(value.workspacePath, '在线工作区');
  assert.equal(value.wireframe_path, 'inputs/wireframe');
  assert.deepEqual(value.reference_paths, ['a.png']);
  assert.equal(value.reference_assets[0].path, 'a.png');
  assert.doesNotMatch(JSON.stringify(value), /\/var\/lib|tenants\/private/);
});

test('identity mapping is stable and sessions expire safely', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-identity-'));
  const store = new IdentityStore(root, 'b'.repeat(64));
  const first = await store.tenantFor('tenant-a', 'user-a');
  const repeated = await store.tenantFor('tenant-a', 'user-a');
  const other = await store.tenantFor('tenant-a', 'user-b');
  assert.equal(first, repeated);
  assert.notEqual(first, other);
  const sessionId = await store.createSession(first);
  assert.equal((await store.readSession(sessionId)).tenant_id, first);
  await store.destroySession(sessionId);
  assert.equal(await store.readSession(sessionId), null);
  await fs.rm(root, { recursive: true, force: true });
});
