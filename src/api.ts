import type { AppConfig, CreateProjectInput, DesignProject, ProjectSummary } from './types';

const previewProjects: DesignProject[] = [];

function previewApi(): DesignCopilotApi {
  const find = (id: string) => {
    const project = previewProjects.find((item) => item.id === id);
    if (!project) throw new Error('Preview project not found.');
    return project;
  };
  return {
    getConfig: async () => ({ workspaceRoot: 'Browser preview · Electron saves to a local workspace', platform: 'browser', kunpo: { configured: true, mode: 'preview', envSource: 'preview', visionModel: 'gemini-vision', imageModel: 'Image-GPT2' } }),
    saveModelConfig: async (input) => ({ workspaceRoot: 'Browser preview · Electron saves to a local workspace', platform: 'browser', kunpo: { configured: true, mode: 'preview', envSource: 'preview', visionModel: input.visionModel, imageModel: input.imageModel } }),
    listProjects: async () => previewProjects,
    createProject: async (input) => {
      const id = `preview-${Date.now()}`;
      const project: DesignProject = {
        id, name: input.name, project_type: input.projectType, continuation_mode: input.projectType === 'existing' ? (input.continuationMode === 'existing-guided' ? 'existing-guided' : 'existing-strict') : 'exploration', art_direction: input.artDirection,
        requirement: input.requirement, screen_id: 'main', active_screen_id: 'main', workspacePath: `/preview/${id}`,
        screens: [{ id: 'main', name: '主页面', status: 'active', input_mode: 'own', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
        updated_at: new Date().toISOString(),
        workflow: { current_stage: 'input', stages: { input: { status: 'draft' }, wireframe_interpretation: { status: 'draft' }, layout_design: { status: 'draft' }, style_resolution: { status: 'draft' }, visual_exploration: { status: 'draft' } } },
        artifacts: { screenContract: null, layouts: null, approvedLayout: null, styleContract: null, visualTask: null, visualResults: { schema_version: '1.0', id: 'preview-results', version: 1, status: 'draft', source: {}, variations: [] } }
      };
      previewProjects.unshift(project); return project;
    },
    duplicateProject: async (id) => {
      const source = find(id);
      const copy = structuredClone(source);
      copy.id = `preview-${Date.now()}`;
      copy.name = `${source.name} · 副本`;
      previewProjects.unshift(copy);
      return copy;
    },
    openProject: async (id) => find(id),
    listScreens: async (id) => ({ active_screen_id: find(id).active_screen_id || 'main', screens: find(id).screens || [] }),
    createScreen: async (id, input) => { const project = find(id); const now = new Date().toISOString(); const screen = { id: input.id || `screen-${(project.screens?.length || 0) + 1}`, name: input.name, status: 'active' as const, created_at: now, updated_at: now }; project.screens = [...(project.screens || []), screen]; return screen; },
    duplicateScreen: async (id, screenId, input) => { const project = find(id); const source = project.screens?.find((item) => item.id === screenId); if (!source) throw new Error('Screen not found.'); const now = new Date().toISOString(); const screen = { ...source, id: input?.id || `${screenId}-copy`, name: input?.name || `${source.name} · 副本`, created_at: now, updated_at: now }; project.screens = [...(project.screens || []), screen]; return screen; },
    setActiveScreen: async (id, screenId) => Object.assign(find(id), { active_screen_id: screenId, screen_id: screenId }),
    updateScreen: async (id, screenId, patch) => { const project = find(id); const screen = project.screens?.find((item) => item.id === screenId); if (!screen) throw new Error('Screen not found.'); Object.assign(screen, patch, { updated_at: new Date().toISOString() }); return screen; },
    saveProject: async (id, patch) => Object.assign(find(id), { requirement: patch.requirement ?? find(id).requirement, art_direction: patch.artDirection ?? find(id).art_direction }),
    importFile: async (id, kind, _screenId) => {
      const project = find(id);
      if (kind === 'wireframe') project.wireframe_path = '/preview/ue-wireframe.png';
      else project.reference_paths = [...(project.reference_paths || []), `/preview/reference-${(project.reference_paths?.length || 0) + 1}.png`];
      return project;
    },
    manageReference: async (id, input) => {
      const project = find(id);
      project.reference_assets = (project.reference_assets || []).filter((item) => input.action !== 'remove' || item.id !== input.id);
      project.reference_paths = project.reference_assets.map((item) => item.path);
      return project;
    },
    importFontAsset: async (id) => find(id),
    confirmFontUsage: async (id) => find(id),
    loadFontBytes: async () => { throw new Error('Browser preview does not contain a real font asset.'); },
    importComponentAsset: async (id) => find(id),
    importForgeManifest: async (id) => find(id),
    revealProject: async () => ({ ok: true }),
    openUserGuide: async () => ({ ok: true }),
    runStage: async (id, stage) => {
      const project = find(id);
      project.workflow.current_stage = stage;
      project.workflow.stages[stage] = { status: 'reviewed' };
      if (stage === 'wireframe_interpretation') project.artifacts.screenContract = { schema_version: '1.0', id: 'main-screen-contract', version: 1, status: 'reviewed', source: {}, screen_name: '角色成长', purpose: '让玩家清晰理解成长收益并完成角色升级', primary_action: 'upgrade-character', required_controls: ['升级按钮', '返回按钮', '角色切换'], required_information: ['角色等级', '属性变化', '所需材料', '货币消耗'], states: ['默认', '材料不足', '满级'], edge_cases: ['材料刚好耗尽', '升级后解锁新技能'] };
      return project;
    },
    draftRequirement: async (id, _screenId) => {
      const project = find(id);
      project.requirement = '这是 AI 根据 UE 线框预填的设计意图草稿。请确认页面目标、核心操作与异常规则后继续。';
      project.requirement_source = 'ai';
      project.requirement_confirmed = false;
      project.workflow.current_stage = 'input';
      project.workflow.stages.input = { status: 'reviewed' };
      return project;
    },
    cancelStage: async (id) => find(id),
    approveArtifact: async (id, kind) => {
      const project = find(id);
      if (kind === 'screen-contract' && project.artifacts.screenContract) project.artifacts.screenContract.status = 'approved';
      return project;
    },
    updateArtifact: async (id, kind, patch) => {
      const project = find(id);
      const key = kind === 'screen-contract' ? 'screenContract' : kind === 'style-contract' ? 'styleContract' : 'visualResults';
      project.artifacts[key] = { ...(project.artifacts[key] || {}), ...patch, status: 'reviewed' } as never;
      return project;
    },
    generateUnderlayContract: async (id) => find(id),
    generateLayoutGuide: async (id) => find(id),
    runUnderlayCritique: async (id) => find(id),
    repairUnderlay: async (id) => find(id),
    approveUnderlayWaiver: async (id) => find(id),
    composeVisual: async (id) => find(id),
    runFidelity: async (id) => find(id),
    exportVisual: async () => ({ ok: true })
  };
}

let browserPreviewApi: DesignCopilotApi | null = null;
let browserWebApi: DesignCopilotApi | null = null;
const activeScreenIds = new Map<string, string>();
const rememberScreen = <T extends DesignProject>(project: T) => { activeScreenIds.set(project.id, project.screen_id); return project; };
const screenIdFor = (id: string, explicit?: string) => explicit || activeScreenIds.get(id) || '';
function withScreen<T extends Record<string, unknown> = Record<string, never>>(id: string, input?: T): T & { screenId: string } {
  const value = input || ({} as T);
  return { ...value, screenId: String(value.screenId || screenIdFor(id)) };
}

async function request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(pathname, {
    credentials: 'same-origin',
    ...init,
    headers: init.body instanceof Blob
      ? init.headers
      : { 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
  if (response.status === 401) {
    window.location.assign('/auth/feishu/start');
    throw new Error('登录状态已失效，正在重新登录。');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload as T;
}

function chooseImages(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.multiple = multiple;
    input.addEventListener('change', () => resolve(Array.from(input.files || [])), { once: true });
    input.click();
  });
}

function chooseAsset(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true }); input.click();
  });
}

