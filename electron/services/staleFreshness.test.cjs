// M1b regression: approval freshness gate, stale-preserving edits, and
// transaction safety for the three pipeline stages (fix-plan P0-08,
// secondary-audit P0-06). A failed model attempt or an ordinary edit must
// never silently destroy an existing usable chain or wash away staleness.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDesignPipeline } = require('./designPipeline.cjs');
const { createProjectStore } = require('./projectStore.cjs');
const { ERROR_CODES } = require('./errorCodes.cjs');

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

function fakeClient({ failStyle = false, styleRequests } = {}) {
  return {
    requestArtifact: async (_config, input) => {
      if (failStyle && input.kind === 'style-contract') throw new Error('model unavailable');
      if (input.kind === 'screen-contract') return screenContractFixture(input);
      if (input.kind === 'layout-proposals') return layoutProposalsFixture(input);
      if (input.kind === 'style-contract') { styleRequests?.push(input); return styleContractFixture(input); }
      throw new Error(`unexpected artifact kind: ${input.kind}`);
    },
    generateImage: async () => ({ url: 'https://kunpoapiimg.ziy.cc/freshness.png', task_id: `task-${Math.random().toString(36).slice(2)}` })
  };
}

async function advanceToApprovedStyle(projectStore, pipeline, projectId) {
  let project = await pipeline.runStage(projectId, 'wireframe_interpretation', { screenId: 'main' });
  project = await pipeline.approveArtifact(projectId, 'screen-contract', { screenId: 'main' });
  project = await pipeline.runStage(projectId, 'layout_design', { screenId: 'main' });
  project = await pipeline.approveArtifact(projectId, 'approved-layout', { screenId: 'main', proposalId: 'proposal-efficiency' });
  project = await pipeline.runStage(projectId, 'style_resolution', { screenId: 'main' });
  project = await pipeline.approveArtifact(projectId, 'style-contract');
  return project;
}

test('transaction safety: a failed style attempt keeps the whole existing chain intact', async () => {
  await withWorkspace('design-copilot-freshness-tx-', async (temporaryRoot) => {
    const projectStore = createProjectStore();
    let project = await projectStore.create({ name: 'Freshness Tx', projectType: 'new', requirement: 'Keep my chain.' });
    const wireframe = path.join(temporaryRoot, 'wireframe.png');
    await fs.writeFile(wireframe, pngHeader(1080, 1920));
    project = await projectStore.importFile(project.id, wireframe, 'wireframe');
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: fakeClient(), kunpoConfig: {} });
    project = await advanceToApprovedStyle(projectStore, pipeline, project.id);
    const before = await projectStore.open(project.id, { screenId: 'main' });

    // 模型失败：不得先失效下游再失败，旧链路保持原状。
    const failing = createDesignPipeline({ projectStore, kunpoClient: fakeClient({ failStyle: true }), kunpoConfig: {} });
    await assert.rejects(() => failing.runStage(project.id, 'style_resolution', { screenId: 'main' }), /model unavailable/);
    const after = await projectStore.open(project.id, { screenId: 'main' });
    assert.equal(after.artifacts.styleContract.status, 'approved', 'failed attempt must keep the approved style');
    assert.equal(after.artifacts.styleContract.version, before.artifacts.styleContract.version, 'failed attempt must not replace the style artifact');
    assert.equal(after.artifacts.approvedLayout.status, 'approved');
    assert.notEqual(after.artifacts.layouts.status, 'stale');
    assert.equal(after.artifacts.screenContract.status, 'approved');
  });
});

test('approval freshness gate: stale artifacts cannot be re-approved without regeneration', async () => {
  await withWorkspace('design-copilot-freshness-gate-', async (temporaryRoot) => {
    const projectStore = createProjectStore();
    let project = await projectStore.create({ name: 'Freshness Gate', projectType: 'new', requirement: 'Gate the stale approval.' });
    const wireframe = path.join(temporaryRoot, 'wireframe.png');
    await fs.writeFile(wireframe, pngHeader(1080, 1920));
    project = await projectStore.importFile(project.id, wireframe, 'wireframe');
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: fakeClient(), kunpoConfig: {} });
    project = await advanceToApprovedStyle(projectStore, pipeline, project.id);

    // stale Style Contract：必须先重新生成，不允许直接重批。
    await projectStore.saveArtifact(project.id, 'style-contract', {
      ...project.artifacts.styleContract, status: 'stale', stale_at: new Date().toISOString(), stale_reason: 'style_contract_regenerated'
    });
    await assert.rejects(
      () => pipeline.approveArtifact(project.id, 'style-contract'),
      (error) => error.code === ERROR_CODES.STALE_REAPPROVAL_BLOCKED
    );

    // stale 布局提案：不能再次批准布局。
    await projectStore.saveArtifact(project.id, 'layout-proposals', {
      ...project.artifacts.layouts, status: 'stale', stale_at: new Date().toISOString(), stale_reason: 'screen-contract_changed'
    }, { screenId: 'main' });
    await assert.rejects(
      () => pipeline.approveArtifact(project.id, 'approved-layout', { screenId: 'main', proposalId: 'proposal-efficiency' }),
      (error) => error.code === ERROR_CODES.STALE_REAPPROVAL_BLOCKED
    );

    // stale Functional Screen Contract 同样被门禁拦截。
    await projectStore.saveArtifact(project.id, 'screen-contract', {
      ...project.artifacts.screenContract, status: 'stale', stale_at: new Date().toISOString(), stale_reason: 'wireframe_changed'
    }, { screenId: 'main' });
    await assert.rejects(
      () => pipeline.approveArtifact(project.id, 'screen-contract', { screenId: 'main' }),
      (error) => error.code === ERROR_CODES.STALE_REAPPROVAL_BLOCKED
    );
  });
});

