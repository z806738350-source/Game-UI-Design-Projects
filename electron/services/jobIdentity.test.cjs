const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDesignPipeline } = require('./designPipeline.cjs');
const { createProjectStore } = require('./projectStore.cjs');

// M4-F2 / AUD-04 Job Identity：取消键、失败写回都必须绑定任务发起时的
// “项目 + Screen”，一个 Screen 的取消/失败绝不能串到另一个 Screen。

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function waitUntil(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitUntil timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function setupScreen(projectStore, projectId, screenId, temporaryRoot, fileName) {
  const sourceImage = path.join(temporaryRoot, fileName);
  await fs.writeFile(sourceImage, pngHeader(1080, 1920));
  await projectStore.importFile(projectId, sourceImage, 'wireframe', { screenId });
  await projectStore.saveArtifact(projectId, 'approved-layout', {
    schema_version: '1.0', id: `${screenId}-approved-layout`, version: 1, status: 'approved', source: {}, label: `${screenId} 布局`,
    manual_adjustments: [], required_controls: ['保存'], proposal: { name: `${screenId} 布局` }
  }, { screenId });
  await projectStore.saveArtifact(projectId, 'style-contract', {
    schema_version: '1.0', id: `${screenId}-style`, style_id: 'wuxia', version: 1, status: 'approved', source: {},
    visual_identity: { theme: '水墨武侠' }, negative_style_constraints: []
  }, { screenId });
}

test('AUD-04 缺口 C：取消一个 Screen 的生成不得中断同项目其他 Screen 的任务', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-cancel-iso-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Cancel Isolation', projectType: 'new', requirement: 'Two screens.' });
    await setupScreen(projectStore, project.id, 'main', temporaryRoot, 'wireframe-main.png');
    await projectStore.createScreen(project.id, { id: 'battle', name: '战斗页' });
    await setupScreen(projectStore, project.id, 'battle', temporaryRoot, 'wireframe-battle.png');

    const mainGate = deferred();
    const generatedPrompts = [];
    let firstTaskReached = false;
    const fakeClient = {
      requestArtifact: async () => null,
      generateImage: async (_config, input) => {
        generatedPrompts.push(input.prompt);
        // 让 main 的第一个任务挂起，给取消指令留出到达窗口。
        if (generatedPrompts.length === 1) { firstTaskReached = true; await mainGate.promise; }
        return { url: `https://kunpoapiimg.ziy.cc/generated-${generatedPrompts.length}.png`, task_id: `task-${generatedPrompts.length}` };
      }
    };
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: fakeClient, kunpoConfig: {} });

    const mainRun = pipeline.runStage(project.id, 'visual_exploration', { screenId: 'main', strategies: ['conservative', 'expressive'] });
    await waitUntil(() => firstTaskReached);
    await pipeline.cancelStage(project.id, 'visual_exploration', { screenId: 'main' });
    mainGate.resolve(undefined);
    const mainResult = await mainRun;
    // 并行提交：两个方向在停止前都已提交；停止前已落盘的 expressive 保留，
    // 挂起的 conservative 迟回被丢弃（停止等待语义）。
    assert.equal(mainResult.artifacts.visualResults.variations.length, 1, 'main 被停止后只保留停止前已完成的 1 个方向');
    assert.equal(mainResult.artifacts.visualResults.variations[0].strategy, 'expressive');

    // 用户切到 battle 屏继续工作：main 的取消标记绝不能串到这里。
    await projectStore.setActiveScreen(project.id, 'battle');
    const battleResult = await pipeline.runStage(project.id, 'visual_exploration', { screenId: 'battle', strategies: ['conservative', 'expressive'] });
    assert.equal(battleResult.artifacts.visualResults.variations.length, 2, 'battle 不受 main 取消影响，两个方向都要生成');
    assert.equal(battleResult.screen_id, 'battle');
    // 并行语义下 main 的两个方向均已提交（provider 侧不可撤回）+ battle 2 个。
    assert.equal(generatedPrompts.length, 4);
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('AUD-04 缺口 B：失败状态写回任务发起时的 Screen，而非当前 active Screen', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-fail-screen-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Failure Writeback', projectType: 'new', requirement: 'Two screens.' });
    await setupScreen(projectStore, project.id, 'main', temporaryRoot, 'wireframe-main.png');
    await projectStore.createScreen(project.id, { id: 'battle', name: '战斗页' });
    await setupScreen(projectStore, project.id, 'battle', temporaryRoot, 'wireframe-battle.png');
    await projectStore.setActiveScreen(project.id, 'battle');

    const battleGate = deferred();
    let battleTaskReached = false;
    const fakeClient = {
      requestArtifact: async () => null,
      generateImage: async () => { battleTaskReached = true; return battleGate.promise; }
    };
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: fakeClient, kunpoConfig: {} });

    const battleRun = pipeline.runStage(project.id, 'visual_exploration', { screenId: 'battle', strategies: ['conservative'] });
    await waitUntil(() => battleTaskReached);
    // 用户在等待期间切回 main：失败状态仍必须落回 battle。
    await projectStore.setActiveScreen(project.id, 'main');
    battleGate.reject(new Error('kunpo gateway unavailable'));
    await assert.rejects(battleRun, /kunpo gateway unavailable/);

    const state = JSON.parse(await fs.readFile(path.join(project.workspacePath, 'workflow', 'state.json'), 'utf8'));
    assert.equal(state.screen_stages.battle.visual_exploration.status, 'failed', '失败必须写回任务发起的 battle 屏');
    assert.notEqual(state.screen_stages.main.visual_exploration?.status, 'failed', 'main 屏不得被其他 Screen 的失败污染');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
