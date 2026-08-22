const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { writeJson, readJson } = require('./jsonStore.cjs');
const { MIGRATION_FAULT_POINTS, migrateProjectV2 } = require('./migrations.cjs');
const { createProjectStore } = require('./projectStore.cjs');

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes;
}

async function treeDigest(root) {
  const hash = crypto.createHash('sha256');
  async function visit(directory, relative = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const nextRelative = path.join(relative, entry.name);
      const absolute = path.join(directory, entry.name);
      hash.update(`${entry.isDirectory() ? 'd' : 'f'}:${nextRelative}\0`);
      if (entry.isDirectory()) await visit(absolute, nextRelative);
      else hash.update(await fs.readFile(absolute));
    }
  }
  await visit(root);
  return hash.digest('hex');
}

test('schema 1 project migrates to schema 2 without inventing font or component contracts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-migration-'));
  const projectPath = path.join(root, 'legacy');
  try {
    await writeJson(path.join(projectPath, 'project.json'), { schema_version: '1.0', id: 'legacy', name: 'Legacy', project_type: 'existing', screen_id: 'main', created_at: '2025-01-01T00:00:00.000Z' });
    await writeJson(path.join(projectPath, 'workflow', 'state.json'), { schema_version: '1.0', stages: { input: { status: 'approved' }, visual_exploration: { status: 'approved' } } });
    await fs.mkdir(path.join(projectPath, 'legacy-assets'), { recursive: true });
    await fs.writeFile(path.join(projectPath, 'legacy-assets', 'preserved.bin'), Buffer.from([1, 2, 3, 4]));
    const result = await migrateProjectV2(projectPath, { transactionId: 'success' });
    assert.equal(result.migrated, true);
    const project = await readJson(path.join(projectPath, 'project.json'));
    assert.equal(project.schema_version, '2.0');
    assert.equal(project.continuation_mode, 'existing-strict');
    assert.equal(await readJson(path.join(projectPath, 'style', 'font-manifest.json'), null), null);
    assert.equal(await readJson(path.join(projectPath, 'style', 'component-contract.json'), null), null);
    const state = await readJson(path.join(projectPath, 'workflow', 'state.json'));
    assert.equal(state.global_stages.typography_resolution.status, 'blocked');
    assert.equal(state.screen_stages.main.component_binding.status, 'blocked');
    const backupPointer = await readJson(path.join(projectPath, 'workflow', 'migration-backup-v1.json'));
    assert.equal(backupPointer.type, 'full-project-directory');
    assert.deepEqual(await fs.readFile(path.join(result.backupPath, 'legacy-assets', 'preserved.bin')), Buffer.from([1, 2, 3, 4]));
    const log = await readJson(path.join(projectPath, 'workflow', 'migration-log.json'));
    assert.equal(log[0].status, 'completed');
    assert.equal(log[0].backup, path.basename(result.backupPath));
    const backupsBeforeRepeat = (await fs.readdir(root)).filter((name) => name.includes('.backup-v1-')).length;
    const repeated = await migrateProjectV2(projectPath, { transactionId: 'must-not-run' });
    assert.equal(repeated.migrated, false);
    assert.equal((await fs.readdir(root)).filter((name) => name.includes('.backup-v1-')).length, backupsBeforeRepeat);
    assert.deepEqual((await createProjectStore({ workspaceRoot: root }).list()).map((item) => item.id), ['legacy']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('every migration write point restores the exact original tree and supports retry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-migration-faults-'));
  try {
    for (const faultPoint of MIGRATION_FAULT_POINTS) {
      const safePoint = faultPoint.replaceAll('-', '_');
      const projectPath = path.join(root, `legacy-${safePoint}`);
      await writeJson(path.join(projectPath, 'project.json'), { schema_version: '1.0', id: safePoint, name: safePoint, project_type: 'existing', screen_id: 'main' });
      await writeJson(path.join(projectPath, 'workflow', 'state.json'), { schema_version: '1.0', stages: { input: { status: 'approved' } } });
      await fs.mkdir(path.join(projectPath, 'nested'), { recursive: true });
      await fs.writeFile(path.join(projectPath, 'nested', 'evidence.bin'), Buffer.from(`evidence:${faultPoint}`));
      const before = await treeDigest(projectPath);
      await assert.rejects(
        migrateProjectV2(projectPath, { transactionId: `fault-${safePoint}`, faultAt: faultPoint }),
        (error) => error.code === 'MIGRATION_FAULT_INJECTED' && error.migration?.restored === true
      );
      assert.equal(await treeDigest(projectPath), before, `${faultPoint} changed the original project tree`);
      assert.equal((await readJson(path.join(projectPath, 'project.json'))).schema_version, '1.0');
      const failedLog = await readJson(`${projectPath}.migration-failed.json`);
      assert.equal(failedLog.status, 'failed');
      assert.equal(failedLog.fault_point, faultPoint);
      assert.equal(failedLog.recovery.restored, true);
      assert.equal(await pathExists(path.join(root, failedLog.backup, 'nested', 'evidence.bin')), true);
      const retried = await migrateProjectV2(projectPath, { transactionId: `retry-${safePoint}` });
      assert.equal(retried.migrated, true);
      assert.equal((await migrateProjectV2(projectPath)).migrated, false);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

async function pathExists(filePath) { return Boolean(await fs.stat(filePath).catch(() => null)); }

test('screen registry creates and switches independent screens', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-screens-'));
  try {
    const store = createProjectStore({ workspaceRoot: root });
    const project = await store.create({ name: 'Screens', projectType: 'new' });
    await store.saveProject(project.id, { screenId: 'main', requirement: '主页面需求', requirementConfirmed: true });
    await store.createScreen(project.id, { id: 'inventory', name: '背包' });
    const switched = await store.setActiveScreen(project.id, 'inventory');
    assert.equal(switched.active_screen_id, 'inventory');
    assert.equal(switched.screen_id, 'inventory');
    assert.equal(switched.screens.length, 2);
    await store.saveProject(project.id, { screenId: 'inventory', requirement: '背包页面独立需求', requirementConfirmed: true });
    const inventoryWireframe = path.join(root, 'inventory.png');
    await fs.writeFile(inventoryWireframe, pngHeader(1080, 1920));
    await store.importFile(project.id, inventoryWireframe, 'wireframe', { screenId: 'inventory' });
    await store.saveArtifact(project.id, 'screen-contract', { schema_version: '2.0', id: 'inventory-screen', version: 1, status: 'draft', source: {} });
    assert.ok(await readJson(path.join(project.workspacePath, 'screens', 'inventory', 'screen-contract.json')));
    assert.equal(await readJson(path.join(project.workspacePath, 'screens', 'main', 'screen-contract.json'), null), null);
    const main = await store.setActiveScreen(project.id, 'main');
    assert.equal(main.requirement, '主页面需求');
    assert.equal(main.wireframe_path, undefined);
    const inventory = await store.setActiveScreen(project.id, 'inventory');
    assert.equal(inventory.requirement, '背包页面独立需求');
    assert.match(inventory.wireframe_path, /screens\/inventory\/inputs\/wireframe\.png$/);
    const copy = await store.duplicateScreen(project.id, 'inventory', { id: 'inventory-copy', name: '背包副本' });
    assert.equal(copy.duplicated_from_screen_id, 'inventory');
    await assert.rejects(store.updateScreen(project.id, 'inventory', { status: 'archived' }), /Cannot archive the active screen/);
    await store.setActiveScreen(project.id, 'main');
    const archived = await store.updateScreen(project.id, 'inventory', { status: 'archived' });
    assert.equal(archived.status, 'archived');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

// P1-09：复制 Screen 必须执行 clone migration——副本 Artifact 获得新身份
// （新 id、新 screen_id、重写 source 引用），已批准事实不继承而降级为
// reviewed，原页产物保持不动。
test('duplicating a screen rewrites artifact identity and demotes approvals', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-clone-'));
  try {
    const store = createProjectStore({ workspaceRoot: root });
    const project = await store.create({ name: 'Clone', projectType: 'new' });
    await store.createScreen(project.id, { id: 'inventory', name: '背包' });
    await store.saveArtifact(project.id, 'screen-contract', {
      schema_version: '2.0', id: 'inventory-screen-contract-v1', version: 1, status: 'approved',
      approved_at: '2026-08-01T00:00:00.000Z', screen_id: 'inventory',
      source: { wireframe: 'screens/inventory/inputs/wireframe.png' },
      purpose: '背包页面'
    }, { screenId: 'inventory' });
    await store.updateWorkflow(project.id, 'wireframe_interpretation', 'approved', 'screens/inventory/screen-contract.json', { screenId: 'inventory' });
    await store.duplicateScreen(project.id, 'inventory', { id: 'inventory-copy', name: '背包副本' });
    const copyContract = await readJson(path.join(project.workspacePath, 'screens', 'inventory-copy', 'screen-contract.json'));
    assert.equal(copyContract.id, 'inventory-copy-screen-contract-v1');
    assert.equal(copyContract.screen_id, 'inventory-copy');
    assert.equal(copyContract.source.wireframe, 'screens/inventory-copy/inputs/wireframe.png');
    assert.equal(copyContract.status, 'reviewed');
    assert.equal(copyContract.approved_at, undefined);
    assert.equal(copyContract.purpose, '背包页面');
    const original = await readJson(path.join(project.workspacePath, 'screens', 'inventory', 'screen-contract.json'));
    assert.equal(original.id, 'inventory-screen-contract-v1');
    assert.equal(original.status, 'approved');
    const state = await readJson(path.join(project.workspacePath, 'workflow', 'state.json'));
    assert.equal(state.screen_stages['inventory-copy'].wireframe_interpretation.status, 'reviewed');
    assert.equal(state.screen_stages.inventory.wireframe_interpretation.status, 'approved');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

// AUD-13：clone 身份重写必须完整——引用数组元素（selected_variation_ids）、
// source_proposal、嵌套 source 引用与 workflow stage 的 output 路径都不得
// 残留原 Screen 身份。
test('duplicating a screen rewrites nested references, arrays and workflow paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-clone-deep-'));
  try {
    const store = createProjectStore({ workspaceRoot: root });
    const project = await store.create({ name: 'Clone Deep', projectType: 'new' });
    await store.createScreen(project.id, { id: 'inventory', name: '背包' });
    await store.saveArtifact(project.id, 'layout-proposals', {
      schema_version: '1.0', id: 'inventory-layout-proposals', version: 1, status: 'approved', screen_id: 'inventory',
      source: {}, proposals: [{ id: 'inventory-proposal-a', name: '方案一' }]
    }, { screenId: 'inventory' });
    await store.saveArtifact(project.id, 'approved-layout', {
      schema_version: '1.0', id: 'inventory-approved-layout-v1', version: 1, status: 'approved', screen_id: 'inventory',
      source: { layout_proposals: 'inventory-layout-proposals', source_proposal: 'inventory-proposal-a' },
      source_proposal: 'inventory-proposal-a', label: '方案一'
    }, { screenId: 'inventory' });
    await store.saveArtifact(project.id, 'visual-results', {
      schema_version: '2.0', id: 'inventory-visual-results', version: 1, status: 'approved', screen_id: 'inventory',
      source: { visual_task: 'inventory-visual-task' },
      variations: [{ id: 'inventory-v1', strategy: 'conservative', image_path: 'screens/inventory/explorations/inventory-v1.png' }],
      review: { mode: 'selected', selected_variation_ids: ['inventory-v1'], notes: '选 V1' }
    }, { screenId: 'inventory' });
    await store.saveArtifact(project.id, 'composition-manifest', {
      schema_version: '2.0', id: 'inventory-composition-final', version: 1, status: 'approved', screen_id: 'inventory',
      source: { visual_results: 'inventory-visual-results', selected_variation_ids: ['inventory-v1'], approved_layout: 'inventory-approved-layout-v1' },
      underlay: { path: 'screens/inventory/explorations/inventory-v1.png' }
    }, { screenId: 'inventory' });
    await store.updateWorkflow(project.id, 'composition', 'approved', 'screens/inventory/composition-output.json', { screenId: 'inventory' });
    await store.duplicateScreen(project.id, 'inventory', { id: 'inventory-copy', name: '背包副本' });
    const copyPath = (relative) => path.join(project.workspacePath, 'screens', 'inventory-copy', relative);

    // 引用数组元素与 source 引用都指向副本身份；物理图片文件随目录复制保留
    // 原文件名，路径只重写目录部分。
    const copyVisual = await readJson(copyPath('explorations/results.json'));
    assert.deepEqual(copyVisual.review.selected_variation_ids, ['inventory-copy-v1']);
    assert.equal(copyVisual.variations[0].id, 'inventory-copy-v1');
    assert.equal(copyVisual.variations[0].image_path, 'screens/inventory-copy/explorations/inventory-v1.png');
    assert.equal(copyVisual.source.visual_task, 'inventory-copy-visual-task');
    const copyManifest = await readJson(copyPath('composition-manifest.json'));
    assert.deepEqual(copyManifest.source.selected_variation_ids, ['inventory-copy-v1']);
    assert.equal(copyManifest.source.approved_layout, 'inventory-copy-approved-layout-v1');
    assert.equal(copyManifest.underlay.path, 'screens/inventory-copy/explorations/inventory-v1.png');

    // source_proposal 指向副本 Proposal（副本 proposals 同步重写）。
    const copyApproved = await readJson(copyPath('approved-layout.json'));
    const copyProposals = await readJson(copyPath('layout-proposals.json'));
    assert.equal(copyApproved.source_proposal, 'inventory-copy-proposal-a');
    assert.equal(copyApproved.source.source_proposal, 'inventory-copy-proposal-a');
    assert.deepEqual(copyProposals.proposals.map((proposal) => proposal.id), ['inventory-copy-proposal-a']);

    // workflow stage 的 output 路径同样重写。
    const state = await readJson(path.join(project.workspacePath, 'workflow', 'state.json'));
    assert.equal(state.screen_stages['inventory-copy'].composition.output, 'screens/inventory-copy/composition-output.json');

    // 全部副本 Screen Artifact 中不得残留任何原 Screen id 的非 provenance 引用；
    // 目录已重写但保留原文件名的物理资产路径除外。
    for (const relative of ['screen-contract.json', 'layout-proposals.json', 'approved-layout.json', 'component-bindings.json', 'reference-pack.json', 'underlay-contract.json', 'underlay-critique.json', 'underlay-repair-task.json', 'composition-manifest.json', 'composition-output.json', 'fidelity-report.json', 'visual-task.json', 'explorations/results.json']) {
      const artifact = await readJson(copyPath(relative), null);
      if (!artifact) continue;
      const serialized = JSON.stringify(artifact)
        .replaceAll('screens/inventory-copy/explorations/inventory-v1.png', 'ASSET')
        .replaceAll('inventory-copy', 'COPY');
      assert.equal(serialized.includes('inventory'), false, `${relative} 残留原 Screen 身份`);
    }
    // 原页产物保持不动。
    const originalVisual = await readJson(path.join(project.workspacePath, 'screens', 'inventory', 'explorations', 'results.json'));
    assert.deepEqual(originalVisual.review.selected_variation_ids, ['inventory-v1']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
