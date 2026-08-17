import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Aperture, Archive, ArrowDown, ArrowRight, ArrowUp, Bot, Check, CheckSquare, CircleDot, Clock3, Copy,
  Download, Edit3, Eye, FileJson, FolderOpen, ImagePlus, Layers3, LoaderCircle, LogOut,
  LockKeyhole, Maximize2, MessageSquare, MoreHorizontal, PanelLeftClose, Plus,
  RefreshCw, Save, ScanSearch, Search, Settings2, Sparkles, Trash2, Upload, WandSparkles, X
} from 'lucide-react';
import { copilotApi } from './api';
import type { AppConfig, Artifact, CreateProjectInput, DesignProject, LayoutProposal, ProjectSummary, VisualVariation } from './types';

const stages = [
  { id: 'input', number: '00', label: '项目输入', eyebrow: 'INPUT', description: '需求、UE 线框与项目类型', icon: Upload },
  { id: 'wireframe_interpretation', number: '01', label: '功能解读', eyebrow: 'UNDERSTAND', description: '建立功能页面契约', icon: ScanSearch },
  { id: 'layout_design', number: '02', label: '布局设计', eyebrow: 'STRUCTURE', description: '比较、调整并批准布局', icon: Layers3 },
  { id: 'style_resolution', number: '03', label: '风格锁定', eyebrow: 'STYLE LOCK', description: '沉淀可复现视觉规范', icon: LockKeyhole },
  { id: 'visual_exploration', number: '04', label: '视觉探索', eyebrow: 'EXPLORE', description: '评审、组合与交付方向', icon: WandSparkles }
] as const;

type StageId = typeof stages[number]['id'];
type RunOptions = { label: string; stage?: StageId; total?: number };
type RunTask = (task: () => Promise<DesignProject>, options: RunOptions) => Promise<DesignProject | undefined>;
type WorkspaceProps = { project: DesignProject; busy: boolean; run: RunTask };
type ContractCategoryKey = (typeof listFields)[number];
type ContractReviewStatus = 'unreviewed' | 'confirmed' | 'changed' | 'question';
type ContractDraft = Record<ContractCategoryKey, string[]> & { screen_name: string; purpose: string; primary_action: string };
type ContractReview = Record<ContractCategoryKey, ContractReviewStatus[]>;

const emptyDraft: CreateProjectInput = { name: '', projectType: 'new', artDirection: '', requirement: '', continuationMode: 'exploration' };
const listFields = ['required_controls', 'required_information', 'states', 'edge_cases'] as const;
const contractCategories = [
  { key: 'required_controls', label: '必需控件', eyebrow: 'CONTROLS', description: '玩家需要看到或操作的按钮、入口与控件' },
  { key: 'required_information', label: '必要信息', eyebrow: 'INFORMATION', description: '完成决策前必须理解的数据、提示与反馈' },
  { key: 'states', label: '交互状态', eyebrow: 'STATES', description: '页面、控件和流程在不同条件下的表现' },
  { key: 'edge_cases', label: '边界情况', eyebrow: 'EDGE CASES', description: '异常、冲突、空状态和失败后的处理规则' }
] as const;
const fieldLabels: Record<string, string> = {
  required_controls: '必需控件', required_information: '必需信息', states: '交互状态', edge_cases: '边界情况',
  materials: '材质', geometry: '几何规则', lighting: '光影', components: '组件', composition: '构图'
};

function statusOf(project: DesignProject | null, stageId: StageId) {
  if (stageId === 'input') return project?.wireframe_path && project.requirement && (project.requirement_confirmed ?? true) ? 'approved' : project?.workflow?.stages?.input?.status || 'draft';
  return project?.workflow?.stages?.[stageId]?.status || 'draft';
}

function statusLabel(status: string) {
  return ({ draft: '待开始', in_progress: '运行中', reviewed: '待确认', approved: '已批准', generated: '已生成', stale: '需更新', rejected: '已否决', failed: '失败', cancelled: '已停止' } as Record<string, string>)[status] || status;
}

function friendlyError(cause: unknown) {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const clean = raw.replace(/^Error invoking remote method '[^']+': Error:\s*/i, '').trim();
  if (/ImageDecodeFailed|图片解码失败/i.test(clean)) return '生成服务无法读取参考图。请重新导入有效的 PNG、JPG 或 WebP 图片后重试。';
  if (/JSON|结构化结果|schema|validation/i.test(clean)) return `模型返回的结构化内容连续自动修复后仍不完整。${clean.includes('连续 3 次') ? '' : '请重试当前步骤。'}`;
  if (/Kunpo request failed/i.test(clean)) return clean.replace(/Kunpo request failed \(\d+\):?\s*/i, '生成服务暂时未完成请求：');
  if (/Kunpo is not configured/i.test(clean)) return '图像服务尚未配置，请先打开右上角“模型与工作区配置”。';
  return clean;
}

function preserveProjectPreviews(next: DesignProject, current: DesignProject | null) {
  if (!current || current.id !== next.id) return next;
  const previousReferences = new Map((current.reference_assets || []).map((asset) => [asset.id, asset.preview]));
  return {
    ...next,
    wireframe_preview: next.wireframe_preview || current.wireframe_preview,
    reference_assets: (next.reference_assets || []).map((asset) => ({ ...asset, preview: asset.preview || previousReferences.get(asset.id) }))
  };
}

