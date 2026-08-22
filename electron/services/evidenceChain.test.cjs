const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { createDesignPipeline } = require('./designPipeline.cjs');
const { createProjectStore } = require('./projectStore.cjs');
const { ERROR_CODES } = require('./errorCodes.cjs');
const { visualBindingMismatch, visualReviewHash } = require('./compositor.cjs');
const { assertFinalApprovalForExport } = require('./compositionRenderer.cjs');
const { hashBuffer } = require('./underlayReview.cjs');

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function withWorkspace(prefix, body) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await body(temporaryRoot);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

// P0-05：交付链重验纯函数——Manifest 必须仍对应当前 Visual Results 评审；
// 升级前未记录 visual_results_version 的旧 Manifest 不受新门禁约束。
test('visualBindingMismatch only enforces manifests that recorded a visual binding', () => {
  const review = { mode: 'selected', selected_variation_ids: ['v-1'], notes: '评审记录' };
  const visualResults = { id: 'vr', version: 3, review };
  const matching = { source: { visual_results_version: 3, selected_variation_ids: ['v-1'], review_hash: visualReviewHash(visualResults) } };
  assert.equal(visualBindingMismatch(matching, visualResults), null);
  // 旧格式 Manifest（无 visual_results_version）由 stale 机制保底，不在此拦截。
  assert.equal(visualBindingMismatch({ source: {} }, visualResults), null);
  assert.equal(visualBindingMismatch({}, visualResults), null);
  assert.ok(visualBindingMismatch(matching, undefined), 'Visual Results 缺失必须拦截');
  assert.ok(visualBindingMismatch(matching, { ...visualResults, version: 4 }), '版本变化必须拦截');
  assert.ok(visualBindingMismatch(matching, { ...visualResults, review: { ...review, selected_variation_ids: ['v-2'] } }), '评审选择变化必须拦截');
  assert.ok(visualBindingMismatch(matching, { ...visualResults, review: { ...review, notes: '改写后的评审' } }), '评审内容变化必须拦截');
  assert.equal(visualReviewHash(visualResults), visualReviewHash({ ...visualResults }), 'hash 对相同评审稳定');
  assert.notEqual(visualReviewHash(visualResults), visualReviewHash({ ...visualResults, review: { ...review, mode: 'combine' } }));
});

