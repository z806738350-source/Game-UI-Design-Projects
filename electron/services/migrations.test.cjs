const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { writeJson, readJson } = require('./jsonStore.cjs');
const { migrateProjectV2 } = require('./migrations.cjs');
const { createProjectStore } = require('./projectStore.cjs');

test('schema 1 project migrates to schema 2 without inventing font or component contracts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-migration-'));
  const projectPath = path.join(root, 'legacy');
  try {
    await writeJson(path.join(projectPath, 'project.json'), { schema_version: '1.0', id: 'legacy', name: 'Legacy', project_type: 'existing', screen_id: 'main', created_at: '2025-01-01T00:00:00.000Z' });
    await writeJson(path.join(projectPath, 'workflow', 'state.json'), { schema_version: '1.0', stages: { input: { status: 'approved' }, visual_exploration: { status: 'approved' } } });
    const result = await migrateProjectV2(projectPath);
    assert.equal(result.migrated, true);
    const project = await readJson(path.join(projectPath, 'project.json'));
    assert.equal(project.schema_version, '2.0');
    assert.equal(project.continuation_mode, 'existing-strict');
    assert.equal(await readJson(path.join(projectPath, 'style', 'font-manifest.json'), null), null);
    assert.equal(await readJson(path.join(projectPath, 'style', 'component-contract.json'), null), null);
    const state = await readJson(path.join(projectPath, 'workflow', 'state.json'));
    assert.equal(state.global_stages.typography_resolution.status, 'blocked');
    assert.equal(state.screen_stages.main.component_binding.status, 'blocked');
    assert.ok(await readJson(path.join(projectPath, 'workflow', 'migration-backup-v1.json')));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('screen registry creates and switches independent screens', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-screens-'));
  try {
    const store = createProjectStore({ workspaceRoot: root });
    const project = await store.create({ name: 'Screens', projectType: 'new' });
    await store.createScreen(project.id, { id: 'inventory', name: '背包' });
    const switched = await store.setActiveScreen(project.id, 'inventory');
    assert.equal(switched.active_screen_id, 'inventory');
    assert.equal(switched.screen_id, 'inventory');
    assert.equal(switched.screens.length, 2);
    await store.saveArtifact(project.id, 'screen-contract', { schema_version: '2.0', id: 'inventory-screen', version: 1, status: 'draft', source: {} });
    assert.ok(await readJson(path.join(project.workspacePath, 'screens', 'inventory', 'screen-contract.json')));
    assert.equal(await readJson(path.join(project.workspacePath, 'screens', 'main', 'screen-contract.json'), null), null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
