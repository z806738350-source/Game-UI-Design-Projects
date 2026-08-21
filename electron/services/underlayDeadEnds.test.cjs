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

// P0-02：视觉生成的参考图容量确认必须与任务目的绑定，并且确认事实绑定
// 当前 Pack 的 hash——参考图变化后旧确认自动失效，避免永久重试死循环。
test('visual omission confirmation is bound to the underlay-generation pack hash', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-omission-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    let project = await projectStore.create({ name: 'Omission Project', projectType: 'new', requirement: 'Build a party.' });
    const wireframe = path.join(temporaryRoot, 'wireframe.png');
    await fs.writeFile(wireframe, pngHeader(1920, 1080));
    project = await projectStore.importFile(project.id, wireframe, 'wireframe');
    for (const name of ['reference-1.png', 'reference-2.png', 'reference-3.png']) {
      const reference = path.join(temporaryRoot, name);
      await fs.writeFile(reference, pngHeader(1920, 1080));
      project = await projectStore.importFile(project.id, reference, 'reference');
    }
    for (const asset of project.reference_assets) {
      project = await projectStore.manageReference(project.id, { id: asset.id, action: 'approval', approved: true });
    }
    await projectStore.saveArtifact(project.id, 'approved-layout', {
      schema_version: '1.0', id: 'approved-layout', version: 1, status: 'approved', source: {}, label: '横屏主布局',
      manual_adjustments: [], required_controls: ['保存'], proposal: { name: '横屏主布局' }
    });
    await projectStore.saveArtifact(project.id, 'style-contract', {
      schema_version: '1.0', id: 'style', style_id: 'wuxia', version: 1, status: 'approved', source: {},
      visual_identity: { theme: '水墨武侠' }, negative_style_constraints: []
    });
    let imageCalls = 0;
    const fakeClient = {
      requestArtifact: async () => null,
      generateImage: async () => { imageCalls += 1; return { url: 'https://kunpoapiimg.ziy.cc/omission.png', task_id: `task-${imageCalls}` }; }
    };
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: fakeClient, kunpoConfig: { providerCapabilities: { max_reference_images: 2 } } });

    // 首次生成：超出容量 → 落盘待确认 Pack 并抛确认错误。
    await assert.rejects(
      pipeline.runStage(project.id, 'visual_exploration', { screenId: 'main', strategies: ['conservative'] }),
      (error) => error.code === ERROR_CODES.REFERENCE_OMISSIONS_CONFIRMATION_REQUIRED
    );
    project = await projectStore.open(project.id, { includePreviews: false });
    const pack = project.artifacts.referencePack;
    assert.equal(pack.purpose, 'underlay-generation');
    assert.equal(pack.requires_omission_confirmation, true);
    assert.equal(pack.selected.length, 2);
    assert.equal(pack.omitted.length, 1);
    assert.ok(pack.pack_hash, 'pack must expose a hash to bind the confirmation');

    // 仅传 confirmReferenceOmissions 不足以通过：hash 不匹配视为旧确认。
    await assert.rejects(
      pipeline.runStage(project.id, 'visual_exploration', { screenId: 'main', strategies: ['conservative'], confirmReferenceOmissions: true, referencePackHash: 'stale-hash' }),
      (error) => error.code === ERROR_CODES.REFERENCE_OMISSIONS_CONFIRMATION_REQUIRED
    );

    // 携带当前 Pack hash 的确认放行，且只带入选附件。
    project = await pipeline.runStage(project.id, 'visual_exploration', { screenId: 'main', strategies: ['conservative'], confirmReferenceOmissions: true, referencePackHash: pack.pack_hash });
    assert.equal(imageCalls, 1);
    assert.equal(project.artifacts.visualResults.variations.length, 1);
    assert.equal(project.artifacts.referencePack.omissions_confirmed, true);

    // 参考图变化 → hash 变化 → 旧确认失效，必须重新确认。
    const extra = path.join(temporaryRoot, 'reference-4.png');
    await fs.writeFile(extra, pngHeader(1920, 1080));
    project = await projectStore.importFile(project.id, extra, 'reference');
    project = await projectStore.manageReference(project.id, { id: project.reference_assets[project.reference_assets.length - 1].id, action: 'approval', approved: true });
    await assert.rejects(
      pipeline.runStage(project.id, 'visual_exploration', { screenId: 'main', strategies: ['expressive'], confirmReferenceOmissions: true, referencePackHash: pack.pack_hash }),
      (error) => error.code === ERROR_CODES.REFERENCE_OMISSIONS_CONFIRMATION_REQUIRED
    );
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

