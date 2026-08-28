import { useEffect, useMemo, useState } from 'react';
import { Layers3, LockKeyhole } from 'lucide-react';
import { copilotApi } from '../../api';
import type { DesignProject } from '../../types';
import { Dropdown, friendlyError } from '../shared/ui';
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
  'content-panel': { allowed_categories: ['content-panel', 'page-specific'], allowed_font_roles: ['body'] }
};

// Concrete role vocabulary for creating/editing Screen Controls. The legacy
// generic 'action' role is intentionally excluded: new controls must never be
// created with it, and migrated 'action' controls must be resolved explicitly.
export const CONTROL_ROLE_OPTIONS = Object.keys(ROLE_POLICIES).filter((role) => role !== 'action');

// 角色词表的简体中文展示标签：仅用于前端下拉/列表提示，写入契约的 role
// 值仍是英文受控词表键，后端语义不变。
export const CONTROL_ROLE_LABELS: Record<string, string> = {
  'primary-action': '主操作按钮',
  'secondary-action': '次级操作按钮',
  navigation: '导航入口',
  tab: '页签切换',
  resource: '资源条',
  'icon-action': '图标按钮',
  'status-badge': '状态徽标',
  'list-row': '列表行',
  'content-panel': '内容面板',
  action: '通用操作（待语义解析）'
};

type BindingChoice = { component_id: string; state: string; font_role: string };
type Control = { id: string; label: string; role?: string; required?: boolean };

