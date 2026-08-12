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
        id, name: input.name, project_type: input.projectType, art_direction: input.artDirection,
        requirement: input.requirement, screen_id: 'main', workspacePath: `/preview/${id}`,
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
    saveProject: async (id, patch) => Object.assign(find(id), { requirement: patch.requirement ?? find(id).requirement, art_direction: patch.artDirection ?? find(id).art_direction }),
    importFile: async (id, kind) => {
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
    revealProject: async () => ({ ok: true }),
    runStage: async (id, stage) => {
      const project = find(id);
      project.workflow.current_stage = stage;
      project.workflow.stages[stage] = { status: 'reviewed' };
      if (stage === 'wireframe_interpretation') project.artifacts.screenContract = { schema_version: '1.0', id: 'main-screen-contract', version: 1, status: 'reviewed', source: {}, screen_name: '角色成长', purpose: '让玩家清晰理解成长收益并完成角色升级', primary_action: 'upgrade-character', required_controls: ['升级按钮', '返回按钮', '角色切换'], required_information: ['角色等级', '属性变化', '所需材料', '货币消耗'], states: ['默认', '材料不足', '满级'], edge_cases: ['材料刚好耗尽', '升级后解锁新技能'] };
      return project;
    },
    draftRequirement: async (id) => {
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
    exportVisual: async () => ({ ok: true })
  };
}

let browserPreviewApi: DesignCopilotApi | null = null;
let browserWebApi: DesignCopilotApi | null = null;

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

function webApi(): DesignCopilotApi {
  const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
  return {
    getConfig: () => request('/api/config'),
    saveModelConfig: (input) => request('/api/config/models', { method: 'POST', body: JSON.stringify(input) }),
    listProjects: () => request('/api/projects'),
    createProject: (input) => request('/api/projects', { method: 'POST', body: JSON.stringify(input) }),
    duplicateProject: (id) => request(`${projectPath(id)}/duplicate`, { method: 'POST', body: '{}' }),
    openProject: (id, options) => request(`${projectPath(id)}?includePreviews=${options?.includePreviews === false ? 'false' : 'true'}`),
    saveProject: (id, patch) => request(projectPath(id), { method: 'PATCH', body: JSON.stringify(patch) }),
    importFile: async (id, kind) => {
      const files = await chooseImages(kind === 'reference');
      let project = await request<DesignProject>(`${projectPath(id)}?includePreviews=true`);
      for (const file of files) {
        project = await request<DesignProject>(`${projectPath(id)}/import?kind=${kind}`, {
          method: 'POST',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }
        });
      }
      return project;
    },
    manageReference: (id, input) => request(`${projectPath(id)}/reference`, { method: 'POST', body: JSON.stringify(input) }),
    revealProject: async () => ({ ok: false }),
    runStage: (id, stage, input) => request(`${projectPath(id)}/pipeline/run`, { method: 'POST', body: JSON.stringify({ stage, input }) }),
    draftRequirement: (id) => request(`${projectPath(id)}/requirement/draft`, { method: 'POST', body: '{}' }),
    cancelStage: (id, stage) => request(`${projectPath(id)}/pipeline/cancel`, { method: 'POST', body: JSON.stringify({ stage }) }),
    approveArtifact: (id, kind, input) => request(`${projectPath(id)}/pipeline/approve`, { method: 'POST', body: JSON.stringify({ kind, input }) }),
    updateArtifact: (id, kind, patch) => request(`${projectPath(id)}/artifact`, { method: 'PATCH', body: JSON.stringify({ kind, patch }) }),
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
  saveModelConfig: (input: { visionModel: string; imageModel: string }): Promise<AppConfig> => api().saveModelConfig(input),
  listProjects: (): Promise<ProjectSummary[]> => api().listProjects(),
  createProject: (input: CreateProjectInput): Promise<DesignProject> => api().createProject(input),
  duplicateProject: (id: string): Promise<DesignProject> => api().duplicateProject(id),
  openProject: (id: string, options?: { includePreviews?: boolean }): Promise<DesignProject> => api().openProject(id, options),
  saveProject: (id: string, patch: Partial<CreateProjectInput>): Promise<DesignProject> => api().saveProject(id, patch),
  importFile: (id: string, kind: 'wireframe' | 'reference'): Promise<DesignProject> => api().importFile(id, kind),
  manageReference: (id: string, input: { id: string; action: 'remove' | 'move' | 'role'; direction?: 'up' | 'down'; role?: string }): Promise<DesignProject> => api().manageReference(id, input),
  revealProject: (id: string) => api().revealProject(id),
  runStage: (id: string, stage: PipelineStage, input?: Record<string, unknown>): Promise<DesignProject> => api().runStage(id, stage, input),
  draftRequirement: (id: string): Promise<DesignProject> => api().draftRequirement(id),
  cancelStage: (id: string, stage: PipelineStage): Promise<DesignProject> => api().cancelStage(id, stage),
  approveArtifact: (id: string, kind: 'screen-contract' | 'approved-layout' | 'style-contract' | 'visual-results', input?: Record<string, unknown>): Promise<DesignProject> => api().approveArtifact(id, kind, input),
  updateArtifact: (id: string, kind: 'screen-contract' | 'style-contract' | 'visual-results', patch: Record<string, unknown>): Promise<DesignProject> => api().updateArtifact(id, kind, patch),
  exportVisual: (id: string, variationId: string) => api().exportVisual(id, variationId),
  logout: () => api().logout ? api().logout!() : Promise.resolve({ ok: true })
};
