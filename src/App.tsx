import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Aperture, Archive, ArrowRight, Bot, Check, Copy, FileJson, FolderOpen, LoaderCircle, LogOut,
  MoreHorizontal, PanelLeftClose, Plus, RefreshCw, Save, ScanSearch, Search, Settings2, Sparkles, X
} from 'lucide-react';
import { copilotApi } from './api';
import type { AppConfig, CreateProjectInput, DesignProject, ProjectSummary } from './types';
import {
  EmptyArtifact, JsonSummary, friendlyError, preserveProjectPreviews, stages, statusOf
} from './features/shared/ui';
import type { RunOptions, RunTask, StageId } from './features/shared/ui';
import { InputWorkspace } from './features/input/InputWorkspace';
import { ContractWorkspace } from './features/contracts/ContractWorkspace';
import { LayoutWorkspace } from './features/layout/LayoutWorkspace';
import { StyleWorkspace } from './features/style/StyleWorkspace';
import { VisualWorkspace } from './features/visual/VisualWorkspace';
import { ScreenManager } from './features/workbenches/ScreenManager';

const emptyDraft: CreateProjectInput = { name: '', projectType: 'new', artDirection: '', requirement: '', continuationMode: 'exploration' };

function Modal({ title, copy, onClose, children, wide = false }: { title: string; copy?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`utility-dialog ${wide ? 'utility-dialog--wide' : ''}`}>
      <header><div><h2>{title}</h2>{copy && <p>{copy}</p>}</div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
      {children}
    </section>
  </div>;
}

function NewProjectDialog({ onCreate, onClose, onLogout, busy }: { onCreate: (input: CreateProjectInput) => void; onClose?: () => void; onLogout?: () => void; busy: boolean }) {
  const [draft, setDraft] = useState(emptyDraft);
  return <div className="dialog-backdrop">
    <form className="create-dialog" data-testid="create-project-dialog" onSubmit={(event) => { event.preventDefault(); onCreate(draft); }}>
      <div className="dialog-mark"><Aperture size={22} /></div>
      <div className="dialog-copy"><span className="kicker">NEW DESIGN PIPELINE</span><h2>建立可追踪的 UI 设计项目</h2><p>每次生成、人工修改和批准都会保留版本来源。</p></div>
      <label><span>项目名称</span><input autoFocus required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：云境计划 · 商城改版" /></label>
      <div className="project-type-grid">
        <button type="button" className={draft.projectType === 'new' ? 'is-selected' : ''} onClick={() => setDraft({ ...draft, projectType: 'new', continuationMode: 'exploration' })}><Sparkles size={18} /><b>新项目</b><small>探索新的视觉语言</small></button>
        <button type="button" className={draft.projectType === 'existing' ? 'is-selected' : ''} onClick={() => setDraft({ ...draft, projectType: 'existing', continuationMode: 'existing-strict' })}><RefreshCw size={18} /><b>已有项目</b><small>默认严格继承批准页面</small></button>
      </div>
      {draft.projectType === 'existing' && <label><span>继承强度</span><select value={draft.continuationMode} onChange={(event) => setDraft({ ...draft, continuationMode: event.target.value as CreateProjectInput['continuationMode'] })}><option value="existing-strict">严格继承（推荐）</option><option value="existing-guided">引导继承</option></select><small>严格继承会阻止公共组件和正式文字进入图片生成；缺少组件或身份关键字体时会明确阻断。</small></label>}
      <label><span>美术大方向</span><input value={draft.artDirection} onChange={(event) => setDraft({ ...draft, artDirection: event.target.value })} placeholder="如：明快二次元科幻、克制东方奇幻" /></label>
      <div className="dialog-actions">{onLogout && <button type="button" className="button button--ghost" onClick={onLogout}><LogOut size={16} />退出账号</button>}{onClose && <button type="button" className="button button--ghost" onClick={onClose}>取消</button>}<button disabled={busy || !draft.name.trim()} className="button button--primary" data-testid="create-project" type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}创建并进入工作台</button></div>
    </form>
  </div>;
}

