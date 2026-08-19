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

function derivedScreenContract(): Record<string, unknown> {
  const contract = stripArtifactMetadata(readJson('screens/main/screen-contract.json'));
  const controls = Array.isArray(contract.required_controls) ? contract.required_controls as Array<Record<string, unknown>> : [];
  contract.required_controls = controls.map((control) => ({ ...control, role: CONTROL_ROLE_BY_ID[String(control.id)] || String(control.role || 'action') }));
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
    if (prompt.includes('independent game UI underlay reviewer')) {
      const next = this.critiqueQueue.shift();
      if (!next) throw new Error('fixture provider critique queue exhausted');
      return JSON.parse(String(JSON.parse(next).raw_text));
    }
    if (prompt.includes('Attempt 1 failed') || prompt.includes('Attempt 2 failed')) {
      // Repair feedback retries must keep routing to the original payload;
      // the original prompt prefix is preserved, so fall through below.
    }
    if (prompt.includes('Read the attached UE wireframe')) {
      return { requirement_draft: String(readJson('project.json').requirement || '') };
    }
    // Most specific envelope id first: layout/style prompts may quote other
    // artifact ids (e.g. the approved screen contract) in their bodies.
    if (prompt.includes('-style-contract')) return stripArtifactMetadata(readJson('style/style-contract.json'));
    if (prompt.includes('-layout-proposals')) return stripArtifactMetadata(readJson('screens/main/layout-proposals.json'));
    if (prompt.includes('-screen-contract')) return derivedScreenContract();
    throw new Error(`fixture provider: unrouted semantic prompt (${prompt.slice(0, 120)}…)`);
  }
}
