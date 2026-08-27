// 设计师权威语义回归：source_inventory 超集约束仅作用于生成期
// （kunpoClient 草稿修复）；审查/批准阶段以设计师调整结果为准确答案，
// 覆盖差异重算写回作留痕信息，不再拦截批准。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDesignPipeline } = require('./designPipeline.cjs');
const { createProjectStore } = require('./projectStore.cjs');

test('screen-contract approval treats coverage as traceability, not a gate', async () => {
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

    // 人工编辑删掉必需控件：保存与批准均放行（设计师调整结果为准确答案），
    // 覆盖差异如实写回作留痕信息。
    await pipeline.updateArtifact(project.id, 'screen-contract', { screenId: 'main', required_controls: [] });
    const edited = await projectStore.open(project.id, { screenId: 'main' });
    assert.notEqual(edited.artifacts.screenContract.status, 'approved');
    // 保存路径与快照共用同一重算事实来源：声称“0 项遗漏”的旧 coverage 不得存活。
    assert.deepEqual(edited.artifacts.screenContract.coverage.uncovered_items, ['保存阵容']);
    assert.deepEqual(edited.artifacts.screenContract.coverage.covered_items, []);
    const approvedAfterTrim = await pipeline.approveArtifact(project.id, 'screen-contract', { screenId: 'main' });
    assert.equal(approvedAfterTrim.artifacts.screenContract.status, 'approved');
    assert.deepEqual(approvedAfterTrim.artifacts.screenContract.coverage.uncovered_items, ['保存阵容']);
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(root, { recursive: true, force: true });
  }
});

// 现场不一致回归：历史项目存储体里残留草稿期“全覆盖” coverage 时，
// 快照打开必须按当前 source_inventory 重算，让工作台覆盖条如实显示遗漏，
// 而不是把假绿灯透传给前端。
test('project snapshot recomputes stale stored coverage on open', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-aud06-snapshot-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = root;
  try {
    const projectStore = createProjectStore({ workspaceRoot: root });
    const project = await projectStore.create({ name: 'AUD-06 Snapshot', projectType: 'existing', requirement: '快照必须重算旧 coverage。' });
    await projectStore.saveArtifact(project.id, 'screen-contract', {
      schema_version: '2.0', id: 'main-screen-contract', status: 'reviewed', version: 1,
      source: { input_revisions: { requirement: 0, wireframe: 0, art_direction: 0, references: 0 } },
      screen_id: 'main', screen_name: '阵容编成', purpose: '编成阵容', primary_action: '保存阵容',
      secondary_actions: [], required_information: [], required_controls: [], states: [], edge_cases: [], data_dependencies: [],
      design_constraints: {}, source_inventory: { requirement_functions: ['保存阵容'], wireframe_controls: [], wireframe_information: [] },
      coverage: { covered_items: ['保存阵容'], uncovered_items: [] }
    }, { screenId: 'main' });
    const opened = await projectStore.open(project.id, { screenId: 'main' });
    assert.deepEqual(opened.artifacts.screenContract.coverage.uncovered_items, ['保存阵容']);
    assert.deepEqual(opened.artifacts.screenContract.coverage.covered_items, []);
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(root, { recursive: true, force: true });
  }
});
