// M4-J2（M4-I 复审 §8）：Clone 证据安全解析与失败回滚。
// 被篡改/损坏项目中的 { path, hash } 证据记录不得逃出克隆目标 Screen
// 目录：父路径穿越、symlink 逃逸、超大文件都必须使 Clone 显式失败，
// 且失败后无残留目标目录、无 registry 条目，重试干净。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectStore } = require('./projectStore.cjs');

function underlayContractWithEvidence(evidence) {
  return { schema_version: '1.0', id: 'main-underlay-contract', version: 1, status: 'draft', source: {}, evidence };
}

async function assertCloneRolledBack(projectStore, projectId, targetId) {
  const resolved = await projectStore.resolveProject(projectId);
  await assert.rejects(fs.stat(path.join(resolved.workspacePath, 'screens', targetId)), '失败 Clone 不得残留目标目录');
  const registry = await projectStore.listScreens(projectId);
  assert.equal(registry.screens.some((screen) => screen.id === targetId), false, '失败 Clone 不得写入 registry');
}

test('M4-J2：父路径穿越的证据路径使 Clone 显式失败并整体回滚，修复后重试干净', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-clone-escape-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Clone Escape', projectType: 'new', requirement: 'Evidence paths must stay inside the cloned screen.' });
    const resolved = await projectStore.resolveProject(project.id);
    // 工作区外（相对证据路径可达）放置一个诱饵文件：没有防护时它会被
    // 读取并泄露哈希/长度。
    await fs.writeFile(path.join(resolved.workspacePath, 'outside.json'), '{"secret":true}');
    await projectStore.saveArtifact(project.id, 'underlay-contract', underlayContractWithEvidence({
      forged: { path: 'screens/main/underlays/../../../outside.json', hash: 'sha256:placeholder', byte_length: 0 }
    }));
    await assert.rejects(
      projectStore.duplicateScreen(project.id, 'main', { id: 'battle' }),
      (error) => /escapes the cloned screen directory/.test(error.message)
    );
    await assertCloneRolledBack(projectStore, project.id, 'battle');
    // 修复（移除伪造证据）后重试：残留清理逻辑保证干净重做。
    await projectStore.saveArtifact(project.id, 'underlay-contract', underlayContractWithEvidence({}));
    const entry = await projectStore.duplicateScreen(project.id, 'main', { id: 'battle' });
    assert.equal(entry.id, 'battle');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('M4-J2：symlink 逃逸的证据路径被 realpath containment 拒绝', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-clone-symlink-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Clone Symlink', projectType: 'new', requirement: 'Symlinks must not escape.' });
    const resolved = await projectStore.resolveProject(project.id);
    const outsideFile = path.join(temporaryRoot, 'outside-secret.txt');
    await fs.writeFile(outsideFile, 'secret');
    const underlaysDir = path.join(resolved.workspacePath, 'screens', 'main', 'underlays');
    await fs.mkdir(underlaysDir, { recursive: true });
    await fs.symlink(outsideFile, path.join(underlaysDir, 'main-link.png'));
    await projectStore.saveArtifact(project.id, 'underlay-contract', underlayContractWithEvidence({
      underlay: { path: 'screens/main/underlays/main-link.png', hash: 'sha256:placeholder', byte_length: 6 }
    }));
    await assert.rejects(
      projectStore.duplicateScreen(project.id, 'main', { id: 'battle' }),
      (error) => /escapes via symlink/.test(error.message)
    );
    await assertCloneRolledBack(projectStore, project.id, 'battle');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('M4-J2：超过大小上限的证据文件被拒绝读取', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-clone-oversize-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Clone Oversize', projectType: 'new', requirement: 'Oversized evidence must not be read.' });
    const resolved = await projectStore.resolveProject(project.id);
    const underlaysDir = path.join(resolved.workspacePath, 'screens', 'main', 'underlays');
    await fs.mkdir(underlaysDir, { recursive: true });
    // 稀疏文件：立即获得 65MB 名义大小而不实际占用磁盘。
    const big = path.join(underlaysDir, 'main-big.bin');
    const handle = await fs.open(big, 'w');
    await handle.truncate(65 * 1024 * 1024);
    await handle.close();
    await projectStore.saveArtifact(project.id, 'underlay-contract', underlayContractWithEvidence({
      underlay: { path: 'screens/main/underlays/main-big.bin', hash: 'sha256:placeholder', byte_length: 0 }
    }));
    await assert.rejects(
      projectStore.duplicateScreen(project.id, 'main', { id: 'battle' }),
      (error) => /exceeds the .* byte limit/.test(error.message)
    );
    await assertCloneRolledBack(projectStore, project.id, 'battle');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