function InputSourceSummary({ project }: { project: DesignProject }) {
  const checks = [
    { label: 'UE 线框稿', value: project.wireframe_name || '尚未导入', ready: Boolean(project.wireframe_path) },
    { label: '画布规格', value: project.canvas_spec ? `${project.canvas_spec.width} × ${project.canvas_spec.height} · ${project.canvas_spec.aspect_ratio}` : '等待识别', ready: Boolean(project.canvas_spec) },
    { label: '设计意图', value: project.requirement.trim() ? (project.requirement_confirmed ? '已确认，将与 UE 一起生成契约' : project.requirement_source === 'ai' ? 'AI 已预填，等待确认' : '已填写，等待确认') : '尚未填写，等待 AI 预填', ready: Boolean(project.requirement_confirmed) },
    { label: '美术大方向', value: project.art_direction || '暂未指定', ready: Boolean(project.art_direction) }
  ];
  return <div className="input-source-summary"><div className="inspector-purpose"><ScanSearch size={20} /><div><b>这里用于检查 AI 的输入和产物</b><p>输入阶段显示模型将读取的来源；后续阶段会显示版本、来源、结构化数据和历史快照。</p></div></div>{checks.map((item) => <div className="source-check" key={item.label}><i className={item.ready ? 'is-ready' : ''}>{item.ready ? <Check size={13} /> : '—'}</i><div><span>{item.label}</span><b>{item.value}</b></div></div>)}</div>;
}

function SettingsDialog({ config, onSaved, onClose }: { config: AppConfig; onSaved: (next: AppConfig) => void; onClose: () => void }) {
  const [visionModel, setVisionModel] = useState(config.kunpo.visionModel);
  const [imageModel, setImageModel] = useState(config.kunpo.imageModel);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const dirty = visionModel.trim() !== config.kunpo.visionModel || imageModel.trim() !== config.kunpo.imageModel;
  const saveModels = async () => {
    setSaving(true); setMessage(''); setSaveError('');
    try {
      const next = await copilotApi.saveModelConfig({ visionModel: visionModel.trim(), imageModel: imageModel.trim() });
      onSaved(next); setVisionModel(next.kunpo.visionModel); setImageModel(next.kunpo.imageModel); setMessage('模型配置已保存，后续新任务将立即使用。');
    } catch (cause) { setSaveError(friendlyError(cause)); }
    finally { setSaving(false); }
  };
  return <Modal title="模型与工作区配置" copy="自由填写服务支持的模型名称；API Key 等敏感凭据不会在界面中显示。" onClose={onClose}><div className="settings-grid"><div><span>连接状态</span><b>{config.kunpo.configured ? '已连接' : '未配置'}</b></div><div><span>接入模式</span><b>{config.kunpo.mode}</b></div><label className="model-setting span-2"><span>视觉理解模型</span><input value={visionModel} onChange={(event) => { setVisionModel(event.target.value); setMessage(''); }} placeholder="例如：google/gemini-3.1-flash-lite" spellCheck={false} /><small>用于理解 UE、需求和参考图，并生成结构化契约。</small></label><label className="model-setting span-2"><span>图像模型</span><input value={imageModel} onChange={(event) => { setImageModel(event.target.value); setMessage(''); }} placeholder="例如：Image-GPT2" spellCheck={false} /><small>用于最终视觉方向生图，必须受当前图像服务支持。</small></label><div className="span-2"><span>模型配置来源</span><code>{config.kunpo.modelSource || config.kunpo.envSource}</code></div><div className="span-2"><span>项目工作区</span><code>{config.workspaceRoot}</code></div></div>{saveError && <p className="model-save-message is-error">{saveError}</p>}{message && <p className="model-save-message is-success">{message}</p>}<div className="model-settings-actions"><small>保存只修改两个模型名称。当前进行中的任务保持原模型，下一项新任务使用新配置。</small><button className="button button--primary" disabled={saving || !dirty || !visionModel.trim() || !imageModel.trim()} onClick={saveModels}><Save size={15} />{saving ? '保存中…' : '保存模型配置'}</button></div><p className="settings-note">模型名称保存在独立的应用配置文件中，不会触发开发服务重启；连接地址与凭据保持不变。</p></Modal>;
}

