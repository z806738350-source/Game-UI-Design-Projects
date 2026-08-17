import type { DesignProject } from '../../types';
export function FidelityWorkbench({ project }: { project: DesignProject }) {
  const report = project.artifacts.fidelityReport; const output = project.artifacts.compositionOutput;
  return <section className="evidence-workbench"><header><span>FIDELITY WORKBENCH</span><b>只读像素证据与最终输出</b></header><div><article><b>Final PNG</b>{output ? <><small>{String(output.path)} · {String(output.width)}×{String(output.height)}</small><code>{String(output.hash)}</code></> : <small>尚未生成</small>}</article><article><b>检查结果</b>{report ? <><small>{String(report.status)} · V{String(report.version || 1)}</small><pre>{JSON.stringify({ source: report.source, metrics: report.metrics, checks: report.checks, issues: report.issues, evidence: report.evidence }, null, 2)}</pre></> : <small>尚未运行</small>}</article></div></section>;
}
