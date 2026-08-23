// AUD-10 负向回归：Artifact 版本必须由存储层单调递增。模型或调用方传入的
// version 一律忽略；连续保存（含 status-only 保存如批准）不得出现重复或
// 回退版本，generation_id 也不得重复。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectStore } = require('./projectStore.cjs');

test('artifact versions increase monotonically regardless of caller-supplied version', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-aud10-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = root;
  try {
    const store = createProjectStore({ workspaceRoot: root });
    const project = await store.create({ name: 'AUD-10 Versions', projectType: 'new' });
    const base = {
      schema_version: '2.0', id: 'main-screen-contract', status: 'generated', source: {},
      screen_id: 'main', screen_name: '主页面', purpose: '主页面', primary_action: '主操作',
      secondary_actions: [], required_information: [], required_controls: [], states: [],
      edge_cases: [], data_dependencies: [], design_constraints: {},
      source_inventory: { requirement_functions: [], wireframe_controls: [], wireframe_information: [] },
      coverage: { covered_items: [], uncovered_items: [] }
    };
    const generations = new Set();
    let expected = 0;
    for (let index = 0; index < 5; index += 1) {
      // 调用方每次都声称固定版本（首版注入 version 99，模拟模型回传历史
      // 版本；其余轮次固定 1）：存储层必须忽略并基于上一版递增，
      // 首版一律落 V1。
      await store.saveArtifact(project.id, 'screen-contract', { ...base, version: index === 0 ? 99 : 1, purpose: `第 ${index + 1} 次保存` }, { screenId: 'main' });
      expected += 1;
      const snapshot = await store.open(project.id, { screenId: 'main' });
      const artifact = snapshot.artifacts.screenContract;
      assert.equal(artifact.version, expected);
      assert.ok(artifact.generation_id && !generations.has(artifact.generation_id), 'generation_id 不得重复');
      generations.add(artifact.generation_id);
    }
    // status-only 保存（如批准落盘）同样必须 bump 版本，不得原地覆盖。
    await store.saveArtifact(project.id, 'screen-contract', { ...base, version: 1, purpose: '第 5 次保存', status: 'approved', approved_at: '2026-08-23T00:00:00.000Z' }, { screenId: 'main' });
    const finalSnapshot = await store.open(project.id, { screenId: 'main' });
    assert.equal(finalSnapshot.artifacts.screenContract.version, expected + 1);
    assert.equal(finalSnapshot.artifacts.screenContract.status, 'approved');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(root, { recursive: true, force: true });
  }
});
