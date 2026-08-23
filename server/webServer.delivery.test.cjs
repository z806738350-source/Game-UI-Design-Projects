// WEB-DELIVERY-01 负向集成测试：Web 直接下载 URL 是正式交付边界，必须与
// 桌面端共用 finalDeliveryGate。未过 Fidelity、未最终批准、视觉绑定漂移、
// Output 被篡改都必须返回 409；全部新鲜并批准时返回 200 且像素 hash 一致。
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const { hashBuffer, resolveProjectPath } = require('../electron/services/compositionRenderer.cjs');
const { createApplication } = require('./webServer.cjs');

async function startApplication() {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-web-delivery-'));
  const app = createApplication({
    HOST: '127.0.0.1',
    PORT: '0',
    PUBLIC_URL: 'http://127.0.0.1:9030',
    DESIGN_COPILOT_DATA_ROOT: dataRoot,
    SESSION_SECRET: 'delivery-gate-test-secret-0123456789abcdef' // gitleaks:allow 仅测试用假值，非真实密钥
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

const MANIFEST_ID = 'main-composition-final';

// 按“全部新鲜并批准”的交付就绪状态落 fixture；各负向用例在其上做单点破坏。
async function seedDeliveryFixture(app, { manifestStatus = 'approved', fidelityStatus = 'passed', manifestSource = {} } = {}) {
  const { projectStore } = app.context;
  const project = await projectStore.create({ name: 'Web Delivery', projectType: 'existing', requirement: 'Web export must respect the delivery gate.' });
  assert.equal(project.continuation_mode, 'existing-strict');
  const resolved = await projectStore.resolveProject(project.id);
  const png = await sharp({ create: { width: 32, height: 16, channels: 4, background: '#203060ff' } }).png().toBuffer();
  const outputPath = 'screens/main/compositions/final-v1.png';
  await fs.mkdir(path.dirname(resolveProjectPath(resolved.workspacePath, outputPath)), { recursive: true });
  await fs.writeFile(resolveProjectPath(resolved.workspacePath, outputPath), png);
  const hash = hashBuffer(png);
  await projectStore.saveArtifact(project.id, 'composition-manifest', {
    schema_version: '2.0', id: MANIFEST_ID, status: manifestStatus, mode: 'final', source: manifestSource,
    output: { path: outputPath, hash }
  }, { screenId: 'main' });
  await projectStore.saveArtifact(project.id, 'composition-output', {
    schema_version: '1.0', id: `${MANIFEST_ID}-output`, version: 1, status: 'generated', mode: 'final',
    path: outputPath, hash, width: 32, height: 16, byte_length: png.length,
    source: { composition_manifest: MANIFEST_ID }
  }, { screenId: 'main' });
  await projectStore.saveArtifact(project.id, 'fidelity-report', {
    schema_version: '1.0', id: 'main-fidelity-report', version: 1, status: fidelityStatus, issues: [],
    source: { composition_manifest: MANIFEST_ID, composition_output_hash: hash }
  }, { screenId: 'main' });
  return { project, resolved, outputPath, hash };
}

async function requestExport(app, projectId) {
  const response = await fetch(`${app.base}/api/projects/${encodeURIComponent(projectId)}/visual/v-1`, { headers: { cookie: app.cookie } });
  const body = Buffer.from(await response.arrayBuffer());
  return { response, body };
}

test('web strict export blocks delivery until fidelity, approval and pixels all line up', async () => {
  const app = await startApplication();
  try {
    // 1. 未运行 Fidelity（无 fidelity-report）→ 409。
    const { projectStore } = app.context;
    const bareProject = await projectStore.create({ name: 'Web No Fidelity', projectType: 'existing', requirement: 'No fidelity yet.' });
    const bareResolved = await projectStore.resolveProject(bareProject.id);
    const barePng = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#334455ff' } }).png().toBuffer();
    const barePath = 'screens/main/compositions/final-v1.png';
    await fs.mkdir(path.dirname(resolveProjectPath(bareResolved.workspacePath, barePath)), { recursive: true });
    await fs.writeFile(resolveProjectPath(bareResolved.workspacePath, barePath), barePng);
    const bareHash = hashBuffer(barePng);
    await projectStore.saveArtifact(bareProject.id, 'composition-manifest', {
      schema_version: '2.0', id: MANIFEST_ID, status: 'approved', mode: 'final', source: {}, output: { path: barePath, hash: bareHash }
    }, { screenId: 'main' });
    await projectStore.saveArtifact(bareProject.id, 'composition-output', {
      schema_version: '1.0', id: `${MANIFEST_ID}-output`, version: 1, status: 'generated', mode: 'final',
      path: barePath, hash: bareHash, width: 16, height: 16, byte_length: barePng.length, source: { composition_manifest: MANIFEST_ID }
    }, { screenId: 'main' });
    const blockedNoFidelity = await requestExport(app, bareProject.id);
    assert.equal(blockedNoFidelity.response.status, 409);
    assert.equal(JSON.parse(blockedNoFidelity.body.toString('utf8')).code, 'FINAL_EXPORT_BLOCKED');

    // 2. Fidelity stale（上游重合成后未重跑）→ 409。
    const staleFidelity = await seedDeliveryFixture(app, { fidelityStatus: 'stale' });
    const blockedStale = await requestExport(app, staleFidelity.project.id);
    assert.equal(blockedStale.response.status, 409);
    assert.equal(JSON.parse(blockedStale.body.toString('utf8')).code, 'FINAL_EXPORT_BLOCKED');

    // 3. Fidelity 新鲜但 Manifest 未最终批准 → 409 FINAL_APPROVAL_REQUIRED。
    const unapproved = await seedDeliveryFixture(app, { manifestStatus: 'generated' });
    const blockedApproval = await requestExport(app, unapproved.project.id);
    assert.equal(blockedApproval.response.status, 409);
    assert.equal(JSON.parse(blockedApproval.body.toString('utf8')).code, 'FINAL_APPROVAL_REQUIRED');

    // 4. 已批准的 Manifest 记录的是旧视觉评审（当前 Visual Results 已 V2）→ 409。
    const drifted = await seedDeliveryFixture(app, {
      manifestSource: { visual_results_version: 1, selected_variation_ids: ['v-1'], review_hash: 'old-review' }
    });
    await projectStore.saveArtifact(drifted.project.id, 'visual-results', {
      schema_version: '2.0', id: 'main-visual-results', version: 2, status: 'generated',
      variations: [{ id: 'v-1', strategy: 'conservative', image_url: 'https://kunpoapiimg.ziy.cc/v1.png', status: 'generated' }]
    }, { screenId: 'main' });
    const blockedDrift = await requestExport(app, drifted.project.id);
    assert.equal(blockedDrift.response.status, 409);
    assert.equal(JSON.parse(blockedDrift.body.toString('utf8')).code, 'VISUAL_RESULTS_BINDING_STALE');

    // 5. Output PNG 被篡改（hash 不再匹配 artifact）→ 409。
    const tampered = await seedDeliveryFixture(app);
    const tamperedPath = resolveProjectPath(tampered.resolved.workspacePath, tampered.outputPath);
    const replacement = await sharp({ create: { width: 32, height: 16, channels: 4, background: '#602020ff' } }).png().toBuffer();
    await fs.writeFile(tamperedPath, replacement);
    const blockedTampered = await requestExport(app, tampered.project.id);
    assert.equal(blockedTampered.response.status, 409);
    assert.equal(JSON.parse(blockedTampered.body.toString('utf8')).code, 'FINAL_EXPORT_BLOCKED');

    // 6. 全部新鲜并批准 → 200，响应字节 hash 与 Output artifact 一致。
    const ready = await seedDeliveryFixture(app);
    const delivered = await requestExport(app, ready.project.id);
    assert.equal(delivered.response.status, 200);
    assert.equal(delivered.response.headers.get('content-type'), 'image/png');
    assert.equal(delivered.response.headers.get('x-content-sha256'), ready.hash);
    assert.equal(hashBuffer(delivered.body), ready.hash);
  } finally {
    await app.close();
  }
});
