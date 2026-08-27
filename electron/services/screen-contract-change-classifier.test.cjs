// M4-J1（M4-I 复审 §7/§9/§10）：Screen Contract 变更四类分类器
//（semantic / label-only / review-only / noop）。secondary_actions /
// data_dependencies / design_constraints 属语义变化，必须完整传播失效并
// 清除批准印记；仅审查元数据不得破坏生产链；完全相同保存整体 no-op；
// 系统字段 no-op 也须先通过 Screen 上下文校验。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDesignPipeline } = require('./designPipeline.cjs');
const { createProjectStore } = require('./projectStore.cjs');
const { ERROR_CODES } = require('./errorCodes.cjs');

function approvedContractFixture() {
  return {
    schema_version: '1.0', id: 'main-screen-contract', version: 1, status: 'approved', source: {},
    approved_at: '2026-08-27T00:00:00.000Z', approval: { by: 'designer' },
    screen_id: 'main', screen_name: '侠客阵容编成', purpose: '编成阵容', primary_action: '保存阵容',
    secondary_actions: [], required_information: [],
    required_controls: [{ id: 'save', role: 'action', required: true, label: '保存阵容' }],
    states: [], edge_cases: [], data_dependencies: [], design_constraints: { density: 'balanced' },
    source_inventory: { requirement_functions: ['保存阵容'], wireframe_controls: [], wireframe_information: [] },
    coverage: { covered_items: ['保存阵容'], uncovered_items: [] }
  };
}

function layoutsFixture() {
  return { schema_version: '1.0', id: 'layouts', version: 1, status: 'approved', source: {}, proposals: [] };
}

function manifestFixture() {
  return { schema_version: '1.0', id: 'main-composition-manifest', version: 1, status: 'approved', source: {}, layers: [] };
}

async function setupClassifierProject() {
  const projectStore = createProjectStore();
  const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
  const project = await projectStore.create({ name: 'Change Classifier', projectType: 'new', requirement: 'Classify changes.' });
  await projectStore.saveArtifact(project.id, 'screen-contract', approvedContractFixture());
  await projectStore.saveArtifact(project.id, 'layout-proposals', layoutsFixture());
  await projectStore.saveArtifact(project.id, 'composition-manifest', manifestFixture());
  return { projectStore, pipeline, projectId: project.id };
}

test('M4-J1：semantic 键（含补齐的三字段）完整传播失效并清除批准印记', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-classifier-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const semanticEdits = [
      { secondary_actions: ['返回', '帮助'] },
      { data_dependencies: ['侠客图鉴'] },
      { design_constraints: { density: 'dense' } }
    ];
    for (const patch of semanticEdits) {
      const { pipeline, projectId } = await setupClassifierProject();
      const updated = await pipeline.updateArtifact(projectId, 'screen-contract', { screenId: 'main', ...patch });
      const contract = updated.artifacts.screenContract;
      const key = Object.keys(patch)[0];
      assert.equal(contract.status, 'reviewed', `${key} 语义编辑后契约必须降级`);
      assert.equal(contract.approved_at, undefined, `${key} 语义编辑必须清除旧 approved_at`);
      assert.equal(contract.approval, undefined, `${key} 语义编辑必须清除旧 approval`);
      assert.equal(updated.artifacts.layouts.status, 'stale', `${key} 语义编辑必须使布局链失效`);
    }
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('M4-J1：review_metadata-only 保存不失效任何生产 Artifact（审核 §9）', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-review-only-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const { pipeline, projectId } = await setupClassifierProject();
    const updated = await pipeline.updateArtifact(projectId, 'screen-contract', { screenId: 'main', review_metadata: { required_controls: ['confirmed'] } });
    assert.equal(updated.artifacts.screenContract.status, 'approved', '审查元数据不改变契约状态');
    assert.equal(updated.artifacts.screenContract.version, 2, '审查元数据保存照常升版本');
    assert.deepEqual(updated.artifacts.screenContract.review_metadata, { required_controls: ['confirmed'] });
    assert.equal(updated.artifacts.layouts.status, 'approved', '布局不得因审查元数据失效');
    assert.equal(updated.artifacts.compositionManifest.status, 'approved', '合成链不得因审查元数据失效');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('M4-J1：规范化后完全相同的保存是整体 no-op；label-only 仍只失效合成链', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-noop-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const { projectStore, pipeline, projectId } = await setupClassifierProject();
    const resolved = await projectStore.resolveProject(projectId);
    const contractPath = path.join(resolved.workspacePath, 'screens', 'main', 'screen-contract.json');
    const statePath = path.join(resolved.workspacePath, 'workflow', 'state.json');
    const contractBefore = await fs.readFile(contractPath, 'utf8');
    const stateBefore = await fs.readFile(statePath, 'utf8');
    // UI 全量保存形态：内容与存储完全一致 → 不升版本、不写文件、不动
    // Workflow、不 stale 下游。
    const noop = await pipeline.updateArtifact(projectId, 'screen-contract', { screenId: 'main', ...JSON.parse(contractBefore) });
    assert.equal(noop.artifacts.screenContract.version, 1, '完全相同保存不得升版本');
    assert.equal(await fs.readFile(contractPath, 'utf8'), contractBefore, '完全相同保存不得改写 Artifact 字节');
    assert.equal(await fs.readFile(statePath, 'utf8'), stateBefore, '完全相同保存不得改写 Workflow');
    assert.equal(noop.artifacts.compositionManifest.status, 'approved', '完全相同保存不得失效合成链');
    // label-only：仅改 label 仍保持 approved、绑定语义不变，但合成链失效。
    const labeled = await pipeline.updateArtifact(projectId, 'screen-contract', {
      screenId: 'main',
      required_controls: [{ id: 'save', role: 'action', required: true, label: '保存阵容确认' }]
    });
    assert.equal(labeled.artifacts.screenContract.status, 'approved', 'label-only 编辑保持 approved');
    assert.equal(labeled.artifacts.layouts.status, 'approved', 'label-only 编辑不失效布局');
    assert.equal(labeled.artifacts.compositionManifest.status, 'stale', 'label-only 编辑失效合成链');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('M4-J1（审核 §10）：仅系统字段的 PATCH 先经 Screen 上下文校验再整体 no-op', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-noop-context-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const { pipeline, projectId } = await setupClassifierProject();
    await assert.rejects(
      pipeline.updateArtifact(projectId, 'screen-contract', { screenId: 'ghost', id: 'forged-only' }),
      (error) => error.code === ERROR_CODES.SCREEN_NOT_FOUND
    );
    // 合法 Screen 上的系统字段 PATCH：上下文校验通过后整体 no-op。
    const noop = await pipeline.updateArtifact(projectId, 'screen-contract', { screenId: 'main', id: 'forged-only', source_inventory: { requirement_functions: [], wireframe_controls: [], wireframe_information: [] } });
    assert.equal(noop.artifacts.screenContract.version, 1, '系统字段 PATCH 不得升版本');
    assert.equal(noop.artifacts.screenContract.id, 'main-screen-contract');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
