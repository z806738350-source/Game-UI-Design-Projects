import { useState } from 'react';
import { Check } from 'lucide-react';
import type { DesignProject, LayoutProposal } from '../../types';
import { pipelineProfileOf } from '../shared/pipelineRoute';
import { layoutStaleGuidance } from '../shared/staleReason';
import type { RunTask } from '../shared/ui';
export function LayoutCanvas({ proposal, safeArea, project }: { proposal?: LayoutProposal; safeArea: boolean; project: DesignProject }) {
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

// Layout review workbench: proposal comparison canvas, safe-area review
// flags, and the manual-adjustment notes draft. Selection and notes state is
// controlled by LayoutWorkspace so the sticky footer can keep the approve
// button always visible. AUD-14：stale 时工作台只显示失效原因与证据，全部
// 恢复动作集中在 sticky Footer（与 Footer 同一套 layoutStaleGuidance 分派），
// 不再无条件渲染“重新生成布局”造成与指引冲突的按钮。
export function LayoutWorkbench({ project, busy, run, selected, onSelect, notes, onNotes }: { project: DesignProject; busy: boolean; run?: RunTask; selected: string; onSelect: (id: string) => void; notes: string; onNotes: (value: string) => void }) {
  void busy;
  void run;
  const proposals = project.artifacts.layouts?.proposals || [];
  const approvedId = project.artifacts.approvedLayout?.status === 'approved'
    ? String(project.artifacts.approvedLayout.source_proposal || '')
    : '';
  const [safeArea, setSafeArea] = useState(true);
  const selectedProposal = proposals.find((proposal) => proposal.id === selected) || proposals[0];
  const stale = project.artifacts.layouts?.status === 'stale';
  // stale 指引按失效原因与路线区分（fix-plan P0-06），不再统一显示
  // “画布或需求已变化”；恢复入口由 Footer 按同一 guidance 分派。
  const staleGuidance = stale ? layoutStaleGuidance(project.artifacts.layouts?.stale_reason, pipelineProfileOf(project)) : null;
  const interactionFlow = Array.isArray(selectedProposal?.interaction_flow)
    ? selectedProposal.interaction_flow.map(String)
    : selectedProposal?.interaction_flow && typeof selectedProposal.interaction_flow === 'object'
      ? Object.entries(selectedProposal.interaction_flow as Record<string, unknown>).map(([key, value]) => `${key.replaceAll('_', ' ')}：${String(value)}`)
      : selectedProposal?.interaction_flow ? [String(selectedProposal.interaction_flow)] : [];
  return <>
    <div className="proposal-tabs">{proposals.map((proposal, index) => <button key={proposal.id} className={selected === proposal.id ? 'is-selected' : ''} onClick={() => onSelect(proposal.id)}><span>方案 {String.fromCharCode(65 + index)}</span><b>{proposal.name}</b><small>{proposal.designer_fit || proposal.strategy}</small>{approvedId === proposal.id && <em><Check size={12} />当前批准</em>}</button>)}</div>
    <div className="layout-review"><LayoutCanvas proposal={selectedProposal} safeArea={safeArea} project={project} /><aside className="layout-notes"><h3>{selectedProposal?.name}</h3><p>{selectedProposal?.strategy}</p><div className="review-checks"><label><input type="checkbox" checked={safeArea} onChange={(event) => setSafeArea(event.target.checked)} />显示边缘预留（5% 示意）</label><label><input type="checkbox" defaultChecked />校验焦点顺序</label><label><input type="checkbox" defaultChecked />校验长文本空间</label><label><input type="checkbox" defaultChecked />覆盖加载/禁用状态</label></div><ol>{interactionFlow.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ol><label className="notes-field"><span>人工调整与批准备注</span><textarea value={notes} onChange={(event) => onNotes(event.target.value)} placeholder={project.canvas_spec?.orientation === 'portrait' ? '例如：保持竖屏，上方阵容区、下方侠客抽屉，底部固定保存与全局导航。' : '例如：右侧属性区缩小 4%，主按钮保持在首屏焦点链末端。'} /></label></aside></div>
    {stale && <div className="layout-workbench-actions" data-testid="layout-stale-notice"><span className="stale-guidance">{staleGuidance?.message}</span><small>恢复操作已集中到页面底部常驻操作栏，按失效原因统一下一步。</small></div>}
  </>;
}
