import {
  Check, ChevronDown, Clock3, FileJson, Layers3, LockKeyhole, Maximize2, ScanSearch, Upload, WandSparkles, X
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Artifact, DesignProject, ScreenControl } from '../../types';

export const stages = [
  { id: 'input', number: '00', label: '项目输入', eyebrow: 'INPUT', description: '需求、UE 线框与项目类型', icon: Upload },
  { id: 'wireframe_interpretation', number: '01', label: '功能解读', eyebrow: 'UNDERSTAND', description: '建立功能页面契约', icon: ScanSearch },
  { id: 'layout_design', number: '02', label: '布局设计', eyebrow: 'STRUCTURE', description: '比较、调整并批准布局', icon: Layers3 },
  { id: 'style_resolution', number: '03', label: '风格锁定', eyebrow: 'STYLE LOCK', description: '沉淀可复现视觉规范', icon: LockKeyhole },
  { id: 'visual_exploration', number: '04', label: '视觉探索', eyebrow: 'EXPLORE', description: '评审、组合与交付方向', icon: WandSparkles }
] as const;

export type StageId = typeof stages[number]['id'];
export type RunOptions = { label: string; stage?: StageId; total?: number; newEntity?: boolean };
export type RunTask = (task: () => Promise<DesignProject>, options: RunOptions) => Promise<DesignProject | undefined>;
export type WorkspaceProps = { project: DesignProject; busy: boolean; run: RunTask };

export const fieldLabels: Record<string, string> = {
  required_controls: '必需控件', required_information: '必需信息', states: '交互状态', edge_cases: '边界情况',
  materials: '材质', geometry: '几何规则', lighting: '光影', components: '组件', composition: '构图'
};

export const screenInput = (project: DesignProject, input: Record<string, unknown> = {}) => ({ screenId: project.screen_id, ...input });

// P1-08：Rail 状态按作用域聚合——全局阶段读 global_stages，Screen 阶段
// 读当前 Screen 的 screen_stages，不再把顶层 stages（最后操作页面写入）当
// 多 Screen 唯一事实源；严格子阶段 stale 时 Style 组合状态不得继续显示已批准。
export function statusOf(project: DesignProject | null, stageId: StageId) {
  if (stageId === 'input') return project?.wireframe_path && project.requirement && (project.requirement_confirmed ?? true) ? 'approved' : project?.workflow?.stages?.input?.status || 'draft';
  const workflow = project?.workflow;
  if (stageId === 'style_resolution') {
    const status = workflow?.global_stages?.style_resolution?.status || workflow?.stages?.style_resolution?.status || 'draft';
    const screenId = project?.screen_id || 'main';
    const screen = workflow?.screen_stages?.[screenId] || {};
    // AUD-12：typography/component resolution 由 updateWorkflow 写入
    // global_stages 而非 screen_stages，聚合状态必须读全局作用域；只有
    // component_binding 是 Screen 作用域。任一 stale/blocked 时 Style Rail
    // 不得继续显示已批准。
    const strictStale = [
      workflow?.global_stages?.typography_resolution,
      workflow?.global_stages?.component_resolution,
      screen.component_binding
    ].some((entry) => entry?.status === 'stale' || entry?.status === 'blocked');
    return strictStale && status === 'approved' ? 'stale' : status;
  }
  const globalStage = ['reference_analysis', 'typography_resolution', 'component_resolution'].includes(stageId);
  if (globalStage) return workflow?.global_stages?.[stageId]?.status || workflow?.stages?.[stageId]?.status || 'draft';
  const screenId = project?.screen_id || 'main';
  return workflow?.screen_stages?.[screenId]?.[stageId]?.status || workflow?.stages?.[stageId]?.status || 'draft';
}

export function statusLabel(status: string) {
  return ({
    draft: '待开始', in_progress: '运行中', reviewed: '待确认', approved: '已批准', generated: '已生成',
    queued: '排队中', running: '正在思考', awaiting_confirmation: '待确认执行', executing: '执行中', succeeded: '已完成',
    stale: '需更新', rejected: '已否决', failed: '失败', cancelled: '已停止', interrupted: '已中断'
  } as Record<string, string>)[status] || status;
}

