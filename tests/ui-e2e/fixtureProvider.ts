// Fixture provider for UI E2E (REM-04): a local HTTP server that impersonates
// the Kunpo gateway. Semantic responses are derived from the published golden
// evidence workspace (desensitized recordings), so the app exercises every
// real backend gate while only the external network boundary is replaced.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const GOLDEN_WORKSPACE = path.resolve(here, '../../release-evidence/golden-samples/existing-continuation/evidence/workspace');
// Binary inputs come from the tracked golden source assets (identical bytes to
// the published evidence workspace where hashes overlap), so CI needs no
// locally generated files. Semantic JSON still reads from the tracked
// evidence workspace.
const GOLDEN_INPUTS = path.resolve(here, '../../release-evidence/golden-samples/existing-continuation/inputs');
const SHARED_FONTS = path.resolve(here, '../../release-evidence/golden-samples/_shared/fonts');

export const GOLDEN_ASSETS = {
  wireframe: path.join(GOLDEN_INPUTS, 'wireframe.png'),
  references: [
    path.join(GOLDEN_INPUTS, 'references/reference-1.png'),
    path.join(GOLDEN_INPUTS, 'references/reference-2.png'),
    path.join(GOLDEN_INPUTS, 'references/reference-3.png')
  ],
  font: path.join(SHARED_FONTS, 'Oxanium-wght.ttf'),
  components: {
    'primary-button': ['default', 'pressed', 'disabled'],
    'bottom-navigation': ['default', 'selected', 'disabled'],
    'section-tab': ['default', 'selected', 'disabled'],
    'resource-bar': ['default'],
    'content-panel': ['default'],
    'action-icon': ['default'],
    'status-badge': ['default'],
    'list-row': ['default']
  } as Record<string, string[]>,
  componentAsset: (family: string, state: string) => path.join(GOLDEN_INPUTS, `components/${family}/${state}.png`),
  contaminatedUnderlay: path.join(GOLDEN_INPUTS, 'known-contaminated-underlay.png'),
  repairedUnderlay: path.join(GOLDEN_INPUTS, 'clean-underlay.png')
};

// The golden screen-contract predates binding-policy-v1, so E2E derives
// control roles from control ids into the frozen policy vocabulary. The
// derived artifact was verified against validateArtifact before adoption.
const CONTROL_ROLE_BY_ID: Record<string, string> = {
  'primary-action': 'primary-action',
  'secondary-action': 'secondary-action',
  navigation: 'navigation',
  tab: 'tab',
  resources: 'resource',
  content: 'content-panel',
  'icon-a': 'icon-action',
  'icon-b': 'icon-action',
  badge: 'status-badge',
  row: 'list-row'
};

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN_WORKSPACE, relativePath), 'utf8'));
}

function stripArtifactMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value };
  for (const key of ['schema_version', 'id', 'version', 'status', 'source', 'approved_at', 'approved_by', 'approval']) delete copy[key];
  return copy;
}

function derivedScreenContract(screenId = 'main'): Record<string, unknown> {
  const contract = stripArtifactMetadata(readJson('screens/main/screen-contract.json'));
  const controls = Array.isArray(contract.required_controls) ? contract.required_controls as Array<Record<string, unknown>> : [];
  contract.required_controls = controls.map((control) => ({ ...control, role: CONTROL_ROLE_BY_ID[String(control.id)] || String(control.role || 'action') }));
  // Multi-screen isolation (UIE2E-02B): each screen receives a contract that
  // is stamped with its own screen id, mirroring what a real provider would
  // return for that screen's envelope id.
  contract.screen_id = screenId;
  return contract;
}

function semanticResponse(value: unknown) {
  return {
    id: 'chatcmpl-ui-e2e',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'fixture-vision',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }]
  };
}

// v1.4 §7/§12.2：Intent Analysis v2 合法 fixture。形状与八类 audit 必须通过
// 服务端 intentAnalysis.cjs 的权威校验；spec 可用 overrides 派生变体。
const UNCERTAINTY_AUDIT_CATEGORIES = [
  'state_semantics', 'reward_rules', 'entry_navigation', 'unlock_preconditions',
  'resource_economy', 'interaction_limits', 'background_behavior', 'data_source_refresh'
];

export function intentAnalysisV2Fixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    page_type: 'modal_overlay',
    page_purpose: '展示 BOSS 伤害进度与奖励节点，并提供挑战入口',
    player_tasks: [{ id: 'task-check-damage', text: '查看个人与全派伤害信息' }],
    core_flow: [
      { id: 'flow-open', text: '打开 BOSS 挑战弹窗' },
      { id: 'flow-challenge', text: '点击挑战进入战斗' }
    ],
    screen_layers: [
      { id: 'background', kind: 'background_frame', name: '压暗的主界面', parent_id: null },
      { id: 'modal', kind: 'modal', name: 'BOSS 挑战弹窗', parent_id: null }
    ],
    visible_controls: [
      { id: 'control-challenge', layer_id: 'modal', visible_label: '挑战', visible_text: '', observed_states: [], claimed_states: [] }
    ],
    visible_information_and_states: [
      { id: 'info-rewards', layer_id: 'modal', visible_label: '奖励进度', visible_text: '99万/999万', observed_states: [], claimed_states: [] }
    ],
    uncertainties: [],
    uncertainty_audit: UNCERTAINTY_AUDIT_CATEGORIES.map((category) => ({ category, status: 'no_gap_found', uncertainty_ids: [], rationale: '' })),
    ...overrides
  };
}

