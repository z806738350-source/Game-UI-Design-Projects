import { useMemo, useState } from 'react';
import { Check, Layers3, LockKeyhole } from 'lucide-react';
import { copilotApi } from '../../api';
import type { DesignProject } from '../../types';
import { ComponentKitWorkbench } from '../workbenches/ComponentKitWorkbench';
import { TypographyWorkbench } from '../workbenches/TypographyWorkbench';

type Run = (task: () => Promise<DesignProject>, options: { label: string; stage?: 'style_resolution' | 'layout_design' }) => Promise<DesignProject | undefined>;

export function StrictContinuationPanel({ project, busy, run }: { project: DesignProject; busy: boolean; run: Run }) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const controls = useMemo(() => ((project.artifacts.screenContract?.required_controls as Array<{ id: string; label: string; required?: boolean }>) || []).filter((control) => control.required !== false), [project.artifacts.screenContract]);
  const families = ((project.artifacts.componentContract?.families as Array<Record<string, unknown>>) || []);
  const gates = [
    ['Style', project.artifacts.styleContract?.status], ['Font Manifest', project.artifacts.fontManifest?.status],
    ['Component Contract', project.artifacts.componentContract?.status], ['Bindings', project.artifacts.bindings?.status]
  ];
  const prepareBindings = () => run(() => copilotApi.updateArtifact(project.id, 'component-bindings', { bindings: controls.map((control) => ({ control_id: control.id, component_id: choices[control.id] || String(families[0]?.id || ''), state: 'default', slot_id: `${control.id}-slot`, reuse_policy: 'contract', label: control.label, text: control.label, font_role: 'button-label', approved: true })) }), { label: '保存控件与组件绑定', stage: 'style_resolution' });
  const approveBindings = () => run(() => copilotApi.approveArtifact(project.id, 'component-bindings'), { label: '验证 100% Binding 覆盖', stage: 'style_resolution' });
  return <section className="strict-panel">
    <header><div><span>STRICT CONTINUATION</span><h3>严格继承资产与绑定</h3><p>这些门禁全部由后端复核；未满足时不能进入组件感知布局。</p></div><div className="strict-gates">{gates.map(([label, status]) => <i className={status === 'approved' ? 'is-ready' : ''} key={label}>{status === 'approved' && <Check size={12} />}{label}</i>)}</div></header>
    <div className="strict-grid">
      <TypographyWorkbench project={project} busy={busy} run={run} />
      <ComponentKitWorkbench project={project} busy={busy} run={run} />
      <article className="strict-bindings"><b><Layers3 size={16} />必要控件绑定</b>{controls.map((control) => <label key={control.id}><span>{control.label}</span><select value={choices[control.id] || String(families[0]?.id || '')} onChange={(event) => setChoices({ ...choices, [control.id]: event.target.value })}><option value="">选择组件</option>{families.map((family) => <option key={String(family.id)} value={String(family.id)}>{String(family.name || family.id)}</option>)}</select></label>)}<div><button className="button button--secondary" disabled={busy || !controls.length || !families.length} onClick={prepareBindings}>保存绑定</button><button className="button button--ghost" disabled={busy || !project.artifacts.bindings} onClick={approveBindings}><LockKeyhole size={14} />批准覆盖率</button></div></article>
    </div>
    <footer><button className="button button--primary" disabled={busy || gates.some(([, status]) => status !== 'approved')} onClick={() => run(() => copilotApi.runStage(project.id, 'layout_design'), { label: '生成组件感知布局', stage: 'layout_design' })}><Layers3 size={15} />生成组件感知布局</button></footer>
  </section>;
}
