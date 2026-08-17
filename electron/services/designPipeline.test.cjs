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

test('blank input is prefilled from UE and must be confirmed before contract generation', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-intent-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
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
          requirement_draft: '玩家需要在竖屏阵容页选择五名侠客、调整站位并保存阵容。隐藏的数值规则需要设计师确认。',
          inferred_page_type: '阵容编成', inferred_rules: ['五人阵容'], uncertainties: ['数值规则']
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
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: fakeClient, kunpoConfig: {} });
    project = await pipeline.draftRequirement(project.id, { screenId: 'main' });
    assert.deepEqual(draftRequest.requiredStringKeys, ['requirement_draft']);
    assert.equal(draftRequest.imagePaths[0], project.wireframe_path);
    assert.equal(project.requirement_source, 'ai');
    assert.equal(project.requirement_confirmed, false);
    assert.equal(project.workflow.current_stage, 'input');
    assert.equal(project.workflow.stages.input.status, 'reviewed');
    await assert.rejects(
      pipeline.runStage(project.id, 'wireframe_interpretation', { screenId: 'main', stayOnInputUntilComplete: true }),
      /确认 AI 预填的设计意图/
    );
    await projectStore.saveProject(project.id, { requirementConfirmed: true });
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
    assert.equal(project.artifacts.screenContract.version, 2);
    assert.equal(project.artifacts.layouts.status, 'approved');
    project = await pipeline.updateArtifact(project.id, 'screen-contract', { screenId: 'main', purpose: 'Upgrade with a clear before/after comparison.' });
    assert.equal(project.artifacts.screenContract.status, 'reviewed');
    assert.equal(project.artifacts.screenContract.version, 3);
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
    assert.equal(project.artifacts.screenContract.status, 'stale');
    assert.equal(project.artifacts.layouts.status, 'stale');
    assert.equal(project.artifacts.approvedLayout.status, 'stale');
    assert.equal(project.artifacts.styleContract.status, 'approved');
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
    assert.deepEqual(pageResult.invalidation.effects[0].affected_screens, ['inventory']);
    const mainAfterPage = await projectStore.open(project.id, { screenId: 'main' });
    const inventoryAfterPage = await projectStore.open(project.id, { screenId: 'inventory' });
    const archiveAfterPage = await projectStore.open(project.id, { screenId: 'archive' });
    assert.equal(mainAfterPage.artifacts.screenContract.status, 'approved');
    assert.equal(mainAfterPage.artifacts.fidelityReport.status, 'approved');
    assert.equal(inventoryAfterPage.artifacts.screenContract.status, 'stale');
    assert.equal(inventoryAfterPage.artifacts.fidelityReport.status, 'stale');
    assert.equal(archiveAfterPage.artifacts.fidelityReport.status, 'approved');
    assert.equal(mainAfterPage.artifacts.styleContract.status, 'approved');

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

test('continuation mode changes stale incompatible production artifacts on every active screen', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-mode-stale-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Mode Matrix', projectType: 'existing', requirement: 'Main.' });
    await projectStore.createScreen(project.id, { id: 'shop', name: 'Shop' });
    await projectStore.saveArtifact(project.id, 'style-contract', { schema_version: '2.0', id: 'style', version: 1, status: 'approved', source: {} });
    for (const screenId of ['main', 'shop']) {
      for (const kind of ['visual-task', 'visual-results', 'underlay-critique', 'composition-manifest', 'composition-output', 'fidelity-report']) {
        await projectStore.saveArtifact(project.id, kind, {
          schema_version: '2.0', id: `${screenId}-${kind}`, version: 1, status: 'approved', source: {},
          ...(kind === 'visual-results' ? { variations: [{ id: `${screenId}-v1` }] } : {})
        }, { screenId });
      }
    }
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    const result = await pipeline.invalidateFromInputChange(project.id, { continuationMode: true, screenId: 'main' });
    assert.deepEqual(result.invalidation.changed_kinds, ['input-continuation-mode']);
    for (const screenId of ['main', 'shop']) {
      const screen = await projectStore.open(project.id, { screenId });
      assert.equal(screen.artifacts.visualResults.status, 'stale');
      assert.equal(screen.artifacts.underlayCritique.status, 'stale');
      assert.equal(screen.artifacts.compositionOutput.status, 'stale');
      assert.equal(screen.artifacts.fidelityReport.status, 'stale');
    }
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
