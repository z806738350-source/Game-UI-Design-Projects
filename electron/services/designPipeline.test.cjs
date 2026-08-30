const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDesignPipeline } = require('./designPipeline.cjs');
const { createProjectStore } = require('./projectStore.cjs');
const { createIntentStateStore } = require('./intentStateStore.cjs');
const { UNCERTAINTY_CATEGORIES } = require('./intentAnalysis.cjs');

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

// v1.4 §11.1：draftRequirement 已升级为 structured-v2 预填；空需求首稿直接采用，
// 未确认的评审不得进入 Screen Contract 生成。
test('blank input is prefilled as a structured-v2 review and must be confirmed before contract generation', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-intent-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const intentStateStore = createIntentStateStore({ projectStore });
    projectStore.__attachIntentStore(intentStateStore);
    let project = await projectStore.create({ name: 'Intent Project', projectType: 'new', requirement: '' });
    const sourceImage = path.join(temporaryRoot, 'wireframe.png');
    await fs.writeFile(sourceImage, pngHeader(1080, 1920));
    project = await projectStore.importFile(project.id, sourceImage, 'wireframe');
    let draftRequest;
    let stageWhileGenerating;
    const fakeClient = {
      requestJson: async (_config, input) => {
        draftRequest = input;
        return {
          value: {
            page_type: 'full_screen',
            page_purpose: '在竖屏阵容页选择五名侠客并保存阵容',
            player_tasks: [{ id: 'task-pick', text: '选择五名侠客并调整站位' }],
            core_flow: [{ id: 'flow-save', text: '保存阵容' }],
            screen_layers: [{ id: 'layer-main', kind: 'primary_content', name: '阵容主内容层', parent_id: null }],
            visible_controls: [{ id: 'control-save', layer_id: 'layer-main', visible_label: '保存', visible_text: '保存阵容', observed_states: [], claimed_states: [] }],
            visible_information_and_states: [],
            uncertainties: [],
            uncertainty_audit: UNCERTAINTY_CATEGORIES.map((category) => ({ category, status: 'no_gap_found', uncertainty_ids: [], rationale: '' }))
          },
          provider: null,
          warnings: []
        };
      },
      requestArtifact: async (_config, input) => {
        stageWhileGenerating = (await projectStore.open(project.id)).workflow.current_stage;
        return {
          schema_version: '1.0', id: input.id, version: 1, status: 'generated', source: input.source,
          screen_id: 'main', screen_name: '侠客阵容编成', purpose: '编成阵容', primary_action: '保存阵容',
          secondary_actions: [], required_information: [], required_controls: ['保存阵容'], states: [], edge_cases: [], data_dependencies: [], design_constraints: {},
          source_inventory: { requirement_functions: ['保存阵容'], wireframe_controls: [], wireframe_information: [] }, coverage: { covered_items: ['保存阵容'], uncovered_items: [] }
        };
      }
    };
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: fakeClient, kunpoConfig: {}, intentStateStore });
    project = await pipeline.draftRequirement(project.id, { screenId: 'main' });
    assert.ok(draftRequest.prompt.startsWith('TASK_KIND: intent-analysis-v2'));
    assert.equal(draftRequest.imagePaths[0], project.wireframe_path);
    // 首稿直接采用：项目进入 structured-v2，需求由服务端渲染生成。
    assert.equal(project.intent_mode, 'structured-v2');
    assert.ok(project.intent_review && project.intent_review.page_purpose);
    assert.ok(project.requirement.trim());
    assert.equal(project.requirement_confirmed, false);
    assert.equal(project.workflow.stages.input.status, 'reviewed');
    await assert.rejects(
      pipeline.runStage(project.id, 'wireframe_interpretation', { screenId: 'main', stayOnInputUntilComplete: true }),
      (error) => {
        assert.equal(error.code, 'INTENT_REVIEW_INCOMPLETE');
        return true;
      }
    );
    await intentStateStore.confirmIntentReview(project.id, 'main', { expectedIntentReviewRevision: 1 });
    project = await pipeline.runStage(project.id, 'wireframe_interpretation', { screenId: 'main', stayOnInputUntilComplete: true });
    assert.equal(stageWhileGenerating, 'input');
    assert.equal(project.workflow.current_stage, 'wireframe_interpretation');
    assert.equal(project.artifacts.screenContract.screen_name, '侠客阵容编成');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('pipeline persists generated and approved artifacts separately', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-test-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    let project = await projectStore.create({ name: 'Test Project', projectType: 'new', requirement: 'Upgrade a character.' });
    const sourceImage = path.join(temporaryRoot, 'wireframe.png');
    await fs.writeFile(sourceImage, pngHeader(1080, 1920));
    project = await projectStore.importFile(project.id, sourceImage, 'wireframe');
    const fakeClient = {
      requestArtifact: async (_config, input) => input.kind === 'screen-contract' ? {
        schema_version: '1.0', id: input.id, version: 1, status: 'generated', source: input.source,
        screen_id: 'main', screen_name: 'Main', purpose: 'Upgrade', primary_action: 'upgrade',
        secondary_actions: [], required_information: [], required_controls: ['upgrade'], states: [], edge_cases: [], data_dependencies: [], design_constraints: {},
        source_inventory: { requirement_functions: ['upgrade'], wireframe_controls: [], wireframe_information: [] }, coverage: { covered_items: ['upgrade'], uncovered_items: [] }
      } : null,
      generateImage: async () => ({ url: 'https://kunpoapiimg.ziy.cc/test.png', task_id: 'task-1' })
    };
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: fakeClient, kunpoConfig: {} });
    project = await pipeline.runStage(project.id, 'wireframe_interpretation', { screenId: 'main' });
    assert.equal(project.artifacts.screenContract.status, 'generated');
    project = await pipeline.approveArtifact(project.id, 'screen-contract', { screenId: 'main' });
    assert.equal(project.artifacts.screenContract.status, 'approved');
    assert.equal(project.workflow.stages.wireframe_interpretation.status, 'approved');
    await projectStore.saveArtifact(project.id, 'layout-proposals', {
      schema_version: '1.0', id: 'layouts', version: 1, status: 'approved', source: {}, proposals: []
    });
    project = await pipeline.updateArtifact(project.id, 'screen-contract', { screenId: 'main', review_metadata: { required_controls: ['confirmed'] } });
    assert.equal(project.artifacts.screenContract.status, 'approved');
    // AUD-10：存储层强制每次保存单调 bump 版本，metadata-only 编辑的保存同样升版本。
    assert.equal(project.artifacts.screenContract.version, 3);
    assert.equal(project.artifacts.layouts.status, 'approved');
    project = await pipeline.updateArtifact(project.id, 'screen-contract', { screenId: 'main', purpose: 'Upgrade with a clear before/after comparison.' });
    assert.equal(project.artifacts.screenContract.status, 'reviewed');
    assert.equal(project.artifacts.screenContract.version, 4);
    assert.equal(project.artifacts.screenContract.purpose, 'Upgrade with a clear before/after comparison.');
    assert.equal(project.artifacts.layouts.status, 'stale');
    assert.equal(project.artifactHistory.length > 0, true);
    await projectStore.saveArtifact(project.id, 'visual-results', {
      schema_version: '1.0', id: 'main-visual-results', version: 1, status: 'generated', source: {},
      variations: [
        { id: 'v1', strategy: 'conservative', image_url: 'https://kunpoapiimg.ziy.cc/v1.png' },
        { id: 'v2', strategy: 'expressive', image_url: 'https://kunpoapiimg.ziy.cc/v2.png' }
      ]
    });
    project = await pipeline.approveArtifact(project.id, 'visual-results', { screenId: 'main', selectedIds: ['v1', 'v2'], mode: 'combine', notes: 'Use V2 hierarchy with V1 cards.' });
    assert.equal(project.artifacts.visualResults.status, 'approved');
    assert.deepEqual(project.artifacts.visualResults.review.selected_variation_ids, ['v1', 'v2']);
    assert.equal(project.artifacts.visualResults.review.mode, 'combine');
    assert.equal(await fs.readFile(path.join(project.workspacePath, 'inputs', 'requirement.md'), 'utf8'), 'Upgrade a character.\n');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('portrait canvas and manual adjustments reach image generation', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-portrait-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    let project = await projectStore.create({ name: 'Portrait Project', projectType: 'new', requirement: 'Build a party.' });
    const sourceImage = path.join(temporaryRoot, 'wireframe.png');
    await fs.writeFile(sourceImage, pngHeader(1080, 1920));
    project = await projectStore.importFile(project.id, sourceImage, 'wireframe');
    await projectStore.saveArtifact(project.id, 'approved-layout', {
      schema_version: '1.0', id: 'approved-layout', version: 1, status: 'approved', source: {}, label: '竖屏抽屉布局',
      manual_adjustments: ['侠客列表必须位于下半屏抽屉'], required_controls: ['保存阵容'], proposal: { name: '竖屏抽屉布局' }
    });
    await projectStore.saveArtifact(project.id, 'style-contract', {
      schema_version: '1.0', id: 'style', style_id: 'wuxia', version: 1, status: 'approved', source: {},
      visual_identity: { theme: '水墨武侠' }, negative_style_constraints: []
    });
    let request;
    const fakeClient = {
      requestArtifact: async () => null,
      generateImage: async (_config, input) => { request = input; return { url: 'https://kunpoapiimg.ziy.cc/portrait.png', task_id: 'portrait-task' }; }
    };
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: fakeClient, kunpoConfig: {} });
    project = await pipeline.runStage(project.id, 'visual_exploration', { screenId: 'main', strategies: ['conservative'] });
    assert.equal(request.size, '864x1536');
    assert.match(request.prompt, /1080x1920/);
    assert.match(request.prompt, /侠客列表必须位于下半屏抽屉/);
    assert.equal(project.artifacts.visualResults.variations[0].canvas_spec.orientation, 'portrait');
    assert.equal(project.artifacts.visualResults.variations[0].layout_name, '竖屏抽屉布局');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('input invalidation marks every dependent artifact stale', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-invalidation-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    let project = await projectStore.create({ name: 'Lineage Project', projectType: 'new', requirement: 'Original.' });
    for (const [kind, artifact] of [
      ['screen-contract', { id: 'screen' }], ['layout-proposals', { id: 'layouts', proposals: [] }], ['approved-layout', { id: 'approved' }],
      ['style-contract', { id: 'style' }], ['visual-task', { id: 'task' }], ['visual-results', { id: 'results', variations: [{ id: 'v1' }] }]
    ]) {
      await projectStore.saveArtifact(project.id, kind, { schema_version: '1.0', version: 1, status: 'approved', source: {}, ...artifact });
    }
    await projectStore.saveProject(project.id, { requirement: 'Changed.' });
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    project = await pipeline.invalidateFromInputChange(project.id, { requirement: true });
    // 新项目走 exploration 路线：依赖方向为 Contract → Layout → Style，
    // 因此需求变化会级联使风格规范 stale（与旧图方向相反，不再是漏网产物）。
    assert.equal(project.artifacts.screenContract.status, 'stale');
    assert.equal(project.artifacts.layouts.status, 'stale');
    assert.equal(project.artifacts.approvedLayout.status, 'stale');
    assert.equal(project.artifacts.styleContract.status, 'stale');
    assert.equal(project.artifacts.visualResults.status, 'stale');
    assert.equal(project.workflow.current_stage, 'input');
    assert.equal(project.workflow.stages.input.status, 'reviewed');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('stale propagation isolates page inputs and fans global inputs across non-archived screens', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-stale-matrix-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Stale Matrix', projectType: 'existing', requirement: 'Main.' });
    await projectStore.createScreen(project.id, { id: 'inventory', name: 'Inventory' });
    await projectStore.createScreen(project.id, { id: 'archive', name: 'Archive' });
    for (const [kind, id] of [['reference-inventory', 'inventory-global'], ['style-contract', 'style-global'], ['font-manifest', 'font-global'], ['component-contract', 'component-global']]) {
      await projectStore.saveArtifact(project.id, kind, { schema_version: '2.0', id, version: 1, status: 'approved', source: {} });
    }
    const screenKinds = [
      'reference-pack', 'screen-contract', 'component-bindings', 'layout-proposals', 'approved-layout',
      'underlay-contract', 'visual-task', 'visual-results', 'underlay-critique',
      'composition-manifest', 'composition-output', 'fidelity-report'
    ];
    for (const screenId of ['main', 'inventory', 'archive']) {
      for (const kind of screenKinds) {
        await projectStore.saveArtifact(project.id, kind, {
          schema_version: '2.0', id: `${screenId}-${kind}`, version: 1, status: 'approved', source: {},
          ...(kind === 'visual-results' ? { variations: [{ id: `${screenId}-v1` }] } : {}),
          ...(kind === 'layout-proposals' ? { proposals: [] } : {})
        }, { screenId });
      }
    }
    await projectStore.updateScreen(project.id, 'archive', { status: 'archived' });
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    const pageResult = await pipeline.invalidateFromInputChange(project.id, { requirement: true, screenId: 'inventory' });
    assert.deepEqual(pageResult.invalidation.changed_kinds, ['input-requirement']);
    // AUD-01 后 strict 图中 screen-contract 是 style/layout 的上游：页面级
    // 输入变化除了失效本页契约，还会沿严格链传播到全局 Style 与全部 Screen
    // 的下游；这正是“契约变化 → 全链 stale”的期望行为。
    assert.deepEqual(new Set(pageResult.invalidation.effects[0].affected_screens), new Set(['inventory', 'main']));
    const mainAfterPage = await projectStore.open(project.id, { screenId: 'main' });
    const inventoryAfterPage = await projectStore.open(project.id, { screenId: 'inventory' });
    const archiveAfterPage = await projectStore.open(project.id, { screenId: 'archive' });
    // 主屏契约本身不受其他页输入变化影响（screen-scoped 种子只在 inventory）。
    assert.equal(mainAfterPage.artifacts.screenContract.status, 'approved');
    // 但主屏的严格链下游因契约→Style→全链传播而 stale。
    assert.equal(mainAfterPage.artifacts.fidelityReport.status, 'stale');
    assert.equal(inventoryAfterPage.artifacts.screenContract.status, 'stale');
    assert.equal(inventoryAfterPage.artifacts.fidelityReport.status, 'stale');
    // 归档屏不参与任何 fan-out。
    assert.equal(archiveAfterPage.artifacts.fidelityReport.status, 'approved');
    assert.equal(mainAfterPage.artifacts.styleContract.status, 'stale');

    const globalResult = await pipeline.invalidateFromInputChange(project.id, { references: true, screenId: 'inventory' });
    assert.deepEqual(new Set(globalResult.invalidation.effects[0].affected_screens), new Set(['main', 'inventory']));
    const mainAfterGlobal = await projectStore.open(project.id, { screenId: 'main' });
    const archiveAfterGlobal = await projectStore.open(project.id, { screenId: 'archive' });
    assert.equal(mainAfterGlobal.artifacts.referencePack.status, 'stale');
    assert.equal(mainAfterGlobal.artifacts.styleContract.status, 'stale');
    assert.equal(mainAfterGlobal.artifacts.fidelityReport.status, 'stale');
    assert.equal(archiveAfterGlobal.artifacts.referencePack.status, 'approved');
    assert.equal(archiveAfterGlobal.artifacts.fidelityReport.status, 'approved');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

// AUD-02：模式切换必须按旧∪新路线清理。只按新图失效会残留旧严格链
// 专属资产（font/component/bindings/underlay）的 approved 事实；切换后
// 全部生产链资产必须 stale，Screen Contract 与参考资产跨路线保留。
test('AUD-02: route switch stales the old and new route production chains on every active screen', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-mode-stale-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Mode Matrix', projectType: 'existing', requirement: 'Main.' });
    await projectStore.createScreen(project.id, { id: 'shop', name: 'Shop' });
    // 模拟 Strict 完整生产链已 approved：全局风格/字体/组件 + 每屏生产链。
    for (const [kind, id] of [['style-contract', 'style'], ['font-manifest', 'font'], ['component-contract', 'component'], ['reference-inventory', 'refs']]) {
      await projectStore.saveArtifact(project.id, kind, { schema_version: '2.0', id, version: 1, status: 'approved', source: {} });
    }
    for (const screenId of ['main', 'shop']) {
      for (const kind of ['screen-contract', 'component-bindings', 'layout-proposals', 'approved-layout', 'underlay-contract', 'visual-task', 'visual-results', 'underlay-critique', 'composition-manifest', 'composition-output', 'fidelity-report']) {
        await projectStore.saveArtifact(project.id, kind, {
          schema_version: '2.0', id: `${screenId}-${kind}`, version: 1, status: 'approved', source: {},
          ...(kind === 'visual-results' ? { variations: [{ id: `${screenId}-v1` }] } : {}),
          ...(kind === 'layout-proposals' ? { proposals: [] } : {})
        }, { screenId });
      }
    }
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    const result = await pipeline.invalidateFromInputChange(project.id, { continuationMode: true, previousContinuationMode: 'existing-strict', screenId: 'main' });
    assert.deepEqual(result.invalidation.changed_kinds, ['input-continuation-mode']);
    assert.equal(result.invalidation.effects[0].changed_kind, 'input-continuation-mode');
    assert.equal(result.invalidation.effects[0].previous_profile, 'existing-strict');
    for (const screenId of ['main', 'shop']) {
      const screen = await projectStore.open(project.id, { screenId });
      // 旧严格链专属资产必须被重置，不得残留 approved。
      assert.equal(screen.artifacts.bindings.status, 'stale', `${screenId}: bindings must stale on route switch`);
      assert.equal(screen.artifacts.layouts.status, 'stale', `${screenId}: layouts must stale on route switch`);
      assert.equal(screen.artifacts.approvedLayout.status, 'stale', `${screenId}: approved layout must stale on route switch`);
      assert.equal(screen.artifacts.underlayContract.status, 'stale', `${screenId}: underlay must stale on route switch`);
      assert.equal(screen.artifacts.visualResults.status, 'stale');
      assert.equal(screen.artifacts.underlayCritique.status, 'stale');
      assert.equal(screen.artifacts.compositionOutput.status, 'stale');
      assert.equal(screen.artifacts.fidelityReport.status, 'stale');
      assert.equal(screen.artifacts.fidelityReport.stale_reason, 'route_profile_changed');
      // Screen Contract 跨路线仍有效，不属于重置集合。
      assert.equal(screen.artifacts.screenContract.status, 'approved');
    }
    const refreshed = await projectStore.open(project.id);
    assert.equal(refreshed.artifacts.styleContract.status, 'stale');
    assert.equal(refreshed.artifacts.fontManifest.status, 'stale', 'strict-only font manifest must not survive a route switch');
    assert.equal(refreshed.artifacts.componentContract.status, 'stale', 'strict-only component contract must not survive a route switch');
    assert.equal(refreshed.artifacts.referenceInventory.status, 'approved');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

// AUD-01 集成场景：Strict 中 Style 已批准，功能契约语义修改必须使
// Style、Font、Component、Binding、Layout、Underlay、Composition、Fidelity
// 全部 stale，旧 Style 不得继续建立在旧契约之上。
test('AUD-01: strict contract semantic edit stales approved style and the full strict chain', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-aud01-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Strict Style Stale', projectType: 'existing', requirement: 'Main.' });
    for (const [kind, id] of [['style-contract', 'style'], ['font-manifest', 'font'], ['component-contract', 'component']]) {
      await projectStore.saveArtifact(project.id, kind, { schema_version: '2.0', id, version: 1, status: 'approved', source: {} });
    }
    for (const kind of ['screen-contract', 'component-bindings', 'layout-proposals', 'approved-layout', 'underlay-contract', 'visual-task', 'visual-results', 'underlay-critique', 'composition-manifest', 'composition-output', 'fidelity-report']) {
      await projectStore.saveArtifact(project.id, kind, {
        schema_version: '2.0', id: `main-${kind}`, version: 1, status: 'approved', source: {},
        ...(kind === 'screen-contract' ? {
          screen_id: 'main', screen_name: 'Main', purpose: 'Old purpose.', primary_action: 'continue',
          secondary_actions: [], required_information: [], required_controls: [], states: [], edge_cases: [], data_dependencies: [],
          design_constraints: {}, source_inventory: { requirement_functions: [], wireframe_controls: [], wireframe_information: [] },
          coverage: { covered_items: [], uncovered_items: [] }
        } : {}),
        ...(kind === 'visual-results' ? { variations: [{ id: 'main-v1' }] } : {}),
        ...(kind === 'layout-proposals' ? { proposals: [] } : {})
      }, { screenId: 'main' });
    }
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    await pipeline.updateArtifact(project.id, 'screen-contract', { screenId: 'main', purpose: 'Changed purpose.' });
    const after = await projectStore.open(project.id, { screenId: 'main' });
    assert.equal(after.artifacts.styleContract.status, 'stale', 'approved style must stale when its strict basis changes');
    assert.equal(after.artifacts.fontManifest.status, 'stale');
    assert.equal(after.artifacts.componentContract.status, 'stale');
    assert.equal(after.artifacts.bindings.status, 'stale');
    assert.equal(after.artifacts.layouts.status, 'stale');
    assert.equal(after.artifacts.underlayContract.status, 'stale');
    assert.equal(after.artifacts.visualResults.status, 'stale');
    assert.equal(after.artifacts.compositionManifest.status, 'stale');
    assert.equal(after.artifacts.fidelityReport.status, 'stale');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('screen-scoped pipeline operations reject missing or inactive screen context', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-screen-context-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Screen Context', projectType: 'new', requirement: 'Main screen.' });
    await projectStore.createScreen(project.id, { id: 'inventory', name: 'Inventory' });
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    await assert.rejects(
      pipeline.runStage(project.id, 'wireframe_interpretation', {}),
      (error) => error.code === 'SCREEN_ID_REQUIRED'
    );
    await assert.rejects(
      pipeline.runStage(project.id, 'wireframe_interpretation', { screenId: 'inventory' }),
      (error) => error.code === 'SCREEN_CONTEXT_MISMATCH'
    );
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

function bindingGateFixture() {
  const screenContract = {
    schema_version: '2.0', id: 'main-screen-contract', version: 1, status: 'approved', source: {},
    screen_id: 'main', screen_name: 'Lineup', purpose: 'Save lineup', primary_action: 'save',
    secondary_actions: [], required_information: [],
    required_controls: [{ id: 'save', label: '保存', role: 'primary-action', required: true }],
    states: [], edge_cases: [], data_dependencies: [], design_constraints: {},
    source_inventory: { requirement_functions: ['保存'], wireframe_controls: [], wireframe_information: [] },
    coverage: { covered_items: ['保存'], uncovered_items: [] }
  };
  const componentContract = {
    schema_version: '2.0', id: 'components', version: 1, status: 'approved', source: {},
    families: [
      {
        id: 'button.primary', category: 'button', status: 'approved', reuse_mode: 'nine-slice',
        states: { default: { asset_path: 'style/components/button.png' }, pressed: { asset_path: 'style/components/button_pressed.png' }, disabled: { asset_path: 'style/components/button_disabled.png' } }
      },
      {
        id: 'nav.item', category: 'navigation', status: 'approved', reuse_mode: 'nine-slice',
        states: { default: { asset_path: 'style/components/nav.png' }, selected: { asset_path: 'style/components/nav_selected.png' }, disabled: { asset_path: 'style/components/nav_disabled.png' } }
      }
    ]
  };
  const fontManifest = {
    schema_version: '2.0', id: 'fonts', version: 1, status: 'approved', source: {}, fonts: [],
    roles: { 'button-label': { font_id: 'ui', fidelity_mode: 'exact' } }
  };
  const compatibleBinding = { control_id: 'save', component_id: 'button.primary', state: 'default', slot_id: 'bottom', text: '保存', font_role: 'button-label' };
  return { screenContract, componentContract, fontManifest, compatibleBinding };
}

test('binding approval is a backend fact and semantic mismatch blocks approval', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-binding-gate-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const fixture = bindingGateFixture();
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Binding Gate', projectType: 'existing', requirement: 'Lineup.' });
    assert.equal(project.continuation_mode, 'existing-strict');
    await projectStore.saveArtifact(project.id, 'screen-contract', fixture.screenContract, { screenId: 'main' });
    await projectStore.saveArtifact(project.id, 'component-contract', fixture.componentContract);
    await projectStore.saveArtifact(project.id, 'font-manifest', fixture.fontManifest);
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    // Client-supplied approved flags and artifact-level approval must be ignored.
    let updated = await pipeline.updateArtifact(project.id, 'component-bindings', {
      screenId: 'main',
      bindings: [{ ...fixture.compatibleBinding, approved: true }],
      approval: { approved_by: 'attacker', validation_version: 'forged' }
    });
    assert.equal(updated.artifacts.bindings.bindings[0].approved, false);
    assert.equal(updated.artifacts.bindings.approval, undefined);
    assert.notEqual(updated.artifacts.bindings.status, 'approved');
    // Approval is stamped by the pipeline after full semantic validation.
    updated = await pipeline.approveArtifact(project.id, 'component-bindings', { screenId: 'main' });
    assert.equal(updated.artifacts.bindings.status, 'approved');
    assert.equal(updated.artifacts.bindings.bindings[0].approved, true);
    assert.equal(updated.artifacts.bindings.approval.approved_by, 'ui-designer');
    assert.equal(updated.artifacts.bindings.approval.validation_version, 'binding-policy-v1');
    assert.equal(updated.artifacts.bindings.approval.approved_at, updated.artifacts.bindings.approved_at);
    // Editing an approved binding demotes it and clears the stale approval stamp.
    updated = await pipeline.updateArtifact(project.id, 'component-bindings', {
      screenId: 'main',
      bindings: [{ ...fixture.compatibleBinding, text: '保存阵容' }]
    });
    assert.equal(updated.artifacts.bindings.status, 'reviewed');
    assert.equal(updated.artifacts.bindings.approval, undefined);
    assert.equal(updated.artifacts.bindings.approved_at, undefined);
    updated = await pipeline.approveArtifact(project.id, 'component-bindings', { screenId: 'main' });
    assert.equal(updated.artifacts.bindings.status, 'approved');
    // Semantic mismatch (primary-action control bound to a navigation family) blocks approval.
    updated = await pipeline.updateArtifact(project.id, 'component-bindings', {
      screenId: 'main',
      bindings: [{ ...fixture.compatibleBinding, component_id: 'nav.item', state: 'default' }]
    });
    assert.notEqual(updated.artifacts.bindings.status, 'approved');
    await assert.rejects(
      pipeline.approveArtifact(project.id, 'component-bindings', { screenId: 'main' }),
      (error) => error.code === 'BINDING_COVERAGE_INCOMPLETE' && /BINDING_COMPONENT_CATEGORY_MISMATCH/.test(error.message)
    );
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('label-only screen contract edits keep bindings fresh while role edits stale them', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-binding-stale-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const fixture = bindingGateFixture();
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Binding Stale', projectType: 'existing', requirement: 'Lineup.' });
    await projectStore.saveArtifact(project.id, 'screen-contract', fixture.screenContract, { screenId: 'main' });
    await projectStore.saveArtifact(project.id, 'component-contract', fixture.componentContract);
    await projectStore.saveArtifact(project.id, 'font-manifest', fixture.fontManifest);
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    await pipeline.updateArtifact(project.id, 'component-bindings', { screenId: 'main', bindings: [fixture.compatibleBinding] });
    let updated = await pipeline.approveArtifact(project.id, 'component-bindings', { screenId: 'main' });
    assert.equal(updated.artifacts.bindings.status, 'approved');
    // Label-only edits are cosmetic: bindings stay approved.
    updated = await pipeline.updateArtifact(project.id, 'screen-contract', {
      screenId: 'main',
      required_controls: [{ id: 'save', label: '保存阵容', role: 'primary-action', required: true }]
    });
    assert.equal(updated.artifacts.screenContract.version, 2);
    assert.equal(updated.artifacts.bindings.status, 'approved');
    // Role changes are semantic: bindings must be revalidated.
    updated = await pipeline.updateArtifact(project.id, 'screen-contract', {
      screenId: 'main',
      required_controls: [{ id: 'save', label: '保存阵容', role: 'navigation', required: true }]
    });
    assert.equal(updated.artifacts.screenContract.version, 3);
    assert.equal(updated.artifacts.bindings.status, 'stale');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

// P2-03：批准必须幂等——内容未变的重复批准是 no-op，不得升版本、不得
// stale 下游；内容变化后的批准仍然正常传播。
test('re-approving unchanged artifacts is a no-op and does not stale downstream', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-noop-approve-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    let project = await projectStore.create({ name: 'Noop Approve', projectType: 'new', requirement: 'Upgrade.' });
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    await projectStore.saveArtifact(project.id, 'visual-results', {
      schema_version: '1.0', id: 'main-visual-results', version: 1, status: 'generated', source: {},
      variations: [
        { id: 'v1', strategy: 'conservative', image_url: 'https://kunpoapiimg.ziy.cc/v1.png' },
        { id: 'v2', strategy: 'expressive', image_url: 'https://kunpoapiimg.ziy.cc/v2.png' }
      ]
    }, { screenId: 'main' });
    project = await pipeline.approveArtifact(project.id, 'visual-results', { screenId: 'main', selectedIds: ['v1'], notes: '' });
    assert.equal(project.artifacts.visualResults.version, 2);
    // 相同评审决策重复批准：不升版本、不失效生产链。
    project = await pipeline.approveArtifact(project.id, 'visual-results', { screenId: 'main', selectedIds: ['v1'], notes: '' });
    assert.equal(project.artifacts.visualResults.version, 2);
    // 决策变化仍然升版本并传播。
    project = await pipeline.approveArtifact(project.id, 'visual-results', { screenId: 'main', selectedIds: ['v2'], notes: '' });
    assert.equal(project.artifacts.visualResults.version, 3);
    // Reference Inventory：相同内容重复批准不得 stale 已批准的风格规范。
    await projectStore.saveArtifact(project.id, 'reference-inventory', {
      schema_version: '1.0', id: 'reference-inventory-1', version: 1, status: 'reviewed', source: {},
      assets: [{ id: 'ref-1', approved: true, role: 'primary' }]
    });
    project = await pipeline.approveArtifact(project.id, 'reference-inventory');
    assert.equal(project.artifacts.referenceInventory.status, 'approved');
    await projectStore.saveArtifact(project.id, 'style-contract', { schema_version: '1.0', id: 'style-1', version: 1, status: 'approved', source: {} });
    project = await pipeline.approveArtifact(project.id, 'reference-inventory');
    assert.equal(project.artifacts.styleContract.status, 'approved');
    // 参考内容变化后重新批准仍然正常 stale 下游。
    await projectStore.saveArtifact(project.id, 'reference-inventory', {
      ...project.artifacts.referenceInventory, status: 'reviewed',
      assets: [{ id: 'ref-1', approved: true, role: 'primary' }, { id: 'ref-2', approved: true, role: 'supporting' }]
    });
    project = await pipeline.approveArtifact(project.id, 'reference-inventory');
    assert.equal(project.artifacts.styleContract.status, 'stale');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
