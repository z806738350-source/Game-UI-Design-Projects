// M4-I2（独立源码审核 §7/§8.3）：Screen Contract 的系统身份与证据字段
// 不得经通用 PATCH（Web Route 原样透传 body.patch）改写。Web 路由将
// { kind, patch } 直接交给 designPipeline.updateArtifact，因此该边界即
// API 边界；本测试按审核报告 §7.4 的 payload 形态直接提交伪造字段。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDesignPipeline } = require('./designPipeline.cjs');
const { createProjectStore } = require('./projectStore.cjs');

function approvedContractFixture() {
  return {
    schema_version: '1.0', id: 'main-screen-contract', version: 1, status: 'approved', source: {},
    screen_id: 'main', screen_name: '侠客阵容编成', purpose: '编成阵容', primary_action: '保存阵容',
    secondary_actions: [], required_information: [],
    required_controls: [{ id: 'save', role: 'action', required: true, label: '保存阵容' }],
    states: [], edge_cases: [], data_dependencies: [], design_constraints: {},
    source_inventory: { requirement_functions: ['保存阵容'], wireframe_controls: ['侠客立绘'], wireframe_information: [] },
    coverage: { covered_items: ['保存阵容', '侠客立绘'], uncovered_items: [] }
  };
}

test('M4-I2：系统字段伪造被静默忽略，设计师内容编辑与全量保存不受影响', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-field-allowlist-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    const project = await projectStore.create({ name: 'Field Allowlist', projectType: 'new', requirement: 'Protect system fields.' });
    await projectStore.saveArtifact(project.id, 'screen-contract', approvedContractFixture());
    const contractPath = path.join(project.workspacePath, 'screens', 'main', 'screen-contract.json');
    const before = JSON.parse(await fs.readFile(contractPath, 'utf8'));

    // 负向 1（审核 §7.4 形态）：伪造身份与来源清单，夹带合法内容编辑——
    // 系统字段被忽略，内容编辑生效，身份/来源清单不变，coverage 由服务端
    // 按原清单重算（伪造的空清单不得使留痕差异归零）。
    const edited = await pipeline.updateArtifact(project.id, 'screen-contract', {
      screenId: 'main',
      id: 'other-contract',
      screen_id: 'other',
      source_inventory: { requirement_functions: [], wireframe_controls: [], wireframe_information: [] },
      coverage: { covered_items: [], uncovered_items: [] },
      status: 'draft',
      approved_at: '1970-01-01T00:00:00.000Z',
      purpose: '调整后的编成目的'
    });
    const contract = edited.artifacts.screenContract;
    assert.equal(contract.id, 'main-screen-contract', 'Artifact 身份不得被 PATCH 改写');
    assert.equal(contract.screen_id, 'main', 'screen_id 不得被 PATCH 改写');
    assert.deepEqual(contract.source_inventory, before.source_inventory, 'source_inventory 不得被 PATCH 改写');
    assert.equal(contract.status, 'reviewed', 'status 由系统控制，编辑降级为 reviewed');
    assert.notEqual(contract.approved_at, '1970-01-01T00:00:00.000Z', 'approved_at 不得被 PATCH 伪造');
    assert.equal(contract.purpose, '调整后的编成目的', '设计师内容编辑照常生效');
    // 伪造的 coverage 被忽略：coverage 永远由服务端按原始清单重算——
    // 「侠客立绘」不在当前控件清单中，重算必须如实留痕；客户端伪造的
    // “全覆盖”不得生效。
    assert.deepEqual(contract.coverage.covered_items, ['保存阵容'], 'coverage 必须由服务端按原清单重算');
    assert.deepEqual(contract.coverage.uncovered_items, ['侠客立绘'], '未保留的来源条目必须如实留痕');

    // 负向 2：仅含系统字段的 PATCH 是整体 no-op——不升版本、不改字节、
    // 不动 Workflow。
    const bytesBefore = await fs.readFile(contractPath, 'utf8');
    const versionBefore = JSON.parse(bytesBefore).version;
    const statePath = path.join(project.workspacePath, 'workflow', 'state.json');
    const stateBefore = await fs.readFile(statePath, 'utf8');
    const noop = await pipeline.updateArtifact(project.id, 'screen-contract', {
      screenId: 'main',
      id: 'other-contract',
      screen_id: 'other',
      source_inventory: { requirement_functions: [], wireframe_controls: [], wireframe_information: [] }
    });
    assert.equal(noop.artifacts.screenContract.version, versionBefore, '仅系统字段的 PATCH 不得升版本');
    assert.equal(await fs.readFile(contractPath, 'utf8'), bytesBefore, '仅系统字段的 PATCH 不得改变 Artifact 字节');
    assert.equal(await fs.readFile(statePath, 'utf8'), stateBefore, '仅系统字段的 PATCH 不得改变 Workflow');

    // 正向：UI 全量保存形态（携带值不变的系统字段 + 设计师内容）不受白名单
    // 影响——保存成功且身份不变。
    const opened = await projectStore.open(project.id);
    const fullSave = await pipeline.updateArtifact(project.id, 'screen-contract', {
      screenId: 'main',
      ...opened.artifacts.screenContract,
      screen_name: '侠客阵容编成 · 改'
    });
    assert.equal(fullSave.artifacts.screenContract.id, 'main-screen-contract');
    assert.equal(fullSave.artifacts.screenContract.screen_name, '侠客阵容编成 · 改');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
