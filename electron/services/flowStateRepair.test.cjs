// M1b legacy repair: one-shot recovery for projects stuck by the pre-fix
// Layout—Style cycle (fix-plan P0-07). Strict eligibility, backup-first
// writes, ledger audit trail, and idempotency are all mandatory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectStore } = require('./projectStore.cjs');
const { createFlowStateRepair } = require('./flowStateRepair.cjs');
const { ERROR_CODES } = require('./errorCodes.cjs');

async function withWorkspace(prefix, body) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await body(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// 复刻旧版缺陷现场：布局先行路线上，风格重新生成把布局链路打成 stale。
async function seedStuckProject(root, { continuationMode = 'existing-guided', staleReason = 'style_contract_regenerated', canvasSpec, dropProposal = false } = {}) {
  const projectStore = createProjectStore({ workspaceRoot: root });
  const projectType = continuationMode ? 'existing' : 'new';
  let project = await projectStore.create({ name: 'Stuck Project', projectType, ...(continuationMode ? { continuationMode } : {}), requirement: 'Stuck by the legacy cycle.' });
  project = await projectStore.open(project.id, { screenId: 'main' });
  await projectStore.saveArtifact(project.id, 'screen-contract', {
    schema_version: '1.0', id: 'main-screen-contract', version: 1, status: 'approved', source: {},
    screen_id: 'main', screen_name: 'Main', purpose: 'Continue', primary_action: 'continue', required_controls: []
  }, { screenId: 'main' });
  await projectStore.saveArtifact(project.id, 'style-contract', {
    schema_version: '1.0', id: 'stuck-style-contract', version: 2, status: 'approved', source: {}
  });
  const proposals = dropProposal
    ? [{ id: 'proposal-other', name: '其他方案', strategy: 'balance', slots: [] }]
    : [{ id: 'proposal-efficiency', name: '效率优先', strategy: 'efficiency', slots: [] }];
  const staleAt = '2026-08-18T00:00:00.000Z';
  await projectStore.saveArtifact(project.id, 'layout-proposals', {
    schema_version: '1.0', id: 'main-layout-proposals', version: 2, status: 'stale', stale_at: staleAt, stale_reason: staleReason,
    source: {}, screen_id: 'main', proposals
  }, { screenId: 'main' });
  await projectStore.saveArtifact(project.id, 'approved-layout', {
    schema_version: '1.0', id: 'main-approved-layout-v1', version: 2, status: 'stale', stale_at: staleAt, stale_reason: staleReason,
    source: { source_proposal: 'proposal-efficiency' }, source_proposal: 'proposal-efficiency', label: '效率优先',
    canvas_spec: canvasSpec ?? project.canvas_spec, required_controls: [],
    proposal: { id: 'proposal-efficiency', name: '效率优先' }, slots: [],
    input_revisions: { ...(project.input_revisions || {}) }
  }, { screenId: 'main' });
  await projectStore.updateWorkflow(project.id, 'layout_design', 'stale', undefined, { screenId: 'main' });
  return { projectStore, project };
}

test('legacy cycle repair restores the layout chain with backup and ledger', async () => {
  await withWorkspace('copilot-repair-happy-', async (root) => {
    const { projectStore, project } = await seedStuckProject(root);
    const repair = createFlowStateRepair({ projectStore });

    const result = await repair.repairRouteCycle(project.id, { screenId: 'main' });
    assert.equal(result.repaired, true);
    assert.equal(result.previous_status.layout_proposals.status, 'stale');
    assert.equal(result.restored_status.approved_layout.status, 'approved');
    assert.ok(result.backup_paths.some((item) => item.includes('approved-layout.json')), 'approved layout must be backed up');

    const after = await projectStore.open(project.id, { screenId: 'main' });
    assert.equal(after.artifacts.approvedLayout.status, 'approved');
    assert.equal(after.artifacts.approvedLayout.stale_at, undefined);
    assert.equal(after.artifacts.approvedLayout.stale_reason, undefined);
    assert.notEqual(after.artifacts.layouts.status, 'stale', 'layout proposals must be restored out of stale');
    assert.equal(after.artifacts.layouts.stale_reason, undefined);
    assert.equal(after.workflow.stages.layout_design.status, 'approved');

    const ledgerPath = path.join(after.workspacePath, 'workflow', 'repairs', 'route-cycle-v1.json');
    const ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
    assert.equal(ledger.repairs.length, 1);
    assert.equal(ledger.repairs[0].repair_version, 'route-cycle-v1');
    assert.equal(ledger.repairs[0].validation.passed, true);

    // 幂等：重复执行不再改写，也不追加台账。
    const repeated = await repair.repairRouteCycle(project.id, { screenId: 'main' });
    assert.deepEqual(repeated, { repaired: false, already_repaired: true, screen_id: 'main' });
    const ledgerAfterRepeat = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
    assert.equal(ledgerAfterRepeat.repairs.length, 1, 'idempotent repair must not append duplicate ledger entries');
  });
});

test('repair refuses strict projects, wrong stale reasons, and drifted inputs', async () => {
  await withWorkspace('copilot-repair-strict-', async (root) => {
    const { projectStore, project } = await seedStuckProject(root, { continuationMode: 'existing-strict' });
    const repair = createFlowStateRepair({ projectStore });
    await assert.rejects(
      () => repair.repairRouteCycle(project.id, { screenId: 'main' }),
      (error) => error.code === ERROR_CODES.ROUTE_CYCLE_REPAIR_INELIGIBLE
    );
  });
  await withWorkspace('copilot-repair-reason-', async (root) => {
    const { projectStore, project } = await seedStuckProject(root, { staleReason: 'screen-contract_changed' });
    const repair = createFlowStateRepair({ projectStore });
    await assert.rejects(
      () => repair.repairRouteCycle(project.id, { screenId: 'main' }),
      (error) => error.code === ERROR_CODES.ROUTE_CYCLE_REPAIR_INELIGIBLE && /失效原因/.test(error.message)
    );
  });
  await withWorkspace('copilot-repair-canvas-', async (root) => {
    const { projectStore, project } = await seedStuckProject(root, { canvasSpec: { width: 999, height: 999 } });
    const repair = createFlowStateRepair({ projectStore });
    await assert.rejects(
      () => repair.repairRouteCycle(project.id, { screenId: 'main' }),
      (error) => error.code === ERROR_CODES.ROUTE_CYCLE_REPAIR_INELIGIBLE && /画布/.test(error.message)
    );
  });
  await withWorkspace('copilot-repair-proposal-', async (root) => {
    const { projectStore, project } = await seedStuckProject(root, { dropProposal: true });
    const repair = createFlowStateRepair({ projectStore });
    await assert.rejects(
      () => repair.repairRouteCycle(project.id, { screenId: 'main' }),
      (error) => error.code === ERROR_CODES.ROUTE_CYCLE_REPAIR_INELIGIBLE && /方案/.test(error.message)
    );
  });
});