function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-pill--${status}`}><i />{statusLabel(status)}</span>;
}

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
    <form className="create-dialog" onSubmit={(event) => { event.preventDefault(); onCreate(draft); }}>
      <div className="dialog-mark"><Aperture size={22} /></div>
      <div className="dialog-copy"><span className="kicker">NEW DESIGN PIPELINE</span><h2>建立可追踪的 UI 设计项目</h2><p>每次生成、人工修改和批准都会保留版本来源。</p></div>
      <label><span>项目名称</span><input autoFocus required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：云境计划 · 商城改版" /></label>
      <div className="project-type-grid">
        <button type="button" className={draft.projectType === 'new' ? 'is-selected' : ''} onClick={() => setDraft({ ...draft, projectType: 'new', continuationMode: 'exploration' })}><Sparkles size={18} /><b>新项目</b><small>探索新的视觉语言</small></button>
        <button type="button" className={draft.projectType === 'existing' ? 'is-selected' : ''} onClick={() => setDraft({ ...draft, projectType: 'existing', continuationMode: 'existing-strict' })}><RefreshCw size={18} /><b>已有项目</b><small>默认严格继承批准页面</small></button>
      </div>
      {draft.projectType === 'existing' && <label><span>继承强度</span><select value={draft.continuationMode} onChange={(event) => setDraft({ ...draft, continuationMode: event.target.value as CreateProjectInput['continuationMode'] })}><option value="existing-strict">严格继承（推荐）</option><option value="existing-guided">引导继承</option></select><small>严格继承会阻止公共组件和正式文字进入图片生成；缺少组件或身份关键字体时会明确阻断。</small></label>}
      <label><span>美术大方向</span><input value={draft.artDirection} onChange={(event) => setDraft({ ...draft, artDirection: event.target.value })} placeholder="如：明快二次元科幻、克制东方奇幻" /></label>
      <div className="dialog-actions">{onLogout && <button type="button" className="button button--ghost" onClick={onLogout}><LogOut size={16} />退出账号</button>}{onClose && <button type="button" className="button button--ghost" onClick={onClose}>取消</button>}<button disabled={busy || !draft.name.trim()} className="button button--primary" type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}创建并进入工作台</button></div>
    </form>
  </div>;
}

function EmptyArtifact({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return <div className="empty-artifact"><FileJson size={26} /><b>{title}</b><p>{copy}</p>{action}</div>;
}

function JsonSummary({ artifact, history = [] }: { artifact: Artifact; history?: DesignProject['artifactHistory'] }) {
  const entries = Object.entries(artifact).filter(([key]) => !['schema_version', 'id', 'status', 'source'].includes(key));
  return <div className="json-summary">
    <div className="artifact-meta"><div><code>{String(artifact.id)}</code><small>版本 V{String(artifact.version || 1)}</small></div><StatusPill status={String(artifact.status)} /></div>
    {Boolean(artifact.designer_summary) && <p className="artifact-summary">{String(artifact.designer_summary)}</p>}
    <div className="lineage"><b>来源</b>{Object.entries((artifact.source || {}) as Record<string, unknown>).map(([key, value]) => <span key={key}>{key.replaceAll('_', ' ')}<code>{String(value)}</code></span>)}</div>
    {entries.slice(0, 10).map(([key, value]) => <div className="summary-row" key={key}><span>{key.replaceAll('_', ' ')}</span><b>{Array.isArray(value) ? `${value.length} 项` : typeof value === 'object' ? `${Object.keys((value as object) || {}).length} 条结构化规则` : String(value)}</b></div>)}
    <details className="raw-artifact"><summary>查看机器可读 JSON</summary><pre>{JSON.stringify(artifact, null, 2)}</pre></details>
    {history?.length ? <details className="artifact-history"><summary>历史版本（{history.length}）</summary>{history.slice(0, 8).map((item) => <div key={item.snapshot}><Clock3 size={13} /><span>{item.kind} · V{item.version} · {statusLabel(item.status || '')}</span><small>{new Date(item.saved_at).toLocaleString()}</small></div>)}</details> : null}
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

function WireframeLightbox({ project, onClose }: { project: DesignProject; onClose: () => void }) {
  if (!project.wireframe_preview) return null;
  return <div className="wireframe-lightbox" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="wireframe-lightbox-panel">
      <header><div><span>UE WIREFRAME</span><b>{project.wireframe_name || '当前线框稿'}</b></div><button className="icon-button" aria-label="关闭 UE 大图" onClick={onClose}><X size={20} /></button></header>
      <img src={project.wireframe_preview} alt="UE Wireframe 大图" />
      {project.canvas_spec && <footer>{project.canvas_spec.width} × {project.canvas_spec.height} · {project.canvas_spec.orientation === 'portrait' ? '竖屏' : project.canvas_spec.orientation === 'landscape' ? '横屏' : '方形'} · {project.canvas_spec.aspect_ratio}</footer>}
    </div>
  </div>;
}

function WireframeReference({ project, onOpen, editable = false, busy = false, onReplace }: { project: DesignProject; onOpen: () => void; editable?: boolean; busy?: boolean; onReplace?: () => void }) {
  return <section className="wireframe-reference">
    <header><div><span>UE WIREFRAME</span><b>{project.wireframe_name || '尚未导入线框稿'}</b></div>{editable && <button className="button button--secondary" disabled={busy} onClick={onReplace}>{project.wireframe_path ? '替换' : '选择图片'}</button>}</header>
    {project.wireframe_preview ? <button className="wireframe-canvas-button" onClick={onOpen} aria-label="放大查看 UE 线框稿"><img src={project.wireframe_preview} alt="UE Wireframe 预览" /><span><Maximize2 size={16} />放大对照</span></button> : <div className="wireframe-empty"><Upload size={24} /><span>导入线框稿后，AI 将直接读取画面结构和信息。</span></div>}
    {project.canvas_spec && <div className="wireframe-meta"><span>{project.canvas_spec.width} × {project.canvas_spec.height}</span><span>{project.canvas_spec.orientation === 'portrait' ? '竖屏' : project.canvas_spec.orientation === 'landscape' ? '横屏' : '方形'}</span><span>{project.canvas_spec.aspect_ratio}</span></div>}
  </section>;
}

function InputWorkspace({ project, busy, run }: WorkspaceProps) {
  const [requirement, setRequirement] = useState(project.requirement);
  const [artDirection, setArtDirection] = useState(project.art_direction);
  const [wireframeOpen, setWireframeOpen] = useState(false);
  useEffect(() => { setRequirement(project.requirement); setArtDirection(project.art_direction); }, [project.id, project.requirement, project.art_direction]);
  const ready = Boolean(project.wireframe_path);
  const dirty = requirement !== project.requirement || artDirection !== project.art_direction;
  const hasIntent = Boolean(requirement.trim());
  const confirmed = hasIntent && !dirty && (project.requirement_confirmed ?? project.requirement_source !== 'ai');
  const aiDraft = project.requirement_source === 'ai' && !confirmed;
  const saveInput = (confirm = false) => copilotApi.saveProject(project.id, {
    requirement,
    artDirection,
    requirementSource: requirement.trim() === project.requirement.trim() && project.requirement_source === 'ai' ? 'ai' : requirement.trim() ? 'user' : 'none',
    requirementConfirmed: confirm
  });
  return <>
    <div className="workspace-content input-workspace">
    <section className="workspace-heading"><div><span className="kicker">00 · PROJECT INPUT</span><h1>让 AI 先读懂 UE，再由你补充意图</h1><p>线框稿是功能理解的主要来源。策划说明可以很简短，只需补充画面里看不出的业务规则。</p></div><button className="button button--ghost" onClick={() => run(() => saveInput(false), { label: '保存项目输入' })} disabled={busy || !dirty}><Save size={16} />{dirty ? '保存补充说明' : '已保存'}</button></section>
    <div className="input-grid input-grid--reworked">
      <div className="input-col input-col--form">
      <label className={`field-card design-brief-card ${aiDraft ? 'has-ai-draft' : ''}`}><span><div><b>设计意图</b><em>{aiDraft ? 'AI 已预填 · 待确认' : confirmed ? '已确认' : '可留空'}</em></div><small>AI 先读 UE 并预填；你可以补充、改写，或直接确认</small></span><textarea value={requirement} onChange={(event) => setRequirement(event.target.value)} placeholder="留空后点击下方按钮，AI 会先根据 UE 线框生成一份可编辑的意图草稿。" /><div className="ai-reading-note"><ScanSearch size={18} /><div><b>{aiDraft ? '请检查这份 AI 草稿' : '先预解读，再生成契约'}</b><p>{aiDraft ? 'AI 只推断画面中可见的页面目标与流程；隐藏玩法规则仍由你补充。' : '空白时先留在本页生成草稿，不会提前跳到功能解读页。'}</p></div>{hasIntent && <button type="button" className="button button--secondary" disabled={busy} onClick={(event) => { event.preventDefault(); run(() => copilotApi.draftRequirement(project.id), { label: 'AI 正在重新读取 UE 并预填意图' }); }}>重新预填</button>}</div></label>
      <label className="field-card art-direction-card"><span><div><b>美术大方向</b><em>选填</em></div><small>用于后续风格锁定和视觉探索，不影响功能识别</small></span><input value={artDirection} onChange={(event) => setArtDirection(event.target.value)} placeholder="例如：克制东方奇幻、近未来硬科幻" /></label>
      </div>
      <div className="input-col input-col--wire">
      <WireframeReference project={project} editable busy={busy} onOpen={() => setWireframeOpen(true)} onReplace={() => run(() => copilotApi.importFile(project.id, 'wireframe'), { label: '导入 UE 线框稿' })} />
      <div className="principle-card"><CircleDot size={20} /><div><b>功能基准</b><p>AI 必须覆盖 UE 中可识别的功能；设计师可在下一步补充、修改或删除具体条目。</p></div></div>
      </div>
    </div>
    </div>
    <div className="workspace-footer"><span className={ready ? 'ready-copy' : ''}>{!ready ? '请先导入 UE 线框稿。' : !hasIntent ? 'UE 已就绪，先让 AI 生成一份可确认的设计意图。' : confirmed ? '设计意图已确认，可以进入功能解读。' : '请检查并确认设计意图，再生成完整功能契约。'}</span>{!hasIntent ? <button className="button button--primary" disabled={busy || !ready} onClick={() => run(async () => { await copilotApi.saveProject(project.id, { artDirection }); return copilotApi.draftRequirement(project.id); }, { label: 'AI 正在读取 UE 并预填意图' })}><ScanSearch size={17} />AI 解读并预填写</button> : <button className="button button--primary" disabled={busy || !ready} onClick={() => run(async () => { await saveInput(true); return copilotApi.runStage(project.id, 'wireframe_interpretation', { stayOnInputUntilComplete: true }); }, { label: '正在生成完整功能契约' })}><Bot size={17} />{confirmed ? '重新生成功能契约' : '确认意图并开始功能解读'}</button>}</div>
    {wireframeOpen && <WireframeLightbox project={project} onClose={() => setWireframeOpen(false)} />}
    </>;
}

function ContractWorkspace({ project, busy, run }: WorkspaceProps) {
  const artifact = project.artifacts.screenContract;
  const [activeCategory, setActiveCategory] = useState<ContractCategoryKey>('required_controls');
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<{ key: ContractCategoryKey; index: number; value: string } | null>(null);
  const [wireframeOpen, setWireframeOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ContractReviewStatus>('all');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const makeDraft = (): ContractDraft => ({
    screen_name: String(artifact?.screen_name || ''), purpose: String(artifact?.purpose || ''), primary_action: String(artifact?.primary_action || ''),
    required_controls: Array.isArray(artifact?.required_controls) ? (artifact.required_controls as unknown[]).map(String) : [],
    required_information: Array.isArray(artifact?.required_information) ? (artifact.required_information as unknown[]).map(String) : [],
    states: Array.isArray(artifact?.states) ? (artifact.states as unknown[]).map(String) : [],
    edge_cases: Array.isArray(artifact?.edge_cases) ? (artifact.edge_cases as unknown[]).map(String) : []
  });
  const makeReview = (): ContractReview => {
    const stored = (artifact?.review_metadata || {}) as Partial<Record<ContractCategoryKey, unknown>>;
    return Object.fromEntries(listFields.map((key) => {
      const source = Array.isArray(stored[key]) ? stored[key] as unknown[] : [];
      const length = Array.isArray(artifact?.[key]) ? (artifact?.[key] as unknown[]).length : 0;
      return [key, Array.from({ length }, (_, index) => ['confirmed', 'changed', 'question'].includes(String(source[index])) ? source[index] as ContractReviewStatus : 'unreviewed')];
    })) as ContractReview;
  };
  const [draft, setDraft] = useState<ContractDraft>(makeDraft);
  const [review, setReview] = useState<ContractReview>(makeReview);
  useEffect(() => { setDraft(makeDraft()); setReview(makeReview()); setEditingItem(null); setCloseConfirm(false); }, [artifact?.id, artifact?.version]);
  useEffect(() => { setCategoryQuery(''); setStatusFilter('all'); setEditingItem(null); }, [activeCategory]);
  const baselineDraft = makeDraft();
  const baselineReview = makeReview();
  const dirty = JSON.stringify(draft) !== JSON.stringify(baselineDraft) || JSON.stringify(review) !== JSON.stringify(baselineReview);
  const itemsFor = (key: ContractCategoryKey) => draft[key];
  const reviewFor = (key: ContractCategoryKey) => review[key] || [];
  const openWorkbench = (key: ContractCategoryKey) => { setActiveCategory(key); setSummaryOpen(false); setWorkbenchOpen(true); setCloseConfirm(false); };
  const requestCloseWorkbench = () => { if (dirty) setCloseConfirm(true); else setWorkbenchOpen(false); };
  const discardAndClose = () => { setDraft(makeDraft()); setReview(makeReview()); setEditingItem(null); setSummaryOpen(false); setCloseConfirm(false); setWorkbenchOpen(false); };
  const commitItem = () => {
    if (!editingItem || !editingItem.value.trim()) return;
    const value = editingItem.value.trim();
    setDraft((current) => ({ ...current, [editingItem.key]: editingItem.index < 0 ? [...current[editingItem.key], value] : current[editingItem.key].map((item, index) => index === editingItem.index ? value : item) }));
    setReview((current) => ({ ...current, [editingItem.key]: editingItem.index < 0 ? [...current[editingItem.key], 'changed'] : current[editingItem.key].map((status, index) => index === editingItem.index ? 'changed' : status) }));
    setEditingItem(null);
  };
  const removeItem = (key: ContractCategoryKey, index: number) => {
    setDraft((current) => ({ ...current, [key]: current[key].filter((_, itemIndex) => itemIndex !== index) }));
    setReview((current) => ({ ...current, [key]: current[key].filter((_, itemIndex) => itemIndex !== index) }));
  };
  const setItemStatus = (key: ContractCategoryKey, index: number, status: ContractReviewStatus) => setReview((current) => ({ ...current, [key]: current[key].map((item, itemIndex) => itemIndex === index ? status : item) }));
  const saveWorkbench = async () => {
    if (!artifact || !dirty) return;
    const result = await run(() => copilotApi.updateArtifact(project.id, 'screen-contract', { ...draft, review_metadata: review }), { label: '保存本轮功能契约检查', stage: 'wireframe_interpretation' });
    if (result) { setWorkbenchOpen(false); setCloseConfirm(false); }
  };
  const activeDefinition = contractCategories.find((item) => item.key === activeCategory)!;
  const activeItems = itemsFor(activeCategory);
  const filteredActiveItems = activeItems.map((item, index) => ({ item, index, status: reviewFor(activeCategory)[index] || 'unreviewed' })).filter(({ item, status }) => item.toLowerCase().includes(categoryQuery.trim().toLowerCase()) && (statusFilter === 'all' || status === statusFilter));
  const reviewStats = (key: ContractCategoryKey) => {
    const statuses = reviewFor(key);
    return { reviewed: statuses.filter((status) => status !== 'unreviewed').length, changed: statuses.filter((status) => status === 'changed').length, questions: statuses.filter((status) => status === 'question').length };
  };
  const statusCopy: Record<ContractReviewStatus, string> = { unreviewed: '未检查', confirmed: '已确认', changed: '已调整', question: '有疑问' };
  return <>
    <div className="workspace-content">
    <section className="workspace-heading contract-heading"><div><span className="kicker">01 · FUNCTION CONTRACT</span><h1>校对功能页面契约</h1><p>先看四类信息的检查进度，再进入专注工作台连续核对；整轮修改只生成一个新版本。</p></div>{artifact && <StatusPill status={artifact.status} />}</section>
    {!artifact ? <EmptyArtifact title={busy ? '正在生成功能契约' : '尚未生成功能契约'} copy={busy ? 'AI 正在结合已确认的设计意图读取 UE；完成后会自动展示四类关键信息。' : '回到项目输入，导入 UE Wireframe 后开始功能解读。'} /> : <><section className="contract-overview">
      <div className="contract-overview-main"><span>页面名称</span><div className="summary-value"><h2>{String(artifact.screen_name)}</h2></div><span>页面目的</span><div className="summary-value"><p>{String(artifact.purpose)}</p></div></div>
      <div className="primary-action-card"><span>核心动作</span><b>{String(artifact.primary_action)}</b></div>
    </section>
    {Boolean(artifact.coverage) && <div className="coverage-strip"><CheckSquare size={17} /><b>UE 来源覆盖校验通过</b><span>{((artifact.coverage as Record<string, unknown>).covered_items as string[])?.length || 0} 项已映射，0 项遗漏</span></div>}
    <section className="contract-category-overview"><header><div><span>四类关键信息</span><h3>选择一类开始检查</h3></div><small>进入后可连续滚动全部条目，无需翻页</small></header><div>{contractCategories.map((category) => { const stats = reviewStats(category.key); const total = itemsFor(category.key).length; return <button key={category.key} onClick={() => openWorkbench(category.key)}><span>{category.eyebrow}</span><div><h3>{category.label}</h3><em>{total} 项</em></div><p>{category.description}</p><footer><b>{stats.reviewed} / {total} 已检查</b><i style={{ '--progress': `${total ? stats.reviewed / total * 100 : 0}%` } as React.CSSProperties} /><small>{stats.changed ? `${stats.changed} 项修改` : '暂无修改'}{stats.questions ? ` · ${stats.questions} 项疑问` : ''}</small></footer><strong>检查与调整 <ArrowRight size={16} /></strong></button>; })}</div></section></>}
    </div>
    {artifact && <div className="workspace-footer"><button className="button button--ghost" disabled={busy} onClick={() => run(() => copilotApi.runStage(project.id, 'wireframe_interpretation'), { label: artifact.status === 'stale' ? '根据新输入重新解读功能' : '重新解读功能', stage: 'wireframe_interpretation' })}><RefreshCw size={16} />{artifact.status === 'stale' ? '输入已变化，重新解读' : '重新解读'}</button>{artifact.status === 'stale' ? <span className="stale-guidance">上游输入已变化，旧契约不能再次批准。</span> : artifact.status !== 'approved' ? <button className="button button--primary" disabled={busy} onClick={() => run(() => copilotApi.approveArtifact(project.id, 'screen-contract'), { label: '批准功能契约', stage: 'wireframe_interpretation' })}><Check size={17} />批准功能契约</button> : <button className="button button--primary" disabled={busy} onClick={() => run(() => copilotApi.runStage(project.id, 'layout_design'), { label: '生成布局提案', stage: 'layout_design' })}><Layers3 size={17} />生成布局提案</button>}</div>}
    {artifact && workbenchOpen && <div className="contract-focus-backdrop"><section className={`contract-focus-workbench ${summaryOpen ? 'has-summary' : ''}`}><header className="focus-header"><div><span>01 · CONTRACT REVIEW</span><h2>功能契约专注检查</h2><p>所有修改先保存在本轮草稿中，点击“保存本轮修改”后统一生成一个版本。</p></div><div><span className={dirty ? 'draft-state is-dirty' : 'draft-state'}>{dirty ? '有未保存修改' : '当前内容已保存'}</span><button className="icon-button" onClick={requestCloseWorkbench} aria-label="关闭专注检查"><X size={20} /></button></div></header>
      <nav className="focus-tabs" aria-label="功能契约分类">{contractCategories.map((category) => { const stats = reviewStats(category.key); return <button key={category.key} className={activeCategory === category.key ? 'is-active' : ''} onClick={() => setActiveCategory(category.key)}><span>{category.eyebrow}</span><b>{category.label}</b><em>{stats.reviewed}/{itemsFor(category.key).length}</em></button>; })}</nav>
      {summaryOpen && <section className="focus-summary-editor"><label><span>页面名称</span><input value={draft.screen_name} onChange={(event) => setDraft({ ...draft, screen_name: event.target.value })} /></label><label><span>核心动作</span><input value={draft.primary_action} onChange={(event) => setDraft({ ...draft, primary_action: event.target.value })} /></label><label className="span-2"><span>页面目的</span><textarea value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value })} /></label></section>}
      <div className="focus-body"><main className="focus-list-panel"><header className="focus-category-heading"><div><span>{activeDefinition.eyebrow}</span><h3>{activeDefinition.label}<em>{activeItems.length} 项</em></h3><p>{activeDefinition.description}</p></div><button className="button button--secondary" onClick={() => setSummaryOpen((current) => !current)}><Edit3 size={15} />{summaryOpen ? '收起页面摘要' : '编辑页面摘要'}</button></header>
        <div className="focus-tools"><label className="category-search"><Search size={16} /><input value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} placeholder={`搜索全部${activeDefinition.label}`} /></label><div className="status-filters">{([['all', '全部'], ['unreviewed', '未检查'], ['confirmed', '已确认'], ['changed', '已修改'], ['question', '有疑问']] as const).map(([value, label]) => <button key={value} className={statusFilter === value ? 'is-active' : ''} onClick={() => setStatusFilter(value)}>{label}</button>)}</div></div>
        <div className="focus-items">{filteredActiveItems.length ? filteredActiveItems.map(({ item, index, status }) => editingItem?.key === activeCategory && editingItem.index === index ? <div className="focus-item is-editing" key={`${activeCategory}-${index}`}><textarea autoFocus value={editingItem.value} onChange={(event) => setEditingItem({ ...editingItem, value: event.target.value })} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') commitItem(); if (event.key === 'Escape') setEditingItem(null); }} /><div><small>⌘ Enter 保存</small><button className="button button--primary" onClick={commitItem} disabled={!editingItem.value.trim()}><Save size={15} />保存条目</button><button className="button button--ghost" onClick={() => setEditingItem(null)}>取消</button></div></div> : <article className={`focus-item status-${status}`} key={`${activeCategory}-${index}-${item}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{item}</p><div className="item-status"><em>{statusCopy[status]}</em><button className={status === 'confirmed' ? 'is-active' : ''} title="标记为已确认" onClick={() => setItemStatus(activeCategory, index, 'confirmed')}><Check size={15} /></button><button className={status === 'question' ? 'is-active is-question' : ''} title="标记为有疑问" onClick={() => setItemStatus(activeCategory, index, 'question')}><MessageSquare size={15} /></button><button title="编辑条目" onClick={() => setEditingItem({ key: activeCategory, index, value: item })}><Edit3 size={15} /></button><button className="is-delete" title="删除条目" onClick={() => removeItem(activeCategory, index)}><Trash2 size={15} /></button></div></article>) : <div className="contract-items-empty">没有匹配条目，可以切换筛选条件或新增条目。</div>}</div>
        <div className="focus-add">{editingItem?.key === activeCategory && editingItem.index < 0 ? <div className="focus-item is-editing is-new"><textarea autoFocus placeholder={`输入新的${activeDefinition.label}条目`} value={editingItem.value} onChange={(event) => setEditingItem({ ...editingItem, value: event.target.value })} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') commitItem(); if (event.key === 'Escape') setEditingItem(null); }} /><div><button className="button button--primary" onClick={commitItem} disabled={!editingItem.value.trim()}><Save size={15} />加入草稿</button><button className="button button--ghost" onClick={() => setEditingItem(null)}>取消</button></div></div> : <button className="add-contract-item" onClick={() => setEditingItem({ key: activeCategory, index: -1, value: '' })}><Plus size={18} />新增{activeDefinition.label}条目</button>}</div>
      </main><aside className="focus-reference"><WireframeReference project={project} onOpen={() => setWireframeOpen(true)} /></aside></div>
      <footer className="focus-footer"><div><b>{filteredActiveItems.length} 项当前可见</b><span>连续滚动浏览，不再分页</span></div><div><button className="button button--ghost" onClick={requestCloseWorkbench}>关闭</button><button className="button button--primary" disabled={busy || !dirty || !draft.screen_name.trim() || !draft.purpose.trim() || !draft.primary_action.trim()} onClick={saveWorkbench}><Save size={16} />{dirty ? '保存本轮修改' : '暂无待保存更改'}</button></div></footer>
      {closeConfirm && <div className="focus-close-confirm" role="dialog" aria-modal="true" aria-labelledby="close-confirm-title"><section><i><AlertTriangle size={22} /></i><div><span>UNSAVED CHANGES</span><h3 id="close-confirm-title">要保存本轮修改吗？</h3><p>当前草稿尚未写入项目版本。你可以先保存并关闭，也可以放弃这些修改。</p></div><footer><button className="button button--ghost" onClick={() => setCloseConfirm(false)}>继续检查</button><button className="button button--danger" onClick={discardAndClose}>不保存并关闭</button><button className="button button--primary" disabled={busy || !draft.screen_name.trim() || !draft.purpose.trim() || !draft.primary_action.trim()} onClick={saveWorkbench}><Save size={16} />保存并关闭</button></footer></section></div>}
    </section></div>}
    {wireframeOpen && <WireframeLightbox project={project} onClose={() => setWireframeOpen(false)} />}
    </>;
}