function webApi(): DesignCopilotApi {
  const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
  return {
    getConfig: () => request('/api/config'),
    saveModelConfig: (input) => request('/api/config/models', { method: 'POST', body: JSON.stringify(input) }),
    listProjects: () => request('/api/projects'),
    createProject: (input) => request('/api/projects', { method: 'POST', body: JSON.stringify(input) }),
    duplicateProject: (id) => request(`${projectPath(id)}/duplicate`, { method: 'POST', body: '{}' }),
    openProject: (id, options) => request(`${projectPath(id)}?includePreviews=${options?.includePreviews === false ? 'false' : 'true'}`),
    listScreens: (id) => request(`${projectPath(id)}/screens`),
    createScreen: (id, input) => request(`${projectPath(id)}/screens`, { method: 'POST', body: JSON.stringify(input) }),
    duplicateScreen: (id, screenId, input) => request(`${projectPath(id)}/screens/${encodeURIComponent(screenId)}/duplicate`, { method: 'POST', body: JSON.stringify(input || {}) }),
    setActiveScreen: (id, screenId) => request(`${projectPath(id)}/screens/active`, { method: 'POST', body: JSON.stringify({ screenId }) }),
    updateScreen: (id, screenId, patch) => request(`${projectPath(id)}/screens/${encodeURIComponent(screenId)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    saveProject: (id, patch) => request(projectPath(id), { method: 'PATCH', body: JSON.stringify(patch) }),
    importFile: async (id, kind, screenId) => {
      const files = await chooseImages(kind === 'reference');
      let project = await request<DesignProject>(`${projectPath(id)}?includePreviews=true`);
      for (const file of files) {
        project = await request<DesignProject>(`${projectPath(id)}/import?kind=${kind}&screenId=${encodeURIComponent(screenId)}`, {
          method: 'POST',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }
        });
      }
      return project;
    },
    manageReference: (id, input) => request(`${projectPath(id)}/reference`, { method: 'POST', body: JSON.stringify(input) }),
    importFontAsset: async (id, input) => { const file = await chooseAsset('.otf,.ttf'); if (!file) return request(projectPath(id)); return request(`${projectPath(id)}/assets/font?meta=${encodeURIComponent(JSON.stringify(input))}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } }); },
    confirmFontUsage: (id, input) => request(`${projectPath(id)}/fonts/confirm`, { method: 'POST', body: JSON.stringify(input) }),
    loadFontBytes: async (id, fontId) => {
      const response = await fetch(`${projectPath(id)}/fonts/${encodeURIComponent(fontId)}/bytes`, { credentials: 'same-origin' });
      if (response.status === 401) {
        window.location.assign('/auth/feishu/start');
        throw new Error('登录状态已失效，正在重新登录。');
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || `字体读取失败（${response.status}）`);
      }
      return response.arrayBuffer();
    },
    importComponentAsset: async (id, input) => { const file = await chooseAsset('image/png,image/jpeg,image/webp,image/svg+xml'); if (!file) return request(projectPath(id)); return request(`${projectPath(id)}/assets/component?meta=${encodeURIComponent(JSON.stringify(input))}`, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } }); },
    importForgeManifest: async (id) => { const file = await chooseAsset('application/json,.json'); if (!file) return request(projectPath(id)); return request(`${projectPath(id)}/assets/forge-manifest`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/json', 'X-File-Name': encodeURIComponent(file.name) } }); },
    revealProject: async () => ({ ok: false }),
    // Web 版不随页面分发说明书 HTML，顶栏帮助入口在 Web 平台不渲染
    openUserGuide: async () => ({ ok: false }),
    runStage: (id, stage, input) => request(`${projectPath(id)}/pipeline/run`, { method: 'POST', body: JSON.stringify({ stage, input }) }),
    draftRequirement: (id, screenId) => request(`${projectPath(id)}/requirement/draft`, { method: 'POST', body: JSON.stringify({ screenId }) }),
    cancelStage: (id, stage, screenId) => request(`${projectPath(id)}/pipeline/cancel`, { method: 'POST', body: JSON.stringify({ stage, screenId }) }),
    approveArtifact: (id, kind, input) => request(`${projectPath(id)}/pipeline/approve`, { method: 'POST', body: JSON.stringify({ kind, input }) }),
    updateArtifact: (id, kind, patch) => request(`${projectPath(id)}/artifact`, { method: 'PATCH', body: JSON.stringify({ kind, patch }) }),
    generateUnderlayContract: (id, screenId) => request(`${projectPath(id)}/underlay/contract`, { method: 'POST', body: JSON.stringify({ screenId }) }),
    generateLayoutGuide: (id, screenId) => request(`${projectPath(id)}/underlay/guide`, { method: 'POST', body: JSON.stringify({ screenId }) }),
    runUnderlayCritique: (id, input) => request(`${projectPath(id)}/underlay/critique`, { method: 'POST', body: JSON.stringify(input) }),
    repairUnderlay: (id, input) => request(`${projectPath(id)}/underlay/repair`, { method: 'POST', body: JSON.stringify(input) }),
    approveUnderlayWaiver: (id, input) => request(`${projectPath(id)}/underlay/waiver`, { method: 'POST', body: JSON.stringify(input) }),
    composeVisual: (id, input) => request(`${projectPath(id)}/composition`, { method: 'POST', body: JSON.stringify(input) }),
    runFidelity: (id, screenId) => request(`${projectPath(id)}/fidelity`, { method: 'POST', body: JSON.stringify({ screenId }) }),
    exportVisual: async (id, variationId) => {
      const anchor = document.createElement('a');
      anchor.href = `${projectPath(id)}/visual/${encodeURIComponent(variationId)}`;
      anchor.download = '';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      return { ok: true };
    },
    logout: async () => {
      await request('/auth/logout', { method: 'POST', body: '{}' });
      window.location.assign('/');
      return { ok: true };
    }
  };
}

