import type { Artifact, DesignProject } from '../../types';
export function UnderlayWorkbench({ project }: { project: DesignProject }) {
  const contract = project.artifacts.underlayContract; const critique = project.artifacts.underlayCritique; const repair = project.artifacts.underlayRepairTask;
  const entries: Array<{ label: string; artifact?: Artifact | null }> = [{ label: 'Contract', artifact: contract }, { label: 'Critique', artifact: critique }, { label: 'Repair', artifact: repair }];
  return <section className="evidence-workbench"><header><span>UNDERLAY WORKBENCH</span><b>结构约束、污染证据与修复链</b></header><div>{entries.map(({ label, artifact }) => <article key={label}><b>{label}</b>{artifact ? <><small>{artifact.status} · V{String(artifact.version || 1)}</small><pre>{JSON.stringify(label === 'Critique' ? { evidence: artifact.evidence, metrics: artifact.deterministic_metrics, issues: artifact.issues } : label === 'Repair' ? { attempt: artifact.attempt, mode: artifact.repair_mode, output: artifact.output, manual_review: artifact.manual_review } : { slots: artifact.slots, layout_guide: artifact.layout_guide }, null, 2)}</pre></> : <small>尚未生成</small>}</article>)}</div></section>;
}
