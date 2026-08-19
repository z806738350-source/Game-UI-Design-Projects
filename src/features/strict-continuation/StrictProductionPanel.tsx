import { Check, Download, RefreshCw, ScanSearch, ShieldCheck, WandSparkles } from 'lucide-react';
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
  const critiquePassed = critique?.result === 'passed' || critique?.result === 'passed-with-waiver';
  const composeFinal = () => run(async () => {
    const fontLoad = await loadProjectExactFonts(project).catch((error) => error);
    if (fontLoad instanceof Error) {
      // The exact-font pre-check failed (missing or unreadable font asset).
      // Still attempt the backend composition: it invalidates the previous
      // evidence chain first and re-validates the font server-side, so Final
      // Approval stays unavailable while the font is broken (UIE2E-07B).
      await copilotApi.composeVisual(project.id, { variationId: underlayId, mode: 'final' }).catch(() => undefined);
      throw fontLoad;
    }
    return copilotApi.composeVisual(project.id, { variationId: underlayId, mode: 'final' });
  }, { label: '实际加载字体并渲染 Final PNG', stage: 'visual_exploration' });
  return <section className="strict-production">
    <header><div><span>STRICT PRODUCTION</span><h3>Underlay → Critique → Composition Output → Fidelity</h3>{output && <small>{String(output.path)} · {String(output.width)}×{String(output.height)} · {String(output.hash).slice(0, 20)}…</small>}</div><div>{[['Critique', critiquePassed], ['Final PNG', output?.mode === 'final'], ['Fidelity', fidelity?.status === 'passed']].map(([label, ready]) => <i className={ready ? 'is-ready' : ''} key={String(label)}>{ready && <Check size={12} />}{label}</i>)}</div></header>
    {Array.isArray(critique?.issues) && <details><summary>审查证据与问题（{critique.issues.length}）</summary><pre>{JSON.stringify({ evidence: critique.evidence, deterministic_metrics: critique.deterministic_metrics, issues: critique.issues, manual_review: critique.manual_review }, null, 2)}</pre></details>}
    <UnderlayWorkbench project={project} />
    <FidelityWorkbench project={project} />
    <nav>
      <button className="button button--secondary" data-testid="underlay-critique" disabled={busy || !underlayId} onClick={() => run(() => copilotApi.runUnderlayCritique(project.id, { underlayId }), { label: '自动审查 Underlay 污染', stage: 'visual_exploration' })}><ScanSearch size={15} />自动 Critique</button>
      <button className="button button--ghost" data-testid="underlay-repair" disabled={busy || !critique || critiquePassed} onClick={() => run(() => copilotApi.repairUnderlay(project.id, { attempt: Number(project.artifacts.underlayRepairTask?.attempt || 0) + 1, maxAutomaticAttempts: 2 }), { label: '执行 Underlay 修复并自动复审', stage: 'visual_exploration' })}><RefreshCw size={15} />修复并复审</button>
      <button className="button button--secondary" data-testid="composition-preview" disabled={busy || !critiquePassed || !underlayId} onClick={() => run(() => copilotApi.composeVisual(project.id, { variationId: underlayId, mode: 'preview' }), { label: '生成确定性合成预览', stage: 'visual_exploration' })}><WandSparkles size={15} />合成预览</button>
      <button className="button button--secondary" data-testid="composition-final" disabled={busy || !critiquePassed || !underlayId} onClick={composeFinal}><ShieldCheck size={15} />加载字体并生成 Final PNG</button>
      <button className="button button--secondary" data-testid="fidelity-run" disabled={busy || composition?.mode !== 'final' || output?.mode !== 'final'} onClick={() => run(() => copilotApi.runFidelity(project.id), { label: '运行 Final Fidelity Gate', stage: 'visual_exploration' })}><ShieldCheck size={15} />Fidelity 检查</button>
      <button className="button button--ghost" data-testid="final-export" disabled={busy || output?.mode !== 'final'} onClick={() => run(async () => { await copilotApi.exportVisual(project.id, underlayId || 'final'); return project; }, { label: '导出 Final PNG', stage: 'visual_exploration' })}><Download size={15} />导出 Final PNG</button>
      <button className="button button--primary" data-testid="final-approve" disabled={busy || fidelity?.status !== 'passed' || composition?.mode !== 'final' || output?.mode !== 'final'} onClick={() => run(() => copilotApi.approveArtifact(project.id, 'composition-manifest'), { label: '批准最终严格继承结果', stage: 'visual_exploration' })}><Check size={15} />最终批准</button>
    </nav>
  </section>;
}