function ProjectManager({ project, projects, busy, run, onClose, onSwitch }: { project: DesignProject; projects: ProjectSummary[]; busy: boolean; run: RunTask; onClose: () => void; onSwitch: (id: string) => void }) {
  const [name, setName] = useState(project.name);
  const [search, setSearch] = useState('');
  useEffect(() => setName(project.name), [project.id, project.name]);
  const filtered = projects.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
  return <Modal title="项目管理" copy="搜索、重命名、复制、归档或恢复项目。" onClose={onClose} wide><div className="project-manager"><div className="project-list-panel"><label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目" /></label>{filtered.map((item) => <button key={item.id} className={item.id === project.id ? 'is-selected' : ''} onClick={() => onSwitch(item.id)}><div><b>{item.name}</b><small>{item.project_type === 'existing' ? '已有项目' : '新项目'} · {new Date(item.updated_at).toLocaleDateString()}</small></div>{item.status === 'archived' && <span>已归档</span>}</button>)}</div><div className="project-detail-panel"><label><span>项目名称</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><div className="project-path"><span>本地目录</span><code>{project.workspacePath}</code></div><button className="button button--primary" disabled={busy || !name.trim() || name === project.name} onClick={() => run(() => copilotApi.saveProject(project.id, { name }), { label: '重命名项目' })}><Save size={15} />保存名称</button><button className="button button--secondary" disabled={busy} onClick={() => run(() => copilotApi.duplicateProject(project.id), { label: '复制项目' })}><Copy size={15} />复制为独立项目</button><button className="button button--ghost" disabled={busy} onClick={() => run(() => copilotApi.saveProject(project.id, { status: project.status === 'archived' ? 'draft' : 'archived' } as never), { label: project.status === 'archived' ? '恢复项目' : '归档项目' })}><Archive size={15} />{project.status === 'archived' ? '恢复项目' : '归档项目'}</button></div></div></Modal>;
}

