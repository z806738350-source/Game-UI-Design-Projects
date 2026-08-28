// M4-L（M4-K 复审 §6/§7）：Clone 并发事务隔离与复制中途失败即时清理。
// 项目级写锁把同项目对 screens/index.json 与 workflow/state.json 的全部
// 写者串行化：并发不同 ID 全部保留、同 ID 仅一个胜出、失败事务不回滚
// 他人已发布结果、Create+Duplicate 并发不丢条目；fs.cp 中途失败的部分
// 目录在首次失败时立即删除且重试成功。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectStore } = require('./projectStore.cjs');

async function setupProject(name) {
  const projectStore = createProjectStore();
  const project = await projectStore.create({ name, projectType: 'new', requirement: 'Concurrency isolation.' });
  return { projectStore, project };
}

test('M4-L：不同目标 ID 的并发 Clone 全部保留（无丢失更新）', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-conc-diff-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const { projectStore, project } = await setupProject('Conc Diff');
    await Promise.all([
      projectStore.duplicateScreen(project.id, 'main', { id: 'battle' }),
      projectStore.duplicateScreen(project.id, 'main', { id: 'shop' })
    ]);
    const registry = await projectStore.listScreens(project.id);
    assert.ok(registry.screens.some((screen) => screen.id === 'battle'), 'battle 条目不得丢失');
    assert.ok(registry.screens.some((screen) => screen.id === 'shop'), 'shop 条目不得丢失');
    const resolved = await projectStore.resolveProject(project.id);
    const state = JSON.parse(await fs.readFile(path.join(resolved.workspacePath, 'workflow', 'state.json'), 'utf8'));
    assert.ok(state.screen_stages.battle, 'battle 的 workflow stage 不得被覆盖丢失');
    assert.ok(state.screen_stages.shop, 'shop 的 workflow stage 不得被覆盖丢失');
    assert.ok(await fs.stat(path.join(resolved.workspacePath, 'screens', 'battle')).catch(() => null));
    assert.ok(await fs.stat(path.join(resolved.workspacePath, 'screens', 'shop')).catch(() => null));
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('M4-L：相同目标 ID 的并发 Clone 只有一个胜出', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-conc-same-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const { projectStore, project } = await setupProject('Conc Same');
    const results = await Promise.allSettled([
      projectStore.duplicateScreen(project.id, 'main', { id: 'battle' }),
      projectStore.duplicateScreen(project.id, 'main', { id: 'battle' })
    ]);
    const winners = results.filter((result) => result.status === 'fulfilled');
    const losers = results.filter((result) => result.status === 'rejected');
    assert.equal(winners.length, 1, '必须恰好一个请求成功');
    assert.equal(losers.length, 1, '另一个请求必须被拒绝');
    assert.match(String(losers[0].reason?.message || ''), /Screen already exists/, '败者必须得到已存在错误');
    const registry = await projectStore.listScreens(project.id);
    assert.equal(registry.screens.filter((screen) => screen.id === 'battle').length, 1, 'registry 只能有一个条目');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('M4-L：失败事务不回滚另一事务已发布的结果', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-conc-cross-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const { projectStore, project } = await setupProject('Conc Cross');
    // 制造一个必然失败的源：broken Screen 的证据指向不存在的文件，
    // 迁移期的证据重算会显式失败。
    await projectStore.createScreen(project.id, { id: 'broken', name: '坏源' });
    await projectStore.saveArtifact(project.id, 'underlay-contract', {
      schema_version: '1.0', id: 'broken-underlay-contract', version: 1, status: 'draft', source: {},
      evidence: { underlay: { path: 'screens/broken/underlays/missing.bin', hash: 'sha256:placeholder', byte_length: 0 } }
    }, { screenId: 'broken' });
    const results = await Promise.allSettled([
      projectStore.duplicateScreen(project.id, 'main', { id: 'battle' }),
      projectStore.duplicateScreen(project.id, 'broken', { id: 'shop' })
    ]);
    const battle = results.find((result) => result.status === 'fulfilled');
    assert.ok(battle, '健康源的 Clone 必须成功');
    assert.equal(battle.value.id, 'battle');
    const shop = results.find((result) => result.status === 'rejected');
    assert.ok(shop, '坏源的 Clone 必须失败');
    // 关键断言：失败事务的回滚（基于自己拿到的快照恢复）不得抹掉
    // 另一事务已经发布的 battle——锁保证败者的快照晚于胜者的发布。
    const registry = await projectStore.listScreens(project.id);
    assert.ok(registry.screens.some((screen) => screen.id === 'battle'), '成功事务的结果不得被失败事务回滚');
    assert.equal(registry.screens.some((screen) => screen.id === 'shop'), false, '失败事务不得发布');
    const resolved = await projectStore.resolveProject(project.id);
    const state = JSON.parse(await fs.readFile(path.join(resolved.workspacePath, 'workflow', 'state.json'), 'utf8'));
    assert.ok(state.screen_stages.battle, '成功事务的 workflow stage 必须保留');
    assert.equal('shop' in (state.screen_stages || {}), false, '失败事务的 workflow stage 不得残留');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('M4-L：Create Screen 与 Duplicate Screen 并发不丢 registry 条目', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-conc-mixed-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const { projectStore, project } = await setupProject('Conc Mixed');
    await Promise.all([
      projectStore.createScreen(project.id, { id: 'extra', name: '新建页' }),
      projectStore.duplicateScreen(project.id, 'main', { id: 'battle' })
    ]);
    const registry = await projectStore.listScreens(project.id);
    assert.ok(registry.screens.some((screen) => screen.id === 'extra'), 'createScreen 条目不得丢失');
    assert.ok(registry.screens.some((screen) => screen.id === 'battle'), 'duplicateScreen 条目不得丢失');
    assert.ok(registry.screens.some((screen) => screen.id === 'main'), '源 Screen 条目不得丢失');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('M4-L（审核 §7）：fs.cp 中途失败立即清理部分目录，同 ID 重试成功', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-conc-midcopy-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  const originalCp = fsPromises.cp;
  try {
    const { projectStore, project } = await setupProject('Conc Midcopy');
    const resolved = await projectStore.resolveProject(project.id);
    const targetDir = path.join(resolved.workspacePath, 'screens', 'battle');
    // 故障注入：复制一部分后抛错（模拟 fs.cp 中途失败）。
    fsPromises.cp = async (source, destination, options) => {
      if (String(destination) === targetDir) {
        await fs.mkdir(path.join(destination, 'partial'), { recursive: true });
        await fs.writeFile(path.join(destination, 'partial', 'half-copied.txt'), 'partial');
        throw new Error('injected mid-copy failure');
      }
      return originalCp(source, destination, options);
    };
    await assert.rejects(
      projectStore.duplicateScreen(project.id, 'main', { id: 'battle' }),
      (error) => /injected mid-copy failure/.test(error.message)
    );
    fsPromises.cp = originalCp;
    // 首次失败即无残留（§7 的严格表述），且无需依赖下一次重试自愈。
    await assert.rejects(fs.stat(targetDir), '中途失败的部分目录必须被立即删除');
    const registry = await projectStore.listScreens(project.id);
    assert.equal(registry.screens.some((screen) => screen.id === 'battle'), false);
    // 干净重试成功。
    const entry = await projectStore.duplicateScreen(project.id, 'main', { id: 'battle' });
    assert.equal(entry.id, 'battle');
  } finally {
    fsPromises.cp = originalCp;
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
