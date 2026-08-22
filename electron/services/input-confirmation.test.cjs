// AUD-08 负向回归：只改美术方向（art direction）的普通保存不得取消已确认
// 的设计意图（requirement_confirmed）；只有需求文本本身变化或显式传值才能
// 改变确认状态。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectStore } = require('./projectStore.cjs');

test('art-direction-only save preserves requirement confirmation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-aud08-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = root;
  try {
    const store = createProjectStore({ workspaceRoot: root });
    let project = await store.create({ name: 'AUD-08 Intent', projectType: 'new', requirement: '玩家需要在阵容页保存五名侠客。' });
    project = await store.saveProject(project.id, { requirementConfirmed: true });
    assert.equal(project.requirement_confirmed, true);
    const readStoredRevisions = async () => JSON.parse(await fs.readFile(path.join(project.workspacePath, 'project.json'), 'utf8')).input_revisions;
    const revisionBefore = (await readStoredRevisions()).art_direction;

    // 只改美术方向：不携带 requirementConfirmed 字段，确认状态必须保留，
    // 且 project.json 记录的 art_direction 修订正常递增。
    project = await store.saveProject(project.id, { artDirection: '水墨武侠，留白构图' });
    assert.equal(project.art_direction, '水墨武侠，留白构图');
    assert.equal(project.requirement_confirmed, true);
    assert.equal((await readStoredRevisions()).art_direction, revisionBefore + 1);

    // 显式传 false 才会取消确认（前端只在显式交互时使用）。
    project = await store.saveProject(project.id, { requirementConfirmed: false });
    assert.equal(project.requirement_confirmed, false);
    project = await store.saveProject(project.id, { requirementConfirmed: true });
    assert.equal(project.requirement_confirmed, true);

    // 需求文本变化而未显式确认 → 确认状态回到未确认（兜底语义）。
    project = await store.saveProject(project.id, { requirement: '玩家需要在阵容页保存六名侠客。' });
    assert.equal(project.requirement_confirmed, false);
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(root, { recursive: true, force: true });
  }
});
