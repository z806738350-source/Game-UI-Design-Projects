// AUD-07 负向集成测试：Web 端 POST /reference 必须与桌面端语义一致——
// 无变化的 blur/重复操作是 no-op，不得失效已批准的 Style 下游链；真实
// 变化仍然传播失效。修复前 Web 端无条件调用 invalidateFromInputChange。
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createApplication } = require('./webServer.cjs');

async function startApplication() {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-web-reference-'));
  const app = createApplication({
    HOST: '127.0.0.1',
    PORT: '0',
    PUBLIC_URL: 'http://127.0.0.1:9031',
    DESIGN_COPILOT_DATA_ROOT: dataRoot,
    SESSION_SECRET: 'reference-noop-test-secret-0123456789abcdef' // gitleaks:allow 仅测试用假值，非真实密钥
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
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(dataRoot, { recursive: true, force: true });
    }
  };
}

async function postReference(app, projectId, input) {
  const response = await fetch(`${app.base}/api/projects/${encodeURIComponent(projectId)}/reference`, {
    method: 'POST',
    headers: { cookie: app.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  return { response, body: JSON.parse(await response.text()) };
}

test('web reference no-op keeps approved style fresh; real change still invalidates', async () => {
  const app = await startApplication();
  try {
    const { projectStore } = app.context;
    const project = await projectStore.create({ name: 'Web Reference Noop', projectType: 'existing', requirement: 'No-op must not stale the style chain.' });
    const resolved = await projectStore.resolveProject(project.id);
    // 直接落两张参考图与已批准 Style，构造「下游新鲜」的初始状态。
    const projectJsonPath = path.join(resolved.workspacePath, 'project.json');
    const projectJson = JSON.parse(await fs.readFile(projectJsonPath, 'utf8'));
    projectJson.reference_assets = [
      { id: 'ref-1', path: 'style/references/a.png', name: 'a.png', role: 'primary', approved: true },
      { id: 'ref-2', path: 'style/references/b.png', name: 'b.png', role: 'supporting' }
    ];
    await fs.writeFile(projectJsonPath, JSON.stringify(projectJson, null, 2));
    await projectStore.saveArtifact(project.id, 'style-contract', { schema_version: '1.0', id: 'style-1', version: 1, status: 'approved', source: {} }, { screenId: 'main' });

    // 1. no-op（重复批准已批准项）→ Style 保持 approved。
    const noopApproval = await postReference(app, project.id, { id: 'ref-1', action: 'approval', approved: true });
    assert.equal(noopApproval.response.status, 200);
    assert.equal(noopApproval.body.artifacts.styleContract.status, 'approved');

    // 2. no-op（首张上移越界）→ Style 保持 approved。
    const noopMove = await postReference(app, project.id, { id: 'ref-1', action: 'move', direction: 'up' });
    assert.equal(noopMove.response.status, 200);
    assert.equal(noopMove.body.artifacts.styleContract.status, 'approved');

    // 3. 对照组：真实变化（取消批准）仍然失效 Style。
    const realChange = await postReference(app, project.id, { id: 'ref-1', action: 'approval', approved: false });
    assert.equal(realChange.response.status, 200);
    assert.equal(realChange.body.artifacts.styleContract.status, 'stale');
  } finally {
    await app.close();
  }
});
