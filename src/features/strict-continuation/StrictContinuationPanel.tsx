import { useMemo, useState } from 'react';
import { Check, FileType2, ImagePlus, Layers3, LockKeyhole } from 'lucide-react';
import { copilotApi } from '../../api';
import type { DesignProject } from '../../types';

type Run = (task: () => Promise<DesignProject>, options: { label: string; stage?: 'style_resolution' | 'layout_design' }) => Promise<DesignProject | undefined>;

function stableId(value: unknown, index: number) {
  if (value && typeof value === 'object' && 'id' in value) return String((value as { id: unknown }).id);
  return String(value || `control-${index + 1}`).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

export function StrictContinuationPanel({ project, busy, run }: { project: DesignProject; busy: boolean; run: Run }) {
  const [fontId, setFontId] = useState('ui-primary');
  const [fontRole, setFontRole] = useState('button-label');
  const [componentId, setComponentId] = useState('button.primary');
  const [componentCategory, setComponentCategory] = useState('button');
  const [choices, setChoices] = useState<Record<string, string>>({});
  const controls = useMemo(() => ((project.artifacts.screenContract?.required_controls as unknown[]) || []).map((control, index) => ({ id: stableId(control, index), label: typeof control === 'string' ? control : String((control as { label?: string }).label || stableId(control, index)) })), [project.artifacts.screenContract]);
  const families = ((project.artifacts.componentContract?.families as Array<Record<string, unknown>>) || []);
  const gates = [
    ['Style', project.artifacts.styleContract?.status], ['Font Manifest', project.artifacts.fontManifest?.status],
    ['Component Contract', project.artifacts.componentContract?.status], ['Bindings', project.artifacts.bindings?.status]
  ];
  const importFont = () => run(async () => {
    const imported = await copilotApi.importFontAsset(project.id, { id: fontId, licenseStatus: 'confirmed' });
    const font = ((imported.artifacts.fontManifest?.fonts as Array<Record<string, unknown>>) || []).find((item) => item.id === fontId);
    return copilotApi.updateArtifact(project.id, 'font-manifest', { roles: { ...((imported.artifacts.fontManifest?.roles as object) || {}), [fontRole]: { font_id: font?.id || fontId, fidelity_mode: 'exact', identity_critical: true, required_coverage: ['zh_cn'] } } });
  }, { label: '导入并绑定字体角色', stage: 'style_resolution' });
  const approveFonts = () => run(() => copilotApi.approveArtifact(project.id, 'font-manifest'), { label: '验证并批准字体清单', stage: 'style_resolution' });
  const importComponent = () => run(() => copilotApi.importComponentAsset(project.id, { componentId, name: componentId, category: componentCategory, state: 'default', reuseMode: 'exact', textPolicy: componentCategory === 'button' ? 'text-slot' : 'none', lockedProperties: ['silhouette', 'corner-radius', 'border-layers', 'light-direction'] }), { label: '导入组件状态资产', stage: 'style_resolution' });
  const approveComponents = () => run(async () => {
    const marked = await copilotApi.updateArtifact(project.id, 'component-contract', { families: families.map((family) => ({ ...family, status: 'approved' })) });
    return copilotApi.approveArtifact(marked.id, 'component-contract');
  }, { label: '验证并批准组件契约', stage: 'style_resolution' });
  const prepareBindings = () => run(() => copilotApi.updateArtifact(project.id, 'component-bindings', { bindings: controls.map((control) => ({ control_id: control.id, component_id: choices[control.id] || String(families[0]?.id || ''), state: 'default', slot_id: `${control.id}-slot`, reuse_policy: 'contract', label: control.label, text: control.label, font_role: 'button-label', approved: true })) }), { label: '保存控件与组件绑定', stage: 'style_resolution' });
  const approveBindings = () => run(() => copilotApi.approveArtifact(project.id, 'component-bindings'), { label: '验证 100% Binding 覆盖', stage: 'style_resolution' });
  return <section className="strict-panel">
    <header><div><span>STRICT CONTINUATION</span><h3>严格继承资产与绑定</h3><p>这些门禁全部由后端复核；未满足时不能进入组件感知布局。</p></div><div className="strict-gates">{gates.map(([label, status]) => <i className={status === 'approved' ? 'is-ready' : ''} key={label}>{status === 'approved' && <Check size={12} />}{label}</i>)}</div></header>
    <div className="strict-grid">
      <article><b><FileType2 size={16} />字体角色</b><label>字体 ID<input value={fontId} onChange={(event) => setFontId(event.target.value)} /></label><label>角色<input value={fontRole} onChange={(event) => setFontRole(event.target.value)} /></label><div><button className="button button--secondary" disabled={busy} onClick={importFont}>选择字体文件</button><button className="button button--ghost" disabled={busy || !project.artifacts.fontManifest} onClick={approveFonts}><LockKeyhole size={14} />批准</button></div></article>
      <article><b><ImagePlus size={16} />组件家族</b><label>组件 ID<input value={componentId} onChange={(event) => setComponentId(event.target.value)} /></label><label>类别<select value={componentCategory} onChange={(event) => setComponentCategory(event.target.value)}><option value="button">按钮</option><option value="navigation">导航</option><option value="tab">页签</option><option value="icon">图标</option><option value="page-specific">页面专属</option></select></label><div><button className="button button--secondary" disabled={busy} onClick={importComponent}>选择组件图片</button><button className="button button--ghost" disabled={busy || !families.length} onClick={approveComponents}><LockKeyhole size={14} />批准</button></div></article>
      <article className="strict-bindings"><b><Layers3 size={16} />必要控件绑定</b>{controls.map((control) => <label key={control.id}><span>{control.label}</span><select value={choices[control.id] || String(families[0]?.id || '')} onChange={(event) => setChoices({ ...choices, [control.id]: event.target.value })}><option value="">选择组件</option>{families.map((family) => <option key={String(family.id)} value={String(family.id)}>{String(family.name || family.id)}</option>)}</select></label>)}<div><button className="button button--secondary" disabled={busy || !controls.length || !families.length} onClick={prepareBindings}>保存绑定</button><button className="button button--ghost" disabled={busy || !project.artifacts.bindings} onClick={approveBindings}><LockKeyhole size={14} />批准覆盖率</button></div></article>
    </div>
    <footer><button className="button button--primary" disabled={busy || gates.some(([, status]) => status !== 'approved')} onClick={() => run(() => copilotApi.runStage(project.id, 'layout_design'), { label: '生成组件感知布局', stage: 'layout_design' })}><Layers3 size={15} />生成组件感知布局</button></footer>
  </section>;
}
