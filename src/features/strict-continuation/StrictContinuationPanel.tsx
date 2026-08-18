import { useMemo, useState } from 'react';
import { Check, Layers3, LockKeyhole } from 'lucide-react';
import { copilotApi } from '../../api';
import type { DesignProject } from '../../types';
import { ComponentKitWorkbench } from '../workbenches/ComponentKitWorkbench';
import { TypographyWorkbench } from '../workbenches/TypographyWorkbench';

type Run = (task: () => Promise<DesignProject>, options: { label: string; stage?: 'style_resolution' | 'layout_design' }) => Promise<DesignProject | undefined>;

// UX-only mirror of electron/services/controlRolePolicy.cjs (binding-policy-v1).
// The backend remains the source of truth and re-validates every binding.
const ROLE_POLICIES: Record<string, { allowed_categories: string[]; allowed_font_roles: string[] }> = {
  'primary-action': { allowed_categories: ['button'], allowed_font_roles: ['button-label'] },
  'secondary-action': { allowed_categories: ['button'], allowed_font_roles: ['button-label'] },
  action: { allowed_categories: ['button', 'navigation', 'tab', 'icon'], allowed_font_roles: ['button-label', 'navigation-label', 'tab-label', 'body', 'caption', 'numeric'] },
  navigation: { allowed_categories: ['navigation'], allowed_font_roles: ['navigation-label'] },
  tab: { allowed_categories: ['tab'], allowed_font_roles: ['tab-label'] },
  resource: { allowed_categories: ['resource-bar'], allowed_font_roles: ['numeric', 'body'] },
  'icon-action': { allowed_categories: ['icon'], allowed_font_roles: [] },
  'status-badge': { allowed_categories: ['status-badge', 'page-specific'], allowed_font_roles: ['caption', 'numeric'] },
  'list-row': { allowed_categories: ['list-row', 'page-specific'], allowed_font_roles: ['body'] },
  'content-panel': { allowed_categories: ['content-panel', 'page-specific'], allowed_font_roles: [] }
};

type BindingChoice = { component_id: string; state: string; font_role: string };

export function StrictContinuationPanel({ project, busy, run }: { project: DesignProject; busy: boolean; run: Run }) {
  const [choices, setChoices] = useState<Record<string, BindingChoice>>({});
  const controls = useMemo(() => ((project.artifacts.screenContract?.required_controls as Array<{ id: string; label: string; role?: string; required?: boolean }>) || []).filter((control) => control.required !== false), [project.artifacts.screenContract]);
  const families = ((project.artifacts.componentContract?.families as Array<Record<string, unknown>>) || []);
  const fontRoles = Object.keys((project.artifacts.fontManifest?.roles as Record<string, unknown>) || {});
  const gates = [
    ['Style', project.artifacts.styleContract?.status], ['Font Manifest', project.artifacts.fontManifest?.status],
    ['Component Contract', project.artifacts.componentContract?.status], ['Bindings', project.artifacts.bindings?.status]
  ];
  const familyById = new Map(families.map((family) => [String(family.id), family]));
  const roleOf = (control: { role?: string }) => control.role || 'action';
  const incompatibility = (control: { role?: string }, family: Record<string, unknown>) => {
    const policy = ROLE_POLICIES[roleOf(control)];
    if (!policy) return '';
    const category = String(family.category || 'page-specific');
    return policy.allowed_categories.includes(category) ? '' : `该控件角色为 ${roleOf(control)}，组件 category 为 ${category}，语义不兼容`;
  };
  const choiceOf = (control: { id: string }) => choices[control.id] || { component_id: '', state: '', font_role: '' };
  const setChoice = (controlId: string, next: Partial<BindingChoice>) => setChoices((previous) => ({ ...previous, [controlId]: { ...choiceOf({ id: controlId }), ...next } }));
  const allSelected = controls.length > 0 && controls.every((control) => choiceOf(control).component_id);
  const prepareBindings = () => run(() => copilotApi.updateArtifact(project.id, 'component-bindings', {
    bindings: controls.map((control) => {
      const choice = choiceOf(control);
      return { control_id: control.id, component_id: choice.component_id, state: choice.state, font_role: choice.font_role || undefined, slot_id: `${control.id}-slot`, reuse_policy: 'contract', label: control.label, text: control.label };
    })
  }), { label: '保存控件与组件绑定', stage: 'style_resolution' });
  const approveBindings = () => run(() => copilotApi.approveArtifact(project.id, 'component-bindings'), { label: '验证 Binding 覆盖与语义兼容', stage: 'style_resolution' });
  return <section className="strict-panel">
    <header><div><span>STRICT CONTINUATION</span><h3>严格继承资产与绑定</h3><p>这些门禁全部由后端复核；未满足时不能进入组件感知布局。绑定必须逐个显式选择，批准由后端生成。</p></div><div className="strict-gates">{gates.map(([label, status]) => <i className={status === 'approved' ? 'is-ready' : ''} key={label}>{status === 'approved' && <Check size={12} />}{label}</i>)}</div></header>
    <div className="strict-grid">
      <TypographyWorkbench project={project} busy={busy} run={run} />
      <ComponentKitWorkbench project={project} busy={busy} run={run} />
      <article className="strict-bindings"><b><Layers3 size={16} />必要控件绑定</b>{controls.map((control) => {
        const choice = choiceOf(control);
        const selectedFamily = familyById.get(choice.component_id);
        const states = Object.keys((selectedFamily?.states as Record<string, unknown>) || {});
        const policy = ROLE_POLICIES[roleOf(control)];
        const allowedFontRoles = (policy?.allowed_font_roles || []).filter((role) => fontRoles.includes(role));
        return <label key={control.id}>
          <span>{control.label}（角色：{roleOf(control)}）</span>
          <select value={choice.component_id} onChange={(event) => {
            const family = familyById.get(event.target.value);
            const nextStates = Object.keys((family?.states as Record<string, unknown>) || {});
            setChoice(control.id, { component_id: event.target.value, state: nextStates.includes('default') ? 'default' : (nextStates[0] || ''), font_role: allowedFontRoles[0] || '' });
          }}>
            <option value="">请选择组件（必选）</option>
            {families.map((family) => {
              const reason = incompatibility(control, family);
              return <option key={String(family.id)} value={String(family.id)} disabled={Boolean(reason)}>{String(family.name || family.id)}{reason ? `（不可选：${reason}）` : ''}</option>;
            })}
          </select>
          {choice.component_id && <select value={choice.state} onChange={(event) => setChoice(control.id, { state: event.target.value })}>
            <option value="">选择状态</option>
            {states.map((state) => <option key={state} value={state}>{state}</option>)}
          </select>}
          {choice.component_id && (allowedFontRoles.length
            ? <select value={choice.font_role} onChange={(event) => setChoice(control.id, { font_role: event.target.value })}>
              <option value="">选择字体角色</option>
              {allowedFontRoles.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
            : <em>该角色不使用文字层</em>)}
        </label>;
      })}
        <div><button className="button button--secondary" disabled={busy || !allSelected} onClick={prepareBindings}>保存绑定</button><button className="button button--ghost" disabled={busy || !project.artifacts.bindings} onClick={approveBindings}><LockKeyhole size={14} />批准覆盖与语义兼容</button></div></article>
    </div>
    <footer><button className="button button--primary" disabled={busy || gates.some(([, status]) => status !== 'approved')} onClick={() => run(() => copilotApi.runStage(project.id, 'layout_design'), { label: '生成组件感知布局', stage: 'layout_design' })}><Layers3 size={15} />生成组件感知布局</button></footer>
  </section>;
}
