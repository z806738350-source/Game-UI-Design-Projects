import { useEffect, useState } from 'react';
import { ImagePlus, Layers3, LockKeyhole, RefreshCw, WandSparkles } from 'lucide-react';
import { copilotApi } from '../../api';
import { omissionConfirmationInput, visualOmissionPack } from '../shared/referenceOmission';
import { pipelineProfileOf } from '../shared/pipelineRoute';
import { layoutStaleGuidance } from '../shared/staleReason';
import { EmptyArtifact, StatusPill, friendlyError, strictContinuation } from '../shared/ui';
import type { StageId, WorkspaceProps } from '../shared/ui';
import { LayoutWorkbench } from './LayoutWorkbench';

// Layout stage shell: heading, workbench (proposal comparison), and stage
// routing actions. Proposal selection/notes state lives here so the sticky
// footer can render the always-visible approve + next-step pair without
// scrolling to the workbench bottom. 进入风格锁定永远只导航：风格分析只能由
// Style 页面的显式按钮触发（导航与执行分离，避免进入页面就自动调用模型）。
export function LayoutWorkspace({ project, busy, run, onNavigate }: WorkspaceProps & { onNavigate: (stage: StageId) => void }) {
  const proposals = project.artifacts.layouts?.proposals || [];
  const strict = strictContinuation(project);
  const approvedId = project.artifacts.approvedLayout?.status === 'approved'
    ? String(project.artifacts.approvedLayout.source_proposal || '')
    : '';
  const preferredProposalId = proposals.some((proposal) => proposal.id === approvedId) ? approvedId : (proposals[0]?.id || '');
  const approvedNotes = ((project.artifacts.approvedLayout?.manual_adjustments as string[]) || []).join('\n');
  const [selected, setSelected] = useState(preferredProposalId);
  const [notes, setNotes] = useState(approvedNotes);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState('');
  // AUD-11：Screen-scoped 工作台的草稿重置必须包含 screen_id，否则切换
  // Screen 后未保存的方案选择/批准备注会残留到另一个页面。
  useEffect(() => { setSelected(preferredProposalId); setNotes(approvedNotes); setApproveError(''); }, [project.id, project.screen_id, project.artifacts.layouts?.version, preferredProposalId, approvedNotes]);
  const selectedProposalId = proposals.find((proposal) => proposal.id === selected)?.id || proposals[0]?.id || '';
  const notesDirty = approvedId === selectedProposalId && notes.trim() !== approvedNotes.trim();
  // 批准跟随所选方案卡片：切换到未批准的方案时「进入风格锁定」保持置灰。
  const needsApproval = approvedId !== selectedProposalId || project.artifacts.approvedLayout?.status !== 'approved' || notesDirty;
  const approveSelected = async () => {
    const approve = () => copilotApi.approveArtifact(project.id, 'approved-layout', { proposalId: selectedProposalId, manualAdjustments: notes.trim() ? notes.split('\n').map((item) => item.trim()).filter(Boolean) : [] });
    if (run) { await run(approve, { label: notesDirty ? '更新布局批准备注' : '批准所选布局', stage: 'layout_design' }); return; }
    setApproving(true); setApproveError('');
    try { await approve(); }
    catch (cause) { setApproveError(friendlyError(cause)); }
    finally { setApproving(false); }
  };
  const prepareUnderlay = async () => { let next = await copilotApi.generateUnderlayContract(project.id); next = await copilotApi.approveArtifact(next.id, 'underlay-contract'); return copilotApi.generateLayoutGuide(next.id); };
  const approveUnderlayAndGuide = async () => { const next = await copilotApi.approveArtifact(project.id, 'underlay-contract'); return copilotApi.generateLayoutGuide(next.id); };
  // P0-01：下一步必须按 Underlay Contract 完整状态判断，不得只看
  // layout_guide 是否存在：stale 时旧 Guide 仍留在对象里，只看 Guide 会
  // 永远指向“生成底层图”而后端报 UNDERLAY_SPEC_REQUIRED 形成死循环。
  const contract = project.artifacts.underlayContract;
  const underlayStep = !contract ? 'none' : contract.status === 'stale' ? 'stale' : contract.status !== 'approved' ? 'review' : contract.layout_guide ? 'ready' : 'guide';
  // AUD-14：外层 Footer 与工作台内部使用同一套 layoutStaleGuidance，按
  // action 给出一致的恢复按钮，不再写死“先更新功能契约”。
  const layoutsStale = project.artifacts.layouts?.status === 'stale';
  const staleGuidance = layoutsStale ? layoutStaleGuidance(project.artifacts.layouts?.stale_reason, pipelineProfileOf(project)) : null;
  const staleAction = staleGuidance?.action === 'update-contract'
    ? { label: '先更新功能契约', onClick: () => onNavigate('wireframe_interpretation') }
    : staleGuidance?.action === 'legacy-repair'
      ? { label: '执行一次性修复', onClick: () => run(() => copilotApi.repairRouteCycle(project.id), { label: '执行路线循环一次性修复', stage: 'layout_design' }) }
      : { label: '重新生成布局', onClick: () => run(() => copilotApi.runStage(project.id, 'layout_design'), { label: '重新生成布局提案', stage: 'layout_design' }) };
  const visualOmissionInput = omissionConfirmationInput(visualOmissionPack(project));
  return <>
    <div className="workspace-content">
    <section className="workspace-heading"><div><span className="kicker">02 · UX / LAYOUT DESIGN</span><h1>比较可执行的布局策略</h1><p>在目标分辨率中检查区域比例、焦点路径、安全区和实际信息承载。</p></div>{project.artifacts.approvedLayout && <StatusPill status={String(project.artifacts.approvedLayout.status)} />}</section>
    {!proposals.length ? <EmptyArtifact title="尚未生成布局提案" copy="批准功能契约后，AI 会给出效率、表现与平衡三种结构。" /> : <LayoutWorkbench project={project} busy={busy} run={run} selected={selected} onSelect={setSelected} notes={notes} onNotes={setNotes} />}
    </div>
    {proposals.length > 0 && <div className="workspace-footer"><button className="button button--ghost" disabled={busy} onClick={layoutsStale ? staleAction.onClick : () => run(() => copilotApi.runStage(project.id, 'layout_design'), { label: '重新生成布局提案', stage: 'layout_design' })}><RefreshCw size={15} />{layoutsStale ? staleAction.label : '重新生成'}</button>{layoutsStale ? <span className="stale-guidance">{staleGuidance?.message}</span> : <span className="footer-actions">{approveError && <span className="inline-error" role="alert">{approveError}</span>}<button className="button button--primary" data-testid="layout-approve" disabled={busy || approving || !selectedProposalId || !needsApproval} onClick={approveSelected}>{needsApproval ? notesDirty ? '更新批准备注' : '批准此布局' : '该方案已批准'}</button>{project.artifacts.approvedLayout?.status === 'approved' && strict && project.artifacts.styleContract?.status === 'approved' ? underlayStep === 'ready' ? <button className="button button--primary" data-testid="underlay-generate" disabled={busy} onClick={() => run(() => copilotApi.runStage(project.id, 'visual_exploration', visualOmissionInput), { label: '生成严格模式底层图', stage: 'visual_exploration', total: 3 })}><WandSparkles size={16} />生成底层图</button> : underlayStep === 'guide' ? <button className="button button--primary" data-testid="underlay-guide" disabled={busy} onClick={() => run(() => copilotApi.generateLayoutGuide(project.id), { label: '生成底层结构引导', stage: 'layout_design' })}><Layers3 size={16} />生成 Layout Guide</button> : underlayStep === 'review' ? <button className="button button--primary" data-testid="underlay-approve" disabled={busy} onClick={() => run(approveUnderlayAndGuide, { label: '批准底层契约并生成结构引导', stage: 'layout_design' })}><Layers3 size={16} />批准底层契约并生成 Guide</button> : underlayStep === 'stale' ? <button className="button button--primary" data-testid="underlay-rebuild" disabled={busy} onClick={() => run(prepareUnderlay, { label: '根据当前布局重建底层规范', stage: 'layout_design' })}><Layers3 size={16} />重新建立底层规范</button> : <button className="button button--primary" data-testid="underlay-prepare" disabled={busy} onClick={() => run(prepareUnderlay, { label: '生成底层契约与结构引导', stage: 'layout_design' })}><Layers3 size={16} />建立底层规范</button> : project.project_type === 'existing' && !(project.reference_assets?.length) ? <button className="button button--primary" data-testid="style-enter" disabled={busy || needsApproval} onClick={() => onNavigate('style_resolution')}><ImagePlus size={16} />进入风格锁定并添加参考</button> : <button className="button button--primary" data-testid="style-enter" disabled={busy || needsApproval} onClick={() => onNavigate('style_resolution')}><LockKeyhole size={16} />进入风格锁定</button>}</span>}</div>}
    </>;
}