// P0-04：合成入口不再静默回退第一张，且 strict 路线要求审查对象与待合成
// 底图一致；失败的尝试不得把仍然有效的链路变 stale。
test('composeVisual requires an explicit variation whose critique evidence matches', async () => {
  await withWorkspace('design-copilot-evidence-compose-', async (root) => {
    const projectStore = createProjectStore({ workspaceRoot: root });
    const strict = await projectStore.create({ name: 'Evidence Strict', projectType: 'existing', requirement: 'Compose with matching evidence.' });
    assert.equal(strict.continuation_mode, 'existing-strict');
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    // AUD-05：证据链门禁要重验像素 hash，variation 必须是可读取的本地文件。
    const resolved = await projectStore.resolveProject(strict.id);
    const v1Bytes = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#223355ff' } }).png().toBuffer();
    const v2Bytes = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#553322ff' } }).png().toBuffer();
    await fs.mkdir(path.join(resolved.workspacePath, 'screens', 'main', 'explorations'), { recursive: true });
    await fs.writeFile(path.join(resolved.workspacePath, 'screens', 'main', 'explorations', 'v1.png'), v1Bytes);
    await fs.writeFile(path.join(resolved.workspacePath, 'screens', 'main', 'explorations', 'v2.png'), v2Bytes);
    const v1Hash = hashBuffer(await sharp(v1Bytes).png().toBuffer());
    await projectStore.saveArtifact(strict.id, 'visual-results', {
      schema_version: '2.0', id: 'main-visual-results', version: 1, status: 'generated',
      variations: [
        { id: 'v-1', strategy: 'conservative', image_path: 'screens/main/explorations/v1.png', status: 'generated' },
        { id: 'v-2', strategy: 'expressive', image_path: 'screens/main/explorations/v2.png', status: 'generated' }
      ]
    }, { screenId: 'main' });

    // 未指定 / 未知 variationId 都必须显式失败，绝不静默回退第一张。
    await assert.rejects(
      pipeline.composeVisual(strict.id, { screenId: 'main' }),
      (error) => error.code === ERROR_CODES.VISUAL_VARIATION_NOT_FOUND
    );
    await assert.rejects(
      pipeline.composeVisual(strict.id, { screenId: 'main', variationId: 'missing' }),
      (error) => error.code === ERROR_CODES.VISUAL_VARIATION_NOT_FOUND
    );

    // Critique 审的是 v-1（携带 hash 与 Visual Results 版本绑定）：
    // 合成 v-2 必须被证据链门禁拦截。
    await projectStore.saveArtifact(strict.id, 'underlay-critique', {
      schema_version: '2.0', id: 'critique-1', version: 1, status: 'reviewed', result: 'passed',
      source: { underlay: 'v-1', underlay_hash: v1Hash, visual_results_id: 'main-visual-results', visual_results_version: 1 }, issues: []
    }, { screenId: 'main' });
    await projectStore.saveArtifact(strict.id, 'composition-manifest', {
      schema_version: '1.0', id: 'main-composition-manifest', version: 1, status: 'approved', mode: 'final', source: {}
    }, { screenId: 'main' });
    await assert.rejects(
      pipeline.composeVisual(strict.id, { screenId: 'main', variationId: 'v-2' }),
      (error) => error.code === ERROR_CODES.UNDERLAY_EVIDENCE_MISMATCH
    );
    // 门禁校验在失效旧证据之前：失败尝试不得污染仍然有效的交付链。
    let reopened = await projectStore.open(strict.id, { includePreviews: false, screenId: 'main' });
    assert.equal(reopened.artifacts.compositionManifest.status, 'approved');
    assert.equal(reopened.artifacts.underlayCritique.status, 'reviewed');

    // 证据匹配时放行门禁：后续失败只能来自下游确定性环节，而不是证据链。
    await assert.rejects(
      pipeline.composeVisual(strict.id, { screenId: 'main', variationId: 'v-1' }),
      (error) => error.code !== ERROR_CODES.UNDERLAY_EVIDENCE_MISMATCH && error.code !== ERROR_CODES.VISUAL_VARIATION_NOT_FOUND
    );

    // AUD-05：stale Critique 必须直接失败，不得凭旧 passed 结论放行。
    await projectStore.saveArtifact(strict.id, 'underlay-critique', {
      schema_version: '2.0', id: 'critique-1', version: 2, status: 'stale', stale_reason: 'visual_results_regenerated', result: 'passed',
      source: { underlay: 'v-1', underlay_hash: v1Hash, visual_results_id: 'main-visual-results', visual_results_version: 1 }, issues: []
    }, { screenId: 'main' });
    await assert.rejects(
      pipeline.composeVisual(strict.id, { screenId: 'main', variationId: 'v-1' }),
      (error) => error.code === ERROR_CODES.UNDERLAY_EVIDENCE_STALE
    );

    // AUD-05：像素 hash 对不上（同 ID 重新生成后像素已变）同样拦截。
    await projectStore.saveArtifact(strict.id, 'underlay-critique', {
      schema_version: '2.0', id: 'critique-1', version: 3, status: 'reviewed', result: 'passed',
      source: { underlay: 'v-1', underlay_hash: 'sha256:outdated', visual_results_id: 'main-visual-results', visual_results_version: 1 }, issues: []
    }, { screenId: 'main' });
    await assert.rejects(
      pipeline.composeVisual(strict.id, { screenId: 'main', variationId: 'v-1' }),
      (error) => error.code === ERROR_CODES.UNDERLAY_EVIDENCE_MISMATCH
    );

    // AUD-05：Visual Results 版本漂移（审查后又生成/评审过）同样拦截。
    await projectStore.saveArtifact(strict.id, 'underlay-critique', {
      schema_version: '2.0', id: 'critique-1', version: 4, status: 'reviewed', result: 'passed',
      source: { underlay: 'v-1', underlay_hash: v1Hash, visual_results_id: 'main-visual-results', visual_results_version: 99 }, issues: []
    }, { screenId: 'main' });
    await assert.rejects(
      pipeline.composeVisual(strict.id, { screenId: 'main', variationId: 'v-1' }),
      (error) => error.code === ERROR_CODES.UNDERLAY_EVIDENCE_MISMATCH
    );
    // 后续三次证据门禁失败都没有再改动链路：Manifest 保持上一步“通过门禁后
    // 下游失败”留下的 stale 状态（再生成尝试取代旧证据的正确语义），而不是
    // 被失败尝试洗成别的状态。
    reopened = await projectStore.open(strict.id, { includePreviews: false, screenId: 'main' });
    assert.equal(reopened.artifacts.compositionManifest.status, 'stale');
    assert.equal(reopened.artifacts.compositionManifest.stale_reason, 'preview_composition_regenerated');

    // exploration 路线没有污染审查链，指定有效方向即放行证据门禁。
    const exploration = await projectStore.create({ name: 'Evidence Exploration', projectType: 'new', requirement: 'Compose freely.' });
    await projectStore.saveArtifact(exploration.id, 'visual-results', {
      schema_version: '2.0', id: 'main-visual-results', version: 1, status: 'generated',
      variations: [{ id: 'e-1', strategy: 'conservative', image_url: 'https://kunpoapiimg.ziy.cc/e1.png', status: 'generated' }]
    }, { screenId: 'main' });
    await assert.rejects(
      pipeline.composeVisual(exploration.id, { screenId: 'main', variationId: 'e-1' }),
      (error) => error.code !== ERROR_CODES.UNDERLAY_EVIDENCE_MISMATCH && error.code !== ERROR_CODES.VISUAL_VARIATION_NOT_FOUND
    );
  });
});

