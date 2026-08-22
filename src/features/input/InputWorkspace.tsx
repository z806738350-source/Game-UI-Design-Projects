import { useEffect, useState } from 'react';
import { Bot, CircleDot, Save, ScanSearch } from 'lucide-react';
import { copilotApi } from '../../api';
import { Dropdown, WireframeLightbox, WireframeReference, screenInput } from '../shared/ui';
import type { WorkspaceProps } from '../shared/ui';

// Input stage workspace: owns the requirement/art-direction drafts and the
// wireframe import/lightbox state; App only supplies the run() boundary.
export function InputWorkspace({ project, busy, run }: WorkspaceProps) {
  const [requirement, setRequirement] = useState(project.requirement);
  const [artDirection, setArtDirection] = useState(project.art_direction);
  const [wireframeOpen, setWireframeOpen] = useState(false);
  useEffect(() => { setRequirement(project.requirement); setArtDirection(project.art_direction); }, [project.id, project.screen_id, project.requirement, project.art_direction]);
  const ready = Boolean(project.wireframe_path);
  const dirty = requirement !== project.requirement || artDirection !== project.art_direction;
  const hasIntent = Boolean(requirement.trim());
  const confirmed = hasIntent && !dirty && (project.requirement_confirmed ?? project.requirement_source !== 'ai');
  const aiDraft = project.requirement_source === 'ai' && !confirmed;
  const saveInput = (confirm = false) => copilotApi.saveProject(project.id, {
    screenId: project.screen_id,
    requirement,
    artDirection,
    requirementSource: requirement.trim() === project.requirement.trim() && project.requirement_source === 'ai' ? 'ai' : requirement.trim() ? 'user' : 'none',
    // AUD-08：普通保存不传确认位，交给后端“仅需求文本变化才重置确认”
    // 的语义；只改 Art Direction 不得取消已确认的设计意图。
    ...(confirm ? { requirementConfirmed: true } : {})
  });
  return <>
    <div className="workspace-content input-workspace">
    <section className="workspace-heading"><div><span className="kicker">00 · PROJECT INPUT</span><h1>让 AI 先读懂 UE，再由你补充意图</h1><p>线框稿是功能理解的主要来源。策划说明可以很简短，只需补充画面里看不出的业务规则。</p></div><button className="button button--ghost" onClick={() => run(() => saveInput(false), { label: '保存项目输入' })} disabled={busy || !dirty}><Save size={16} />{dirty ? '保存补充说明' : '已保存'}</button></section>
    <div className="input-grid input-grid--reworked">
      <div className="input-col input-col--form">
      <label className={`field-card design-brief-card ${aiDraft ? 'has-ai-draft' : ''}`}><span><div><b>设计意图</b><em>{aiDraft ? 'AI 已预填 · 待确认' : confirmed ? '已确认' : '可留空'}</em></div><small>AI 先读 UE 并预填；你可以补充、改写，或直接确认</small></span><textarea value={requirement} onChange={(event) => setRequirement(event.target.value)} placeholder="留空后点击下方按钮，AI 会先根据 UE 线框生成一份可编辑的意图草稿。" /><div className="ai-reading-note"><ScanSearch size={18} /><div><b>{aiDraft ? '请检查这份 AI 草稿' : '先预解读，再生成契约'}</b><p>{aiDraft ? 'AI 只推断画面中可见的页面目标与流程；隐藏玩法规则仍由你补充。' : '空白时先留在本页生成草稿，不会提前跳到功能解读页。'}</p></div>{hasIntent && <button type="button" className="button button--secondary" disabled={busy} onClick={(event) => { event.preventDefault(); run(() => copilotApi.draftRequirement(project.id), { label: 'AI 正在重新读取 UE 并预填意图' }); }}>重新预填</button>}</div></label>
      <label className="field-card art-direction-card"><span><div><b>美术大方向</b><em>选填</em></div><small>用于后续风格锁定和视觉探索，不影响功能识别</small></span><input value={artDirection} onChange={(event) => setArtDirection(event.target.value)} placeholder="例如：克制东方奇幻、近未来硬科幻" /></label>
      {project.project_type === 'existing' && <label className="field-card continuation-mode-card"><span><div><b>继承强度</b><em>全局输入</em></div><small>切换会按依赖图使模式相关的下游批准失效；锁定继承的项目不可切换</small></span><Dropdown testId="continuation-mode-select" ariaLabel="切换继承强度" disabled={busy || project.continuation_mode === 'locked-continuation'} value={project.continuation_mode === 'locked-continuation' ? 'existing-strict' : project.continuation_mode} onChange={(next) => run(() => copilotApi.saveProject(project.id, { continuationMode: next, screenId: project.screen_id } as never), { label: '切换继承强度' })} options={[{ value: 'existing-strict', label: '严格继承（推荐）' }, { value: 'existing-guided', label: '引导继承（实验性）' }]} /></label>}
      </div>
      <div className="input-col input-col--wire">
  <WireframeReference project={project} editable busy={busy} onOpen={() => setWireframeOpen(true)} onReplace={() => run(() => copilotApi.importFile(project.id, 'wireframe', project.screen_id), { label: '导入 UE 线框稿' })} />
      <div className="principle-card"><CircleDot size={20} /><div><b>功能基准</b><p>AI 必须覆盖 UE 中可识别的功能；设计师可在下一步补充、修改或删除具体条目。</p></div></div>
      </div>
    </div>
    </div>
    <div className="workspace-footer"><span className={ready ? 'ready-copy' : ''}>{!ready ? '请先导入 UE 线框稿。' : !hasIntent ? 'UE 已就绪，先让 AI 生成一份可确认的设计意图。' : confirmed ? '设计意图已确认，可以进入功能解读。' : '请检查并确认设计意图，再生成完整功能契约。'}</span>{!hasIntent ? <button className="button button--primary" data-testid="intent-draft" disabled={busy || !ready} onClick={() => run(async () => { await copilotApi.saveProject(project.id, { artDirection, screenId: project.screen_id } as never); return copilotApi.draftRequirement(project.id, project.screen_id); }, { label: 'AI 正在读取 UE 并预填意图' })}><ScanSearch size={17} />AI 解读并预填写</button> : <button className="button button--primary" data-testid="intent-confirm" disabled={busy || !ready} onClick={() => run(async () => { await saveInput(true); return copilotApi.runStage(project.id, 'wireframe_interpretation', screenInput(project, { stayOnInputUntilComplete: true })); }, { label: '正在生成完整功能契约' })}><Bot size={17} />{confirmed ? '重新生成功能契约' : '确认意图并开始功能解读'}</button>}</div>
    {wireframeOpen && <WireframeLightbox project={project} onClose={() => setWireframeOpen(false)} />}
    </>;
}
