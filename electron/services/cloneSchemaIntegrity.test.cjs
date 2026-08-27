// AUD-13 + M4-H1：Schema-aware Clone 完整性。先用真实 pipeline 在 main Screen 上
// 生成完整 Strict Artifact 树（Contract → Layout → Style → Underlay Contract
// → Visual Exploration → Critique → Repair → 真实合成 → 真实保真），再
// Duplicate Screen，递归扫描副本目录：除明确 provenance
//（duplicated_from_screen_id）外不得残留原 Screen 身份；task_id /
// visual_tasks / visual_results_id / underlay_id / parent_underlay_id /
// repair_task_id / critique / layout_version / underlay_critique / issue_id
// 等生产字段必须全部重写到新 Screen。
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fsSync = require('node:fs');
const sharp = require('sharp');
const { createDesignPipeline } = require('./designPipeline.cjs');
const { createProjectStore } = require('./projectStore.cjs');
const { inspectFont } = require('./typographyAssets.cjs');

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function screenContractFixture(input) {
  return {
    schema_version: '2.0', id: input.id, version: 1, status: 'generated', source: input.source,
    screen_id: 'main', screen_name: 'Main', purpose: 'Clone integrity', primary_action: 'continue',
    secondary_actions: [], required_information: [], states: [], edge_cases: [], data_dependencies: [], design_constraints: {},
    required_controls: [{ id: 'continue', label: '继续', role: 'primary-action', required: true }],
    source_inventory: { requirement_functions: ['继续'], wireframe_controls: [], wireframe_information: [] },
    coverage: { covered_items: ['继续'], uncovered_items: [] }
  };
}

function layoutProposalsFixture(input) {
  return {
    schema_version: '1.0', id: input.id, version: 1, status: 'generated', source: input.source, screen_id: 'main',
    proposals: [
      { id: 'proposal-efficiency', name: '效率优先', strategy: 'efficiency', slots: [{ id: 'bottom', rect: { x: 0.1, y: 0.8, width: 0.8, height: 0.15 }, underlay_policy: { keep_clear: true } }] },
      { id: 'proposal-expression', name: '表现优先', strategy: 'expression', slots: [] },
      { id: 'proposal-balance', name: '平衡', strategy: 'balance', slots: [] }
    ]
  };
}

function styleContractFixture(input) {
  return {
    schema_version: '1.0', id: input.id, version: 1, status: 'generated', source: input.source,
    style_id: 'clone-style', visual_identity: { theme: '克隆完整性', mood: ['克制'], keywords: ['测试'] },
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

// 递归收集所有「值以原 Screen id 为前缀或完全相等」的字符串落点。
function collectSourceIdentity(node, sourceId, trail, hits) {
  if (typeof node === 'string') {
    if (node === sourceId || node.startsWith(`${sourceId}-`) || node.includes(`screens/${sourceId}/`)) hits.push({ trail: trail.join('.'), value: node });
    return;
  }
  if (Array.isArray(node)) { node.forEach((item, index) => collectSourceIdentity(item, sourceId, [...trail, String(index)], hits)); return; }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) collectSourceIdentity(value, sourceId, [...trail, key], hits);
  }
}

async function collectJsonHits(directory, sourceId) {
  const hits = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) { hits.push(...await collectJsonHits(full, sourceId)); continue; }
    if (!entry.name.endsWith('.json')) continue;
    const parsed = JSON.parse(await fs.readFile(full, 'utf8'));
    const fileHits = [];
    collectSourceIdentity(parsed, sourceId, [], fileHits);
    for (const hit of fileHits) hits.push({ file: entry.name, ...hit });
  }
  return hits;
}

function sha256(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

async function listAllFiles(directory, files = []) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await listAllFiles(full, files);
    else files.push(full);
  }
  return files;
}

// M4-I1：深遍历「path + sha256 hash」证据记录——文件必须存在，
// hash/byte_length 必须等于实际文件字节（四向一致）。
function checkEvidenceRecords(node, workspacePath, trail, problems) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => checkEvidenceRecords(item, workspacePath, [...trail, String(index)], problems));
    return;
  }
  if (node && typeof node === 'object') {
    if (typeof node.path === 'string' && typeof node.hash === 'string' && node.hash.startsWith('sha256:')) {
      const absolute = path.join(workspacePath, node.path);
      if (!fsSync.existsSync(absolute)) problems.push(`${trail.join('.')}: path ${node.path} 不存在`);
      else {
        const bytes = fsSync.readFileSync(absolute);
        if (sha256(bytes) !== node.hash) problems.push(`${trail.join('.')}: hash 与实际字节不符（${node.path}）`);
        if (typeof node.byte_length === 'number' && node.byte_length !== bytes.length) problems.push(`${trail.join('.')}: byte_length 与实际长度不符（${node.path}）`);
      }
    }
    for (const [key, value] of Object.entries(node)) checkEvidenceRecords(value, workspacePath, [...trail, key], problems);
  }
}