function LayoutCanvas({ proposal, safeArea, project }: { proposal?: LayoutProposal; safeArea: boolean; project: DesignProject }) {
  const regions = Object.entries((proposal?.regions || {}) as Record<string, unknown>).map(([key, rawRegion]) => {
    const region = rawRegion && typeof rawRegion === 'object'
      ? rawRegion as { label?: string; recommended_ratio?: number }
      : { label: key.replaceAll('_', ' '), recommended_ratio: Number(rawRegion) || .2 };
    return [key, region] as const;
  });
  const spec = project.canvas_spec || { width: 1920, height: 1080, orientation: 'landscape', aspect_ratio: '16:9' };
  const tracks = regions.map(([, region]) => `${Math.max(.08, Number(region.recommended_ratio || .2))}fr`).join(' ') || '1fr';
  const portrait = spec.orientation === 'portrait';
  const annotationFor = (key: string, label: string, index: number) => {
    const source = `${key} ${label}`.toLowerCase();
    if (/safe|gesture|手势|安全/.test(source)) return { role: '安全留白', hint: '避免系统手势冲突' };
    if (/global.*nav|navigation|全局导航/.test(source)) return { role: '全局导航', hint: '切换一级功能' };
    if (/command|tab|指令|快捷/.test(source)) return { role: '快捷指令', hint: '模式与队伍切换' };
    if (/action|footer|save|操作|保存/.test(source)) return { role: '关键操作', hint: '完成与状态反馈' };
    if (/roster|list|filter|列表|筛选/.test(source)) return { role: '选择与筛选', hint: '浏览、定位与选择' };
    if (/formation|battlefield|workspace|阵型|阵容|站位/.test(source)) return { role: '核心工作区', hint: '主要编辑与反馈' };
    if (index === 0) return { role: '导航与状态', hint: '返回、标题与资源' };
    if (index === 1) return { role: '主要入口', hint: '核心功能触发' };
    return { role: '信息与操作', hint: '内容展示与交互' };
  };
  return <div className={`layout-canvas-shell ${portrait ? 'is-portrait' : ''}`}><div className="layout-toolbar"><span>{spec.width} × {spec.height}</span><span>{spec.aspect_ratio} · {portrait ? '竖屏' : spec.orientation === 'square' ? '方形' : '横屏'}</span><span>焦点 01 → 0{Math.max(1, regions.length)}</span>{safeArea && <span className="safe-legend"><i />边缘阴影：5% 预留</span>}</div><div className="layout-canvas" style={{ aspectRatio: `${spec.width}/${spec.height}`, ...(portrait ? { gridTemplateRows: tracks } : { gridTemplateColumns: tracks }) }}>{safeArea && <div className="safe-area" aria-label="画布四周各预留 5%，仅用于早期布局检查"><i className="safe-band safe-band--top"><span>边缘预留 5%（示意）</span></i><i className="safe-band safe-band--right" /><i className="safe-band safe-band--bottom" /><i className="safe-band safe-band--left" /></div>}{regions.map(([key, region], index) => {
    const ratio = Math.round(Number(region.recommended_ratio || .2) * 100);
    const fullLabel = String(region.label || key.replaceAll('_', ' '));
    const [regionName, ...descriptionParts] = fullLabel.split(/[：:]/);
    const annotation = annotationFor(key, fullLabel, index);
    return <section className={`layout-region ${ratio <= 10 ? 'is-compact' : ''}`} key={key} title={fullLabel}><b>0{index + 1}</b><div className="region-copy"><strong>{regionName.trim()}</strong>{descriptionParts.length > 0 && <p>{descriptionParts.join('：').trim()}</p>}<small>画布占比 {ratio}%</small></div><i><b>{annotation.role}</b><span>{annotation.hint}</span></i></section>;
  })}</div></div>;
}

