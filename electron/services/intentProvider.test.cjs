// PR-I2 provider tests (v1.4 §13.2)：prefillIntent 两阶段提交、provider 纠正环、
// Screen Contract 生成前门禁，以及完成门——捕获最终 Screen Contract Prompt，
// 证明 stale analysis 被机械排除、设计师已审内容继续生效。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDesignPipeline } = require('./designPipeline.cjs');
const { createProjectStore } = require('./projectStore.cjs');
const { createIntentStateStore } = require('./intentStateStore.cjs');
const kunpoClientModule = require('./kunpoClient.cjs');
const { UNCERTAINTY_CATEGORIES } = require('./intentAnalysis.cjs');

const KUNPO_CONFIG = { configured: true, baseUrl: 'https://example.test', visionModel: 'vision-fixture', mode: 'gateway' };
// 分析独有标记：只存在于 visible_facts（stale 时被排除）；
// 评审共有标记：存在于 review 渲染文本（始终保留）。
const ANALYSIS_MARKER = 'ALPHA7421';
const REVIEW_MARKER = 'GAMMA-DRAFT';

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function providerAnalysis(layerMarker) {
  return {
    page_type: 'full_screen',
    page_purpose: `每日奖励领取页 ${REVIEW_MARKER}`,
    player_tasks: [{ id: 'task-claim', text: '领取每日奖励' }],
    core_flow: [{ id: 'flow-claim', text: '打开奖励页并点击领取' }],
    screen_layers: [{ id: 'layer-main', kind: 'primary_content', name: `主内容层 ${layerMarker}`, parent_id: null }],
    visible_controls: [{ id: 'control-claim', layer_id: 'layer-main', visible_label: '领取', visible_text: '领取', observed_states: [], claimed_states: [] }],
    visible_information_and_states: [],
    uncertainties: [],
    uncertainty_audit: UNCERTAINTY_CATEGORIES.map((category) => ({ category, status: 'no_gap_found', uncertainty_ids: [], rationale: '' }))
  };
}

