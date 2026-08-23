const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDesignPipeline } = require('./designPipeline.cjs');
const { createProjectStore } = require('./projectStore.cjs');
const { ERROR_CODES } = require('./errorCodes.cjs');

// M4-F3 / AUD-06：已批准 Contract 的 label-only 编辑不得绕过批准重验。
// 保持 approved 的前提是写入前用与批准相同的确定性链路
//（normalize → recomputeCoverage → validateArtifact）重验通过。

function approvedContractFixture() {
  return {
    schema_version: '1.0', id: 'main-screen-contract', version: 1, status: 'approved', source: {},
    screen_id: 'main', screen_name: '侠客阵容编成', purpose: '编成阵容', primary_action: '保存阵容',
    secondary_actions: [], required_information: [],
    required_controls: [{ id: 'save', role: 'action', required: true, label: '保存阵容' }],
    states: [], edge_cases: [], data_dependencies: [], design_constraints: {},
    source_inventory: { requirement_functions: ['保存阵容'], wireframe_controls: [], wireframe_information: [] },
    coverage: { covered_items: ['保存阵容'], uncovered_items: [] }
  };
}

test('AUD-06：已批准 Contract 的 label-only 编辑走批准同链重验', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-label-gate-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    const project = await projectStore.create({ name: 'Label Gate', projectType: 'new', requirement: 'Save the party.' });
    await projectStore.saveArtifact(project.id, 'screen-contract', approvedContractFixture());

    // 负向：把 label 改成与 source_inventory 无关的文案，coverage 失真，
    // 必须拒绝保存且 Contract 保持原版本、原批准状态。
    await assert.rejects(
      pipeline.updateArtifact(project.id, 'screen-contract', {
        screenId: 'main',
        required_controls: [{ id: 'save', role: 'action', required: true, label: '删除角色' }]
      }),
      (error) => error.code === ERROR_CODES.SCREEN_CONTRACT_COVERAGE_INCOMPLETE
    );
    let refused = await projectStore.open(project.id);
    assert.equal(refused.artifacts.screenContract.status, 'approved');
    assert.equal(refused.artifacts.screenContract.version, 1);
    assert.equal(refused.artifacts.screenContract.required_controls[0].label, '保存阵容');

    // 正向：label 仍覆盖 source 语义（“保存阵容确认”包含“保存阵容”），
    // 保持 approved，且 coverage 按新 label 重算、版本单调上升。
    const edited = await pipeline.updateArtifact(project.id, 'screen-contract', {
      screenId: 'main',
      required_controls: [{ id: 'save', role: 'action', required: true, label: '保存阵容确认' }]
    });
    assert.equal(edited.artifacts.screenContract.status, 'approved');
    assert.equal(edited.artifacts.screenContract.version, 2);
    assert.equal(edited.artifacts.screenContract.required_controls[0].label, '保存阵容确认');
    assert.deepEqual(edited.artifacts.screenContract.coverage.uncovered_items, []);
    assert.ok(edited.artifacts.screenContract.coverage.covered_items.includes('保存阵容'));

    // 对照组：未批准（reviewed）的 Contract 不受该门禁限制，破坏性
    // label 编辑仍可保存（其批准时会被批准重验拦截）。
    await projectStore.saveArtifact(project.id, 'screen-contract', { ...approvedContractFixture(), status: 'reviewed' });
    const reviewedEdit = await pipeline.updateArtifact(project.id, 'screen-contract', {
      screenId: 'main',
      required_controls: [{ id: 'save', role: 'action', required: true, label: '删除角色' }]
    });
    assert.equal(reviewedEdit.artifacts.screenContract.status, 'reviewed');
    assert.equal(reviewedEdit.artifacts.screenContract.required_controls[0].label, '删除角色');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
