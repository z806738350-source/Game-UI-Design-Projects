import {
  Check, Clock3, FileJson, Layers3, LockKeyhole, Maximize2, ScanSearch, Upload, WandSparkles, X
} from 'lucide-react';
import type { Artifact, DesignProject, ScreenControl } from '../../types';

export const stages = [
  { id: 'input', number: '00', label: '项目输入', eyebrow: 'INPUT', description: '需求、UE 线框与项目类型', icon: Upload },
  { id: 'wireframe_interpretation', number: '01', label: '功能解读', eyebrow: 'UNDERSTAND', description: '建立功能页面契约', icon: ScanSearch },
  { id: 'layout_design', number: '02', label: '布局设计', eyebrow: 'STRUCTURE', description: '比较、调整并批准布局', icon: Layers3 },
  { id: 'style_resolution', number: '03', label: '风格锁定', eyebrow: 'STYLE LOCK', description: '沉淀可复现视觉规范', icon: LockKeyhole },
  { id: 'visual_exploration', number: '04', label: '视觉探索', eyebrow: 'EXPLORE', description: '评审、组合与交付方向', icon: WandSparkles }
] as const;

export type StageId = typeof stages[number]['id'];
export type RunOptions = { label: string; stage?: StageId; total?: number };
export type RunTask = (task: () => Promise<DesignProject>, options: RunOptions) => Promise<DesignProject | undefined>;
export type WorkspaceProps = { project: DesignProject; busy: boolean; run: RunTask };

export const fieldLabels: Record<string, string> = {
  required_controls: '必需控件', required_information: '必需信息', states: '交互状态', edge_cases: '边界情况',
  materials: '材质', geometry: '几何规则', lighting: '光影', components: '组件', composition: '构图'
};

export const screenInput = (project: DesignProject, input: Record<string, unknown> = {}) => ({ screenId: project.screen_id, ...input });

export function statusOf(project: DesignProject | null, stageId: StageId) {
  if (stageId === 'input') return project?.wireframe_path && project.requirement && (project.requirement_confirmed ?? true) ? 'approved' : project?.workflow?.stages?.input?.status || 'draft';
  return project?.workflow?.stages?.[stageId]?.status || 'draft';
}

export function statusLabel(status: string) {
  return ({ draft: '待开始', in_progress: '运行中', reviewed: '待确认', approved: '已批准', generated: '已生成', stale: '需更新', rejected: '已否决', failed: '失败', cancelled: '已停止' } as Record<string, string>)[status] || status;
}

export function friendlyError(cause: unknown) {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const clean = raw.replace(/^Error invoking remote method '[^']+': Error:\s*/i, '').trim();
  if (/ImageDecodeFailed|图片解码失败/i.test(clean)) return '生成服务无法读取参考图。请重新导入有效的 PNG、JPG 或 WebP 图片后重试。';
  if (/JSON|结构化结果|schema|validation/i.test(clean)) return `模型返回的结构化内容连续自动修复后仍不完整。${clean.includes('连续 3 次') ? '' : '请重试当前步骤。'}`;
  if (/Kunpo request failed/i.test(clean)) return clean.replace(/Kunpo request failed \(\d+\):?\s*/i, '生成服务暂时未完成请求：');
  if (/Kunpo is not configured/i.test(clean)) return '图像服务尚未配置，请先打开右上角“模型与工作区配置”。';
  return clean;
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-pill--${status}`}><i />{statusLabel(status)}</span>;
}

export function EmptyArtifact({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return <div className="empty-artifact"><FileJson size={26} /><b>{title}</b><p>{copy}</p>{action}</div>;
}

export function JsonSummary({ artifact, history = [] }: { artifact: Artifact; history?: DesignProject['artifactHistory'] }) {
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

export function WireframeLightbox({ project, onClose }: { project: DesignProject; onClose: () => void }) {
  if (!project.wireframe_preview) return null;
  return <div className="wireframe-lightbox" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="wireframe-lightbox-panel">
      <header><div><span>UE WIREFRAME</span><b>{project.wireframe_name || '当前线框稿'}</b></div><button className="icon-button" aria-label="关闭 UE 大图" onClick={onClose}><X size={20} /></button></header>
      <img src={project.wireframe_preview} alt="UE Wireframe 大图" />
      {project.canvas_spec && <footer>{project.canvas_spec.width} × {project.canvas_spec.height} · {project.canvas_spec.orientation === 'portrait' ? '竖屏' : project.canvas_spec.orientation === 'landscape' ? '横屏' : '方形'} · {project.canvas_spec.aspect_ratio}</footer>}
    </div>
  </div>;
}

export function WireframeReference({ project, onOpen, editable = false, busy = false, onReplace }: { project: DesignProject; onOpen: () => void; editable?: boolean; busy?: boolean; onReplace?: () => void }) {
  return <section className="wireframe-reference">
    <header><div><span>UE WIREFRAME</span><b>{project.wireframe_name || '尚未导入线框稿'}</b></div>{editable && <button className="button button--secondary" data-testid="wireframe-import" disabled={busy} onClick={onReplace}>{project.wireframe_path ? '替换' : '选择图片'}</button>}</header>
    {project.wireframe_preview ? <button className="wireframe-canvas-button" onClick={onOpen} aria-label="放大查看 UE 线框稿"><img src={project.wireframe_preview} alt="UE Wireframe 预览" /><span><Maximize2 size={16} />放大对照</span></button> : <div className="wireframe-empty"><Upload size={24} /><span>导入线框稿后，AI 将直接读取画面结构和信息。</span></div>}
    {project.canvas_spec && <div className="wireframe-meta"><span>{project.canvas_spec.width} × {project.canvas_spec.height}</span><span>{project.canvas_spec.orientation === 'portrait' ? '竖屏' : project.canvas_spec.orientation === 'landscape' ? '横屏' : '方形'}</span><span>{project.canvas_spec.aspect_ratio}</span></div>}
  </section>;
}

// Shared normalization for screen contract controls used by workbench drafts.
export function normalizeDraftControls(rawControls: unknown): ScreenControl[] {
  return Array.isArray(rawControls) ? (rawControls as unknown[]).map((control, index) => typeof control === 'string'
    ? { id: `control-${index + 1}`, label: control, role: 'action', required: true, migrated_from_label: control }
    : {
      id: String((control as ScreenControl).id), label: String((control as ScreenControl).label),
      role: String((control as ScreenControl).role || 'action'), required: (control as ScreenControl).required !== false,
      ...((control as ScreenControl).migrated_from_label ? { migrated_from_label: (control as ScreenControl).migrated_from_label } : {})
    }) : [];
}

export function preserveProjectPreviews(next: DesignProject, current: DesignProject | null) {
  if (!current || current.id !== next.id) return next;
  const previousReferences = new Map((current.reference_assets || []).map((asset) => [asset.id, asset.preview]));
  return {
    ...next,
    wireframe_preview: next.wireframe_preview || current.wireframe_preview,
    reference_assets: (next.reference_assets || []).map((asset) => ({ ...asset, preview: asset.preview || previousReferences.get(asset.id) }))
  };
}

export const strictContinuation = (project: DesignProject) => project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation';

// Legacy check icon re-export keeps strict gate lists readable in workbenches.
export { Check };