function LayoutWorkspace({ project, busy, run, onNavigate }: WorkspaceProps & { onNavigate: (stage: StageId) => void }) {
  const proposals = project.artifacts.layouts?.proposals || [];
  const approvedId = project.artifacts.approvedLayout?.status === 'approved'
    ? String(project.artifacts.approvedLayout.source_proposal || '')
    : '';
  const preferredProposalId = proposals.some((proposal) => proposal.id === approvedId) ? approvedId : (proposals[0]?.id || '');
  const [selected, setSelected] = useState(preferredProposalId);
  const [safeArea, setSafeArea] = useState(true);
  const [notes, setNotes] = useState('');
  const approvedNotes = ((project.artifacts.approvedLayout?.manual_adjustments as string[]) || []).join('\n');
  useEffect(() => { setSelected(preferredProposalId); setNotes(approvedNotes); }, [project.id, project.artifacts.layouts?.version, preferredProposalId, approvedNotes]);
  const selectedProposal = proposals.find((proposal) => proposal.id === selected) || proposals[0];
  const selectedProposalId = selectedProposal?.id || '';
  const notesDirty = approvedId === selected && notes.trim() !== approvedNotes.trim();
  const interactionFlow = Array.isArray(selectedProposal?.interaction_flow)
    ? selectedProposal.interaction_flow.map(String)
    : selectedProposal?.interaction_flow && typeof selectedProposal.interaction_flow === 'object'
      ? Object.entries(selectedProposal.interaction_flow as Record<string, unknown>).map(([key, value]) => `${key.replaceAll('_', ' ')}：${String(value)}`)
      : selectedProposal?.interaction_flow ? [String(selectedProposal.interaction_flow)] : [];
  return <>
    <div className="workspace-content">
    <section className="workspace-heading"><div><span className="kicker">02 · UX / LAYOUT DESIGN</span><h1>比较可执行的布局策略</h1><p>在目标分辨率中检查区域比例、焦点路径、安全区和实际信息承载。</p></div>{project.artifacts.approvedLayout && <StatusPill status={String(project.artifacts.approvedLayout.status)} />}</section>
    {!proposals.length ? <EmptyArtifact title="尚未生成布局提案" copy="批准功能契约后，AI 会给出效率、表现与平衡三种结构。" /> : <><div className="proposal-tabs">{proposals.map((proposal, index) => <button key={proposal.id} className={selected === proposal.id ? 'is-selected' : ''} onClick={() => setSelected(proposal.id)}><span>方案 {String.fromCharCode(65 + index)}</span><b>{proposal.name}</b><small>{proposal.designer_fit || proposal.strategy}</small>{approvedId === proposal.id && <em><Check size={12} />当前批准</em>}</button>)}</div><div className="layout-review"><LayoutCanvas proposal={selectedProposal} safeArea={safeArea} project={project} /><aside className="layout-notes"><h3>{selectedProposal?.name}</h3><p>{selectedProposal?.strategy}</p><div className="review-checks"><label><input type="checkbox" checked={safeArea} onChange={(event) => setSafeArea(event.target.checked)} />显示边缘预留（5% 示意）</label><label><input type="checkbox" defaultChecked />校验焦点顺序</label><label><input type="checkbox" defaultChecked />校验长文本空间</label><label><input type="checkbox" defaultChecked />覆盖加载/禁用状态</label></div><ol>{interactionFlow.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ol><label className="notes-field"><span>人工调整与批准备注</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={project.canvas_spec?.orientation === 'portrait' ? '例如：保持竖屏，上方阵容区、下方侠客抽屉，底部固定保存与全局导航。' : '例如：右侧属性区缩小 4%，主按钮保持在首屏焦点链末端。'} /></label></aside></div></>}
    </div>
    {proposals.length > 0 && <div className="workspace-footer"><button className="button button--ghost" disabled={busy} onClick={() => project.artifacts.layouts?.status === 'stale' ? onNavigate('wireframe_interpretation') : run(() => copilotApi.runStage(project.id, 'layout_design'), { label: '重新生成布局提案', stage: 'layout_design' })}><RefreshCw size={15} />{project.artifacts.layouts?.status === 'stale' ? '先更新功能契约' : '重新生成'}</button>{project.artifacts.layouts?.status === 'stale' ? <span className="stale-guidance">画布或需求已变化，旧布局只能用于对照。</span> : approvedId !== selectedProposalId || project.artifacts.approvedLayout?.status !== 'approved' || notesDirty ? <button className="button button--primary" disabled={busy || !selectedProposalId} onClick={() => run(() => copilotApi.approveArtifact(project.id, 'approved-layout', { proposalId: selectedProposalId, manualAdjustments: notes.trim() ? notes.split('\n').map((item) => item.trim()).filter(Boolean) : [] }), { label: notesDirty ? '更新布局批准备注' : '批准所选布局', stage: 'layout_design' })}><CheckSquare size={16} />{notesDirty ? '更新批准备注' : '批准此布局'}</button> : project.project_type === 'existing' && !(project.reference_assets?.length) ? <button className="button button--primary" disabled={busy} onClick={() => onNavigate('style_resolution')}><ImagePlus size={16} />先添加风格参考</button> : <button className="button button--primary" disabled={busy} onClick={() => run(() => copilotApi.runStage(project.id, 'style_resolution'), { label: '解析视觉风格', stage: 'style_resolution' })}><LockKeyhole size={16} />进入风格锁定</button>}</div>}
    </>;
}

function ruleText(value: unknown): string {
  if (Array.isArray(value)) return value.join(' · ');
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key.replaceAll('_', ' ')}：${typeof item === 'object' ? ruleText(item) : String(item)}`).join('\n');
  return String(value || '—');
}

function displayText(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  if (Array.isArray(value)) return value.map((item) => displayText(item, '')).filter(Boolean).join(' · ') || fallback;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred = record.value ?? record.hex ?? record.color ?? record.name;
    if (preferred !== undefined && typeof preferred !== 'object') return String(preferred);
    return ruleText(record);
  }
  return String(value);
}

function semanticColor(value: unknown) {
  if (!value || typeof value !== 'object') return { value: displayText(value), usage: '' };
  const record = value as Record<string, unknown>;
  return {
    value: displayText(record.value ?? record.hex ?? record.color),
    usage: displayText(record.usage ?? record.description, '')
  };
}

function StyleWorkspace({ project, busy, run }: WorkspaceProps) {
  const artifact = project.artifacts.styleContract;
  const references = project.reference_assets || [];
  const canGenerate = project.artifacts.approvedLayout?.status === 'approved' && (project.project_type === 'new' || references.length > 0);
  const colors = artifact?.colors && typeof artifact.colors === 'object' ? Object.entries(artifact.colors as Record<string, unknown>) : [];
  const [editing, setEditing] = useState(false);
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonError, setJsonError] = useState('');
  useEffect(() => { if (artifact) setJsonDraft(JSON.stringify({ visual_identity: artifact.visual_identity, colors: artifact.colors, typography: artifact.typography, materials: artifact.materials, geometry: artifact.geometry, lighting: artifact.lighting, components: artifact.components, composition: artifact.composition, negative_style_constraints: artifact.negative_style_constraints, designer_summary: artifact.designer_summary }, null, 2)); setEditing(false); }, [artifact?.id, artifact?.version]);
  const save = () => { try { const patch = JSON.parse(jsonDraft); setJsonError(''); run(() => copilotApi.updateArtifact(project.id, 'style-contract', patch), { label: '保存风格规范新版本', stage: 'style_resolution' }).then(() => setEditing(false)); } catch { setJsonError('JSON 格式有误，请检查逗号、引号和括号。'); } };
  const manage = (input: { id: string; action: 'remove' | 'move' | 'role'; direction?: 'up' | 'down'; role?: string }) => run(() => copilotApi.manageReference(project.id, input), { label: '更新风格参考' });
  const warnings = ((artifact?.quality_checks as Record<string, unknown>)?.warnings as string[]) || [];
  return <>
    <div className="workspace-content">
    <section className="workspace-heading"><div><span className="kicker">03 · STYLE RESOLUTION</span><h1>{project.project_type === 'existing' ? '重建现有项目的视觉语言' : '把美术方向变成执行规范'}</h1><p>完整展示可复制的颜色、字号、几何、材质、组件状态和构图规则。</p></div><div className="heading-actions">{artifact && <button className="button button--secondary" onClick={() => setEditing(!editing)}><Edit3 size={15} />{editing ? '返回规范' : '编辑规范'}</button>}{artifact && <StatusPill status={artifact.status} />}</div></section>
    <div className="reference-strip"><div><b>风格参考与用途</b><small>{project.project_type === 'existing' ? '已有项目至少需要 1 张；主参考决定总体语言' : '可选，用于收敛风格意图'}</small></div><div className="reference-count"><ImagePlus size={17} />{references.length} 张</div><button className="button button--secondary" disabled={busy} onClick={() => run(() => copilotApi.importFile(project.id, 'reference'), { label: '添加风格参考' })}>批量添加</button></div>
    {references.length > 0 && <div className="reference-gallery">{references.map((asset, index) => <article key={asset.id}><img src={asset.preview} alt={asset.name} /><div><b title={asset.name}>{asset.name}</b><small>{asset.metadata ? `${asset.metadata.width}×${asset.metadata.height}` : '图片参考'}</small><select value={asset.role} disabled={busy} onChange={(event) => manage({ id: asset.id, action: 'role', role: event.target.value })}><option value="primary">主参考</option><option value="component">组件</option><option value="material">材质</option><option value="composition">构图</option><option value="supporting">辅助</option></select></div><nav><button title="前移" disabled={busy || index === 0} onClick={() => manage({ id: asset.id, action: 'move', direction: 'up' })}><ArrowUp size={13} /></button><button title="后移" disabled={busy || index === references.length - 1} onClick={() => manage({ id: asset.id, action: 'move', direction: 'down' })}><ArrowDown size={13} /></button><button title="移出参考集" disabled={busy} onClick={() => manage({ id: asset.id, action: 'remove' })}><Trash2 size={13} /></button></nav></article>)}</div>}
    {!artifact ? <EmptyArtifact title="风格规范尚未生成" copy={project.project_type === 'existing' && !references.length ? '请先添加至少一张参考图，并指定一张主参考。' : '先批准布局，再生成可复现的风格规范。'} /> : editing ? <div className="json-editor"><div><b>结构化风格规范</b><p>修改后会生成新版本，并让下游视觉探索标记为“需更新”。</p></div><textarea value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} spellCheck={false} />{jsonError && <span className="inline-error">{jsonError}</span>}<button className="button button--primary" onClick={save} disabled={busy}><Save size={15} />保存为新版本</button></div> : <><div className="style-board"><section className="style-identity"><span>视觉识别</span><h2>{displayText((artifact.visual_identity as Record<string, unknown>)?.theme || project.art_direction)}</h2><div className="tag-row">{(((artifact.visual_identity as Record<string, unknown>)?.mood as unknown[]) || []).map((item, index) => <i key={`${index}-${displayText(item)}`}>{displayText(item)}</i>)}</div><p>{displayText(artifact.designer_summary, '')}</p></section><section className="palette"><span>语义色彩系统</span><div>{colors.map(([name, rawValue]) => { const color = semanticColor(rawValue); return <figure key={name} title={color.usage || undefined}><i style={{ background: color.value }} /><figcaption><b>{name}</b><small>{color.value}</small>{color.usage && <em>{color.usage}</em>}</figcaption></figure>; })}</div></section><section className="style-rules"><span>可复现规则</span>{['materials', 'geometry', 'lighting', 'components', 'composition'].map((key) => <div key={key}><b>{fieldLabels[key]}</b><p>{ruleText(artifact[key])}</p></div>)}</section></div>{warnings.map((warning, index) => <div className="quality-warning" key={`${index}-${displayText(warning)}`}><AlertTriangle size={16} /><div><b>功能密度冲突</b><p>{displayText(warning)}</p></div></div>)}</>}
    </div>
    <div className="workspace-footer"><button className="button button--ghost" disabled={busy || !canGenerate} onClick={() => run(() => copilotApi.runStage(project.id, 'style_resolution'), { label: artifact?.status === 'stale' ? '根据新参考重新解析风格' : '解析视觉风格', stage: 'style_resolution' })}><RefreshCw size={15} />{artifact?.status === 'stale' ? '参考已变化，重新解析' : artifact ? '重新解析' : '生成风格规范'}</button>{!canGenerate && <span className="stale-guidance">{project.artifacts.approvedLayout?.status !== 'approved' ? '请先批准布局。' : '已有项目必须先添加参考图。'}</span>}{artifact && artifact.status !== 'approved' && artifact.status !== 'stale' && <button className="button button--primary" disabled={busy} onClick={() => run(() => copilotApi.approveArtifact(project.id, 'style-contract'), { label: '批准并锁定风格', stage: 'style_resolution' })}><LockKeyhole size={16} />批准并锁定</button>}{artifact?.status === 'approved' && <button className="button button--primary" disabled={busy} onClick={() => run(() => copilotApi.runStage(project.id, 'visual_exploration'), { label: '生成 3 个视觉方向', stage: 'visual_exploration', total: 3 })}><WandSparkles size={16} />生成 3 个方向</button>}</div>
    </>;
}

function VisualLightbox({ variation, index, onClose, onExport }: { variation: VisualVariation; index: number; onClose: () => void; onExport: () => void }) {
  const outputSize = variation.output_width && variation.output_height ? `${variation.output_width}×${variation.output_height}` : variation.target_size;
  return <div className="lightbox" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="lightbox-panel"><header><div><span>V{index + 1} · {variation.strategy}</span><b>{variation.strategy === 'conservative' ? '保守继承' : variation.strategy === 'expressive' ? '表现强化' : '局部创新'}</b></div><div><button className="button button--secondary" onClick={onExport}><Download size={15} />导出 PNG</button><button className="icon-button" onClick={onClose}><X size={18} /></button></div></header><img src={variation.image_url} alt={variation.strategy} /><footer><code>布局：{variation.layout_name || variation.layout_version}</code><code>风格：{variation.style_name || variation.style_version}</code><code>成图：{outputSize ? `${outputSize}${variation.canvas_spec?.aspect_ratio ? ` · ${variation.canvas_spec.aspect_ratio}` : ''}` : '历史结果未记录像素'}</code>{variation.canvas_spec && <code>设计画布：{variation.canvas_spec.width}×{variation.canvas_spec.height}</code>}</footer></div></div>;
}

function VisualWorkspace({ project, busy, run, canCancel, onCancel }: WorkspaceProps & { canCancel: boolean; onCancel: () => void }) {
  const artifact = project.artifacts.visualResults;
  const variations = artifact?.variations || [];
  const strategies = ['conservative', 'expressive', 'innovative'];
  const missingStrategies = strategies.filter((strategy) => !variations.some((variation) => variation.strategy === strategy));
  const approvedIds = ((artifact?.review as Record<string, unknown>)?.selected_variation_ids as string[]) || [];
  const [selected, setSelected] = useState<string[]>(approvedIds.length ? approvedIds : variations[0]?.id ? [variations[0].id] : []);
  const [lightbox, setLightbox] = useState('');
  const [notes, setNotes] = useState(String((artifact?.review as Record<string, unknown>)?.notes || ''));
  useEffect(() => { setSelected(approvedIds.length ? approvedIds : variations[0]?.id ? [variations[0].id] : []); }, [project.id, artifact?.version, variations.length]);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const active = variations.find((item) => item.id === lightbox);
  const approve = (mode: 'selected' | 'combine') => run(() => copilotApi.approveArtifact(project.id, 'visual-results', { selectedIds: selected, mode, notes }), { label: mode === 'combine' ? '保存组合方向' : '批准视觉方向', stage: 'visual_exploration' });
  return <>
    <div className="workspace-content visual-workspace">
    <section className="workspace-heading"><div><span className="kicker">04 · AI VISUAL EXPLORATION</span><h1>评审、组合并交付视觉方向</h1><p>支持多选组合、全屏检查、批注意见、批准版本、全部否决和单张导出。</p></div>{variations.length > 0 && <StatusPill status={artifact?.status || 'reviewed'} />}</section>
    {!variations.length ? <EmptyArtifact title={busy ? '正在生成视觉方向…' : '尚未生成视觉探索'} copy={busy ? '结果会逐张写入；可以停止剩余任务，已完成图片不会丢失。' : '批准并锁定风格规范后开始生图。'} action={canCancel ? <button className="button button--ghost" onClick={onCancel}>停止剩余任务</button> : undefined} /> : <>{artifact?.status === 'stale' && <div className="quality-warning"><AlertTriangle size={16} /><div><b>结果依据已变化</b><p>布局、风格或输入已更新，这些图片只保留用于对照，不能继续批准。</p></div></div>}<div className={`visual-grid is-${project.canvas_spec?.orientation || 'landscape'}`}>{variations.map((variation, index) => { const outputSize = variation.output_width && variation.output_height ? `${variation.output_width}×${variation.output_height}` : variation.target_size; return <article key={variation.id} className={`visual-card ${selected.includes(variation.id) ? 'is-selected' : ''}`}><button className="visual-preview-button" onClick={() => setLightbox(variation.id)}><div className="visual-image" style={{ aspectRatio: variation.output_width && variation.output_height ? `${variation.output_width}/${variation.output_height}` : variation.canvas_spec ? `${variation.canvas_spec.width}/${variation.canvas_spec.height}` : project.canvas_spec ? `${project.canvas_spec.width}/${project.canvas_spec.height}` : '16/9' }}><img src={variation.image_url} alt={variation.strategy} /><span>V{index + 1}</span><em><Maximize2 size={14} />全屏检查</em></div></button><div className="visual-card-copy"><div><span>{variation.strategy}</span><b>{variation.strategy === 'conservative' ? '保守继承' : variation.strategy === 'expressive' ? '表现强化' : '局部创新'}</b></div><label><input type="checkbox" disabled={artifact?.status === 'stale'} checked={selected.includes(variation.id)} onChange={() => toggle(variation.id)} />加入评审选择</label><small>{variation.layout_name || variation.layout_version} · {variation.style_name || variation.style_version}</small><small>{outputSize ? `成图 ${outputSize}${variation.canvas_spec?.aspect_ratio ? ` · ${variation.canvas_spec.aspect_ratio}` : ''}` : '历史结果未记录实际像素'}</small><button className="retry-variation" disabled={busy || artifact?.status === 'stale'} onClick={() => run(() => copilotApi.runStage(project.id, 'visual_exploration', { strategies: [variation.strategy], preserveExisting: true, feedback: notes }), { label: `重新生成 ${variation.strategy} 方向`, stage: 'visual_exploration', total: 1 })}><RefreshCw size={12} />仅重试此方向</button></div></article>; })}</div><div className="visual-review-panel"><label><MessageSquare size={16} /><span>评审批注 / 下一轮反馈</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="例如：保留 V2 的主视觉层级，采用 V1 的属性卡片；降低紫色发光强度，放大升级前后数值差。" /></label><div><b>已选择 {selected.length} 个方向</b><small>{artifact?.status === 'approved' ? '评审决策已写入 Artifact，可随时重新选择并产生新版本。' : '选择一个批准，或选择两个以上进行组合。'}</small></div></div></>}
    </div>
    <div className="workspace-footer visual-footer">{canCancel ? <button className="button button--ghost" onClick={onCancel}><X size={15} />停止剩余任务</button> : missingStrategies.length > 0 && artifact?.status !== 'stale' ? <button className="button button--ghost" disabled={busy} onClick={() => run(() => copilotApi.runStage(project.id, 'visual_exploration', { strategies: missingStrategies, preserveExisting: true }), { label: `补全 ${missingStrategies.length} 个方向`, stage: 'visual_exploration', total: missingStrategies.length })}><RefreshCw size={15} />补全缺失方向</button> : <button className="button button--ghost" disabled={busy || artifact?.status === 'stale'} onClick={() => run(() => copilotApi.updateArtifact(project.id, 'visual-results', { status: 'rejected', review_notes: notes }), { label: '记录全部否决', stage: 'visual_exploration' }).then(() => run(() => copilotApi.runStage(project.id, 'visual_exploration', { feedback: notes }), { label: '根据反馈重新探索', stage: 'visual_exploration', total: 3 }))}><RefreshCw size={15} />全部否决并重探</button>}<div><button className="button button--secondary" disabled={busy || artifact?.status === 'stale' || selected.length < 2} onClick={() => approve('combine')}><Copy size={15} />组合所选</button><button className="button button--primary" disabled={busy || artifact?.status === 'stale' || selected.length !== 1} onClick={() => approve('selected')}><Check size={16} />批准所选方向</button></div></div>
    {active && <VisualLightbox variation={active} index={variations.indexOf(active)} onClose={() => setLightbox('')} onExport={() => copilotApi.exportVisual(project.id, active.id)} />}
    </>;
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
    catch (cause) { setError(friendlyError(cause)); setRetryTask({ task, options }); }
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

  return <div className={`app-shell ${inspectorOpen ? 'has-inspector' : ''} ${config?.platform === 'darwin' ? 'is-mac' : ''}`}>
    <header className="topbar"><div className="brand"><div><Aperture size={19} /></div><span><b>Game UI</b><small>Design Copilot</small></span></div><div className="project-switcher"><button onClick={() => setCreateOpen(true)}><Plus size={15} />新项目</button><select value={project?.id || ''} onChange={(event) => switchProject(event.target.value)}><option value="" disabled>选择项目</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.status === 'archived' ? '〔归档〕' : ''}{item.name}</option>)}</select>{project && <button className="manage-button" onClick={() => setManagerOpen(true)}><MoreHorizontal size={16} />管理</button>}</div><nav><div className={`connection ${config?.kunpo.configured ? 'is-online' : ''}`}><i />{config?.kunpo.configured ? `${config.kunpo.mode === 'gateway' ? 'Gateway' : 'Kunpo API'} 已就绪` : 'Kunpo 未配置'}</div>{project && config?.platform !== 'web' && <button title="在 Finder 中显示项目" onClick={() => copilotApi.revealProject(project.id)}><FolderOpen size={17} /></button>}<button title="查看 AI 输入、产物与历史版本" onClick={() => setInspectorOpen(!inspectorOpen)}><PanelLeftClose size={17} /></button><button title="模型与工作区配置" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button>{config?.platform === 'web' && <button title="退出当前飞书账号" onClick={() => copilotApi.logout()}><LogOut size={17} /></button>}</nav></header>
    <aside className="stage-rail"><div className="rail-title"><span>DESIGN FLOW</span><small>{project ? '1 个页面' : '无项目'}</small></div><div className="stage-list">{stages.map((stage, index) => { const status = statusOf(project, stage.id); const Icon = stage.icon; return <button key={stage.id} disabled={!project} className={`${activeStage === stage.id ? 'is-active' : ''} is-${status}`} onClick={() => setActiveStage(stage.id)}><div className="stage-node"><Icon size={16} /></div><div><span>{stage.number} · {stage.eyebrow}</span><b>{stage.label}</b><small>{stage.description}</small></div>{index < stages.length - 1 && <i className="stage-line" />}</button>; })}</div><div className="rail-principle"><Bot size={17} /><p><b>状态属于设计流水线</b><br />模型生成、人工修改和批准都保留可追踪版本。</p></div></aside>
    <main ref={mainWorkspaceRef} className="main-workspace">{busyJob && <div className="busy-bar"><LoaderCircle className="spin" size={14} /><div><b>{busyJob.label}</b><span>{progress ? `${progress.completed}/${progress.total} · ${progress.message || ''}` : '正在处理'} · 已用时 {elapsed}s</span></div><small>{busyJob.stage === 'visual_exploration' ? '结果会逐张保存' : '可继续浏览其他阶段'}</small></div>}{error && <div className="error-banner"><b>当前步骤未完成</b><span>{error}</span>{retryTask && !busy && <button className="error-retry" onClick={() => run(retryTask.task, retryTask.options)}><RefreshCw size={13} />重试</button>}<button aria-label="关闭错误" onClick={() => setError('')}>×</button></div>}{!project ? <div className="welcome"><Aperture size={38} /><h1>为游戏 UI 设计师准备的 AI 流水线</h1><p>从 UE 理解到视觉交付，每个决策都可修改、可追踪、可复现。</p><button className="button button--primary" onClick={() => setCreateOpen(true)}><Plus size={16} />建立第一个项目</button></div> : activeStage === 'input' ? <InputWorkspace project={project} busy={busy} run={run} /> : activeStage === 'wireframe_interpretation' ? <ContractWorkspace project={project} busy={busy} run={run} /> : activeStage === 'layout_design' ? <LayoutWorkspace project={project} busy={busy} run={run} onNavigate={setActiveStage} /> : activeStage === 'style_resolution' ? <StyleWorkspace project={project} busy={busy} run={run} /> : <VisualWorkspace project={project} busy={busy} run={run} canCancel={busyJob?.stage === 'visual_exploration'} onCancel={cancelVisual} />}</main>
    {inspectorOpen && <aside className="artifact-inspector"><div className="inspector-head"><span>AI 输入、产物与版本</span><FileJson size={17} /></div>{activeStage === 'input' && project ? <InputSourceSummary project={project} /> : currentArtifact ? <JsonSummary artifact={currentArtifact} history={project?.artifactHistory?.filter((item) => item.id === currentArtifact.id || item.kind.includes(activeStage.split('_')[0]))} /> : <EmptyArtifact title="当前阶段尚无 AI 产物" copy="完成当前步骤后，版本、来源、结构化内容和历史快照会显示在这里。" />}<div className="inspector-foot"><b>{config?.platform === 'web' ? '在线项目空间' : '本地项目目录'}</b><code>{config?.workspaceRoot || 'Loading…'}</code><small>批准与生成结果均保存在这里，可随时回看历史版本。</small></div></aside>}
    {createOpen && <NewProjectDialog onCreate={create} onClose={projects.length ? () => setCreateOpen(false) : undefined} onLogout={config?.platform === 'web' ? () => { void copilotApi.logout(); } : undefined} busy={busy} />}{settingsOpen && config && <SettingsDialog config={config} onSaved={setConfig} onClose={() => setSettingsOpen(false)} />}{managerOpen && project && <ProjectManager project={project} projects={projects} busy={busy} run={run} onClose={() => setManagerOpen(false)} onSwitch={switchProject} />}
  </div>;
}
