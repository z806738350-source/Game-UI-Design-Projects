import { ImagePlus, Layers3, LockKeyhole, RefreshCw, WandSparkles } from 'lucide-react';
import { copilotApi } from '../../api';
import { EmptyArtifact, StatusPill, strictContinuation } from '../shared/ui';
import type { StageId, WorkspaceProps } from '../shared/ui';
import { LayoutWorkbench } from './LayoutWorkbench';

// Layout stage shell: heading, workbench (proposal comparison + approval),
// and stage routing actions. Proposal selection/notes state lives in
// LayoutWorkbench.
export function LayoutWorkspace({ project, busy, run, onNavigate }: WorkspaceProps & { onNavigate: (stage: StageId) => void }) {
  const proposals = project.artifacts.layouts?.proposals || [];
  const strict = strictContinuation(project);
  const prepareUnderlay = async () => { let next = await copilotApi.generateUnderlayContract(project.id); next = await copilotApi.approveArtifact(next.id, 'underlay-contract'); return copilotApi.generateLayoutGuide(next.id); };
  return <>
    <div className="workspace-content">
    <section className="workspace-heading"><div><span className="kicker">02 · UX / LAYOUT DESIGN</span><h1>比较可执行的布局策略</h1><p>在目标分辨率中检查区域比例、焦点路径、安全区和实际信息承载。</p></div>{project.artifacts.approvedLayout && <StatusPill status={String(project.artifacts.approvedLayout.status)} />}</section>
    {!proposals.length ? <EmptyArtifact title="尚未生成布局提案" copy="批准功能契约后，AI 会给出效率、表现与平衡三种结构。" /> : <LayoutWorkbench project={project} busy={busy} run={run} />}
    </div>
    {proposals.length > 0 && <div className="workspace-footer"><button className="button button--ghost" disabled={busy} onClick={() => project.artifacts.layouts?.status === 'stale' ? onNavigate('wireframe_interpretation') : run(() => copilotApi.runStage(project.id, 'layout_design'), { label: '重新生成布局提案', stage: 'layout_design' })}><RefreshCw size={15} />{project.artifacts.layouts?.status === 'stale' ? '先更新功能契约' : '重新生成'}</button>{project.artifacts.layouts?.status === 'stale' ? <span className="stale-guidance">画布或需求已变化，旧布局只能用于对照。</span> : project.artifacts.approvedLayout?.status === 'approved' ? strict && project.artifacts.styleContract?.status === 'approved' ? project.artifacts.underlayContract?.layout_guide ? <button className="button button--primary" data-testid="underlay-generate" disabled={busy} onClick={() => run(() => copilotApi.runStage(project.id, 'visual_exploration'), { label: '生成严格模式底层图', stage: 'visual_exploration', total: 3 })}><WandSparkles size={16} />生成底层图</button> : <button className="button button--primary" data-testid="underlay-prepare" disabled={busy} onClick={() => run(prepareUnderlay, { label: '生成底层契约与结构引导', stage: 'layout_design' })}><Layers3 size={16} />建立底层规范</button> : project.project_type === 'existing' && !(project.reference_assets?.length) ? <button className="button button--primary" disabled={busy} onClick={() => onNavigate('style_resolution')}><ImagePlus size={16} />先添加风格参考</button> : <button className="button button--primary" disabled={busy} onClick={() => run(() => copilotApi.runStage(project.id, 'style_resolution'), { label: '解析视觉风格', stage: 'style_resolution' })}><LockKeyhole size={16} />进入风格锁定</button> : <span className="stale-guidance">选择方案并批准后进入下一步。</span>}</div>}
    </>;
}
