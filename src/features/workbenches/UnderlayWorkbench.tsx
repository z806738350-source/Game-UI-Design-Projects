import type { Artifact, DesignProject } from '../../types';

// Underlay evidence workbench: contract slots, critique pollution evidence and
// the repair attempt chain, with status badges instead of raw JSON only.
export function UnderlayWorkbench({ project }: { project: DesignProject }) {
  const contract = project.artifacts.underlayContract;
  const critique = project.artifacts.underlayCritique;
  const repair = project.artifacts.underlayRepairTask;
  const critiqueIssues = Array.isArray(critique?.issues) ? (critique?.issues as unknown[]) : [];
  const entries: Array<{ label: string; artifact?: Artifact | null; badge?: string }> = [
    { label: 'Contract', artifact: contract, badge: contract ? String(contract.status) : '' },
    { label: 'Critique', artifact: critique, badge: critique ? `${String(critique.result || critique.status)} · ${critiqueIssues.length} 项问题` : '' },
    { label: 'Repair', artifact: repair, badge: repair ? `第 ${String(repair.attempt || 1)} 次 · ${String(repair.status)}` : '' }
  ];
  return <section className="evidence-workbench underlay-workbench" data-testid="underlay-workbench"><header><span>UNDERLAY WORKBENCH</span><b>结构约束、污染证据与修复链</b></header><div>{entries.map(({ label, artifact, badge }) => <article key={label} data-testid={`underlay-${label.toLowerCase()}`}><b>{label}</b>{artifact ? <><small className={String(artifact.status) === 'failed' ? 'is-failed' : ''}>{badge || `${String(artifact.status)} · V${String(artifact.version || 1)}`}</small><details><summary>查看证据 JSON</summary><pre>{JSON.stringify(label === 'Critique' ? { evidence: artifact.evidence, metrics: artifact.deterministic_metrics, issues: artifact.issues } : label === 'Repair' ? { attempt: artifact.attempt, mode: artifact.repair_mode, output: artifact.output, manual_review: artifact.manual_review } : { slots: artifact.slots, layout_guide: artifact.layout_guide }, null, 2)}</pre></details></> : <small>尚未生成</small>}</article>)}</div></section>;
}
