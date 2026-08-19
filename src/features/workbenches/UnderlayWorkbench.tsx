import type { Artifact, DesignProject } from '../../types';

const resultLabel: Record<string, string> = { passed: '已通过', failed: '未通过', 'passed-with-waiver': '豁免通过', approved: '已批准', generated: '已生成', stale: '需更新', pending: '等待中', completed: '已完成' };
const zh = (value: string) => resultLabel[value] || value;

// Underlay evidence workbench: contract slots, critique pollution evidence and
// the repair attempt chain, with status badges instead of raw JSON only.
export function UnderlayWorkbench({ project }: { project: DesignProject }) {
  const contract = project.artifacts.underlayContract;
  const critique = project.artifacts.underlayCritique;
  const repair = project.artifacts.underlayRepairTask;
  const critiqueIssues = Array.isArray(critique?.issues) ? (critique?.issues as unknown[]) : [];
  const entries: Array<{ id: string; label: string; artifact?: Artifact | null; badge?: string }> = [
    { id: 'contract', label: '结构契约', artifact: contract, badge: contract ? zh(String(contract.status)) : '' },
    { id: 'critique', label: '污染审查', artifact: critique, badge: critique ? `${zh(String(critique.result || critique.status))} · ${critiqueIssues.length} 项问题` : '' },
    { id: 'repair', label: '修复链', artifact: repair, badge: repair ? `第 ${String(repair.attempt || 1)} 次 · ${zh(String(repair.status))}` : '' }
  ];
  return <section className="evidence-workbench underlay-workbench" data-testid="underlay-workbench"><header><span>UNDERLAY WORKBENCH</span><b>结构约束、污染证据与修复链</b></header><div>{entries.map(({ id, label, artifact, badge }) => <article key={id} data-testid={`underlay-evidence-${id}`}><b>{label}</b>{artifact ? <><small className={String(artifact.status) === 'failed' ? 'is-failed' : ''}>{badge || `${zh(String(artifact.status))} · V${String(artifact.version || 1)}`}</small><details><summary>查看证据 JSON</summary><pre>{JSON.stringify(id === 'critique' ? { evidence: artifact.evidence, metrics: artifact.deterministic_metrics, issues: artifact.issues } : id === 'repair' ? { attempt: artifact.attempt, mode: artifact.repair_mode, output: artifact.output, manual_review: artifact.manual_review } : { slots: artifact.slots, layout_guide: artifact.layout_guide }, null, 2)}</pre></details></> : <small>尚未生成</small>}</article>)}</div></section>;
}
