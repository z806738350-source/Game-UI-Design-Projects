// M4-K2（M4-J 复审 SEC-P1-02 + TX-P1-01，审核者 §8.4 终稿）：
// Clone 全树 symlink 策略、全事务回滚与 Fail-Closed 检测。
// - 目标树任何 symlink（目录/文件）都使 Clone 显式失败，且不修改链接目标；
// - Workflow/Registry 写入失败自动回滚（还原备份 + 删除目标目录）；
// - 回滚自身也失败时抛结构化错误 CLONE_ROLLBACK_INCOMPLETE（携带事务/
//   步骤/备份路径/人工恢复顺序），不做启动期自动恢复；
// - 「有条目无 stage」的 Clone 不一致状态在再复制/切换时被检测阻断。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectStore } = require('./projectStore.cjs');

async function assertCloneRolledBack(projectStore, projectId, targetId) {
  const resolved = await projectStore.resolveProject(projectId);
  await assert.rejects(fs.stat(path.join(resolved.workspacePath, 'screens', targetId)), '失败 Clone 不得残留目标目录');
  const registry = await projectStore.listScreens(projectId);
  assert.equal(registry.screens.some((screen) => screen.id === targetId), false, '失败 Clone 不得写入 registry');
}

function patchWriteFile(predicate, message) {
  const original = fsPromises.writeFile;
  fsPromises.writeFile = (...args) => (predicate(String(args[0])) ? Promise.reject(new Error(message)) : original.apply(fsPromises, args));
  return () => { fsPromises.writeFile = original; };
}

function patchCopyFile(message) {
  const original = fsPromises.copyFile;
  fsPromises.copyFile = () => Promise.reject(new Error(message));
  return () => { fsPromises.copyFile = original; };
}