export function Modal({ title, copy, onClose, children, wide = false }: {
  title: string;
  copy?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  const copyId = useId();
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      returnFocusRef.current?.focus();
    };
  }, []);

  return createPortal(
    <dialog ref={dialogRef} className="dialog-backdrop" aria-labelledby={titleId} aria-describedby={copy ? copyId : undefined}
      onCancel={(event) => { event.preventDefault(); closeRef.current(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}>
      <section className={`utility-dialog ${wide ? 'utility-dialog--wide' : ''}`}>
        <header><div><h2 id={titleId}>{title}</h2>{copy && <p id={copyId}>{copy}</p>}</div><button className="icon-button" type="button" onClick={() => closeRef.current()} aria-label="关闭"><X size={18} /></button></header>
        {children}
      </section>
    </dialog>,
    document.body
  );
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
    <div className="lineage"><b>来源</b>{Object.entries((artifact.source || {}) as Record<string, unknown>).map(([key, value]) => <span key={key}>{key.replaceAll('_', ' ')}<code>{value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}</code></span>)}</div>
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

// P0-07 / AUD-04：并发项目与 Screen 上下文。任务结果可能在用户切换项目
// 或 Screen 后才返回：结果只能写回任务发起时的项目（jobId）与 Screen
// （jobScreenId），绝不能覆盖用户当前正在看的另一个项目或另一个 Screen；
// jobId / jobScreenId 缺失（如创建项目任务）时不存在跨上下文覆盖风险，
// 直接放行。返回对象自身也必须属于任务冻结的上下文：晚到响应或错误
// 响应即使碰上当前 UI 恰好仍在原上下文，也不得被应用。
export function applyJobResult(current: DesignProject | null, next: DesignProject, jobId?: string, jobScreenId?: string) {
  if (jobId && current && current.id !== jobId) return current;
  if (jobScreenId && current && current.id === jobId && (current.screen_id || 'main') !== jobScreenId) return current;
  if (jobId && next.id !== jobId) return current;
  if (jobScreenId && (next.screen_id || 'main') !== jobScreenId) return current;
  return preserveProjectPreviews(next, current);
}

// AUD-04：重试上下文匹配。失败任务冻结了发起时的项目与 Screen；只有用户仍
// 停留在同一项目与 Screen 时才允许重试，否则应提示先切回原上下文，绝不
// 拿当前 UI 上下文执行旧任务。任务无项目上下文（如创建项目）时直接放行。
export function retryContextMatches(
  retry: { projectId?: string; screenId?: string } | null,
  project: { id: string; screen_id?: string } | null
) {
  if (!retry?.projectId) return true;
  if (!project || project.id !== retry.projectId) return false;
  if (!retry.screenId) return true;
  return (project.screen_id || 'main') === retry.screenId;
}

export const strictContinuation = (project: DesignProject) => project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation';

export type DropdownOption = { value: string; label: string; disabled?: boolean; className?: string };

// 自绘下拉框：macOS 下原生 <select> 的展开列表是系统菜单，无法套用设计令牌，
// 故统一用 DOM 列表框替代，展开态完全遵循 Darkroom Precision 风格。
// 语义模型遵循 WAI-ARIA select-only combobox + listbox 模式：触发元素是
// role=combobox 的可聚焦容器（不再是普通 button），焦点始终停留在其上，
// 通过 aria-activedescendant 指向活动选项；禁用项不可被键盘或鼠标选中。
// Accessible Name 由 aria-labelledby（优先）或 aria-label 提供，
// 占位文本不构成名称；开发态两者都缺失时输出一次警告。
export function Dropdown({ value, options, onChange, disabled = false, testId, ariaLabel, ariaLabelledBy, placeholder }: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  testId?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const comboboxRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const menuId = useId();
  const typedRef = useRef({ prefix: '', at: 0 });
  const nameWarnedRef = useRef(false);
  const enabledCount = options.filter((option) => !option.disabled).length;
  const currentIndex = options.findIndex((option) => option.value === value && !option.disabled);
  const firstEnabled = options.findIndex((option) => !option.disabled);
  let lastEnabled = -1;
  options.forEach((option, index) => { if (!option.disabled) lastEnabled = index; });

  const openAt = (index: number) => { setActiveIndex(index); setOpen(true); };
  // 关闭时重置 typeahead 缓冲，避免上一轮输入污染关闭后的下一次前缀搜索
  const close = () => { setOpen(false); typedRef.current.prefix = ''; };
  const closeAndFocusCombobox = () => { close(); comboboxRef.current?.focus(); };
  const selectAt = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    closeAndFocusCombobox();
  };
  const moveActive = (direction: 1 | -1) => {
    if (enabledCount === 0) return;
    let next = activeIndex;
    for (let step = 0; step < options.length; step += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next].disabled) break;
    }
    setActiveIndex(next);
  };

  useEffect(() => {
    if (import.meta.env.DEV && !ariaLabel && !ariaLabelledBy && !nameWarnedRef.current) {
      nameWarnedRef.current = true;
      console.warn('Dropdown requires ariaLabel or ariaLabelledBy');
    }
  }, [ariaLabel, ariaLabelledBy]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(); };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);
  // 活动项滚入视野 + 菜单贴近视口底部时向上翻转，避免被裁切
  useEffect(() => { if (open && activeIndex >= 0) optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' }); }, [open, activeIndex]);
  useEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const menuHeight = Math.min(Math.max(options.length, 1), 8) * 34 + 14;
    setDropUp(window.innerHeight - rect.bottom < menuHeight && rect.top > menuHeight);
  }, [open]);

  const onComboboxKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openAt(currentIndex >= 0 ? currentIndex : firstEnabled);
        else moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openAt(currentIndex >= 0 ? currentIndex : lastEnabled);
        else moveActive(-1);
        break;
      case 'Home':
        if (open && firstEnabled >= 0) { event.preventDefault(); setActiveIndex(firstEnabled); }
        break;
      case 'End':
        if (open && lastEnabled >= 0) { event.preventDefault(); setActiveIndex(lastEnabled); }
        break;
      case 'Enter':
      case ' ':
        // div combobox 没有原生激活行为，Enter/Space 的开合只由这里驱动
        event.preventDefault();
        if (!open) openAt(currentIndex >= 0 ? currentIndex : firstEnabled);
        else if (activeIndex >= 0) selectAt(activeIndex);
        else close();
        break;
      case 'Escape':
        if (open) { event.preventDefault(); closeAndFocusCombobox(); }
        break;
      case 'Tab':
        // 不拦截：菜单随焦点离开关闭，焦点按正常顺序前进
        if (open) close();
        break;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.nativeEvent.isComposing) {
          const now = Date.now();
          const typed = typedRef.current;
          typed.prefix = now - typed.at < 600 ? typed.prefix + event.key.toLocaleLowerCase() : event.key.toLocaleLowerCase();
          typed.at = now;
          const match = options.findIndex((option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(typed.prefix));
          if (match >= 0) {
            event.preventDefault();
            if (open) setActiveIndex(match);
            else openAt(match);
          }
        }
    }
  };

  const current = options.find((option) => option.value === value);
  return (
    <div className="dropdown" ref={rootRef} data-testid={testId}>
      <div ref={comboboxRef} role="combobox" tabIndex={disabled ? -1 : 0} className={`dropdown-button${current?.className ? ` ${current.className}` : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} aria-activedescendant={open && activeIndex >= 0 ? `${menuId}-option-${activeIndex}` : undefined} aria-disabled={disabled || undefined} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} onClick={() => { if (disabled) return; if (open) close(); else openAt(currentIndex >= 0 ? currentIndex : firstEnabled); }} onKeyDown={onComboboxKeyDown}>
        <span className={current ? undefined : 'is-placeholder'}>{current ? current.label : placeholder}</span>
        <ChevronDown size={13} />
      </div>
      {open && <ul className={`dropdown-menu${dropUp ? ' is-up' : ''}`} id={menuId} role="listbox" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}>
        {options.map((option, index) => (
          <li key={option.value} id={`${menuId}-option-${index}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-value={option.value}
            ref={(node) => { optionRefs.current[index] = node; }}
            className={`dropdown-option${option.value === value ? ' is-selected' : ''}${option.disabled ? ' is-disabled' : ''}${index === activeIndex ? ' is-active' : ''}${option.className ? ` ${option.className}` : ''}`}
            // 触发元素是 div[role=combobox]，不属于 labelable element，外围 <label>
            // 的激活行为不会转发到它；此 preventDefault 仅为防御性保留。
            onClick={(event) => { event.preventDefault(); selectAt(index); }}
            onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }}>
            <Check size={12} className="dropdown-check" />
            <span title={option.label}>{option.label}</span>
          </li>
        ))}
        {options.length === 0 && <li className="dropdown-option is-disabled" role="option" aria-selected={false} aria-disabled><span>无可选项</span></li>}
      </ul>}
    </div>
  );
}

// Legacy check icon re-export keeps strict gate lists readable in workbenches.
export { Check };
