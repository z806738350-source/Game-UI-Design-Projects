import type { AppConfig, CreateProjectInput, DesignProject, GalleryAsset, GalleryDownloadResult, GalleryListResult, GalleryQuery, IntentCandidate, IntentReview, ProjectSummary } from './types';

const previewProjects: DesignProject[] = [];
const previewIntentCandidates = new Map<string, IntentCandidate>();
const previewCandidateKey = (id: string, screenId: string) => `${id}::${screenId}`;

// 预览模式的 structured-v2 草稿：只模拟形状与状态机，不模拟真实分析。
function previewIntentDraft(): IntentReview {
  return {
    page_purpose: { text: 'AI 预填：让玩家快速理解当前页面的核心目标。', evidence: 'preview', designer_modified: false },
    player_tasks: [{ text: 'AI 预填：确认页面主任务并完成关键操作。', evidence: 'preview', designer_modified: false }],
    core_flow: [{ text: 'AI 预填：进入页面 → 完成主操作 → 离开。', evidence: 'preview', designer_modified: false }],
    visible_controls: [{ text: 'AI 预填：主操作按钮', evidence: 'preview', designer_modified: false }],
    visible_information_and_states: [{ text: 'AI 预填：默认态与禁用态说明', evidence: 'preview', designer_modified: false }],
    uncertainties: []
  };
}

function previewRevisionError(): Error {
  return Object.assign(new Error('Intent Review 已被更新，请刷新后基于最新版本重试。'), { code: 'INTENT_REVISION_CONFLICT' });
}

// 预览模式图库（§7.4）：内存 fixture，但隐藏/恢复/分页/门禁语义与真实实现一致。
const previewDay = 24 * 60 * 60 * 1000;
const previewGalleryAssets: GalleryAsset[] = [
  { id: 'preview-gallery-1', cdn_url: 'https://kunpoapiimg.ziy.cc/preview/gallery-1.png', provider: 'kunpo', provider_task_id: 'task-preview-1', storage_mode: 'provider_cdn', remote_only: true, origin_kind: 'visual_exploration', continuation_mode: 'exploration', project_id: 'preview-cloud', project_name_snapshot: '云境计划', project_status_snapshot: 'draft', screen_id: 'main', screen_name_snapshot: '主页面', variation_id: 'variation-preview-1', strategy: 'conservative', layout_name: '标准栅格', style_name: '明快科幻', width: 1920, height: 1080, target_size: '1920x1080', created_at: new Date(Date.now() - previewDay).toISOString(), indexed_at: new Date(Date.now() - previewDay).toISOString(), last_seen_at: new Date(Date.now() - previewDay).toISOString(), hidden_at: null },
  { id: 'preview-gallery-2', cdn_url: 'https://kunpoapiimg.ziy.cc/preview/gallery-2.png', provider: 'kunpo', provider_task_id: 'task-preview-2', storage_mode: 'provider_cdn', remote_only: true, origin_kind: 'visual_exploration', continuation_mode: 'exploration', project_id: 'preview-cloud', project_name_snapshot: '云境计划', project_status_snapshot: 'draft', screen_id: 'shop', screen_name_snapshot: '商城', variation_id: 'variation-preview-2', strategy: 'expressive', layout_name: '中心焦点', style_name: '明快科幻', width: 1080, height: 1920, target_size: '1080x1920', created_at: new Date(Date.now() - 3 * previewDay).toISOString(), indexed_at: new Date(Date.now() - 3 * previewDay).toISOString(), last_seen_at: new Date(Date.now() - 3 * previewDay).toISOString(), hidden_at: null },
  { id: 'preview-gallery-3', cdn_url: 'https://kunpoapiimg.ziy.cc/preview/gallery-3.png', provider: 'kunpo', provider_task_id: 'task-preview-3', storage_mode: 'provider_cdn', remote_only: true, origin_kind: 'visual_exploration', continuation_mode: 'existing-strict', project_id: 'preview-harbor', project_name_snapshot: '星港商城', project_status_snapshot: 'draft', screen_id: 'main', screen_name_snapshot: '主页面', variation_id: 'variation-preview-3', strategy: 'conservative', layout_name: '继承布局', style_name: '既有风格', width: 1920, height: 1080, target_size: '1920x1080', created_at: new Date(Date.now() - 6 * previewDay).toISOString(), indexed_at: new Date(Date.now() - 6 * previewDay).toISOString(), last_seen_at: new Date(Date.now() - 6 * previewDay).toISOString(), hidden_at: null },
  { id: 'preview-gallery-4', cdn_url: 'https://kunpoapiimg.ziy.cc/preview/gallery-4.png', provider: 'kunpo', provider_task_id: 'task-preview-4', storage_mode: 'provider_cdn', remote_only: true, origin_kind: 'underlay_repair', continuation_mode: 'existing-guided', project_id: 'preview-cloud', project_name_snapshot: '云境计划', project_status_snapshot: 'draft', screen_id: 'main', screen_name_snapshot: '主页面', variation_id: 'underlay-repair-preview', strategy: 'underlay-repair', width: 1920, height: 1080, target_size: '1920x1080', created_at: new Date(Date.now() - 10 * previewDay).toISOString(), indexed_at: new Date(Date.now() - 10 * previewDay).toISOString(), last_seen_at: new Date(Date.now() - 10 * previewDay).toISOString(), hidden_at: null },
  { id: 'preview-gallery-5', cdn_url: 'https://kunpoapiimg.ziy.cc/preview/gallery-5.png', provider: 'kunpo', provider_task_id: 'task-preview-5', storage_mode: 'provider_cdn', remote_only: true, origin_kind: 'visual_exploration', continuation_mode: 'exploration', project_id: 'preview-harbor', project_name_snapshot: '星港商城', project_status_snapshot: 'draft', screen_id: 'shop', screen_name_snapshot: '商城', variation_id: 'variation-preview-5', strategy: 'innovative', layout_name: '自由拼贴', style_name: '既有风格', width: 1920, height: 1080, target_size: '1920x1080', created_at: new Date(Date.now() - 15 * previewDay).toISOString(), indexed_at: new Date(Date.now() - 15 * previewDay).toISOString(), last_seen_at: new Date(Date.now() - 15 * previewDay).toISOString(), hidden_at: new Date(Date.now() - 2 * previewDay).toISOString() }
];