test('M4-K2：symlink 化的目录使 Clone 显式失败，链接目标不被触碰', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-clone-symdir-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Clone Symdir', projectType: 'new', requirement: 'Symlinked directories must be rejected.' });
    const resolved = await projectStore.resolveProject(project.id);
    const outsideDir = path.join(temporaryRoot, 'outside-dir');
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, 'victim.json'), '{"untouched":true}');
    // 源 Screen 的 reviews 目录是一个指向工作区外的 symlink。
    await fs.symlink(outsideDir, path.join(resolved.workspacePath, 'screens', 'main', 'reviews'));
    await assert.rejects(
      projectStore.duplicateScreen(project.id, 'main', { id: 'battle' }),
      (error) => /symlink/.test(error.message)
    );
    await assertCloneRolledBack(projectStore, project.id, 'battle');
    // clone_does_not_modify_symlink_target：链接目标必须原样。
    assert.equal(await fs.readFile(path.join(outsideDir, 'victim.json'), 'utf8'), '{"untouched":true}');
    assert.equal((await fs.readdir(outsideDir)).length, 1);
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('M4-K2：symlink 化的 Artifact JSON 使 Clone 显式失败，目标文件不被修改', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-clone-symfile-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Clone Symfile', projectType: 'new', requirement: 'Symlinked artifact files must be rejected.' });
    const resolved = await projectStore.resolveProject(project.id);
    const outsideFile = path.join(temporaryRoot, 'outside-contract.json');
    await fs.writeFile(outsideFile, '{"secret":"untouched"}');
    const contractPath = path.join(resolved.workspacePath, 'screens', 'main', 'screen-contract.json');
    await fs.rm(contractPath, { force: true });
    await fs.symlink(outsideFile, contractPath);
    await assert.rejects(
      projectStore.duplicateScreen(project.id, 'main', { id: 'battle' }),
      (error) => /symlink/.test(error.message)
    );
    await assertCloneRolledBack(projectStore, project.id, 'battle');
    assert.equal(await fs.readFile(outsideFile, 'utf8'), '{"secret":"untouched"}');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('M4-K2：Workflow 写入失败自动回滚——还原 Workflow、删除目标目录，修复后重试成功', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-clone-tx-workflow-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Clone Tx Workflow', projectType: 'new', requirement: 'Workflow failure must roll back.' });
    const resolved = await projectStore.resolveProject(project.id);
    const statePath = path.join(resolved.workspacePath, 'workflow', 'state.json');
    const indexPath = path.join(resolved.workspacePath, 'screens', 'index.json');
    const stateBefore = await fs.readFile(statePath, 'utf8');
    const indexBefore = await fs.readFile(indexPath, 'utf8');
    // 故障注入：state.json 的原子写（临时文件以 state.json 路径开头）失败。
    const restoreWriteFile = patchWriteFile((filePath) => filePath.startsWith(statePath), 'injected workflow failure');
    await assert.rejects(
      projectStore.duplicateScreen(project.id, 'main', { id: 'battle' }),
      (error) => /injected workflow failure/.test(error.message)
    );
    restoreWriteFile();
    await assertCloneRolledBack(projectStore, project.id, 'battle');
    assert.equal(await fs.readFile(statePath, 'utf8'), stateBefore, 'Workflow 必须与原字节一致');
    assert.equal(await fs.readFile(indexPath, 'utf8'), indexBefore, 'Registry 必须与原字节一致');
    const transactionDirs = await fs.readdir(path.join(resolved.workspacePath, 'workflow', 'transactions')).catch(() => []);
    assert.deepEqual(transactionDirs, [], '正常回滚后事务目录必须被清理');
    // 修复后干净重试成功（含 workflow stage）。
    const entry = await projectStore.duplicateScreen(project.id, 'main', { id: 'battle' });
    assert.equal(entry.id, 'battle');
    const stateAfter = JSON.parse(await fs.readFile(statePath, 'utf8'));
    assert.ok(stateAfter.screen_stages.battle, '成功 Clone 必须写入 workflow stage');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('M4-K2：Registry 写入失败自动回滚——还原 Workflow、删除目标目录', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-clone-tx-registry-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Clone Tx Registry', projectType: 'new', requirement: 'Registry failure must roll back.' });
    const resolved = await projectStore.resolveProject(project.id);
    const statePath = path.join(resolved.workspacePath, 'workflow', 'state.json');
    const indexPath = path.join(resolved.workspacePath, 'screens', 'index.json');
    const stateBefore = await fs.readFile(statePath, 'utf8');
    const restoreWriteFile = patchWriteFile((filePath) => filePath.startsWith(indexPath), 'injected registry failure');
    await assert.rejects(
      projectStore.duplicateScreen(project.id, 'main', { id: 'battle' }),
      (error) => /injected registry failure/.test(error.message)
    );
    restoreWriteFile();
    await assertCloneRolledBack(projectStore, project.id, 'battle');
    assert.equal(await fs.readFile(statePath, 'utf8'), stateBefore, '发布点失败时 Workflow 必须还原为原字节');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('M4-K2：回滚自身也失败时抛结构化 CLONE_ROLLBACK_INCOMPLETE，携带完整恢复信息', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-clone-tx-double-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Clone Tx Double', projectType: 'new', requirement: 'Double fault must surface structured error.' });
    const resolved = await projectStore.resolveProject(project.id);
    const statePath = path.join(resolved.workspacePath, 'workflow', 'state.json');
    // 双重故障注入：主操作在 Workflow 写入失败，回滚的备份还原也失败。
    const restoreWriteFile = patchWriteFile((filePath) => filePath.startsWith(statePath), 'injected workflow failure');
    const restoreCopyFile = patchCopyFile('injected restore failure');
    let caught = null;
    await projectStore.duplicateScreen(project.id, 'main', { id: 'battle' }).catch((error) => { caught = error; });
    restoreWriteFile();
    restoreCopyFile();
    assert.ok(caught, '双重故障必须抛出');
    assert.equal(caught.code, 'CLONE_ROLLBACK_INCOMPLETE');
    assert.ok(caught.transaction_id, '必须携带事务 ID');
    assert.equal(caught.source_screen_id, 'main');
    assert.equal(caught.target_screen_id, 'battle');
    assert.equal(caught.failed_step, 'workflow-update', '必须指明原始失败步骤');
    assert.ok(caught.rollback_failures.some((failure) => failure.includes('restore workflow/state.json')), '必须指明回滚失败步骤');
    assert.ok(caught.completed_steps.includes('transaction-backups-written'), '必须携带已完成步骤');
    assert.equal(caught.workflow_state_path, statePath);
    assert.ok(caught.workflow_backup_path.includes('workflow-state.before.json'), '必须携带备份路径');
    assert.ok(Array.isArray(caught.manual_actions) && caught.manual_actions.length >= 2, '必须携带人工恢复顺序');
    assert.match(caught.message, /人工恢复顺序/, '错误消息必须可确定执行');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('M4-K2：「有条目无 stage」的 Clone 不一致状态被 Fail-Closed 检测阻断', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-clone-failclosed-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Clone FailClosed', projectType: 'new', requirement: 'Inconsistent clone state must fail closed.' });
    const resolved = await projectStore.resolveProject(project.id);
    const indexPath = path.join(resolved.workspacePath, 'screens', 'index.json');
    // 手工制造双重故障残留：registry 有条目、workflow 无对应 stage。
    const registry = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    registry.screens.push({ id: 'ghost', name: '残留副本', status: 'active', input_mode: 'own', duplicated_from_screen_id: 'main', created_at: '2026-08-28T00:00:00.000Z', updated_at: '2026-08-28T00:00:00.000Z' });
    await fs.writeFile(indexPath, JSON.stringify(registry, null, 2));
    // 再复制同名 → 不得被“Screen already exists”掩盖，必须给出结构化恢复指引。
    await assert.rejects(
      projectStore.duplicateScreen(project.id, 'main', { id: 'ghost' }),
      (error) => error.code === 'CLONE_ROLLBACK_INCOMPLETE'
    );
    // 切换到该 Screen 同样被阻断。
    await assert.rejects(
      projectStore.setActiveScreen(project.id, 'ghost'),
      (error) => error.code === 'CLONE_ROLLBACK_INCOMPLETE'
    );
    // 一致性完好的克隆不受检测影响：正常克隆后同名复制得到普通“已存在”。
    await projectStore.duplicateScreen(project.id, 'main', { id: 'battle' });
    await assert.rejects(
      projectStore.duplicateScreen(project.id, 'main', { id: 'battle' }),
      (error) => error.code === undefined && /Screen already exists/.test(error.message)
    );
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