// App shell only: project/screen/stage switching, global busy/error
// boundaries, inspector, and feature workspace assembly. Domain workspaces
// live under src/features/* and own their own drafts and local state.
export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<DesignProject | null>(null);
  const [activeStage, setActiveStage] = useState<StageId>('input');
  const [busy, setBusy] = useState(false);
  const [busyJob, setBusyJob] = useState<(RunOptions & { startedAt: number }) | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [retryTask, setRetryTask] = useState<{ task: () => Promise<DesignProject>; options: RunOptions } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const mainWorkspaceRef = useRef<HTMLElement>(null);

  const refreshProjects = () => copilotApi.listProjects().then(setProjects);
  useEffect(() => { Promise.all([copilotApi.getConfig(), copilotApi.listProjects()]).then(([nextConfig, nextProjects]) => { setConfig(nextConfig); setProjects(nextProjects); if (nextProjects[0]) copilotApi.openProject(nextProjects[0].id).then(setProject); else setCreateOpen(true); }).catch((cause) => setError(cause.message)); }, []);
  useEffect(() => { const nextStage = project?.workflow?.current_stage as StageId | undefined; if (nextStage && stages.some((stage) => stage.id === nextStage)) setActiveStage(nextStage); }, [project?.id, project?.workflow?.current_stage]);
  useEffect(() => { mainWorkspaceRef.current?.scrollTo({ top: 0, behavior: 'auto' }); }, [activeStage, project?.id]);
  useEffect(() => { if (!busyJob || !project) return; const timer = window.setInterval(() => { setElapsed(Math.floor((Date.now() - busyJob.startedAt) / 1000)); copilotApi.openProject(project.id, { includePreviews: false }).then((next) => setProject((current) => preserveProjectPreviews(next, current))).catch(() => undefined); }, 1200); return () => window.clearInterval(timer); }, [busyJob, project?.id]);

  const run: RunTask = async (task, options) => {
    if (options.stage) setActiveStage(options.stage);
    setBusy(true); setBusyJob({ ...options, startedAt: Date.now() }); setElapsed(0); setError('');
    try { const next = await task(); setProject((current) => preserveProjectPreviews(next, current)); setRetryTask(null); await refreshProjects(); return next; }
    catch (cause) {
      setError(friendlyError(cause)); setRetryTask({ task, options });
      // A failed attempt may still have changed backend state (e.g. a
      // regeneration attempt invalidates stale evidence before it fails).
      // Reload the project so gates reflect the current truth; guard against
      // a late response overwriting a project the user switched to meanwhile.
      if (project) copilotApi.openProject(project.id, { includePreviews: false }).then((next) => setProject((current) => (current && current.id !== next.id ? current : preserveProjectPreviews(next, current)))).catch(() => undefined);
    }
    finally { setBusy(false); setBusyJob(null); }
  };
  const cancelVisual = async () => {
    if (!project) return;
    try { setProject(await copilotApi.cancelStage(project.id, 'visual_exploration')); }
    catch (cause) { setError(friendlyError(cause)); }
  };
  const create = async (input: CreateProjectInput) => { await run(() => copilotApi.createProject(input), { label: '创建项目' }); setCreateOpen(false); setActiveStage('input'); };
  const switchProject = (id: string) => { copilotApi.openProject(id).then(setProject).catch((cause) => setError(cause.message)); };
  const currentArtifact = useMemo(() => { if (!project) return null; if (activeStage === 'wireframe_interpretation') return project.artifacts.screenContract; if (activeStage === 'layout_design') return project.artifacts.approvedLayout || project.artifacts.layouts; if (activeStage === 'style_resolution') return project.artifacts.styleContract; if (activeStage === 'visual_exploration') return project.artifacts.visualResults?.variations?.length ? project.artifacts.visualResults : project.artifacts.visualTask; return null; }, [project, activeStage]);
  const busyStage = busyJob?.stage ? project?.workflow?.stages?.[busyJob.stage] : undefined;
  const progress = busyStage?.status === 'in_progress'
    ? busyStage.progress
    : busyJob?.total ? { completed: 0, total: busyJob.total, message: '正在准备视觉任务' } : undefined;

  return <div className={`app-shell ${project ? 'has-project' : ''} ${inspectorOpen ? 'has-inspector' : ''} ${config?.platform === 'darwin' ? 'is-mac' : ''}`}>
    <header className="topbar"><div className="brand"><div><Aperture size={19} /></div><span><b>Game UI</b><small>Design Copilot</small></span></div><div className="project-switcher"><button onClick={() => setCreateOpen(true)}><Plus size={15} />新项目</button><select value={project?.id || ''} onChange={(event) => switchProject(event.target.value)}><option value="" disabled>选择项目</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.status === 'archived' ? '〔归档〕' : ''}{item.name}</option>)}</select>{project && <button className="manage-button" onClick={() => setManagerOpen(true)}><MoreHorizontal size={16} />管理</button>}</div><nav><div className={`connection ${config?.kunpo.configured ? 'is-online' : ''}`}><i />{config?.kunpo.configured ? `${config.kunpo.mode === 'gateway' ? 'Gateway' : 'Kunpo API'} 已就绪` : 'Kunpo 未配置'}</div>{project && config?.platform !== 'web' && <button title="在 Finder 中显示项目" onClick={() => copilotApi.revealProject(project.id)}><FolderOpen size={17} /></button>}<button title="查看 AI 输入、产物与历史版本" onClick={() => setInspectorOpen(!inspectorOpen)}><PanelLeftClose size={17} /></button><button title="模型与工作区配置" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button>{config?.platform === 'web' && <button title="退出当前飞书账号" onClick={() => copilotApi.logout()}><LogOut size={17} /></button>}</nav></header>
    {project && <div className="screen-manager-dock"><ScreenManager project={project} busy={busy} onProject={setProject} /></div>}
    <aside className="stage-rail"><div className="rail-title"><span>DESIGN FLOW</span><small>{project ? '1 个页面' : '无项目'}</small></div><div className="stage-list">{stages.map((stage, index) => { const status = statusOf(project, stage.id); const Icon = stage.icon; return <button key={stage.id} data-testid={`stage-${stage.id}`} disabled={!project} className={`${activeStage === stage.id ? 'is-active' : ''} is-${status}`} onClick={() => setActiveStage(stage.id)}><div className="stage-node"><Icon size={16} /></div><div><span>{stage.number} · {stage.eyebrow}</span><b>{stage.label}</b><small>{stage.description}</small></div>{index < stages.length - 1 && <i className="stage-line" />}</button>; })}</div><div className="rail-principle"><Bot size={17} /><p><b>状态属于设计流水线</b><br />模型生成、人工修改和批准都保留可追踪版本。</p></div></aside>
    <main ref={mainWorkspaceRef} className="main-workspace">{busyJob && <div className="busy-bar"><LoaderCircle className="spin" size={14} /><div><b>{busyJob.label}</b><span>{progress ? `${progress.completed}/${progress.total} · ${progress.message || ''}` : '正在处理'} · 已用时 {elapsed}s</span></div><small>{busyJob.stage === 'visual_exploration' ? '结果会逐张保存' : '可继续浏览其他阶段'}</small></div>}{error && <div className="error-banner"><b>当前步骤未完成</b><span>{error}</span>{retryTask && !busy && <button className="error-retry" onClick={() => run(retryTask.task, retryTask.options)}><RefreshCw size={13} />重试</button>}<button aria-label="关闭错误" onClick={() => setError('')}>×</button></div>}{!project ? <div className="welcome"><Aperture size={38} /><h1>为游戏 UI 设计师准备的 AI 流水线</h1><p>从 UE 理解到视觉交付，每个决策都可修改、可追踪、可复现。</p><button className="button button--primary" onClick={() => setCreateOpen(true)}><Plus size={16} />建立第一个项目</button></div> : activeStage === 'input' ? <InputWorkspace project={project} busy={busy} run={run} /> : activeStage === 'wireframe_interpretation' ? <ContractWorkspace project={project} busy={busy} run={run} /> : activeStage === 'layout_design' ? <LayoutWorkspace project={project} busy={busy} run={run} onNavigate={setActiveStage} /> : activeStage === 'style_resolution' ? <StyleWorkspace project={project} busy={busy} run={run} /> : <VisualWorkspace project={project} busy={busy} run={run} canCancel={busyJob?.stage === 'visual_exploration'} onCancel={cancelVisual} />}</main>
    {inspectorOpen && <aside className="artifact-inspector"><div className="inspector-head"><span>AI 输入、产物与版本</span><FileJson size={17} /></div>{activeStage === 'input' && project ? <InputSourceSummary project={project} /> : currentArtifact ? <JsonSummary artifact={currentArtifact} history={project?.artifactHistory?.filter((item) => item.id === currentArtifact.id || item.kind.includes(activeStage.split('_')[0]))} /> : <EmptyArtifact title="当前阶段尚无 AI 产物" copy="完成当前步骤后，版本、来源、结构化内容和历史快照会显示在这里。" />}<div className="inspector-foot"><b>{config?.platform === 'web' ? '在线项目空间' : '本地项目目录'}</b><code>{config?.workspaceRoot || 'Loading…'}</code><small>批准与生成结果均保存在这里，可随时回看历史版本。</small></div></aside>}
    {createOpen && <NewProjectDialog onCreate={create} onClose={projects.length ? () => setCreateOpen(false) : undefined} onLogout={config?.platform === 'web' ? () => { void copilotApi.logout(); } : undefined} busy={busy} />}{settingsOpen && config && <SettingsDialog config={config} onSaved={setConfig} onClose={() => setSettingsOpen(false)} />}{managerOpen && project && <ProjectManager project={project} projects={projects} busy={busy} run={run} onClose={() => setManagerOpen(false)} onSwitch={switchProject} />}
  </div>;
}