function jsonResponse(content) {
  return new Response(JSON.stringify({ id: 'resp-1', model: 'vision-fixture', choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}

// script(attempt) → 该次模型调用返回的 JSON 对象。
function fakeKunpoGateway(script) {
  const prompts = [];
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    prompts.push(JSON.parse(options.body).messages[0].content[0].text);
    return jsonResponse(script(calls));
  };
  return { prompts, callCount: () => calls };
}

function validContract(input) {
  return {
    schema_version: '1.0', id: input.id, version: 1, status: 'generated', source: input.source,
    screen_id: 'main', screen_name: '每日奖励领取', purpose: '领取每日奖励', primary_action: '领取奖励',
    secondary_actions: [], required_information: ['奖励进度'], required_controls: ['领取'], states: [], edge_cases: [], data_dependencies: [], design_constraints: {},
    source_inventory: { requirement_functions: ['领取奖励'], wireframe_controls: ['领取'], wireframe_information: ['奖励进度'] },
    coverage: { covered_items: ['领取奖励', '奖励进度'], uncovered_items: [] }
  };
}

async function setupScenario() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-intent-provider-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = root;
  const projectStore = createProjectStore();
  const intentStateStore = createIntentStateStore({ projectStore });
  projectStore.__attachIntentStore(intentStateStore);
  let project = await projectStore.create({ name: 'Intent Provider Project', projectType: 'new', requirement: '' });
  const wireframe = path.join(root, 'wireframe.png');
  await fs.writeFile(wireframe, pngHeader(1080, 1920));
  project = await projectStore.importFile(project.id, wireframe, 'wireframe');
  const contractRequests = [];
  const client = {
    ...kunpoClientModule,
    requestArtifact: async (_config, input) => { contractRequests.push(input); return validContract(input); }
  };
  const pipeline = createDesignPipeline({ projectStore, kunpoClient: client, kunpoConfig: KUNPO_CONFIG, intentStateStore });
  const restore = async () => {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(root, { recursive: true, force: true });
  };
  return { root, projectStore, intentStateStore, pipeline, project, contractRequests, restore };
}

const inputsJsonPath = (project) => path.join(project.workspacePath, 'screens', 'main', 'inputs.json');

test('prefillIntent runs the two-phase commit with a bounded correction loop', async () => {
  const scenario = await setupScenario();
  const originalFetch = global.fetch;
  try {
    // 第 1 次返回非法 page_type，触发纠正反馈；第 2 次返回合法分析。
    const gateway = fakeKunpoGateway((attempt) => attempt === 1 ? { ...providerAnalysis(ANALYSIS_MARKER), page_type: 'bogus' } : providerAnalysis(ANALYSIS_MARKER));
    const result = await scenario.pipeline.prefillIntent(scenario.project.id, { screenId: 'main' });
    assert.equal(result.adopted, 'first-draft');
    assert.equal(gateway.callCount(), 2);
    assert.equal(gateway.prompts[0].split('\n')[0], 'TASK_KIND: intent-analysis-v2');
    assert.match(gateway.prompts[1], /failed validation with/);
    const opened = await scenario.projectStore.open(scenario.project.id);
    assert.equal(opened.intent_mode, 'structured-v2');
    assert.equal(opened.intent_generation.status, 'ready');
    assert.equal(opened.intent_generation.purpose, 'first-draft');
    assert.equal(opened.requirement_confirmed, false);
    assert.ok(opened.requirement.trim().length > 0);
    assert.ok(opened.intent_review);
    assert.equal(opened.intent_analysis.provider.response_id, 'resp-1');
    assert.equal(opened.intent_analysis.source_revision.wireframe, 1);
    assert.ok(opened.intent_context?.hash?.startsWith('sha256:'));
  } finally {
    global.fetch = originalFetch;
    await scenario.restore();
  }
});

test('prefillIntent without an intent state store fails closed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-intent-nostore-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = root;
  try {
    const projectStore = createProjectStore();
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: kunpoClientModule, kunpoConfig: KUNPO_CONFIG });
    await assert.rejects(pipeline.prefillIntent('missing', { screenId: 'main' }), /Intent state store is not configured/);
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('prefillIntent writes a terminal validation-failed state after three failed corrections', async () => {
  const scenario = await setupScenario();
  const originalFetch = global.fetch;
  try {
    const gateway = fakeKunpoGateway(() => ({ page_type: 'bogus' }));
    await assert.rejects(
      scenario.pipeline.prefillIntent(scenario.project.id, { screenId: 'main' }),
      (error) => {
        assert.equal(error.code, 'INTENT_ANALYSIS_INVALID');
        return true;
      }
    );
    assert.equal(gateway.callCount(), 3);
    const opened = await scenario.projectStore.open(scenario.project.id);
    assert.equal(opened.intent_generation.status, 'validation-failed');
    assert.equal(opened.intent_generation.error_code, 'INTENT_ANALYSIS_INVALID');
    assert.ok(opened.intent_generation.finished_at);
  } finally {
    global.fetch = originalFetch;
    await scenario.restore();
  }
});

test('structured wireframe interpretation gates on confirmation, running generation and context hash', async () => {
  const scenario = await setupScenario();
  const { projectStore, intentStateStore, pipeline } = scenario;
  const originalFetch = global.fetch;
  try {
    fakeKunpoGateway(() => providerAnalysis(ANALYSIS_MARKER));
    await pipeline.prefillIntent(scenario.project.id, { screenId: 'main' });
    // 门禁 1：未确认的 Intent Review 不得进入 Screen Contract 生成。
    await assert.rejects(
      pipeline.runStage(scenario.project.id, 'wireframe_interpretation', { screenId: 'main' }),
      (error) => {
        assert.equal(error.code, 'INTENT_REVIEW_INCOMPLETE');
        return true;
      }
    );
    await intentStateStore.confirmIntentReview(scenario.project.id, 'main', { expectedIntentReviewRevision: 1 });
    // 门禁 2：生成中的 Intent 预填必须先出结果。
    const inputsPath = inputsJsonPath(scenario.project);
    const confirmedInputs = JSON.parse(await fs.readFile(inputsPath, 'utf8'));
    await fs.writeFile(inputsPath, JSON.stringify({ ...confirmedInputs, intent_generation: { ...confirmedInputs.intent_generation, status: 'running' } }));
    await assert.rejects(
      pipeline.runStage(scenario.project.id, 'wireframe_interpretation', { screenId: 'main' }),
      /Intent 预填正在运行/
    );
    await fs.writeFile(inputsPath, JSON.stringify(confirmedInputs));
    // 门禁 3：确认后的 canonical hash 与 inputs 记录不一致时拒绝生成。
    await fs.writeFile(inputsPath, JSON.stringify({ ...confirmedInputs, intent_context: { ...confirmedInputs.intent_context, hash: 'sha256:deadbeef' } }));
    await assert.rejects(
      pipeline.runStage(scenario.project.id, 'wireframe_interpretation', { screenId: 'main' }),
      (error) => {
        assert.equal(error.code, 'INTENT_REVISION_CONFLICT');
        return true;
      }
    );
    await fs.writeFile(inputsPath, JSON.stringify(confirmedInputs));
    // 全部通过：生成成功并绑定 intent context。
    const project = await pipeline.runStage(scenario.project.id, 'wireframe_interpretation', { screenId: 'main' });
    assert.equal(scenario.contractRequests.length, 1);
    const binding = project.artifacts.screenContract.source.intent_context;
    assert.equal(binding.wireframe_revision, 1);
    assert.equal(binding.intent_context_revision, project.intent_context.revision);
    assert.equal(binding.intent_context_hash, project.intent_context.hash);
  } finally {
    global.fetch = originalFetch;
    await scenario.restore();
  }
});

test('completion gate: the final Screen Contract prompt excludes stale analysis after wireframe replacement', async () => {
  const scenario = await setupScenario();
  const { projectStore, intentStateStore, pipeline } = scenario;
  const originalFetch = global.fetch;
  try {
    fakeKunpoGateway(() => providerAnalysis(ANALYSIS_MARKER));
    await pipeline.prefillIntent(scenario.project.id, { screenId: 'main' });
    await intentStateStore.confirmIntentReview(scenario.project.id, 'main', { expectedIntentReviewRevision: 1 });
    await pipeline.runStage(scenario.project.id, 'wireframe_interpretation', { screenId: 'main' });
    const freshPrompt = scenario.contractRequests[0].prompt;
    // fresh：visible_facts 携带分析独有标记，评审文本同样在场。
    assert.ok(freshPrompt.includes(ANALYSIS_MARKER));
    assert.ok(freshPrompt.includes(REVIEW_MARKER));
    assert.ok(freshPrompt.includes('Designer-confirmed Intent context (authoritative input):'));
    const firstHash = scenario.contractRequests[0].source.intent_context.intent_context_hash;

    // 替换 UE：确认被取消，stale analysis 必须重新确认后才可继续。
    const secondWireframe = path.join(scenario.root, 'wireframe-2.png');
    await fs.writeFile(secondWireframe, pngHeader(1080, 1920));
    await projectStore.importFile(scenario.project.id, secondWireframe, 'wireframe');
    const reopened = await projectStore.open(scenario.project.id);
    assert.equal(reopened.requirement_confirmed, false);
    assert.equal(reopened.input_revisions.wireframe, 2);
    await assert.rejects(
      pipeline.runStage(scenario.project.id, 'wireframe_interpretation', { screenId: 'main' }),
      (error) => {
        assert.equal(error.code, 'INTENT_REVIEW_INCOMPLETE');
        return true;
      }
    );
    await intentStateStore.confirmIntentReview(scenario.project.id, 'main', { expectedIntentReviewRevision: 1 });
    await pipeline.runStage(scenario.project.id, 'wireframe_interpretation', { screenId: 'main' });

    // 完成门证据：最终 Prompt 中 stale analysis 的独有标记被机械排除，
    // 设计师已审内容保留，且明确标注排除原因。
    const stalePrompt = scenario.contractRequests[1].prompt;
    assert.ok(!stalePrompt.includes(ANALYSIS_MARKER), 'stale analysis must not reach the Screen Contract prompt');
    assert.ok(stalePrompt.includes(REVIEW_MARKER));
    assert.match(stalePrompt, /The AI analysis context was excluded from this task \(wireframe_revision_mismatch\)/);
    const secondBinding = scenario.contractRequests[1].source.intent_context;
    assert.equal(secondBinding.wireframe_revision, 2);
    assert.notEqual(secondBinding.intent_context_hash, firstHash);
    const reopenedAfter = await projectStore.open(scenario.project.id);
    assert.equal(secondBinding.intent_context_hash, reopenedAfter.intent_context.hash);
  } finally {
    global.fetch = originalFetch;
    await scenario.restore();
  }
});

test('approving a Screen Contract whose recorded intent hash no longer matches the recomputed content is blocked', async () => {
  const scenario = await setupScenario();
  const { projectStore, intentStateStore, pipeline } = scenario;
  const originalFetch = global.fetch;
  try {
    fakeKunpoGateway(() => providerAnalysis(ANALYSIS_MARKER));
    await pipeline.prefillIntent(scenario.project.id, { screenId: 'main' });
    await intentStateStore.confirmIntentReview(scenario.project.id, 'main', { expectedIntentReviewRevision: 1 });
    await pipeline.runStage(scenario.project.id, 'wireframe_interpretation', { screenId: 'main' });
    const inputsPath = inputsJsonPath(scenario.project);
    const confirmedInputs = await fs.readFile(inputsPath, 'utf8');
    // 篡改已发布的 Intent 内容但保持记录的 intent_context.hash 不变：
    // heal 的 hash 比对不会预标 stale，批准时必须由 assertSourceRevisionsFresh
    // 的 Screen Contract 专用分支纯函数重算 hash 拦住。
    const tampered = JSON.parse(confirmedInputs);
    tampered.intent_review.player_tasks[0].text = '篡改后的任务文本';
    await fs.writeFile(inputsPath, JSON.stringify(tampered));
    await assert.rejects(
      pipeline.approveArtifact(scenario.project.id, 'screen-contract', { screenId: 'main' }),
      (error) => {
        assert.equal(error.code, 'STALE_REAPPROVAL_BLOCKED');
        assert.match(error.message, /Intent 内容已变化/);
        return true;
      }
    );
    // 恢复权威输入后：重新生成并批准必须放行。
    await fs.writeFile(inputsPath, confirmedInputs);
    await pipeline.runStage(scenario.project.id, 'wireframe_interpretation', { screenId: 'main' });
    const approved = await pipeline.approveArtifact(scenario.project.id, 'screen-contract', { screenId: 'main' });
    assert.equal(approved.artifacts.screenContract.status, 'approved');
  } finally {
    global.fetch = originalFetch;
    await scenario.restore();
  }
});
