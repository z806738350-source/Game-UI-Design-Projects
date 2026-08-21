// Route flow regression: 三条路线的状态机必须一次走通，且 Style 与 Layout
// 之间不得再形成 stale 死循环（pipeline-flow-cycle-fix-plan Case A/B/C）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDesignPipeline } = require('./designPipeline.cjs');
const { createProjectStore } = require('./projectStore.cjs');

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function withWorkspace(prefix, body) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    return await body(temporaryRoot);
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

function screenContractFixture(input) {
  return {
    schema_version: '1.0', id: input.id, version: 1, status: 'generated', source: input.source,
    screen_id: 'main', screen_name: 'Main', purpose: 'Progress the route', primary_action: 'continue',
    secondary_actions: [], required_information: [], required_controls: ['continue'], states: [], edge_cases: [], data_dependencies: [], design_constraints: {},
    source_inventory: { requirement_functions: ['continue'], wireframe_controls: [], wireframe_information: [] },
    coverage: { covered_items: ['continue'], uncovered_items: [] }
  };
}

function layoutProposalsFixture(input) {
  return {
    schema_version: '1.0', id: input.id, version: 1, status: 'generated', source: input.source, screen_id: 'main',
    proposals: [
      { id: 'proposal-efficiency', name: '效率优先', strategy: 'efficiency', slots: [] },
      { id: 'proposal-expression', name: '表现优先', strategy: 'expression', slots: [] },
      { id: 'proposal-balance', name: '平衡', strategy: 'balance', slots: [] }
    ]
  };
}

// 可通过 style-contract 批准校验的最小完整规范。
function styleContractFixture(input) {
  return {
    schema_version: '1.0', id: input.id, version: 1, status: 'generated', source: input.source,
    style_id: 'route-style', visual_identity: { theme: '路线回归', mood: ['克制'], keywords: ['测试'] },
    colors: { primary: '#d6b05f', surface: '#14161c', text: '#f2ede1' },
    typography: {
      display: { size: 48, weight: 700, letter_spacing: 2, line_height: 1.2, fill: '#f2ede1' },
      body: { size: 24, weight: 400, letter_spacing: 0, line_height: 1.4, fill: '#d9d4c8' }
    },
    materials: ['磨砂金属'], reference_ids: [], negative_style_constraints: [],
    geometry: { corner_language: 'rounded', corner_radius: 12, density: 'balanced' },
    lighting: { treatment: '顶部柔光，边缘轻微暗角', light_direction: 'top', intensity: 0.6 },
    components: { button: { default: '实心圆角按钮' } },
    composition: { information_density: 'balanced', main_visual_priority: 'medium', decoration_density: 'low', spacing: '分组间距 24px' }
  };
}

function routeFakeClient(styleRequests) {
  return {
    requestArtifact: async (_config, input) => {
      if (input.kind === 'screen-contract') return screenContractFixture(input);
      if (input.kind === 'layout-proposals') return layoutProposalsFixture(input);
      if (input.kind === 'style-contract') { styleRequests.push(input); return styleContractFixture(input); }
      throw new Error(`unexpected artifact kind: ${input.kind}`);
    },
    generateImage: async () => ({ url: 'https://kunpoapiimg.ziy.cc/route.png', task_id: `task-${Math.random().toString(36).slice(2)}` })
  };
}

async function advanceToApprovedLayout(projectStore, pipeline, projectId) {
  let project = await pipeline.runStage(projectId, 'wireframe_interpretation', { screenId: 'main' });
  project = await pipeline.approveArtifact(projectId, 'screen-contract', { screenId: 'main' });
  project = await pipeline.runStage(projectId, 'layout_design', { screenId: 'main' });
  project = await pipeline.approveArtifact(projectId, 'approved-layout', { screenId: 'main', proposalId: 'proposal-efficiency' });
  assert.equal(project.artifacts.approvedLayout.status, 'approved');
  return project;
}