// P0-05：视觉评审决策变化属于 visual-results 变化事件——strict 依赖图上
// 审查/合成/输出/保真整条生产链必须先失效，旧交付链不得继续放行。
test('approving a new visual review stales the strict production chain', async () => {
  await withWorkspace('design-copilot-evidence-review-', async (root) => {
    const projectStore = createProjectStore({ workspaceRoot: root });
    const project = await projectStore.create({ name: 'Evidence Review', projectType: 'existing', requirement: 'Review change stales the chain.' });
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    await projectStore.saveArtifact(project.id, 'visual-results', {
      schema_version: '2.0', id: 'main-visual-results', version: 1, status: 'generated',
      variations: [{ id: 'v-1', strategy: 'conservative', image_url: 'https://kunpoapiimg.ziy.cc/v1.png', status: 'generated' }]
    }, { screenId: 'main' });
    await projectStore.saveArtifact(project.id, 'underlay-critique', {
      schema_version: '2.0', id: 'critique-1', version: 1, status: 'reviewed', result: 'passed', source: { underlay: 'v-1' }, issues: []
    }, { screenId: 'main' });
    await projectStore.saveArtifact(project.id, 'composition-manifest', {
      schema_version: '1.0', id: 'main-composition-manifest', version: 1, status: 'approved', mode: 'final', source: {}
    }, { screenId: 'main' });
    await projectStore.saveArtifact(project.id, 'composition-output', {
      schema_version: '1.0', id: 'main-composition-output', version: 1, status: 'generated'
    }, { screenId: 'main' });
    await projectStore.saveArtifact(project.id, 'fidelity-report', {
      schema_version: '1.0', id: 'main-fidelity-report', version: 1, status: 'passed', issues: []
    }, { screenId: 'main' });

    const reviewed = await pipeline.approveArtifact(project.id, 'visual-results', { screenId: 'main', selectedIds: ['v-1'] });
    assert.equal(reviewed.artifacts.visualResults.version, 2);
    assert.deepEqual(reviewed.artifacts.visualResults.review.selected_variation_ids, ['v-1']);
    const reopened = await projectStore.open(project.id, { includePreviews: false, screenId: 'main' });
    for (const [label, artifact] of Object.entries({
      'underlay-critique': reopened.artifacts.underlayCritique,
      'composition-manifest': reopened.artifacts.compositionManifest,
      'composition-output': reopened.artifacts.compositionOutput,
      'fidelity-report': reopened.artifacts.fidelityReport
    })) {
      assert.equal(artifact.status, 'stale', `${label} 必须被评审变化失效`);
      assert.equal(artifact.stale_reason, 'visual_review_changed', `${label} 的失效原因必须是评审变化`);
    }
  });
});