test('duplicate screen rewrites every production identity field (AUD-13 schema-aware clone)', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-clone-schema-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const projectStore = createProjectStore();
    // existing → strict 路线：visual_exploration 需要 Underlay Contract + Guide。
    let project = await projectStore.create({ name: 'Clone Schema', projectType: 'existing', requirement: 'Clone must rewrite every identity.' });
    const sourceImage = path.join(temporaryRoot, 'wireframe.png');
    await fs.writeFile(sourceImage, pngHeader(1080, 1920));
    project = await projectStore.importFile(project.id, sourceImage, 'wireframe');
    // strict 风格解析需要至少一张已批准参考页。
    const referenceImage = path.join(temporaryRoot, 'reference-1.png');
    await fs.writeFile(referenceImage, pngHeader(1920, 1080));
    project = await projectStore.importFile(project.id, referenceImage, 'reference');
    ({ project } = await projectStore.manageReference(project.id, { id: project.reference_assets[0].id, action: 'approval', approved: true }));

    const repairedBytes = await sharp({ create: { width: 128, height: 64, channels: 4, background: '#30343aff' } }).png().toBuffer();
    const generatedBytes = await sharp({ create: { width: 540, height: 960, channels: 4, background: '#1c2129ff' } }).png().toBuffer();
    const client = {
      requestArtifact: async (_config, input) => {
        if (input.kind === 'screen-contract') return screenContractFixture(input);
        if (input.kind === 'layout-proposals') return layoutProposalsFixture(input);
        if (input.kind === 'style-contract') return styleContractFixture(input);
        throw new Error(`unexpected artifact kind: ${input.kind}`);
      },
      // critique/repair 会真实 fetch underlay 证据：用 data: URL 内联返回。
      generateImage: async () => ({ url: `data:image/png;base64,${generatedBytes.toString('base64')}`, task_id: 'provider-clone' }),
      requestJson: async () => ({ confidence: 0.95, suspected_ui_regions: [], text_like_regions: [], slot_checks: [] }),
      repairImage: async () => ({ image_url: `data:image/png;base64,${repairedBytes.toString('base64')}`, task_id: 'provider-repair' })
    };
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: client, kunpoConfig: { configured: true, imageModel: 'image-test', visionModel: 'vision-test', providerCapabilities: { supports_inpaint: false, max_reference_images: 6 } } });

    // Contract（真实管线）；随后按 strict 门禁落 Font/Component/Bindings 事实。
    project = await pipeline.runStage(project.id, 'wireframe_interpretation', { screenId: 'main' });
    project = await pipeline.approveArtifact(project.id, 'screen-contract', { screenId: 'main' });
    // strict 依赖图中 Style 位于 Font/Component/Bindings/Layout 上游：
    // 先生成并批准 Style，再按 E2E 顺序落资产与绑定。
    project = await pipeline.runStage(project.id, 'style_resolution', { screenId: 'main' });
    project = await pipeline.approveArtifact(project.id, 'style-contract');
    // critique 的组件看板会真实读取组件资产：先落有效 PNG。
    const componentBytes = await sharp({ create: { width: 90, height: 40, channels: 4, background: '#d6b05fff' } }).png().toBuffer();
    const opened = await projectStore.open(project.id, { includePreviews: false });
    for (const name of ['button.png', 'button_pressed.png', 'button_disabled.png']) {
      const assetPath = path.join(opened.workspacePath, 'style', 'components', name);
      await fs.mkdir(path.dirname(assetPath), { recursive: true });
      await fs.writeFile(assetPath, componentBytes);
    }
    await projectStore.saveArtifact(project.id, 'component-contract', {
      schema_version: '2.0', id: 'components', version: 1, status: 'approved', source: {},
      families: [{
        id: 'button.primary', category: 'button', status: 'approved', reuse_mode: 'nine-slice',
        slice: { margins: [8, 8, 8, 8] },
        states: { default: { asset_path: 'style/components/button.png' }, pressed: { asset_path: 'style/components/button_pressed.png' }, disabled: { asset_path: 'style/components/button_disabled.png' } }
      }]
    });
    await projectStore.saveArtifact(project.id, 'font-manifest', await (async () => {
      // 真实 Compositor 的字体门禁要求 manifest 携带真实字体资产与 exact
      // 确认证据：落盘一份真实系统 TTF 并用 inspectFont 提取元数据。
      const systemFont = ['/System/Library/Fonts/Supplemental/Georgia.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf'].find((candidate) => fsSync.existsSync(candidate));
      assert.ok(systemFont, 'a real system TTF is required');
      const fontPath = path.join(opened.workspacePath, 'style', 'fonts', 'ui.ttf');
      await fs.mkdir(path.dirname(fontPath), { recursive: true });
      await fs.copyFile(systemFont, fontPath);
      const font = await inspectFont(fontPath);
      return {
        schema_version: '2.0', id: 'fonts', version: 1, status: 'approved', source: {},
        fonts: [{ id: 'ui', family_name: font.family_name, postscript_name: font.postscript_name, format: 'ttf', local_path: 'style/fonts/ui.ttf', file_hash: font.file_hash, license_status: 'confirmed', license_confirmation: { confirmed: true }, coverage: { zh_cn: true } }],
        roles: { 'button-label': { font_id: 'ui', fidelity_mode: 'exact', identity_critical: true, required_coverage: ['zh_cn'], exact_confirmation: { confirmed: true } } }
      };
    })());
    project = await pipeline.updateArtifact(project.id, 'component-bindings', {
      screenId: 'main',
      bindings: [{ control_id: 'continue', component_id: 'button.primary', state: 'default', slot_id: 'bottom', text: '继续', font_role: 'button-label' }]
    });
    project = await pipeline.approveArtifact(project.id, 'component-bindings', { screenId: 'main' });
    assert.equal(project.artifacts.bindings.status, 'approved');
    project = await pipeline.runStage(project.id, 'layout_design', { screenId: 'main' });
    project = await pipeline.approveArtifact(project.id, 'approved-layout', { screenId: 'main', proposalId: 'proposal-efficiency' });
    assert.equal(project.artifacts.approvedLayout.status, 'approved');

    // Strict 底层契约 + Layout Guide（真实管线）。
    project = await pipeline.createUnderlayContract(project.id, { screenId: 'main' });
    project = await pipeline.approveArtifact(project.id, 'underlay-contract', { screenId: 'main' });
    project = await pipeline.createLayoutGuide(project.id, { screenId: 'main' });
    assert.ok(project.artifacts.underlayContract.layout_guide?.path, 'layout guide must exist for strict visual generation');

    // Visual Exploration（真实管线）：task_id / visual_tasks / layout_version /
    // style_version 全部由生产代码写入。
    project = await pipeline.runStage(project.id, 'visual_exploration', { screenId: 'main', strategies: ['conservative'] });
    const variation = project.artifacts.visualResults.variations[0];
    assert.ok(variation.id.startsWith('main-'), 'variation/task id must be screen-scoped');
    assert.equal(project.artifacts.visualResults.source.visual_tasks, 'main-visual-tasks');
    assert.ok(variation.layout_version.startsWith('main-'));

    // Critique（真实管线）：source.underlay / visual_results_id 生产写入；
    // 随后注入一个 critical issue 以便驱动真实 Repair。
    project = await pipeline.critiqueUnderlay(project.id, { screenId: 'main', underlayId: variation.id });
    assert.equal(project.artifacts.underlayCritique.source.visual_results_id, project.artifacts.visualResults.id);
    const critiquePath = path.join(project.workspacePath, 'screens', 'main', 'underlay-critique.json');
    const critiqueJson = JSON.parse(await fs.readFile(critiquePath, 'utf8'));
    critiqueJson.result = 'failed';
    critiqueJson.issues = [{ issue_id: 'bad-1', severity: 'critical', type: 'button-like', slot_id: 'primary', reason: 'button residue' }];
    await fs.writeFile(critiquePath, JSON.stringify(critiqueJson, null, 2));

    // Repair（真实管线）：output.underlay_id / parent_underlay_id、修复
    // Variation 的 repair_task_id / parent_underlay_id、source.critique。
    project = await pipeline.repairUnderlay(project.id, { screenId: 'main', attempt: 1, maxAutomaticAttempts: 2 });
    const repairTask = project.artifacts.underlayRepairTask;
    assert.ok(repairTask.output.underlay_id.startsWith('main-'));
    assert.equal(repairTask.output.parent_underlay_id, variation.id);
    const repairedVariation = project.artifacts.visualResults.variations.find((item) => item.strategy === 'underlay-repair');
    assert.equal(repairedVariation.parent_underlay_id, variation.id);
    assert.equal(repairedVariation.repair_task_id, repairTask.id);

    // 对修复后的底图重新执行真实 Critique（source.underlay /
    // visual_results_id 生产写入），随后注入一个与生产同形态的 Screen 前缀
    // issue（underlayCritique.cjs 按 `${underlayId}-issue-N` 生成），再用
    // 真实 waiver 链路豁免，使 Critique 携带 manual_waivers 证据。
    project = await pipeline.critiqueUnderlay(project.id, { screenId: 'main', underlayId: repairedVariation.id });
    assert.equal(project.artifacts.underlayCritique.source.underlay, repairedVariation.id);
    const waivedIssueId = `${repairedVariation.id}-issue-1`;
    const finalCritiquePath = path.join(project.workspacePath, 'screens', 'main', 'underlay-critique.json');
    const finalCritiqueJson = JSON.parse(await fs.readFile(finalCritiquePath, 'utf8'));
    finalCritiqueJson.result = 'failed';
    finalCritiqueJson.issues = [{ issue_id: waivedIssueId, severity: 'major', type: 'button-like', slot_id: 'bottom', reason: 'residue near primary slot' }];
    await fs.writeFile(finalCritiquePath, JSON.stringify(finalCritiqueJson, null, 2));
    project = await pipeline.waiveUnderlayIssue(project.id, { screenId: 'main', issueId: waivedIssueId, reason: '设计负责人确认该残留属于场景元素，不构成功能入口' });
    assert.equal(project.artifacts.underlayCritique.result, 'passed-with-waiver');
    assert.equal(project.artifacts.underlayCritique.manual_waivers[0].issue_id, waivedIssueId);

    // Composition Manifest / Output（真实 Compositor）：source.underlay_critique
    // 由生产代码写入，不再手工保存简化对象。
    project = await pipeline.composeVisual(project.id, { screenId: 'main', variationId: repairedVariation.id, mode: 'final' });
    assert.ok(project.artifacts.compositionManifest.source.underlay_critique.startsWith('main-'), 'real compositor must stamp screen-scoped underlay_critique');

    // Fidelity Report（真实 runFidelity）：source.underlay_critique 与
    // underlay.manual_waivers[].issue_id 由生产代码写入。
    project = await pipeline.runFidelity(project.id, { screenId: 'main' });
    assert.ok(project.artifacts.fidelityReport.source.underlay_critique.startsWith('main-'), 'real fidelity must stamp screen-scoped underlay_critique');
    assert.equal(project.artifacts.fidelityReport.underlay.manual_waivers[0].issue_id, waivedIssueId);

    // Duplicate Screen 后递归扫描副本：除 provenance 外不得残留 main 身份。
    await projectStore.duplicateScreen(project.id, 'main', { id: 'battle', name: '战斗页副本' });
    const resolved = await projectStore.resolveProject(project.id);
    const hits = await collectJsonHits(path.join(resolved.workspacePath, 'screens', 'battle'), 'main');
    const provenance = hits.filter((hit) => hit.trail.split('.').includes('duplicated_from_screen_id'));
    const residue = hits.filter((hit) => !hit.trail.split('.').includes('duplicated_from_screen_id'));
    assert.deepEqual(residue, [], '副本不得残留原 Screen 身份');
    assert.equal(provenance.length, 1, '仅 screen input 的 duplicated_from_screen_id 保留原 Screen 指向');

    // 逐字段断言生产身份已重写到新 Screen。
    const readArtifact = async (relative) => JSON.parse(await fs.readFile(path.join(resolved.workspacePath, 'screens', 'battle', relative), 'utf8'));
    const visualTask = await readArtifact('visual-task.json');
    assert.equal(visualTask.id, 'battle-visual-tasks');
    assert.ok(visualTask.tasks[0].task_id.startsWith('battle-'));
    const visualResults = await readArtifact('explorations/results.json');
    assert.equal(visualResults.source.visual_tasks, 'battle-visual-tasks');
    assert.ok(visualResults.variations[0].layout_version.startsWith('battle-'));
    const clonedRepair = visualResults.variations.find((item) => item.strategy === 'underlay-repair');
    assert.ok(clonedRepair.parent_underlay_id.startsWith('battle-'));
    assert.ok(clonedRepair.repair_task_id.startsWith('battle-'));
    const critique = await readArtifact('underlay-critique.json');
    assert.ok(critique.source.visual_results_id.startsWith('battle-'));
    assert.ok(critique.source.underlay.startsWith('battle-'));
    // M4-H1：issue / waiver id 必须属于目标 Screen。
    assert.ok(critique.issues[0].issue_id.startsWith('battle-'), 'cloned critique issue_id must belong to target screen');
    assert.ok(critique.manual_waivers[0].issue_id.startsWith('battle-'), 'cloned waiver issue_id must belong to target screen');
    const repairTaskCloned = await readArtifact('underlay-repair-task.json');
    assert.ok(repairTaskCloned.source.critique.startsWith('battle-'));
    assert.ok(repairTaskCloned.output.underlay_id.startsWith('battle-'));
    assert.ok(repairTaskCloned.output.parent_underlay_id.startsWith('battle-'));
    const manifest = await readArtifact('composition-manifest.json');
    assert.ok(manifest.source.selected_variation_ids.every((id) => id.startsWith('battle-')));
    // 未经视觉评审的合成不携带 visual_results_id（生产 Compositor 仅在
    // visualResults 存在时写入），有值时必须属于目标 Screen。
    if (manifest.source.visual_results_id !== undefined) assert.ok(manifest.source.visual_results_id.startsWith('battle-'));
    // M4-H1：真实 Compositor 写入的 underlay_critique 引用属于目标 Screen。
    assert.ok(manifest.source.underlay_critique.startsWith('battle-'), 'cloned manifest underlay_critique must belong to target screen');
    assert.ok(manifest.output.artifact_id.startsWith('battle-'), 'cloned manifest output.artifact_id must belong to target screen');
    const fidelity = await readArtifact('fidelity-report.json');
    assert.ok(fidelity.source.underlay_critique.startsWith('battle-'), 'cloned fidelity underlay_critique must belong to target screen');
    assert.ok(fidelity.underlay.critique_id.startsWith('battle-'), 'cloned fidelity critique_id must belong to target screen');
    assert.ok(fidelity.underlay.manual_waivers[0].issue_id.startsWith('battle-'), 'cloned fidelity waiver issue_id must belong to target screen');
    // M4-I1（审核 §5.2）：物理文件名本身也是身份扫描对象——副本目录里
    // 不得出现仍带原 Screen 前缀的 basename。
    const clonedFiles = await listAllFiles(path.join(resolved.workspacePath, 'screens', 'battle'));
    const foreignBasenames = clonedFiles.filter((file) => path.basename(file).startsWith('main-'));
    assert.deepEqual(foreignBasenames, [], '副本物理文件名不得保留原 Screen 前缀');
    // M4-I1（审核 §5.3/§5.6）：每个「path + hash」证据记录必须与实际文件
    // 四向一致——文件存在、hash 与字节相符、byte_length 与长度相符。
    const evidenceProblems = [];
    for (const file of clonedFiles.filter((item) => item.endsWith('.json'))) {
      checkEvidenceRecords(JSON.parse(await fs.readFile(file, 'utf8')), resolved.workspacePath, [path.basename(file)], evidenceProblems);
    }
    assert.deepEqual(evidenceProblems, [], '副本证据记录必须与实际文件字节一致');
    // 语义证据内容被重写后，冻结的 hash/byte_length 必须已重算，且路径与
    // 其中记录的 underlay_id 均属于目标 Screen。
    assert.match(critique.evidence.semantic_raw.path, /^screens\/battle\/reviews\/battle-/, '语义证据路径必须属于目标 Screen');
    const semanticBytes = await fs.readFile(path.join(resolved.workspacePath, critique.evidence.semantic_raw.path));
    assert.equal(critique.evidence.semantic_raw.hash, sha256(semanticBytes), 'semantic_raw.hash 必须等于重写后的实际字节');
    assert.equal(critique.evidence.semantic_raw.byte_length, semanticBytes.length, 'semantic_raw.byte_length 必须等于实际长度');
    assert.equal(JSON.parse(semanticBytes.toString('utf8')).source.underlay_id, critique.source.underlay, '重写后的语义证据必须指向克隆底图');
    // M4-I1（审核 §6）：Fidelity 的 passed 状态不得原样继承到副本。
    assert.notEqual(fidelity.status, 'passed', '副本 Fidelity 不得继承 passed 状态');
    // approved 事实不继承（既有策略不回退）。
    assert.notEqual(visualTask.status, 'approved');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