test('Case A: exploration route completes Contract → Layout → Style → Visual without the stale cycle', async () => {
  await withWorkspace('design-copilot-route-exploration-', async (temporaryRoot) => {
    const projectStore = createProjectStore();
    let project = await projectStore.create({ name: 'Route Exploration', projectType: 'new', requirement: 'Build the party page.' });
    const sourceImage = path.join(temporaryRoot, 'wireframe.png');
    await fs.writeFile(sourceImage, pngHeader(1080, 1920));
    project = await projectStore.importFile(project.id, sourceImage, 'wireframe');
    const styleRequests = [];
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: routeFakeClient(styleRequests), kunpoConfig: {} });
    project = await advanceToApprovedLayout(projectStore, pipeline, project.id);

    // 进入风格阶段只允许显式触发；生成 Style 不得把上游 Layout 打成 stale。
    project = await pipeline.runStage(project.id, 'style_resolution', { screenId: 'main' });
    assert.equal(styleRequests.length, 1);
    assert.notEqual(project.artifacts.layouts.status, 'stale', 'style generation must not stale layout proposals on exploration');
    assert.equal(project.artifacts.approvedLayout.status, 'approved', 'approved layout must survive style generation');
    assert.deepEqual(project.artifacts.styleContract.source.style_basis, {
      kind: 'approved-layout', id: project.artifacts.approvedLayout.id, screen_id: 'main'
    });

    project = await pipeline.approveArtifact(project.id, 'style-contract');
    assert.equal(project.artifacts.styleContract.status, 'approved');
    assert.equal(project.artifacts.approvedLayout.status, 'approved', 'style approval must not stale layout');

    // Style 批准后直接进入视觉探索，不再出现「布局尚未批准」死锁。
    project = await pipeline.runStage(project.id, 'visual_exploration', { screenId: 'main' });
    assert.equal(project.artifacts.visualResults.variations.length, 3);
    assert.equal(project.artifacts.visualResults.status, 'generated');
  });
});

test('Case B: guided route keeps layout approved across explicit style generation', async () => {
  await withWorkspace('design-copilot-route-guided-', async (temporaryRoot) => {
    const projectStore = createProjectStore();
    let project = await projectStore.create({ name: 'Route Guided', projectType: 'existing', continuationMode: 'existing-guided', requirement: 'Continue the page.' });
    assert.equal(project.continuation_mode, 'existing-guided');
    const wireframe = path.join(temporaryRoot, 'wireframe.png');
    const reference = path.join(temporaryRoot, 'reference.png');
    await fs.writeFile(wireframe, pngHeader(1080, 1920));
    await fs.writeFile(reference, pngHeader(1080, 1920));
    project = await projectStore.importFile(project.id, wireframe, 'wireframe');
    project = await projectStore.importFile(project.id, reference, 'reference');
    const styleRequests = [];
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: routeFakeClient(styleRequests), kunpoConfig: {} });
    project = await advanceToApprovedLayout(projectStore, pipeline, project.id);
    project = await pipeline.runStage(project.id, 'style_resolution', { screenId: 'main' });
    assert.equal(styleRequests.length, 1);
    assert.notEqual(project.artifacts.layouts.status, 'stale', 'guided style generation must not stale layout');
    assert.equal(project.artifacts.approvedLayout.status, 'approved');
    assert.equal(project.artifacts.styleContract.source.style_basis.kind, 'approved-layout');
  });
});

test('Case C: strict route locks style from the screen contract and stales layout downstream', async () => {
  await withWorkspace('design-copilot-route-strict-', async (temporaryRoot) => {
    const projectStore = createProjectStore();
    let project = await projectStore.create({ name: 'Route Strict', projectType: 'existing', requirement: 'Continue strictly.' });
    assert.equal(project.continuation_mode, 'existing-strict');
    const wireframe = path.join(temporaryRoot, 'wireframe.png');
    const reference = path.join(temporaryRoot, 'reference.png');
    await fs.writeFile(wireframe, pngHeader(1080, 1920));
    await fs.writeFile(reference, pngHeader(1080, 1920));
    project = await projectStore.importFile(project.id, wireframe, 'wireframe');
    project = await projectStore.importFile(project.id, reference, 'reference');
    const styleRequests = [];
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: routeFakeClient(styleRequests), kunpoConfig: {} });
    let next = await pipeline.runStage(project.id, 'wireframe_interpretation', { screenId: 'main' });
    next = await pipeline.approveArtifact(project.id, 'screen-contract', { screenId: 'main' });

    // 严格路线顺序：契约批准后先锁风格（而不是先生成布局）。
    // 风格基线永远是已批准功能契约：即使 Approved Layout 存在，
    // 也不得回读 Layout 作为风格输入（旧行为会形成循环）。
    next = await pipeline.runStage(project.id, 'style_resolution', { screenId: 'main' });
    assert.deepEqual(next.artifacts.styleContract.source.style_basis, {
      kind: 'screen-contract', id: next.artifacts.screenContract.id, screen_id: 'main'
    });

    // 模拟后续完成组件感知布局后再次解析风格：Strict 下 Style 更新
    // 必须使布局 stale（无反向边，环检测另见单测），契约不受影响。
    await projectStore.saveArtifact(project.id, 'layout-proposals', layoutProposalsFixture({ id: 'main-layout-proposals', source: {} }), { screenId: 'main' });
    await projectStore.saveArtifact(project.id, 'approved-layout', {
      schema_version: '1.0', id: 'main-approved-layout-v1', version: 1, status: 'approved', source: { source_proposal: 'proposal-efficiency' },
      source_proposal: 'proposal-efficiency', label: '效率优先', canvas_spec: { width: 1080, height: 1920 }, required_controls: [], proposal: { id: 'proposal-efficiency', name: '效率优先' }, slots: []
    }, { screenId: 'main' });
    next = await pipeline.runStage(project.id, 'style_resolution', { screenId: 'main' });
    assert.equal(styleRequests.length, 2);
    assert.deepEqual(next.artifacts.styleContract.source.style_basis, {
      kind: 'screen-contract', id: next.artifacts.screenContract.id, screen_id: 'main'
    }, 'strict style basis must stay the screen contract even when an approved layout exists');
    assert.equal(next.artifacts.layouts.status, 'stale');
    assert.equal(next.artifacts.approvedLayout.status, 'stale');
    assert.equal(next.artifacts.screenContract.status, 'approved', 'style regeneration must never stale the contract');
  });
});

