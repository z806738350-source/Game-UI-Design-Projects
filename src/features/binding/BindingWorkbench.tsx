import { useMemo, useState } from 'react';
import { Layers3, LockKeyhole } from 'lucide-react';
import { copilotApi } from '../../api';
import type { DesignProject } from '../../types';
import { friendlyError } from '../shared/ui';
import type { RunTask } from '../shared/ui';

// UX-only mirror of electron/services/controlRolePolicy.cjs (binding-policy-v1).
// The backend remains the source of truth and re-validates every binding.
export const ROLE_POLICIES: Record<string, { allowed_categories: string[]; allowed_font_roles: string[] }> = {
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
type Control = { id: string; label: string; role?: string; required?: boolean };

// Binding workbench (REM-01): every required control needs an explicit
// component selection — there is no implicit first-family fallback. The
// workbench owns the selection draft; saving sends no approved flag and
// approval is stamped by the backend after full semantic validation. When a
// run() boundary is provided (App shell) errors surface in the global banner;
// standalone usage shows them in the workbench's own error slot.
export function BindingWorkbench({ project, busy, run }: { project: DesignProject; busy: boolean; run?: RunTask }) {
  const [choices, setChoices] = useState<Record<string, BindingChoice>>({});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const controls = useMemo(() => ((project.artifacts.screenContract?.required_controls as Control[]) || []).filter((control) => control.required !== false), [project.artifacts.screenContract]);
  const families = ((project.artifacts.componentContract?.families as Array<Record<string, unknown>>) || []);
  const fontRoles = Object.keys((project.artifacts.fontManifest?.roles as Record<string, unknown>) || {});
  const familyById = new Map(families.map((family) => [String(family.id), family]));
  const roleOf = (control: Control) => control.role || 'action';
  const incompatibility = (control: Control, family: Record<string, unknown>) => {
    const policy = ROLE_POLICIES[roleOf(control)];
    if (!policy) return '';
    const category = String(family.category || 'page-specific');
    return policy.allowed_categories.includes(category) ? '' : `该控件角色为 ${roleOf(control)}，组件 category 为 ${category}，语义不兼容`;
  };
  const choiceOf = (control: Control) => choices[control.id] || { component_id: '', state: '', font_role: '' };
  const setChoice = (controlId: string, next: Partial<BindingChoice>) => setChoices((previous) => ({ ...previous, [controlId]: { ...(previous[controlId] || { component_id: '', state: '', font_role: '' }), ...next } }));
  const allSelected = controls.length > 0 && controls.every((control) => choiceOf(control).component_id);
  const bindingsPayload = () => controls.map((control) => {
    const choice = choiceOf(control);
    return { control_id: control.id, component_id: choice.component_id, state: choice.state, font_role: choice.font_role || undefined, slot_id: `${control.id}-slot`, reuse_policy: 'contract', label: control.label, text: control.label };
  });
  const execute = async (label: string, stage: 'style_resolution', task: () => Promise<DesignProject>) => {
    if (run) { await run(task, { label, stage }); return; }
    setWorking(true); setError('');
    try { await task(); }
    catch (cause) { setError(friendlyError(cause)); }
    finally { setWorking(false); }
  };
  const prepareBindings = () => execute('保存控件与组件绑定', 'style_resolution', () => copilotApi.updateArtifact(project.id, 'component-bindings', { bindings: bindingsPayload() }));
  const approveBindings = () => execute('验证 Binding 覆盖与语义兼容', 'style_resolution', () => copilotApi.approveArtifact(project.id, 'component-bindings'));
  const actionBusy = busy || working;
  return <article className="strict-bindings binding-workbench"><b><Layers3 size={16} />必要控件绑定</b><p className="binding-workbench-copy">每个控件必须显式选择组件；未全部选择前不能保存，批准由后端在全量语义校验后生成。</p>{controls.map((control) => {
    const choice = choiceOf(control);
    const selectedFamily = familyById.get(choice.component_id);
    const states = Object.keys((selectedFamily?.states as Record<string, unknown>) || {});
    const policy = ROLE_POLICIES[roleOf(control)];
    const allowedFontRoles = (policy?.allowed_font_roles || []).filter((role) => fontRoles.includes(role));
    return <label key={control.id} data-testid={`binding-component-select-${control.id}`}>
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
    {error && <span className="inline-error" role="alert">{error}</span>}
    <div><button className="button button--secondary" data-testid="binding-save" disabled={actionBusy || !allSelected} onClick={prepareBindings}>保存绑定</button><button className="button button--ghost" data-testid="binding-approve" disabled={actionBusy || !project.artifacts.bindings} onClick={approveBindings}><LockKeyhole size={14} />批准覆盖与语义兼容</button></div></article>;
}