// 带一个非阻断级待确认项的变体：确认前必须在 UI 里处理它（§10.5）。
export function intentAnalysisV2WithUncertainty(): Record<string, unknown> {
  return intentAnalysisV2Fixture({
    uncertainties: [
      { id: 'uncertainty-reward-reset', category: 'reward_rules', question: '奖励进度每日零点重置还是按周重置？', priority: 'important', evidence_ids: ['info-rewards'] }
    ],
    uncertainty_audit: UNCERTAINTY_AUDIT_CATEGORIES.map((category) => (
      category === 'reward_rules'
        ? { category, status: 'questions_present', uncertainty_ids: ['uncertainty-reward-reset'], rationale: '图中看不出重置周期' }
        : { category, status: 'no_gap_found', uncertainty_ids: [], rationale: '' }
    ))
  });
}

function dataUrl(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const mime = extension === 'jpg' ? 'jpeg' : extension;
  return `data:image/${mime || 'png'};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function promptText(body: Record<string, unknown>): string {
  const content = (body?.messages as Array<{ content: unknown }>)?.[0]?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && (part as { type?: string; text?: string }).type === 'text' ? String((part as { text?: string }).text || '') : ''))
      .join('\n');
  }
  return '';
}

export class FixtureProvider {
  baseUrl = '';
  requests: Array<{ kind: string; head: string }> = [];
  private server: http.Server | null = null;
  private chatFailures = 0;
  private imageQueue: string[] = [];
  private critiqueQueue: string[] = [];
  private intentQueue: Array<Record<string, unknown>> = [];

  armUnderlayGeneration() {
    this.imageQueue.push(GOLDEN_ASSETS.contaminatedUnderlay, GOLDEN_ASSETS.contaminatedUnderlay, GOLDEN_ASSETS.contaminatedUnderlay);
  }

  armRepair() {
    this.imageQueue.push(GOLDEN_ASSETS.repairedUnderlay);
  }

  armCritiqueSequence(results: Array<'contaminated' | 'repaired'>) {
    this.critiqueQueue = results.map((kind) =>
      fs.readFileSync(path.join(GOLDEN_WORKSPACE, `screens/main/reviews/known-contaminated${kind === 'repaired' ? '-repair-v1' : ''}-semantic-response.json`), 'utf8'));
  }

  failNextChatRequests(count: number) { this.chatFailures = count; }

  // v1.4 §12.2：按顺序返回给定的 v2 分析（合法/非法变体），队列耗尽后回落默认合法 fixture。
  armIntentAnalysisSequence(values: Array<Record<string, unknown>>) { this.intentQueue = [...values]; }

  async start(): Promise<void> {
    this.server = http.createServer((request, response) => { void this.handle(request, response); });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('fixture provider failed to bind');
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const send = (status: number, payload: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    if (request.method === 'POST' && request.url === '/chat/completions') {
      const prompt = promptText(JSON.parse(bodyText || '{}'));
      this.requests.push({ kind: 'chat', head: prompt.slice(0, 160) });
      if (this.chatFailures > 0) { this.chatFailures -= 1; return send(500, { error: { message: 'fixture provider injected failure' } }); }
      try { return send(200, semanticResponse(this.routeSemantic(prompt))); }
      catch (cause) { return send(500, { error: { message: String((cause as Error).message) } }); }
    }
    if (request.method === 'POST' && request.url === '/images/tasks') {
      this.requests.push({ kind: 'image', head: bodyText.slice(0, 160) });
      const filePath = this.imageQueue.shift();
      if (!filePath) return send(500, { error: { message: 'fixture provider image queue exhausted' } });
      return send(200, { task_id: `e2e-task-${this.requests.length}`, status: 'succeeded', result_url: dataUrl(filePath) });
    }
    if (request.method === 'GET' && request.url?.startsWith('/images/tasks/')) {
      return send(200, { task_id: request.url.split('/').pop(), status: 'succeeded' });
    }
    send(404, { error: { message: `fixture provider: unrouted ${request.method} ${request.url}` } });
  }

  private routeSemantic(prompt: string): unknown {
    // v1.4 §7：TASK_KIND 首行路由。v2 Intent Prompt 只允许命中 v2 fixture，
    // 队列可注入非法分析验证纠正环；无匹配路由硬失败。
    if (prompt.startsWith('TASK_KIND: intent-analysis-v2')) {
      return this.intentQueue.shift() ?? intentAnalysisV2Fixture();
    }
    if (prompt.includes('independent game UI underlay reviewer')) {
      const next = this.critiqueQueue.shift();
      if (!next) throw new Error('fixture provider critique queue exhausted');
      return JSON.parse(String(JSON.parse(next).raw_text));
    }
    if (prompt.includes('Attempt 1 failed') || prompt.includes('Attempt 2 failed')) {
      // Repair feedback retries must keep routing to the original payload;
      // the original prompt prefix is preserved, so fall through below.
    }
    // Most specific envelope id first: layout/style prompts may quote other
    // artifact ids (e.g. the approved screen contract) in their bodies.
    if (prompt.includes('-style-contract')) return stripArtifactMetadata(readJson('style/style-contract.json'));
    if (prompt.includes('-layout-proposals')) return stripArtifactMetadata(readJson('screens/main/layout-proposals.json'));
    if (prompt.includes('-screen-contract')) {
      const envelope = prompt.match(/"id":"([a-z0-9-]+)-screen-contract"/);
      return derivedScreenContract(envelope?.[1]);
    }
    throw new Error(`fixture provider: unrouted semantic prompt (${prompt.slice(0, 120)}…)`);
  }
}