// P0-05：strict 重新生成即取代旧证据——即使后续生图失败，旧的审查/合成链
// 也不得继续被信任（失效发生在生图之前）。
test('strict underlay regeneration stales the evidence chain before generation', async () => {
  await withWorkspace('design-copilot-evidence-regen-', async (root) => {
    const projectStore = createProjectStore({ workspaceRoot: root });
    let project = await projectStore.create({ name: 'Evidence Regen', projectType: 'existing', requirement: 'Regeneration supersedes evidence.' });
    const wireframe = path.join(root, 'wireframe.png');
    await fs.writeFile(wireframe, pngHeader(1920, 1080));
    project = await projectStore.importFile(project.id, wireframe, 'wireframe');
    await projectStore.saveArtifact(project.id, 'approved-layout', {
      schema_version: '1.0', id: 'approved-layout', version: 1, status: 'approved', source: {}, label: '横屏主布局', proposal: { name: '横屏主布局' }
    }, { screenId: 'main' });
    await projectStore.saveArtifact(project.id, 'style-contract', {
      schema_version: '1.0', id: 'style', style_id: 'wuxia', version: 1, status: 'approved', source: {}, visual_identity: { theme: '水墨武侠' }
    });
    await projectStore.saveArtifact(project.id, 'underlay-contract', {
      schema_version: '2.0', id: 'main-underlay-contract', version: 1, status: 'approved', source: {},
      layout_guide: { path: 'screens/main/layout-guide.md' }
    }, { screenId: 'main' });
    await projectStore.saveArtifact(project.id, 'underlay-critique', {
      schema_version: '2.0', id: 'critique-1', version: 1, status: 'reviewed', result: 'passed', source: { underlay: 'v-old' }, issues: []
    }, { screenId: 'main' });
    await projectStore.saveArtifact(project.id, 'composition-manifest', {
      schema_version: '1.0', id: 'main-composition-manifest', version: 1, status: 'approved', mode: 'final', source: {}
    }, { screenId: 'main' });
    const fakeClient = {
      requestArtifact: async () => null,
      generateImage: async () => { throw new Error('provider down'); }
    };
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: fakeClient, kunpoConfig: {} });
    await assert.rejects(
      pipeline.runStage(project.id, 'visual_exploration', { screenId: 'main', strategies: ['conservative'] }),
      /provider down/
    );
    // 生图失败，但旧证据链已经被取代：不允许继续信任旧审查/旧合成。
    const reopened = await projectStore.open(project.id, { includePreviews: false, screenId: 'main' });
    assert.equal(reopened.artifacts.underlayCritique.status, 'stale');
    assert.equal(reopened.artifacts.underlayCritique.stale_reason, 'visual_results_regenerated');
    assert.equal(reopened.artifacts.compositionManifest.status, 'stale');
    assert.equal(reopened.artifacts.compositionManifest.stale_reason, 'visual_results_regenerated');
  });
});

// P0-05 + P0-06：最终批准边界——stale Manifest 不得重批，绑定已漂移的
// Manifest 不得批准；导出边界同样重验视觉绑定。
test('final approval and export reverify the visual binding', async () => {
  await withWorkspace('design-copilot-evidence-approval-', async (root) => {
    const projectStore = createProjectStore({ workspaceRoot: root });
    const project = await projectStore.create({ name: 'Evidence Approval', projectType: 'existing', requirement: 'Final approval rechecks binding.' });
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });

    // stale Manifest 不得再次批准（合成产物不在批准即重验白名单内）。
    await projectStore.saveArtifact(project.id, 'composition-manifest', {
      schema_version: '1.0', id: 'main-composition-manifest', version: 1, status: 'stale', mode: 'final', stale_reason: 'visual_review_changed', source: {}
    }, { screenId: 'main' });
    await assert.rejects(
      pipeline.approveArtifact(project.id, 'composition-manifest', { screenId: 'main' }),
      (error) => error.code === ERROR_CODES.STALE_REAPPROVAL_BLOCKED
    );

    // Manifest 记录的是 V1 视觉结果，当前已是 V2：最终批准必须拦截。
    await projectStore.saveArtifact(project.id, 'visual-results', {
      schema_version: '2.0', id: 'main-visual-results', version: 2, status: 'generated',
      variations: [{ id: 'v-1', strategy: 'conservative', image_url: 'https://kunpoapiimg.ziy.cc/v1.png', status: 'generated' }]
    }, { screenId: 'main' });
    await projectStore.saveArtifact(project.id, 'composition-manifest', {
      schema_version: '1.0', id: 'main-composition-manifest', version: 2, status: 'generated', mode: 'final',
      source: { visual_results_version: 1, selected_variation_ids: ['v-1'], review_hash: '' }
    }, { screenId: 'main' });
    await assert.rejects(
      pipeline.approveArtifact(project.id, 'composition-manifest', { screenId: 'main' }),
      (error) => error.code === ERROR_CODES.VISUAL_RESULTS_BINDING_STALE
    );

    // 导出边界：未批准 → FINAL_APPROVAL_REQUIRED；绑定漂移 → BINDING_STALE；
    // 旧格式 Manifest（无绑定字段）不受新门禁约束。
    assert.throws(
      () => assertFinalApprovalForExport({ artifacts: { compositionManifest: { status: 'generated', source: {} } } }),
      (error) => error.code === ERROR_CODES.FINAL_APPROVAL_REQUIRED
    );
    assert.throws(
      () => assertFinalApprovalForExport({
        artifacts: {
          compositionManifest: { status: 'approved', source: { visual_results_version: 1, selected_variation_ids: [], review_hash: '' } },
          visualResults: { version: 2 }
        }
      }),
      (error) => error.code === ERROR_CODES.VISUAL_RESULTS_BINDING_STALE
    );
    assertFinalApprovalForExport({ artifacts: { compositionManifest: { status: 'approved', source: {} } } });
  });
});