// P0-03：人工复核是独立完成动作——只处理 manual-review-required 状态，
// 必须留下结论与理由，且绝不把未豁免的阻断问题洗成通过。
test('underlay manual review completes manual-review-required critiques without laundering blockers', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-manual-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    const project = await projectStore.create({ name: 'Manual Review Project', projectType: 'new', requirement: 'Review an underlay.' });
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    const base = { schema_version: '2.0', version: 1, status: 'reviewed', source: { underlay: 'underlay-v1' } };

    // 未要求人工复核的 Critique 不允许走该动作。
    await projectStore.saveArtifact(project.id, 'underlay-critique', { ...base, id: 'critique-auto', result: 'failed', issues: [], manual_review: { required: false, approved: false }, manual_waivers: [] });
    await assert.rejects(
      pipeline.approveUnderlayManualReview(project.id, { screenId: 'main', conclusion: '已核对', reason: '证据完整，可以放行继续合成' }),
      (error) => error.code === ERROR_CODES.UNDERLAY_MANUAL_REVIEW_NOT_REQUIRED
    );

    // 要求人工复核但缺少结论/理由时拒绝。
    await projectStore.saveArtifact(project.id, 'underlay-critique', {
      ...base, id: 'critique-manual', result: 'manual-review',
      issues: [{ issue_id: 'issue-1', severity: 'major', type: 'low-critique-confidence', reason: 'confidence below 0.6' }],
      manual_review: { required: true, approved: false }, manual_waivers: []
    });
    await assert.rejects(pipeline.approveUnderlayManualReview(project.id, { screenId: 'main', conclusion: '', reason: '证据完整，可以放行继续合成' }), /结论/);
    await assert.rejects(pipeline.approveUnderlayManualReview(project.id, { screenId: 'main', conclusion: '已核对', reason: '太短' }), /理由/);

    // 成功完成：记录 approved_by/approved_at/结论/理由；但存在未豁免的
    // major 问题时结果仍是 failed、阶段仍 blocked（不洗白 blocker）。
    let next = await pipeline.approveUnderlayManualReview(project.id, { screenId: 'main', conclusion: '已逐区核对底层图，残留纹理属于场景元素', reason: '参照主参考页的背景处理，低置信度来自语义证据不足' });
    const approved = next.artifacts.underlayCritique;
    assert.equal(approved.manual_review.approved, true);
    assert.equal(approved.manual_review.approved_by, 'ui-designer');
    assert.ok(approved.manual_review.approved_at);
    assert.equal(approved.manual_review.conclusion, '已逐区核对底层图，残留纹理属于场景元素');
    assert.equal(approved.result, 'failed');
    assert.equal(next.workflow.stages.underlay_review.status, 'blocked');

    // 已完成的人工复核不能重复执行。
    await assert.rejects(
      pipeline.approveUnderlayManualReview(project.id, { screenId: 'main', conclusion: '再次确认', reason: '重复提交必须被拒绝以保证审计唯一' }),
      (error) => error.code === ERROR_CODES.UNDERLAY_MANUAL_REVIEW_NOT_REQUIRED
    );

    // 无阻断问题时，人工复核完成即放行。
    await projectStore.saveArtifact(project.id, 'underlay-critique', {
      ...base, id: 'critique-manual-clean', result: 'manual-review',
      issues: [{ issue_id: 'issue-1', severity: 'minor', type: 'missing-semantic-evidence', reason: 'semantic evidence missing' }],
      manual_review: { required: true, approved: false }, manual_waivers: []
    });
    next = await pipeline.approveUnderlayManualReview(project.id, { screenId: 'main', conclusion: '人工确认底层图无 UI 残留', reason: '已用放大检查确认所有保留区域干净' });
    assert.equal(next.artifacts.underlayCritique.result, 'passed');
    assert.equal(next.workflow.stages.underlay_review.status, 'approved');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