// Binding workbench (REM-01 / F-01): every required control needs an explicit
// component, state, and — for text-slot families — font role selection. There
// is no implicit first-family, 'default' state, or first-font-role fallback:
// recommendations are shown as hints only and never enter the save payload.
// The workbench owns the selection draft; saving sends no approved flag and
// approval is stamped by the backend after full semantic validation. When a
// run() boundary is provided (App shell) errors surface in the global banner;
// standalone usage shows them in the workbench's own error slot.
export function BindingWorkbench({ project, busy, run }: { project: DesignProject; busy: boolean; run?: RunTask }) {
  const [choices, setChoices] = useState<Record<string, BindingChoice>>({});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  // P1-07：从已保存的 Binding Artifact hydrate 草稿（已批准绑定不再一片空白），
  // 并在项目 / Screen / Artifact 版本变化时重建草稿，避免跨 Screen、跨项目
  // 携带旧选择（相同控件 id 时尤其危险）。
  useEffect(() => {
    const saved = ((project.artifacts.bindings?.bindings as Array<Record<string, unknown>>) || []).reduce<Record<string, BindingChoice>>((draft, binding) => {
      const controlId = String(binding.control_id || '');
      if (controlId) draft[controlId] = { component_id: String(binding.component_id || ''), state: String(binding.state || ''), font_role: String(binding.font_role || '') };
      return draft;
    }, {});
    setChoices(saved);
  }, [project.id, project.screen_id, project.artifacts.bindings?.version]);
  const controls = useMemo(() => ((project.artifacts.screenContract?.required_controls as Control[]) || []).filter((control) => control.required !== false), [project.artifacts.screenContract]);
  const families = ((project.artifacts.componentContract?.families as Array<Record<string, unknown>>) || []);
  const fontRoles = Object.keys((project.artifacts.fontManifest?.roles as Record<string, unknown>) || {});
  const familyById = new Map(families.map((family) => [String(family.id), family]));
  const roleOf = (control: Control) => control.role || 'action';
  const incompatibility = (control: Control, family: Record<string, unknown>) => {
    const policy = ROLE_POLICIES[roleOf(control)];
    if (!policy) return '';
    const category = String(family.category || 'page-specific');
    return policy.allowed_categories.includes(category) ? '' : `该控件角色为 ${roleOf(control)}，组件类别为 ${category}，语义不兼容`;
  };
  const choiceOf = (control: Control) => choices[control.id] || { component_id: '', state: '', font_role: '' };
  const setChoice = (controlId: string, next: Partial<BindingChoice>) => setChoices((previous) => ({ ...previous, [controlId]: { ...(previous[controlId] || { component_id: '', state: '', font_role: '' }), ...next } }));
  const needsFontRole = (control: Control) => {
    const family = familyById.get(choiceOf(control).component_id);
    return family?.text_policy === 'text-slot';
  };
  // F-01: save requires an explicit component + state for every required
  // control, plus an explicit font role whenever the bound family declares a
  // text-slot. Recommendations never count as confirmation.
  const allExplicitlyResolved = controls.length > 0 && controls.every((control) => {
    const choice = choiceOf(control);
    if (!choice.component_id || !choice.state) return false;
    if (needsFontRole(control) && !choice.font_role) return false;
    return true;
  });
  const bindingsPayload = () => controls.map((control) => {
    const choice = choiceOf(control);
    return { control_id: control.id, component_id: choice.component_id, state: choice.state, font_role: choice.font_role || undefined, slot_id: `slot-${control.id}`, reuse_policy: 'contract', label: control.label, text: control.label };
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
  return <article className="strict-bindings binding-workbench"><b><Layers3 size={16} />必要控件绑定</b><p className="binding-workbench-copy">每个控件必须显式选择组件、状态与（文字组件的）字体角色；推荐值仅供参考，未全部显式确认前不能保存，批准由后端在全量语义校验后生成。</p>{controls.map((control) => {
    const choice = choiceOf(control);
    const role = roleOf(control);
    const selectedFamily = familyById.get(choice.component_id);
    const states = Object.keys((selectedFamily?.states as Record<string, unknown>) || {});
    const policy = ROLE_POLICIES[role];
    const allowedFontRoles = (policy?.allowed_font_roles || []).filter((fontRole) => fontRoles.includes(fontRole));
    const fontRoleRequired = needsFontRole(control);
    // 一行绑定含组件/状态/字体角色三个独立 combobox，不能用单个 <label> 同时命名；
    // fieldset/legend 提供控件组语义，每个 Dropdown 通过 aria-labelledby 获得独立可读名称
    //（字段名 + 控件名，如「组件 确认按钮（角色：primary-action）」），互不混淆。
    return <fieldset className="binding-row" key={control.id}>
      <legend id={`binding-legend-${control.id}`}>
        {control.label}（角色：{role}）{role === 'action' && <em className="binding-unresolved-role" data-testid={`binding-unresolved-role-${control.id}`}>待语义解析：严格继承批准前，请在功能契约中改为具体角色</em>}
      </legend>
      <div className="binding-field">
        <span id={`binding-component-label-${control.id}`}>组件</span>
        <Dropdown testId={`binding-component-select-${control.id}`} ariaLabelledBy={`binding-component-label-${control.id} binding-legend-${control.id}`} value={choice.component_id} onChange={(next) => {
        // Selecting a family never confirms state or font role: both stay
        // empty until the designer picks them explicitly.
        setChoice(control.id, { component_id: next, state: '', font_role: '' });
      }} placeholder="请选择组件（必选）" options={families.map((family) => {
        const reason = incompatibility(control, family);
        return { value: String(family.id), label: `${String(family.name || family.id)}${reason ? `（不可选：${reason}）` : ''}`, disabled: Boolean(reason) };
      })} />
      </div>
      {choice.component_id && <div className="binding-field">
        <span id={`binding-state-label-${control.id}`}>状态</span>
        <Dropdown testId={`binding-state-select-${control.id}`} ariaLabelledBy={`binding-state-label-${control.id} binding-legend-${control.id}`} value={choice.state} onChange={(next) => setChoice(control.id, { state: next })} placeholder="选择状态（必选）" options={states.map((state) => ({ value: state, label: state }))} />
      </div>}
      {choice.component_id && !choice.state && states.length > 0 && <em className="binding-hint">推荐状态：{states.includes('default') ? 'default' : states[0]}（需手动确认）</em>}
      {choice.component_id && (allowedFontRoles.length
        ? <div className="binding-field">
            <span id={`binding-font-role-label-${control.id}`}>字体角色</span>
            <Dropdown testId={`binding-font-role-select-${control.id}`} ariaLabelledBy={`binding-font-role-label-${control.id} binding-legend-${control.id}`} value={choice.font_role} onChange={(next) => setChoice(control.id, { font_role: next })} placeholder={`选择字体角色${fontRoleRequired ? '（必选）' : '（可选）'}`} options={allowedFontRoles.map((fontRole) => ({ value: fontRole, label: fontRole }))} />
          </div>
        : fontRoleRequired
          ? <em className="binding-hint binding-hint--conflict">该组件需要文字层，但角色 {role} 没有可用的字体角色，请调整控件角色或组件</em>
          : <em className="binding-hint">该角色不使用文字层</em>)}
      {choice.component_id && fontRoleRequired && !choice.font_role && allowedFontRoles.length > 0 && <em className="binding-hint">推荐字体角色：{allowedFontRoles[0]}（需手动确认）</em>}
    </fieldset>;
  })}
    {error && <span className="inline-error" role="alert">{error}</span>}
    <div><button className="button button--secondary" data-testid="binding-save" disabled={actionBusy || !allExplicitlyResolved} onClick={prepareBindings}>保存绑定</button><button className="button button--ghost" data-testid="binding-approve" disabled={actionBusy || !project.artifacts.bindings} onClick={approveBindings}><LockKeyhole size={14} />批准覆盖与语义兼容</button></div></article>;
}
