import { useState } from 'react';
import { AlertTriangle, Check, Download, RefreshCw, ScanSearch, ShieldCheck, UserCheck, WandSparkles } from 'lucide-react';
import { copilotApi } from '../../api';
import type { DesignProject } from '../../types';
import { loadProjectExactFonts } from '../production/fontFaceLoader';
import { FidelityWorkbench } from '../workbenches/FidelityWorkbench';
import { UnderlayWorkbench } from '../workbenches/UnderlayWorkbench';

type Run = (task: () => Promise<DesignProject>, options: { label: string; stage: 'visual_exploration' }) => Promise<DesignProject | undefined>;

export function StrictProductionPanel({ project, underlayId, busy, run }: { project: DesignProject; underlayId?: string; busy: boolean; run: Run }) {
  const critique = project.artifacts.underlayCritique;
  const composition = project.artifacts.compositionManifest;
  const output = project.artifacts.compositionOutput;
  const fidelity = project.artifacts.fidelityReport;
  const critiqueResultPassed = critique?.result === 'passed' || critique?.result === 'passed-with-waiver';
  // AUD-05：UI 层与后端 reviewGate 预对齐——stale Critique、或审查时冻结的
  // visual_results_version 与当前 Visual Results 版本不一致，都视为证据失效：
  // 不得显示绿灯，也不得放开合成入口，而不是等后端报错。
  const critiqueStale = critique?.status === 'stale';
  const critiqueVisualVersion = Number((critique?.source as Record<string, unknown>)?.visual_results_version);
  const currentVisualVersion = Number(project.artifacts.visualResults?.version || 0);
  const critiqueVersionMismatch = Boolean(critique?.source) && Number.isFinite(critiqueVisualVersion) && Boolean(project.artifacts.visualResults) && critiqueVisualVersion !== currentVisualVersion;
  // P1-01：升级前的 legacy Critique 往往没有 source 或缺少冻结的
  // visual_results_version（Number(undefined) = NaN 不会命中版本不一致分支），
  // 旧逻辑会显示假绿灯。这里直接视为证据不完整并 fail closed：
  // 不显示绿灯、不放行合成，重新审查是唯一正确路径。
  const critiqueEvidenceIncomplete = Boolean(critique) && (!critique?.source || !Number.isFinite(critiqueVisualVersion));
  const critiquePassed = critiqueResultPassed && !critiqueStale && !critiqueVersionMismatch && !critiqueEvidenceIncomplete;
  // P0-04：证据链匹配——选中底图必须是被审查的那张，否则合成入口
  // 禁用并提示；后端同样以 UNDERLAY_EVIDENCE_MISMATCH 硬门禁拦截。
  const critiqueUnderlay = String((critique?.source as Record<string, unknown>)?.underlay || '');
  const evidenceMismatch = Boolean(underlayId) && Boolean(critique) && critiqueUnderlay !== underlayId;
  // P0-03：人工复核是 Critique 的独立完成入口。旧版只有自动审查与
  // 修复复审，manual_review.required 后无任何可达完成动作，形成死路。
  const manualReview = (critique?.manual_review as Record<string, unknown>) || null;
  const manualRequired = manualReview?.required === true && manualReview?.approved !== true;
  const [manualConclusion, setManualConclusion] = useState('');
  const [manualReason, setManualReason] = useState('');
  const composeFinal = () => run(async () => {
    const fontLoad = await loadProjectExactFonts(project).catch((error) => error);
    if (fontLoad instanceof Error) {
      // The exact-font pre-check failed (missing or unreadable font asset).
      // Still attempt the backend composition: it invalidates the previous
      // evidence chain first and re-validates the font server-side, so Final
      // Approval stays unavailable while the font is broken (UIE2E-07B). If
      // the backend somehow succeeds anyway, surface its honest result instead
      // of the pre-check error; approval still requires fresh passing fidelity.
      const backend = await copilotApi.composeVisual(project.id, { variationId: underlayId, mode: 'final' }).then((next) => next, () => undefined);
      if (backend) return backend;
      throw fontLoad;
    }
    return copilotApi.composeVisual(project.id, { variationId: underlayId, mode: 'final' });
  }, { label: '实际加载字体并渲染最终 PNG', stage: 'visual_exploration' });
  return <section className="strict-production">
    <header><div><span>STRICT PRODUCTION</span><h3>结构底层 → 污染审查 → 合成输出 → 保真校验 → 批准与导出</h3>{output && <small>{String(output.path)} · {String(output.width)}×{String(output.height)} · {String(output.hash).slice(0, 20)}…</small>}</div><div>{([['strict-gate-critique', '污染审查', critiquePassed], ['strict-gate-final-png', '最终 PNG', output?.mode === 'final'], ['strict-gate-fidelity', '保真校验', fidelity?.status === 'passed'], ['strict-gate-approval', '最终批准', composition?.status === 'approved']] as Array<[string, string, boolean]>).map(([testId, label, ready]) => <i data-testid={testId} className={ready ? 'is-ready' : ''} key={testId}>{ready && <Check size={12} />}{label}</i>)}</div></header>
    {Array.isArray(critique?.issues) && <details><summary>审查证据与问题（{critique.issues.length}）</summary><pre>{JSON.stringify({ evidence: critique.evidence, deterministic_metrics: critique.deterministic_metrics, issues: critique.issues, manual_review: critique.manual_review }, null, 2)}</pre></details>}
    {critiqueStale && <div className="quality-warning" data-testid="critique-stale-warning"><AlertTriangle size={16} /><div><b>污染审查证据已失效</b><p>审查后底层图或上游证据链已变化，此审查结论不能用于合成。请对当前选中底图重新执行污染审查。</p></div></div>}
    {critiqueVersionMismatch && !critiqueStale && <div className="quality-warning" data-testid="critique-version-mismatch"><AlertTriangle size={16} /><div><b>审查证据与当前视觉结果版本不一致</b><p>审查时冻结的 Visual Results 版本是 V{String(critiqueVisualVersion)}，当前是 V{String(currentVisualVersion)}。请重新执行污染审查后再合成。</p></div></div>}
    {critiqueEvidenceIncomplete && !critiqueStale && <div className="quality-warning" data-testid="critique-legacy-evidence"><AlertTriangle size={16} /><div><b>旧版证据需重新审查</b><p>当前污染审查缺少审查时冻结的 Visual Results 版本记录（legacy 证据），无法证明它针对当前证据链做出。请对当前选中底图重新执行污染审查后再合成。</p></div></div>}
    {evidenceMismatch && <div className="quality-warning" data-testid="underlay-evidence-mismatch"><AlertTriangle size={16} /><div><b>当前选中底图与审查证据不一致</b><p>审查对象是 {critiqueUnderlay || '（无）'}，选中底图是 {underlayId}。请先对选中底图执行污染审查，或切回已审查的底图，再进行合成。</p></div></div>}
    {manualRequired && <div className="quality-warning manual-review-panel" data-testid="underlay-manual-review-panel"><AlertTriangle size={16} /><div><b>本次审查要求人工复核</b><p>自动审查无法给出足够置信度（如缺少语义证据或输入证据不完整）。请核对上方完整证据后填写人工结论；人工复核只解除“需人工复核”阻断，不会自动豁免未处理的阻断问题。</p><label><span>人工结论</span><input value={manualConclusion} onChange={(event) => setManualConclusion(event.target.value)} placeholder="例如：已逐区核对底层图，残留纹理属于场景元素，可继续合成" /></label><label><span>判断理由（不少于 10 字）</span><textarea value={manualReason} onChange={(event) => setManualReason(event.target.value)} placeholder="说明判断依据，如参照了哪张参考页、哪个槽位的证据" /></label><button className="button button--secondary" data-testid="underlay-manual-review" disabled={busy || !manualConclusion.trim() || manualReason.trim().length < 10} onClick={() => run(() => copilotApi.approveUnderlayManualReview(project.id, { conclusion: manualConclusion.trim(), reason: manualReason.trim() }), { label: '完成人工复核', stage: 'visual_exploration' })}><UserCheck size={15} />完成人工复核</button></div></div>}
    {manualReview?.approved === true && <div className="settings-note" data-testid="underlay-manual-review-done"><b>人工复核已完成</b><span>{String(manualReview.approved_by || '')} · {String(manualReview.approved_at || '')}：{String(manualReview.conclusion || '')}</span></div>}
    <UnderlayWorkbench project={project} />
    <FidelityWorkbench project={project} />
    <nav>
      <button className="button button--secondary" data-testid="underlay-critique" disabled={busy || !underlayId} onClick={() => run(() => copilotApi.runUnderlayCritique(project.id, { underlayId }), { label: '自动审查底层污染', stage: 'visual_exploration' })}><ScanSearch size={15} />自动污染审查</button>
      <button className="button button--ghost" data-testid="underlay-repair" disabled={busy || !critique || critiquePassed} onClick={() => run(() => copilotApi.repairUnderlay(project.id, { attempt: Number(project.artifacts.underlayRepairTask?.attempt || 0) + 1, maxAutomaticAttempts: 2 }), { label: '执行底层修复并自动复审', stage: 'visual_exploration' })}><RefreshCw size={15} />修复并复审</button>
      <button className="button button--secondary" data-testid="composition-preview" disabled={busy || !critiquePassed || !underlayId || evidenceMismatch} onClick={() => run(() => copilotApi.composeVisual(project.id, { variationId: underlayId, mode: 'preview' }), { label: '生成确定性合成预览', stage: 'visual_exploration' })}><WandSparkles size={15} />合成预览</button>
      <button className="button button--secondary" data-testid="composition-final" disabled={busy || !critiquePassed || !underlayId || evidenceMismatch} onClick={composeFinal}><ShieldCheck size={15} />加载字体并生成最终 PNG</button>
      <button className="button button--secondary" data-testid="fidelity-run" disabled={busy || composition?.mode !== 'final' || output?.mode !== 'final'} onClick={() => run(() => copilotApi.runFidelity(project.id), { label: '运行最终保真校验', stage: 'visual_exploration' })}><ShieldCheck size={15} />保真校验</button>
      <button className="button button--primary" data-testid="final-approve" disabled={busy || fidelity?.status !== 'passed' || composition?.mode !== 'final' || output?.mode !== 'final'} onClick={() => run(() => copilotApi.approveArtifact(project.id, 'composition-manifest'), { label: '批准最终严格继承结果', stage: 'visual_exploration' })}><Check size={15} />最终批准</button>
      {/* 交付顺序：最终批准先于导出。后端同时以 FINAL_APPROVAL_REQUIRED 硬门禁阻断未批准导出。 */}
      <button className="button button--ghost" data-testid="final-export" disabled={busy || output?.mode !== 'final' || composition?.status !== 'approved'} title={composition?.status === 'approved' ? undefined : '完成最终批准后开放导出'} onClick={() => run(async () => { await copilotApi.exportVisual(project.id, underlayId || 'final'); return project; }, { label: '导出最终 PNG', stage: 'visual_exploration' })}><Download size={15} />导出最终 PNG</button>
    </nav>
  </section>;
}