test('exploration layout change fans Screen → Global(style) → Screen across all active screens', async () => {
  await withWorkspace('design-copilot-route-fanout-', async (temporaryRoot) => {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Route Fanout', projectType: 'new', requirement: 'Two screens.' });
    await projectStore.createScreen(project.id, { id: 'shop', name: 'Shop' });
    await projectStore.createScreen(project.id, { id: 'archive', name: 'Archive' });
    await projectStore.saveArtifact(project.id, 'style-contract', { schema_version: '1.0', id: 'style-global', version: 1, status: 'approved', source: {} });
    await projectStore.saveArtifact(project.id, 'layout-proposals', {
      schema_version: '1.0', id: 'main-layout-proposals', version: 1, status: 'generated', source: {}, screen_id: 'main',
      proposals: [
        { id: 'p1', name: '方案一', strategy: 'efficiency', slots: [] },
        { id: 'p2', name: '方案二', strategy: 'balance', slots: [] },
        { id: 'p3', name: '方案三', strategy: 'expression', slots: [] }
      ]
    }, { screenId: 'main' });
    await projectStore.saveArtifact(project.id, 'approved-layout', {
      schema_version: '1.0', id: 'main-approved-layout-v1', version: 1, status: 'approved', source: { source_proposal: 'p1' },
      source_proposal: 'p1', label: '方案一', canvas_spec: { width: 1080, height: 1920 }, required_controls: [], proposal: { id: 'p1', name: '方案一' }, slots: []
    }, { screenId: 'main' });
    for (const screenId of ['main', 'shop', 'archive']) {
      await projectStore.saveArtifact(project.id, 'visual-task', { schema_version: '1.0', id: `${screenId}-visual-task`, version: 1, status: 'approved', source: {} }, { screenId });
      await projectStore.saveArtifact(project.id, 'visual-results', { schema_version: '1.0', id: `${screenId}-visual-results`, version: 1, status: 'approved', source: {}, variations: [{ id: `${screenId}-v1` }] }, { screenId });
    }
    await projectStore.updateScreen(project.id, 'archive', { status: 'archived' });
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });

    // 更换批准方案 → main 的 approved-layout 变化 → 全局 Style stale →
    // fan-out 使所有未归档 Screen 的 visual 产物 stale；归档 Screen 不受影响。
    await pipeline.approveArtifact(project.id, 'approved-layout', { screenId: 'main', proposalId: 'p2' });
    const main = await projectStore.open(project.id, { screenId: 'main' });
    const shop = await projectStore.open(project.id, { screenId: 'shop' });
    const archive = await projectStore.open(project.id, { screenId: 'archive' });
    assert.equal(main.artifacts.styleContract.status, 'stale');
    assert.equal(main.artifacts.visualTask.status, 'stale');
    assert.equal(main.artifacts.visualResults.status, 'stale');
    assert.equal(shop.artifacts.visualTask.status, 'stale', 'global style staleness must fan out to every active screen');
    assert.equal(shop.artifacts.visualResults.status, 'stale');
    assert.equal(archive.artifacts.visualTask.status, 'approved', 'archived screens keep their evidence untouched');
  });
});