function previewGalleryMatches(asset: GalleryAsset, query: GalleryQuery): boolean {
  const hidden = asset.hidden_at != null;
  if ((query.scope || 'all') === 'hidden' ? !hidden : hidden) return false;
  if (query.projectId && asset.project_id !== query.projectId) return false;
  if (query.screenId && asset.screen_id !== query.screenId) return false;
  if (query.orientation) {
    const width = Number(asset.width); const height = Number(asset.height);
    const orientation = width > height ? 'landscape' : width < height ? 'portrait' : 'square';
    if (orientation !== query.orientation) return false;
  }
  if (query.range && query.range !== 'all') {
    const created = Date.parse(asset.created_at);
    const start = new Date();
    if (query.range === 'today') start.setHours(0, 0, 0, 0);
    else if (query.range === '7d') start.setDate(start.getDate() - 7);
    else start.setDate(start.getDate() - 30);
    if (!Number.isFinite(created) || created < start.getTime()) return false;
  }
  if (query.query) {
    const needle = query.query.trim().toLowerCase();
    const haystack = [asset.project_name_snapshot, asset.screen_name_snapshot, asset.strategy, asset.layout_name, asset.style_name, asset.cdn_url].filter(Boolean).join(' ').toLowerCase();
    if (needle && !haystack.includes(needle)) return false;
  }
  return true;
}

