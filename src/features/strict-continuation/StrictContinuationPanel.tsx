import { Check, Layers3 } from 'lucide-react';
import { copilotApi } from '../../api';
import type { DesignProject } from '../../types';
import { BindingWorkbench } from '../binding/BindingWorkbench';
import type { RunTask } from '../shared/ui';
import { ComponentKitWorkbench } from '../workbenches/ComponentKitWorkbench';
import { TypographyWorkbench } from '../workbenches/TypographyWorkbench';

export function StrictContinuationPanel({ project, busy, run }: { project: DesignProject; busy: boolean; run: RunTask }) {
  const gates = [
    ['风格规范', project.artifacts.styleContract?.status], ['字体清单', project.artifacts.fontManifest?.status],
    ['组件契约', project.artifacts.componentContract?.status], ['控件绑定', project.artifacts.bindings?.status]
  ];
  return <section className="strict-panel">
    <header><div><span>STRICT CONTINUATION</span><h3>严格继承资产与绑定</h3><p>这些门禁全部由后端复核；未满足时不能进入组件感知布局。绑定必须逐个显式选择，批准由后端生成。</p></div><div className="strict-gates">{gates.map(([label, status]) => <i className={status === 'approved' ? 'is-ready' : ''} key={label}>{status === 'approved' && <Check size={12} />}{label}</i>)}</div></header>
    <div className="strict-grid">
      <TypographyWorkbench project={project} busy={busy} run={run} />
      <ComponentKitWorkbench project={project} busy={busy} run={run} />
      <BindingWorkbench project={project} busy={busy} run={run} />
    </div>
    <footer><button className="button button--primary" data-testid="strict-layout-generate" disabled={busy || gates.some(([, status]) => status !== 'approved')} onClick={() => run(() => copilotApi.runStage(project.id, 'layout_design'), { label: '生成组件感知布局', stage: 'layout_design' })}><Layers3 size={15} />生成组件感知布局</button></footer>
  </section>;
}