function api() {
  if (window.designCopilot) return window.designCopilot;
  if (import.meta.env.DEV) {
    browserPreviewApi ||= previewApi();
    return browserPreviewApi;
  }
  browserWebApi ||= webApi();
  return browserWebApi;
}

export const copilotApi = {
  getConfig: (): Promise<AppConfig> => api().getConfig(),
  saveModelConfig: (input: { visionModel: string; critiqueModel?: string; imageModel: string }): Promise<AppConfig> => api().saveModelConfig(input),
  listProjects: (): Promise<ProjectSummary[]> => api().listProjects(),
  createProject: async (input: CreateProjectInput): Promise<DesignProject> => rememberScreen(await api().createProject(input)),
  duplicateProject: (id: string): Promise<DesignProject> => api().duplicateProject(id),
  openProject: async (id: string, options?: { includePreviews?: boolean }): Promise<DesignProject> => rememberScreen(await api().openProject(id, options)),
  listScreens: (id: string) => api().listScreens(id),
  createScreen: (id: string, input: { id?: string; name: string }) => api().createScreen(id, input),
  duplicateScreen: (id: string, screenId: string, input?: { id?: string; name?: string }) => api().duplicateScreen(id, screenId, input),
  setActiveScreen: async (id: string, screenId: string) => rememberScreen(await api().setActiveScreen(id, screenId)),
  updateScreen: (id: string, screenId: string, patch: { name?: string; status?: 'archived' }) => api().updateScreen(id, screenId, patch),
  saveProject: async (id: string, patch: Partial<CreateProjectInput> & { screenId?: string }): Promise<DesignProject> => rememberScreen(await api().saveProject(id, { ...patch, screenId: screenIdFor(id, patch.screenId) } as never)),
  importFile: async (id: string, kind: 'wireframe' | 'reference', screenId?: string): Promise<DesignProject> => rememberScreen(await api().importFile(id, kind, screenIdFor(id, screenId))),
  manageReference: (id: string, input: { id: string; action: 'remove' | 'move' | 'role' | 'details' | 'approval'; direction?: 'up' | 'down'; role?: string; approved?: boolean; screenType?: string; contains?: string[]; baseline?: string; notes?: string }): Promise<DesignProject> => api().manageReference(id, input),
  importFontAsset: (id: string, input: Record<string, unknown>) => api().importFontAsset(id, input),
  confirmFontUsage: (id: string, input: Record<string, unknown>) => api().confirmFontUsage(id, input),
  loadFontBytes: async (id: string, fontId: string): Promise<ArrayBuffer> => {
    const value = await api().loadFontBytes(id, fontId);
    if (value instanceof ArrayBuffer) return value;
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  },
  importComponentAsset: (id: string, input: Record<string, unknown>) => api().importComponentAsset(id, input),
  importForgeManifest: (id: string) => api().importForgeManifest(id),
  revealProject: (id: string) => api().revealProject(id),
  openUserGuide: () => api().openUserGuide(),
  runStage: async (id: string, stage: PipelineStage, input?: Record<string, unknown>): Promise<DesignProject> => rememberScreen(await api().runStage(id, stage, withScreen(id, input))),
  draftRequirement: async (id: string, screenId?: string): Promise<DesignProject> => rememberScreen(await api().draftRequirement(id, screenIdFor(id, screenId))),
  cancelStage: async (id: string, stage: PipelineStage, screenId?: string): Promise<DesignProject> => rememberScreen(await api().cancelStage(id, stage, screenIdFor(id, screenId))),
  approveArtifact: async (id: string, kind: 'reference-inventory' | 'screen-contract' | 'component-bindings' | 'approved-layout' | 'underlay-contract' | 'composition-manifest' | 'style-contract' | 'font-manifest' | 'component-contract' | 'visual-results', input?: Record<string, unknown>): Promise<DesignProject> => rememberScreen(await api().approveArtifact(id, kind, withScreen(id, input))),
  updateArtifact: async (id: string, kind: 'screen-contract' | 'component-bindings' | 'underlay-contract' | 'style-contract' | 'font-manifest' | 'component-contract' | 'visual-results', patch: Record<string, unknown>): Promise<DesignProject> => rememberScreen(await api().updateArtifact(id, kind, withScreen(id, patch))),
  generateUnderlayContract: async (id: string, screenId?: string) => rememberScreen(await api().generateUnderlayContract(id, screenIdFor(id, screenId))),
  generateLayoutGuide: async (id: string, screenId?: string) => rememberScreen(await api().generateLayoutGuide(id, screenIdFor(id, screenId))),
  runUnderlayCritique: async (id: string, input: Record<string, unknown>) => rememberScreen(await api().runUnderlayCritique(id, withScreen(id, input))),
  repairUnderlay: async (id: string, input: Record<string, unknown>) => rememberScreen(await api().repairUnderlay(id, withScreen(id, input))),
  approveUnderlayWaiver: async (id: string, input: { issueId: string; reason: string }) => rememberScreen(await api().approveUnderlayWaiver(id, withScreen(id, input))),
  composeVisual: async (id: string, input: { variationId?: string; mode: 'preview' | 'final' }) => rememberScreen(await api().composeVisual(id, withScreen(id, input))),
  runFidelity: async (id: string, screenId?: string) => rememberScreen(await api().runFidelity(id, screenIdFor(id, screenId))),
  exportVisual: (id: string, variationId: string) => api().exportVisual(id, variationId),
  logout: () => api().logout ? api().logout!() : Promise.resolve({ ok: true })
};