// P0-06：来源修订重验——对着旧输入生成的契约不得被批准为新事实；
// 修订一致时批准正常放行。
test('contract approval rechecks recorded source input revisions', async () => {
  await withWorkspace('design-copilot-evidence-revisions-', async (root) => {
    const projectStore = createProjectStore({ workspaceRoot: root });
    const project = await projectStore.create({ name: 'Evidence Revisions', projectType: 'existing', requirement: 'Revisions must match.' });
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });

    // screen-contract 记录的是旧输入修订（requirement 已变化）→ 拒绝批准。
    // AUD-06 后批准即完整重验，fixture 必须携带完整可验证字段。
    const contractBase = {
      screen_id: 'main', secondary_actions: [], data_dependencies: [],
      design_constraints: {}, source_inventory: { requirement_functions: [], wireframe_controls: [], wireframe_information: [] },
      coverage: { covered_items: [], uncovered_items: [] }
    };
    await projectStore.saveArtifact(project.id, 'screen-contract', {
      schema_version: '2.0', id: 'main-screen-contract', version: 1, status: 'generated',
      source: { input_revisions: { requirement: 1, wireframe: 0, art_direction: 0, references: 0 } },
      screen_name: '阵容编成', purpose: '编成', primary_action: '保存', required_controls: [], required_information: [], states: [], edge_cases: [],
      ...contractBase
    }, { screenId: 'main' });
    await assert.rejects(
      pipeline.approveArtifact(project.id, 'screen-contract', { screenId: 'main' }),
      (error) => error.code === ERROR_CODES.STALE_REAPPROVAL_BLOCKED
    );

    // 修订与当前输入一致 → 批准放行。
    await projectStore.saveArtifact(project.id, 'screen-contract', {
      schema_version: '2.0', id: 'main-screen-contract', version: 2, status: 'generated',
      source: { input_revisions: { requirement: 0, wireframe: 0, art_direction: 0, references: 0 } },
      screen_name: '阵容编成', purpose: '编成', primary_action: '保存', required_controls: [], required_information: [], states: [], edge_cases: [],
      ...contractBase
    }, { screenId: 'main' });
    const approved = await pipeline.approveArtifact(project.id, 'screen-contract', { screenId: 'main' });
    assert.equal(approved.artifacts.screenContract.status, 'approved');

    // style-contract 同样受来源修订重验约束。
    await projectStore.saveArtifact(project.id, 'style-contract', {
      schema_version: '1.0', id: 'style', style_id: 'wuxia', version: 1, status: 'generated',
      source: { input_revisions: { requirement: 0, wireframe: 5, art_direction: 0, references: 0 } }, visual_identity: { theme: '水墨武侠' }
    });
    await assert.rejects(
      pipeline.approveArtifact(project.id, 'style-contract'),
      (error) => error.code === ERROR_CODES.STALE_REAPPROVAL_BLOCKED
    );
  });
});