async function previewGalleryList(query: GalleryQuery = {}): Promise<GalleryListResult> {
  const filtered = previewGalleryAssets.filter((asset) => previewGalleryMatches(asset, query));
  const direction = query.sort === 'oldest' ? 1 : -1;
  filtered.sort((a, b) => {
    const delta = a.created_at.localeCompare(b.created_at) * direction;
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
  let start = 0;
  if (query.cursor) {
    const index = filtered.findIndex((asset) => asset.id === query.cursor);
    start = index < 0 ? filtered.length : index + 1;
  }
  const limit = Math.max(1, Number(query.limit) || 40);
  const items = filtered.slice(start, start + limit);
  const next = filtered[start + limit];
  const projects = new Map<string, { id: string; name: string; status: 'draft' | 'archived' }>();
  const screens = new Map<string, { id: string; name: string; projectId?: string }>();
  for (const asset of previewGalleryAssets.filter((item) => previewGalleryMatches(item, { scope: query.scope }))) {
    if (asset.project_id) projects.set(asset.project_id, { id: asset.project_id, name: asset.project_name_snapshot || asset.project_id, status: asset.project_status_snapshot || 'draft' });
    if (asset.screen_id) screens.set(asset.screen_id, { id: asset.screen_id, name: asset.screen_name_snapshot || asset.screen_id, projectId: asset.project_id });
  }
  return { items, total: filtered.length, nextCursor: next ? next.id : null, facets: { projects: [...projects.values()], screens: [...screens.values()] } };
}

function previewGalleryAsset(assetId: string): GalleryAsset {
  const asset = previewGalleryAssets.find((item) => item.id === assetId);
  if (!asset) throw new Error(`图库资产不存在：${assetId}`);
  return asset;
}

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
    // v1.4 §11.1：预览模式的 structured-v2 同义接口（内存模拟）。
    generateIntentCandidate: async (id, screenId) => {
      const project = find(id);
      if (!project.wireframe_path) throw new Error('请先导入 UE Wireframe。');
      const now = new Date().toISOString();
      const requestId = `preview-intent-${Date.now()}`;
      const screenKey = screenId || project.screen_id;
      if (previewIntentCandidates.has(previewCandidateKey(id, screenKey))) {
        throw Object.assign(new Error('已存在待处理的 Intent candidate，请先采用或丢弃。'), { code: 'INTENT_CANDIDATE_REPLACEMENT_REQUIRED' });
      }
      if (project.intent_review) {
        previewIntentCandidates.set(previewCandidateKey(id, screenKey), {
          candidate_id: `preview-candidate-${Date.now()}`, request_id: requestId, screen_id: screenKey, status: 'ready', generated_at: now,
          source_context: { wireframe_revision: project.input_revisions?.wireframe ?? 0, project_type: project.project_type },
          base_current_revisions: { requirement: project.input_revisions?.requirement ?? 0, intent_review: project.input_revisions?.intent_review ?? 0, intent_context: project.input_revisions?.intent_context ?? 0 },
          review: previewIntentDraft(), warnings: []
        });
        project.intent_generation = { request_id: requestId, status: 'ready', purpose: 'candidate', finished_at: now, error_code: null };
      } else {
        project.intent_mode = 'structured-v2';
        project.intent_review = { ...previewIntentDraft(), revision: 1, confirmed_at: null };
        project.intent_generation = { request_id: requestId, status: 'ready', purpose: 'first-draft', finished_at: now, error_code: null };
        project.requirement = '这是 AI 基于 UE 线框预填的结构化设计意图草稿。请逐段确认页面目标、玩家任务、核心流程、可见控件与信息状态后继续。';
        project.requirement_source = 'ai';
        project.requirement_confirmed = false;
      }
      project.workflow.current_stage = 'input';
      project.workflow.stages.input = { status: 'reviewed' };
      return project;
    },
    saveIntentReview: async (id, input) => {
      const project = find(id);
      const current = Number(project.input_revisions?.intent_review ?? 0);
      if (!Number.isFinite(Number(input.expectedIntentReviewRevision)) || Number(input.expectedIntentReviewRevision) !== current) throw previewRevisionError();
      const revision = current + 1;
      project.intent_mode = 'structured-v2';
      project.intent_review = { ...input.draft, revision, confirmed_at: null };
      project.requirement = `【Intent Review】revision ${revision}（预览模拟渲染，以服务端渲染为准）`;
      project.requirement_source = 'user';
      project.requirement_confirmed = false;
      project.input_revisions = { ...(project.input_revisions || {}), intent_review: revision, requirement: (project.input_revisions?.requirement ?? 0) + 1 };
      return project;
    },
    confirmIntentReview: async (id, input) => {
      const project = find(id);
      if (!project.intent_review) throw Object.assign(new Error('当前 Screen 没有可确认的 Intent Review。'), { code: 'INTENT_REVIEW_INCOMPLETE' });
      const current = Number(project.input_revisions?.intent_review ?? 0);
      if (!Number.isFinite(Number(input.expectedIntentReviewRevision)) || Number(input.expectedIntentReviewRevision) !== current) throw previewRevisionError();
      project.intent_review = { ...project.intent_review, confirmed_at: new Date().toISOString() };
      project.requirement_confirmed = true;
      return project;
    },
    adoptIntentCandidate: async (id, input) => {
      const project = find(id);
      const candidate = previewIntentCandidates.get(previewCandidateKey(id, input.screenId || project.screen_id));
      if (!candidate || candidate.candidate_id !== input.candidateId) throw Object.assign(new Error('Intent candidate 不存在或已被处理。'), { code: 'INTENT_CANDIDATE_STALE' });
      const current = Number(project.input_revisions?.intent_review ?? 0);
      if (!Number.isFinite(Number(input.expectedIntentReviewRevision)) || Number(input.expectedIntentReviewRevision) !== current) throw previewRevisionError();
      previewIntentCandidates.delete(previewCandidateKey(id, input.screenId || project.screen_id));
      const revision = current + 1;
      project.intent_mode = 'structured-v2';
      project.intent_review = { ...(candidate.review || {}), revision, confirmed_at: null };
      project.requirement = `【Intent Review】revision ${revision}（预览模拟渲染，以服务端渲染为准）`;
      project.requirement_source = 'ai';
      project.requirement_confirmed = false;
      project.input_revisions = { ...(project.input_revisions || {}), intent_review: revision, requirement: (project.input_revisions?.requirement ?? 0) + 1 };
      if (project.intent_generation && candidate.request_id && project.intent_generation.request_id === candidate.request_id) project.intent_generation = { ...project.intent_generation, status: 'superseded' };
      return project;
    },
    discardIntentCandidate: async (id, input) => {
      const project = find(id);
      const key = previewCandidateKey(id, input.screenId || project.screen_id);
      const candidate = previewIntentCandidates.get(key);
      if (!candidate || candidate.candidate_id !== input.candidateId) throw Object.assign(new Error('Intent candidate 不存在或已被处理。'), { code: 'INTENT_CANDIDATE_STALE' });
      previewIntentCandidates.delete(key);
      if (project.intent_generation && candidate.request_id && project.intent_generation.request_id === candidate.request_id) project.intent_generation = { ...project.intent_generation, status: 'superseded' };
      return project;
    },
    getIntentCandidate: async (id, screenId) => previewIntentCandidates.get(previewCandidateKey(id, screenId || find(id).screen_id)) ?? null,
    listIntentHistory: async () => [],
    restoreIntentHistory: async () => { throw Object.assign(new Error('预览模式没有可恢复的历史版本。'), { code: 'INTENT_HISTORY_VERSION_NOT_FOUND' }); },
    deleteIntentHistory: async () => { throw Object.assign(new Error('预览模式没有可删除的历史版本。'), { code: 'INTENT_HISTORY_VERSION_NOT_FOUND' }); },
    cancelStage: async (id) => find(id),
    approveArtifact: async (id, kind) => {
      const project = find(id);
      if (kind === 'screen-contract' && project.artifacts.screenContract) project.artifacts.screenContract.status = 'approved';
      return project;
    },
    repairRouteCycle: async (id) => find(id),
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
    approveUnderlayManualReview: async (id) => find(id),
    composeVisual: async (id) => find(id),
    runFidelity: async (id) => find(id),
    exportVisual: async () => ({ ok: true }),
    listGallery: async (query) => previewGalleryList(query || {}),
    hideGalleryAsset: async (assetId) => { const asset = previewGalleryAsset(assetId); asset.hidden_at = asset.hidden_at || new Date().toISOString(); return { ...asset }; },
    restoreGalleryAsset: async (assetId) => { const asset = previewGalleryAsset(assetId); asset.hidden_at = null; return { ...asset }; },
    downloadGalleryAsset: async (assetId) => {
      const asset = previewGalleryAsset(assetId);
      // §7.5：预览同样只认登记时的路线快照，严格/锁定路线一律阻断。
      if (asset.continuation_mode !== 'exploration' && asset.continuation_mode !== 'existing-guided') {
        return { status: 'blocked', message: '严格继承项目的图片需回到工作流完成正式交付后导出。' };
      }
      return { status: 'failed', message: '预览模式没有真实图片可下载。' };
    }
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
    // AUD-04：轮询/失败重载可显式携带任务冻结时的 Screen，不再依赖项目当前
    // active screen。
    openProject: (id, options) => request(`${projectPath(id)}?includePreviews=${options?.includePreviews === false ? 'false' : 'true'}${options?.screenId ? `&screenId=${encodeURIComponent(options.screenId)}` : ''}`),
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
    // v1.4 §11.1：structured-v2 Intent 同义路由（与桌面端同一业务方法）。
    generateIntentCandidate: (id, screenId) => request(`${projectPath(id)}/intent/generate`, { method: 'POST', body: JSON.stringify({ screenId }) }),
    saveIntentReview: (id, input) => request(`${projectPath(id)}/intent/review/save`, { method: 'POST', body: JSON.stringify(input) }),
    confirmIntentReview: (id, input) => request(`${projectPath(id)}/intent/review/confirm`, { method: 'POST', body: JSON.stringify(input) }),
    adoptIntentCandidate: (id, input) => request(`${projectPath(id)}/intent/candidate/adopt`, { method: 'POST', body: JSON.stringify(input) }),
    discardIntentCandidate: (id, input) => request(`${projectPath(id)}/intent/candidate/discard`, { method: 'POST', body: JSON.stringify(input) }),
    getIntentCandidate: (id, screenId) => request(`${projectPath(id)}/intent/candidate?screenId=${encodeURIComponent(screenId)}`),
    listIntentHistory: (id, screenId) => request(`${projectPath(id)}/intent/history?screenId=${encodeURIComponent(screenId)}`),
    restoreIntentHistory: (id, screenId, input) => request(`${projectPath(id)}/intent/history/restore`, { method: 'POST', body: JSON.stringify({ screenId, ...input }) }),
    deleteIntentHistory: (id, screenId, input) => request(`${projectPath(id)}/intent/history/delete`, { method: 'POST', body: JSON.stringify({ screenId, ...input }) }),
    cancelStage: (id, stage, screenId) => request(`${projectPath(id)}/pipeline/cancel`, { method: 'POST', body: JSON.stringify({ stage, screenId }) }),
    approveArtifact: (id, kind, input) => request(`${projectPath(id)}/pipeline/approve`, { method: 'POST', body: JSON.stringify({ kind, input }) }),
    repairRouteCycle: (id, input) => request(`${projectPath(id)}/pipeline/repair-route-cycle`, { method: 'POST', body: JSON.stringify(input) }),
    updateArtifact: (id, kind, patch) => request(`${projectPath(id)}/artifact`, { method: 'PATCH', body: JSON.stringify({ kind, patch }) }),
    generateUnderlayContract: (id, screenId) => request(`${projectPath(id)}/underlay/contract`, { method: 'POST', body: JSON.stringify({ screenId }) }),
    generateLayoutGuide: (id, screenId) => request(`${projectPath(id)}/underlay/guide`, { method: 'POST', body: JSON.stringify({ screenId }) }),
    runUnderlayCritique: (id, input) => request(`${projectPath(id)}/underlay/critique`, { method: 'POST', body: JSON.stringify(input) }),
    repairUnderlay: (id, input) => request(`${projectPath(id)}/underlay/repair`, { method: 'POST', body: JSON.stringify(input) }),
    approveUnderlayWaiver: (id, input) => request(`${projectPath(id)}/underlay/waiver`, { method: 'POST', body: JSON.stringify(input) }),
    approveUnderlayManualReview: (id, input) => request(`${projectPath(id)}/underlay/manual-review`, { method: 'POST', body: JSON.stringify(input) }),
    composeVisual: (id, input) => request(`${projectPath(id)}/composition`, { method: 'POST', body: JSON.stringify(input) }),
    runFidelity: (id, screenId) => request(`${projectPath(id)}/fidelity`, { method: 'POST', body: JSON.stringify({ screenId }) }),
    // P1-03：<a> 导航下载无法感知 409/4xx，Gate 错误不会回传到应用错误条。
    // 改为 fetch：非 2xx 读取 JSON 错误并 throw（UI 层可见）；2xx 转 Blob
    // 再触发下载。同时把调用时冻结的 Screen 放进 URL，避免多会话下
    // Active Screen 被其它会话切换后下载到错误 Screen 的交付结果。
    exportVisual: async (id, variationId) => {
      const screenId = screenIdFor(id);
      const response = await fetch(`${projectPath(id)}/visual/${encodeURIComponent(variationId)}${screenId ? `?screenId=${encodeURIComponent(screenId)}` : ''}`, { credentials: 'same-origin' });
      if (response.status === 401) {
        window.location.assign('/auth/feishu/start');
        throw new Error('登录状态已失效，正在重新登录。');
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || `导出最终成图失败（${response.status}）`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] || `visual-${variationId.replace(/[^A-Za-z0-9_-]/g, '')}.png`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      return { ok: true };
    },
    // 图库（v1.1 §7.3/§7.4）：租户级 /api/gallery 路由；下载走同源代理，
    // 409 = 严格路线门禁阻断（§7.5），由 UI 展示指引而非当作未知错误。
    listGallery: (query) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query || {})) {
        if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
      }
      const suffix = params.toString();
      return request(`/api/gallery${suffix ? `?${suffix}` : ''}`);
    },
    hideGalleryAsset: (assetId) => request(`/api/gallery/${encodeURIComponent(assetId)}/hide`, { method: 'POST', body: '{}' }),
    restoreGalleryAsset: (assetId) => request(`/api/gallery/${encodeURIComponent(assetId)}/restore`, { method: 'POST', body: '{}' }),
    downloadGalleryAsset: async (assetId): Promise<GalleryDownloadResult> => {
      const response = await fetch(`/api/gallery/${encodeURIComponent(assetId)}/download`, { credentials: 'same-origin' });
      if (response.status === 401) {
        window.location.assign('/auth/feishu/start');
        throw new Error('登录状态已失效，正在重新登录。');
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        if (response.status === 409) return { status: 'blocked', message: payload.error || '严格继承项目的图片需回到工作流完成正式交付后导出。' };
        return { status: 'failed', message: payload.error || `下载失败（${response.status}）` };
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] || `gallery-${assetId.replace(/[^A-Za-z0-9_-]/g, '')}.png`;
      const objectUrl = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = fileName;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      return { status: 'saved' };
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
  // P1-10：复制项目后 wrapper 立即把新项目设为当前，必须同步记住其
  // Screen 上下文，否则立即执行 Screen-scoped 操作会因空 screenId 报
  // SCREEN_ID_REQUIRED。
  duplicateProject: async (id: string): Promise<DesignProject> => rememberScreen(await api().duplicateProject(id)),
  openProject: async (id: string, options?: { includePreviews?: boolean; screenId?: string }): Promise<DesignProject> => rememberScreen(await api().openProject(id, options)),
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
  generateIntentCandidate: async (id: string, screenId?: string): Promise<DesignProject> => rememberScreen(await api().generateIntentCandidate(id, screenIdFor(id, screenId))),
  saveIntentReview: async (id: string, input: { expectedIntentReviewRevision: number; draft: IntentReview; screenId?: string }): Promise<DesignProject> => rememberScreen(await api().saveIntentReview(id, withScreen(id, input))),
  confirmIntentReview: async (id: string, input: { expectedIntentReviewRevision: number; screenId?: string }): Promise<DesignProject> => rememberScreen(await api().confirmIntentReview(id, withScreen(id, input))),
  adoptIntentCandidate: async (id: string, input: { candidateId: string; expectedIntentReviewRevision: number; screenId?: string }): Promise<DesignProject> => rememberScreen(await api().adoptIntentCandidate(id, withScreen(id, input))),
  discardIntentCandidate: async (id: string, input: { candidateId: string; screenId?: string }): Promise<DesignProject> => rememberScreen(await api().discardIntentCandidate(id, withScreen(id, input))),
  getIntentCandidate: (id: string, screenId?: string): Promise<IntentCandidate | null> => api().getIntentCandidate(id, screenIdFor(id, screenId)),
  listIntentHistory: (id: string, screenId?: string) => api().listIntentHistory(id, screenIdFor(id, screenId)),
  restoreIntentHistory: async (id: string, screenId?: string, input?: { historyId: string; expectedIntentReviewRevision: number }): Promise<DesignProject> => rememberScreen(await api().restoreIntentHistory(id, screenIdFor(id, screenId), input as { historyId: string; expectedIntentReviewRevision: number })),
  deleteIntentHistory: async (id: string, screenId?: string, input?: { historyId: string }): Promise<DesignProject> => rememberScreen(await api().deleteIntentHistory(id, screenIdFor(id, screenId), input as { historyId: string })),
  cancelStage: async (id: string, stage: PipelineStage, screenId?: string): Promise<DesignProject> => rememberScreen(await api().cancelStage(id, stage, screenIdFor(id, screenId))),
  approveArtifact: async (id: string, kind: 'reference-inventory' | 'screen-contract' | 'component-bindings' | 'approved-layout' | 'underlay-contract' | 'composition-manifest' | 'style-contract' | 'font-manifest' | 'component-contract' | 'visual-results', input?: Record<string, unknown>): Promise<DesignProject> => rememberScreen(await api().approveArtifact(id, kind, withScreen(id, input))),
  repairRouteCycle: async (id: string, screenId?: string): Promise<DesignProject> => rememberScreen(await api().repairRouteCycle(id, withScreen(id, { screenId: screenIdFor(id, screenId) }))),
  updateArtifact: async (id: string, kind: 'screen-contract' | 'component-bindings' | 'underlay-contract' | 'style-contract' | 'font-manifest' | 'component-contract' | 'visual-results', patch: Record<string, unknown>): Promise<DesignProject> => rememberScreen(await api().updateArtifact(id, kind, withScreen(id, patch))),
  generateUnderlayContract: async (id: string, screenId?: string) => rememberScreen(await api().generateUnderlayContract(id, screenIdFor(id, screenId))),
  generateLayoutGuide: async (id: string, screenId?: string) => rememberScreen(await api().generateLayoutGuide(id, screenIdFor(id, screenId))),
  runUnderlayCritique: async (id: string, input: Record<string, unknown>) => rememberScreen(await api().runUnderlayCritique(id, withScreen(id, input))),
  repairUnderlay: async (id: string, input: Record<string, unknown>) => rememberScreen(await api().repairUnderlay(id, withScreen(id, input))),
  approveUnderlayWaiver: async (id: string, input: { issueId: string; reason: string }) => rememberScreen(await api().approveUnderlayWaiver(id, withScreen(id, input))),
  approveUnderlayManualReview: async (id: string, input: { conclusion: string; reason: string }) => rememberScreen(await api().approveUnderlayManualReview(id, withScreen(id, input))),
  composeVisual: async (id: string, input: { variationId?: string; mode: 'preview' | 'final' }) => rememberScreen(await api().composeVisual(id, withScreen(id, input))),
  runFidelity: async (id: string, screenId?: string) => rememberScreen(await api().runFidelity(id, screenIdFor(id, screenId))),
  exportVisual: (id: string, variationId: string) => api().exportVisual(id, variationId),
  listGallery: (query: GalleryQuery): Promise<GalleryListResult> => api().listGallery(query),
  hideGalleryAsset: (assetId: string): Promise<GalleryAsset> => api().hideGalleryAsset(assetId),
  restoreGalleryAsset: (assetId: string): Promise<GalleryAsset> => api().restoreGalleryAsset(assetId),
  downloadGalleryAsset: (assetId: string): Promise<GalleryDownloadResult> => api().downloadGalleryAsset(assetId),
  logout: () => api().logout ? api().logout!() : Promise.resolve({ ok: true })
};
