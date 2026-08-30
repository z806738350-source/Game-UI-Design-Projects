import { useCallback, useEffect, useState } from 'react';
import { Bot, CircleDot, FileSearch, Save, ScanSearch, Sparkles } from 'lucide-react';
import { copilotApi } from '../../api';
import type { IntentCandidate, IntentHistoryEntry, IntentReview } from '../../types';
import { Dropdown, WireframeLightbox, WireframeReference, screenInput } from '../shared/ui';
import type { WorkspaceProps } from '../shared/ui';
import { IntentReviewEditor } from './IntentReviewEditor';
import { IntentUncertaintyPanel } from './IntentUncertaintyPanel';
import { IntentCandidateDiff } from './IntentCandidateDiff';
import { IntentHistoryPanel } from './IntentHistoryPanel';
import { asStructuredReview, confirmBlockers, deriveIntentStatus } from './intentModel';
import type { StructuredReview } from './intentModel';

// Input stage workspace: owns the requirement/art-direction drafts and the
// wireframe import/lightbox state; App only supplies the run() boundary.
// v1.4 §10：structured-v2 分支渲染六段编辑器/待确认项/Diff/历史；
// legacy 分支保留原有自由文本流程（含回滚场景，§15）。
export function InputWorkspace({ project, busy, run }: WorkspaceProps) {
  const reviewRevision = Number(project.input_revisions?.intent_review ?? 0);
  const serverReview = asStructuredReview(project.intent_review);
  const [requirement, setRequirement] = useState(project.requirement);
  const [artDirection, setArtDirection] = useState(project.art_direction);
  const [wireframeOpen, setWireframeOpen] = useState(false);
  const [draft, setDraft] = useState<StructuredReview | null>(serverReview);
  const [candidate, setCandidate] = useState<IntentCandidate | null>(null);
  const [history, setHistory] = useState<IntentHistoryEntry[]>([]);
  useEffect(() => { setRequirement(project.requirement); setArtDirection(project.art_direction); }, [project.id, project.screen_id, project.requirement, project.art_direction]);
  // §10.4：本地草稿按 project + screen + review revision 重建；
  // 切换 Screen 时未保存的草稿直接丢弃，不带入下一个 Screen。
  useEffect(() => { setDraft(asStructuredReview(project.intent_review)); }, [project.id, project.screen_id, reviewRevision]);
  const refreshRemote = useCallback(async () => {
    try {
      const [nextCandidate, nextHistory] = await Promise.all([
        copilotApi.getIntentCandidate(project.id, project.screen_id),
        copilotApi.listIntentHistory(project.id, project.screen_id)
      ]);
      setCandidate(nextCandidate || null);
      setHistory(Array.isArray(nextHistory) ? nextHistory : []);
    } catch {
      setCandidate(null);
      setHistory([]);
    }
  }, [project.id, project.screen_id]);
  useEffect(() => { refreshRemote(); }, [refreshRemote, reviewRevision, project.intent_generation?.status]);
  const structured = project.intent_mode === 'structured-v2' || Boolean(serverReview) || Boolean(candidate);
  const ready = Boolean(project.wireframe_path);
  const dirty = structured ? artDirection !== project.art_direction : requirement !== project.requirement || artDirection !== project.art_direction;
  const hasIntent = Boolean(requirement.trim());
  const confirmed = hasIntent && !dirty && (project.requirement_confirmed ?? project.requirement_source !== 'ai');
  const aiDraft = project.requirement_source === 'ai' && !confirmed;
  const dirtyReview = Boolean(draft) && JSON.stringify(draft) !== JSON.stringify(serverReview);
  const blockers = draft ? confirmBlockers(draft) : [];
  const candidateReady = candidate?.status === 'ready';
  const status = deriveIntentStatus(project, candidate);
  const analysisLayers = Array.isArray(project.intent_analysis?.screen_layers) ? project.intent_analysis!.screen_layers as Array<Record<string, unknown>> : [];
  const saveInput = (confirm = false) => copilotApi.saveProject(project.id, {
    screenId: project.screen_id,
    requirement,
    artDirection,
    requirementSource: requirement.trim() === project.requirement.trim() && project.requirement_source === 'ai' ? 'ai' : requirement.trim() ? 'user' : 'none',
    // AUD-08：普通保存不传确认位，交给后端“仅需求文本变化才重置确认”
    // 的语义；只改 Art Direction 不得取消已确认的设计意图。
    ...(confirm ? { requirementConfirmed: true } : {})
  });
  const saveReview = () => run(async () => {
    const next = await copilotApi.saveIntentReview(project.id, { screenId: project.screen_id, expectedIntentReviewRevision: reviewRevision, draft: draft as unknown as IntentReview });
    await refreshRemote();
    return next;
  }, { label: '正在保存 Intent 评审' });
  const generateCandidate = () => run(async () => {
    const next = await copilotApi.generateIntentCandidate(project.id, project.screen_id);
    await refreshRemote();
    return next;
  }, { label: 'AI 正在读取 UE 并生成 candidate' });
  const confirmReview = () => run(async () => {
    await copilotApi.confirmIntentReview(project.id, { screenId: project.screen_id, expectedIntentReviewRevision: reviewRevision });
    return copilotApi.runStage(project.id, 'wireframe_interpretation', screenInput(project, { stayOnInputUntilComplete: true }));
  }, { label: '正在生成完整功能契约' });
  return <>
    <div className="workspace-content input-workspace">
    <section className="workspace-heading"><div><span className="kicker">00 · PROJECT INPUT</span><h1>让 AI 先读懂 UE，再由你补充意图</h1><p>线框稿是功能理解的主要来源。策划说明可以很简短，只需补充画面里看不出的业务规则。</p></div><button className="button button--ghost" onClick={() => run(() => saveInput(false), { label: '保存项目输入' })} disabled={busy || !dirty}><Save size={16} />{dirty ? '保存补充说明' : '已保存'}</button></section>
    <div className="input-grid input-grid--reworked">
      <div className="input-col input-col--form">
      {structured ? (
        <div className="intent-workspace-panel">
          <div className="intent-status-bar">
            <i className={`intent-badge intent-badge--${status.tone}`} role="status">{status.label}</i>
            {dirtyReview && <i className="intent-badge intent-badge--warn">有未保存修改</i>}
            <button type="button" className="button button--secondary button--small" data-testid="intent-regenerate" disabled={busy || !ready || Boolean(candidateReady)} title={candidateReady ? '存在待处理的 candidate：请先采用或丢弃' : undefined} onClick={generateCandidate}><Sparkles size={14} />{serverReview || candidate ? '重新 AI 预填' : 'AI 解读并预填写'}</button>
          </div>
          {candidate && <IntentCandidateDiff project={project} candidate={candidate} currentReview={draft} busy={busy}
            onAdopt={() => run(async () => {
              const next = await copilotApi.adoptIntentCandidate(project.id, { screenId: project.screen_id, candidateId: candidate.candidate_id, expectedIntentReviewRevision: reviewRevision });
              setCandidate(null);
              await refreshRemote();
              return next;
            }, { label: '正在采用 candidate（整版替换）' })}
            onDiscard={() => run(async () => {
              const next = await copilotApi.discardIntentCandidate(project.id, { screenId: project.screen_id, candidateId: candidate.candidate_id });
              setCandidate(null);
              return next;
            }, { label: '正在丢弃 candidate' })} />}
          {draft ? <>
            <IntentReviewEditor review={draft} onChange={setDraft} busy={busy} />
            <IntentUncertaintyPanel review={draft} onChange={setDraft} busy={busy} />
            {Boolean(analysisLayers.length) && (
              <details className="intent-evidence">
                <summary><FileSearch size={14} />可见证据：AI 在图中识别到的 {analysisLayers.length} 个图层</summary>
                <ul>{analysisLayers.map((layer, index) => <li key={String(layer.id || index)}>{String(layer.title || layer.kind || layer.id || `图层 ${index + 1}`)}</li>)}</ul>
              </details>
            )}
          </> : <p className="intent-empty">当前还没有 Intent 评审；点击「AI 解读并预填写」生成第一份草稿。</p>}
          <details className="intent-history-wrap">
            <summary>历史版本（{history.length}）</summary>
            <IntentHistoryPanel entries={history} busy={busy}
              onRestore={(entry) => run(async () => {
                const next = await copilotApi.restoreIntentHistory(project.id, project.screen_id, { historyId: entry.history_id, expectedIntentReviewRevision: reviewRevision });
                await refreshRemote();
                return next;
              }, { label: '正在恢复历史版本' })}
              onDelete={(entry) => run(async () => {
                const next = await copilotApi.deleteIntentHistory(project.id, project.screen_id, { historyId: entry.history_id });
                await refreshRemote();
                return next;
              }, { label: '正在删除历史版本' })} />
          </details>
          <label className={`field-card design-brief-card ${structured ? 'is-readonly' : ''}`}><span><div><b>设计意图（结构化摘要）</b><em>只读</em></div><small>structured-v2 模式下需求文本由评审确认生成，不可手改；如需自由文本可回滚模式</small></span><textarea value={project.requirement} readOnly aria-label="设计意图（只读）" /></label>
          <label className="field-card art-direction-card"><span><div><b>美术大方向</b><em>选填</em></div><small>用于后续风格锁定和视觉探索，不影响功能识别</small></span><input value={artDirection} onChange={(event) => setArtDirection(event.target.value)} placeholder="例如：克制东方奇幻、近未来硬科幻" /></label>
          {project.project_type === 'existing' && <label className="field-card continuation-mode-card"><span><div><b>继承强度</b><em>全局输入</em></div><small>切换会按依赖图使模式相关的下游批准失效；锁定继承的项目不可切换</small></span><Dropdown testId="continuation-mode-select" ariaLabel="切换继承强度" disabled={busy || project.continuation_mode === 'locked-continuation'} value={project.continuation_mode === 'locked-continuation' ? 'existing-strict' : project.continuation_mode} onChange={(next) => run(() => copilotApi.saveProject(project.id, { continuationMode: next, screenId: project.screen_id } as never), { label: '切换继承强度' })} options={[{ value: 'existing-strict', label: '严格继承（推荐）' }, { value: 'existing-guided', label: '引导继承（实验性）' }]} /></label>}
        </div>
      ) : (
        <>
      <label className={`field-card design-brief-card ${aiDraft ? 'has-ai-draft' : ''}`}><span><div><b>设计意图</b><em>{aiDraft ? 'AI 已预填 · 待确认' : confirmed ? '已确认' : '可留空'}</em></div><small>AI 先读 UE 并预填；你可以补充、改写，或直接确认</small></span><textarea value={requirement} onChange={(event) => setRequirement(event.target.value)} placeholder="留空后点击下方按钮，AI 会先根据 UE 线框生成一份可编辑的意图草稿。" /><div className="ai-reading-note"><ScanSearch size={18} /><div><b>{aiDraft ? '请检查这份 AI 草稿' : '先预解读，再生成契约'}</b><p>{aiDraft ? 'AI 只推断画面中可见的页面目标与流程；隐藏玩法规则仍由你补充。' : '空白时先留在本页生成草稿，不会提前跳到功能解读页。'}</p></div>{hasIntent && <button type="button" className="button button--secondary" disabled={busy} onClick={(event) => { event.preventDefault(); run(() => copilotApi.draftRequirement(project.id), { label: 'AI 正在重新读取 UE 并预填意图' }); }}>重新预填</button>}</div></label>
      <label className="field-card art-direction-card"><span><div><b>美术大方向</b><em>选填</em></div><small>用于后续风格锁定和视觉探索，不影响功能识别</small></span><input value={artDirection} onChange={(event) => setArtDirection(event.target.value)} placeholder="例如：克制东方奇幻、近未来硬科幻" /></label>
      {project.project_type === 'existing' && <label className="field-card continuation-mode-card"><span><div><b>继承强度</b><em>全局输入</em></div><small>切换会按依赖图使模式相关的下游批准失效；锁定继承的项目不可切换</small></span><Dropdown testId="continuation-mode-select" ariaLabel="切换继承强度" disabled={busy || project.continuation_mode === 'locked-continuation'} value={project.continuation_mode === 'locked-continuation' ? 'existing-strict' : project.continuation_mode} onChange={(next) => run(() => copilotApi.saveProject(project.id, { continuationMode: next, screenId: project.screen_id } as never), { label: '切换继承强度' })} options={[{ value: 'existing-strict', label: '严格继承（推荐）' }, { value: 'existing-guided', label: '引导继承（实验性）' }]} /></label>}
        </>
      )}
      </div>
      <div className="input-col input-col--wire">
  <WireframeReference project={project} editable busy={busy} onOpen={() => setWireframeOpen(true)} onReplace={() => run(() => copilotApi.importFile(project.id, 'wireframe', project.screen_id), { label: '导入 UE 线框稿' })} />
      <div className="principle-card"><CircleDot size={20} /><div><b>功能基准</b><p>AI 必须覆盖 UE 中可识别的功能；设计师可在下一步补充、修改或删除具体条目。</p></div></div>
      </div>
    </div>
    </div>
    {structured ? (
      <div className="workspace-footer intent-footer">
        <span className={draft && !blockers.length && !dirtyReview ? 'ready-copy' : ''}>
          {!ready ? '请先导入 UE 线框稿。'
            : !draft ? '先让 AI 生成一份结构化草稿。'
            : candidateReady ? '请先处理 candidate：采用（整版替换）或保留当前版本。'
            : dirtyReview ? '请先保存评审修改，再确认。'
            : blockers.length ? `还有 ${blockers.length} 项需要处理才能确认。`
            : project.requirement_confirmed ? '设计意图已确认，可以进入功能解读。'
            : '评审完整，可以确认并开始功能解读。'}
        </span>
        <div className="intent-footer-actions">
          <button className="button button--secondary" disabled={busy || !dirtyReview} onClick={saveReview}><Save size={16} />{dirtyReview ? '保存评审修改' : '评审已保存'}</button>
          <button className="button button--primary" data-testid="intent-confirm" disabled={busy || !ready || !draft || dirtyReview || Boolean(blockers.length)} onClick={confirmReview}><Bot size={17} />{project.requirement_confirmed ? '重新生成功能契约' : '确认意图并开始功能解读'}</button>
        </div>
        {Boolean(blockers.length) && !dirtyReview && draft && <ul className="intent-blockers" aria-label="确认前需要处理的问题">{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
      </div>
    ) : (
    <div className="workspace-footer"><span className={ready ? 'ready-copy' : ''}>{!ready ? '请先导入 UE 线框稿。' : !hasIntent ? 'UE 已就绪，先让 AI 生成一份可确认的设计意图。' : confirmed ? '设计意图已确认，可以进入功能解读。' : '请检查并确认设计意图，再生成完整功能契约。'}</span>{!hasIntent ? <button className="button button--primary" data-testid="intent-draft" disabled={busy || !ready} onClick={() => run(async () => { await copilotApi.saveProject(project.id, { artDirection, screenId: project.screen_id } as never); return copilotApi.draftRequirement(project.id, project.screen_id); }, { label: 'AI 正在读取 UE 并预填意图' })}><ScanSearch size={17} />AI 解读并预填写</button> : <button className="button button--primary" data-testid="intent-confirm" disabled={busy || !ready} onClick={() => run(async () => { await saveInput(true); return copilotApi.runStage(project.id, 'wireframe_interpretation', screenInput(project, { stayOnInputUntilComplete: true })); }, { label: '正在生成完整功能契约' })}><Bot size={17} />{confirmed ? '重新生成功能契约' : '确认意图并开始功能解读'}</button>}</div>
    )}
    {wireframeOpen && <WireframeLightbox project={project} onClose={() => setWireframeOpen(false)} />}
    </>;
}