test('style basis freshness: locking style against a changed approved layout is blocked', async () => {
  await withWorkspace('design-copilot-freshness-basis-', async (temporaryRoot) => {
    const projectStore = createProjectStore();
    let project = await projectStore.create({ name: 'Freshness Basis', projectType: 'new', requirement: 'Basis must be fresh.' });
    const wireframe = path.join(temporaryRoot, 'wireframe.png');
    await fs.writeFile(wireframe, pngHeader(1080, 1920));
    project = await projectStore.importFile(project.id, wireframe, 'wireframe');
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: fakeClient(), kunpoConfig: {} });
    project = await pipeline.runStage(project.id, 'wireframe_interpretation', { screenId: 'main' });
    project = await pipeline.approveArtifact(project.id, 'screen-contract', { screenId: 'main' });
    project = await pipeline.runStage(project.id, 'layout_design', { screenId: 'main' });
    project = await pipeline.approveArtifact(project.id, 'approved-layout', { screenId: 'main', proposalId: 'proposal-efficiency' });
    project = await pipeline.runStage(project.id, 'style_resolution', { screenId: 'main' });

    // 风格生成后基线被换成了另一份已批准布局：锁定时必须拒绝。
    await projectStore.saveArtifact(project.id, 'approved-layout', {
      schema_version: '1.0', id: 'main-approved-layout-v2', version: 2, status: 'approved',
      source: { source_proposal: 'proposal-expression' }, source_proposal: 'proposal-expression',
      label: '表现优先', canvas_spec: project.canvas_spec, required_controls: [],
      proposal: { id: 'proposal-expression', name: '表现优先' }, slots: [],
      input_revisions: { ...(project.input_revisions || {}) }
    }, { screenId: 'main' });
    await assert.rejects(
      () => pipeline.approveArtifact(project.id, 'style-contract'),
      (error) => error.code === ERROR_CODES.STALE_REAPPROVAL_BLOCKED && /风格基线/.test(error.message)
    );
  });
});

test('edits never wash away staleness: stale artifacts stay stale after updateArtifact', async () => {
  await withWorkspace('design-copilot-freshness-edit-', async (temporaryRoot) => {
    const projectStore = createProjectStore();
    let project = await projectStore.create({ name: 'Freshness Edit', projectType: 'new', requirement: 'Edits must not wash stale.' });
    const wireframe = path.join(temporaryRoot, 'wireframe.png');
    await fs.writeFile(wireframe, pngHeader(1080, 1920));
    project = await projectStore.importFile(project.id, wireframe, 'wireframe');
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: fakeClient(), kunpoConfig: {} });
    project = await pipeline.runStage(project.id, 'wireframe_interpretation', { screenId: 'main' });
    project = await pipeline.runStage(project.id, 'style_resolution', { screenId: 'main' }).catch(() => project);
    if (!project.artifacts.styleContract) {
      await projectStore.saveArtifact(project.id, 'style-contract', styleContractFixture({ id: 'freshness-style-contract', source: {} }));
      project = await projectStore.open(project.id);
    }

    // stale 风格规范被普通编辑后仍保持 stale，且保留失效原因。
    await projectStore.saveArtifact(project.id, 'style-contract', {
      ...project.artifacts.styleContract, status: 'stale', stale_at: '2026-08-20T00:00:00.000Z', stale_reason: 'style_contract_regenerated'
    });
    let next = await pipeline.updateArtifact(project.id, 'style-contract', { materials: ['玻璃'] });
    assert.equal(next.artifacts.styleContract.status, 'stale', 'editing a stale artifact must keep it stale');
    assert.equal(next.artifacts.styleContract.stale_reason, 'style_contract_regenerated');
    assert.equal(next.artifacts.styleContract.stale_at, '2026-08-20T00:00:00.000Z');
    assert.deepEqual(next.artifacts.styleContract.materials, ['玻璃'], 'the edit itself still applies');

    // 非 stale Artifact 编辑后清除历史 stale 痕迹。
    await projectStore.saveArtifact(project.id, 'style-contract', { ...next.artifacts.styleContract, status: 'generated', stale_at: '2026-08-20T00:00:00.000Z', stale_reason: 'style_contract_regenerated' });
    next = await pipeline.updateArtifact(project.id, 'style-contract', { materials: ['磨砂金属'] });
    assert.equal(next.artifacts.styleContract.status, 'reviewed');
    assert.equal(next.artifacts.styleContract.stale_at, undefined);
    assert.equal(next.artifacts.styleContract.stale_reason, undefined);
  });
});
