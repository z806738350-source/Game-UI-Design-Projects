// AUD-06 负向回归：Screen Contract 批准即完整确定性重验——批准边界不得
// 信任契约体内存储的 coverage；人工编辑删掉必需控件后，重算 coverage 必须
// 暴露遗漏并拒绝批准，而不是沿用旧 coverage 显示“0 项遗漏”放行。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDesignPipeline } = require('./designPipeline.cjs');
const { createProjectStore } = require('./projectStore.cjs');
const { ERROR_CODES } = require('./errorCodes.cjs');

test('screen-contract approval revalidates coverage instead of trusting stored coverage', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-aud06-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = root;
  try {
    const projectStore = createProjectStore({ workspaceRoot: root });
    const project = await projectStore.create({ name: 'AUD-06 Revalidation', projectType: 'existing', requirement: '批准必须重算覆盖。' });
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    const base = {
      schema_version: '2.0', id: 'main-screen-contract', status: 'generated',
      source: { input_revisions: { requirement: 0, wireframe: 0, art_direction: 0, references: 0 } },
      screen_id: 'main', screen_name: '阵容编成', purpose: '编成阵容', primary_action: '保存阵容',
      secondary_actions: [], required_information: [], states: [], edge_cases: [], data_dependencies: [],
      design_constraints: {}, source_inventory: { requirement_functions: ['保存阵容'], wireframe_controls: [], wireframe_information: [] }
    };
    // 完整覆盖的契约可以批准。
    await projectStore.saveArtifact(project.id, 'screen-contract', {
      ...base, version: 1,
      required_controls: [{ id: 'save-formation', label: '保存阵容', role: 'primary-action', required: true }],
      coverage: { covered_items: ['保存阵容'], uncovered_items: [] }
    }, { screenId: 'main' });
    const approved = await pipeline.approveArtifact(project.id, 'screen-contract', { screenId: 'main' });
    assert.equal(approved.artifacts.screenContract.status, 'approved');

    // 人工编辑删掉必需控件，但契约体里的旧 coverage 仍声称全部覆盖：
    // 批准必须按当前 source_inventory 重算 coverage 并拒绝。
    await pipeline.updateArtifact(project.id, 'screen-contract', { screenId: 'main', required_controls: [] });
    const edited = await projectStore.open(project.id, { screenId: 'main' });
    assert.notEqual(edited.artifacts.screenContract.status, 'approved');
    await assert.rejects(
      pipeline.approveArtifact(project.id, 'screen-contract', { screenId: 'main' }),
      (error) => error.code === ERROR_CODES.SCREEN_CONTRACT_COVERAGE_INCOMPLETE
    );
    const afterRejected = await projectStore.open(project.id, { screenId: 'main' });
    assert.notEqual(afterRejected.artifacts.screenContract.status, 'approved');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(root, { recursive: true, force: true });
  }
});
