import { useEffect, useState } from 'react';
import { AlertTriangle, Edit3, LockKeyhole, RefreshCw, Save, WandSparkles } from 'lucide-react';
import { copilotApi } from '../../api';
import { EmptyArtifact, StatusPill, fieldLabels, strictContinuation } from '../shared/ui';
import type { WorkspaceProps } from '../shared/ui';
import { ReferenceWorkbench } from '../workbenches/ReferenceWorkbench';
import { StrictContinuationPanel } from '../strict-continuation/StrictContinuationPanel';

function ruleText(value: unknown): string {
  if (Array.isArray(value)) return value.join(' · ');
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key.replaceAll('_', ' ')}：${typeof item === 'object' ? ruleText(item) : String(item)}`).join('\n');
  return String(value || '—');
}

function displayText(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  if (Array.isArray(value)) return value.map((item) => displayText(item, '')).filter(Boolean).join(' · ') || fallback;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred = record.value ?? record.hex ?? record.color ?? record.name;
    if (preferred !== undefined && typeof preferred !== 'object') return String(preferred);
    return ruleText(record);
  }
  return String(value);
}

function semanticColor(value: unknown) {
  if (!value || typeof value !== 'object') return { value: displayText(value), usage: '' };
  const record = value as Record<string, unknown>;
  return {
    value: displayText(record.value ?? record.hex ?? record.color),
    usage: displayText(record.usage ?? record.description, '')
  };
}

// Style stage workspace: owns the JSON edit draft/validation for the style
// contract; reference capacity and font/component gates render through their
// dedicated workbenches.
export function StyleWorkspace({ project, busy, run }: WorkspaceProps) {
  const artifact = project.artifacts.styleContract;
  const references = project.reference_assets || [];
  const strict = strictContinuation(project);
  const canGenerate = (strict ? project.artifacts.screenContract?.status === 'approved' : project.artifacts.approvedLayout?.status === 'approved') && (project.project_type === 'new' || (project.artifacts.referenceInventory?.status === 'approved' && references.some((asset) => asset.approved)));
  const colors = artifact?.colors && typeof artifact.colors === 'object' ? Object.entries(artifact.colors as Record<string, unknown>) : [];
  const [editing, setEditing] = useState(false);
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonError, setJsonError] = useState('');
  useEffect(() => { if (artifact) setJsonDraft(JSON.stringify({ visual_identity: artifact.visual_identity, colors: artifact.colors, typography: artifact.typography, materials: artifact.materials, geometry: artifact.geometry, lighting: artifact.lighting, components: artifact.components, composition: artifact.composition, negative_style_constraints: artifact.negative_style_constraints, designer_summary: artifact.designer_summary }, null, 2)); setEditing(false); }, [artifact?.id, artifact?.version]);
  const save = () => { try { const patch = JSON.parse(jsonDraft); setJsonError(''); run(() => copilotApi.updateArtifact(project.id, 'style-contract', patch), { label: '保存风格规范新版本', stage: 'style_resolution' }).then(() => setEditing(false)); } catch { setJsonError('JSON 格式有误，请检查逗号、引号和括号。'); } };
  const warnings = ((artifact?.quality_checks as Record<string, unknown>)?.warnings as string[]) || [];
  return <>
    <div className="workspace-content">
    <section className="workspace-heading"><div><span className="kicker">03 · STYLE RESOLUTION</span><h1>{project.project_type === 'existing' ? '重建现有项目的视觉语言' : '把美术方向变成执行规范'}</h1><p>完整展示可复制的颜色、字号、几何、材质、组件状态和构图规则。</p></div><div className="heading-actions">{artifact && <button className="button button--secondary" onClick={() => setEditing(!editing)}><Edit3 size={15} />{editing ? '返回规范' : '编辑规范'}</button>}{artifact && <StatusPill status={artifact.status} />}</div></section>
    <ReferenceWorkbench project={project} busy={busy} run={run} />
    {!artifact ? <EmptyArtifact title="风格规范尚未生成" copy={project.project_type === 'existing' && !references.length ? '请先添加至少一张参考图，并指定一张主参考。' : '先批准布局，再生成可复现的风格规范。'} /> : editing ? <div className="json-editor"><div><b>结构化风格规范</b><p>修改后会生成新版本，并让下游视觉探索标记为“需更新”。</p></div><textarea value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} spellCheck={false} />{jsonError && <span className="inline-error">{jsonError}</span>}<button className="button button--primary" onClick={save} disabled={busy}><Save size={15} />保存为新版本</button></div> : <><div className="style-board"><section className="style-identity"><span>视觉识别</span><h2>{displayText((artifact.visual_identity as Record<string, unknown>)?.theme || project.art_direction)}</h2><div className="tag-row">{(((artifact.visual_identity as Record<string, unknown>)?.mood as unknown[]) || []).map((item, index) => <i key={`${index}-${displayText(item)}`}>{displayText(item)}</i>)}</div><p>{displayText(artifact.designer_summary, '')}</p></section><section className="palette"><span>语义色彩系统</span><div>{colors.map(([name, rawValue]) => { const color = semanticColor(rawValue); return <figure key={name} title={color.usage || undefined}><i style={{ background: color.value }} /><figcaption><b>{name}</b><small>{color.value}</small>{color.usage && <em>{color.usage}</em>}</figcaption></figure>; })}</div></section><section className="style-rules"><span>可复现规则</span>{['materials', 'geometry', 'lighting', 'components', 'composition'].map((key) => <div key={key}><b>{fieldLabels[key]}</b><p>{ruleText(artifact[key])}</p></div>)}</section></div>{warnings.map((warning, index) => <div className="quality-warning" key={`${index}-${displayText(warning)}`}><AlertTriangle size={16} /><div><b>功能密度冲突</b><p>{displayText(warning)}</p></div></div>)}</>}
    {strict && artifact?.status === 'approved' && <StrictContinuationPanel project={project} busy={busy} run={run} />}
    </div>
    <div className="workspace-footer"><button className="button button--ghost" disabled={busy || !canGenerate} onClick={() => run(() => copilotApi.runStage(project.id, 'style_resolution', { confirmReferenceOmissions: project.artifacts.referencePack?.requires_omission_confirmation === true }), { label: project.artifacts.referencePack?.requires_omission_confirmation ? '确认省略项并解析风格' : artifact?.status === 'stale' ? '根据新参考重新解析风格' : '解析视觉风格', stage: 'style_resolution' })}><RefreshCw size={15} />{project.artifacts.referencePack?.requires_omission_confirmation ? '确认省略项并继续' : artifact?.status === 'stale' ? '参考已变化，重新解析' : artifact ? '重新解析' : '生成风格规范'}</button>{!canGenerate && <span className="stale-guidance">{(strict ? project.artifacts.screenContract?.status : project.artifacts.approvedLayout?.status) !== 'approved' ? (strict ? '请先批准功能契约。' : '请先批准布局。') : '已有项目必须先批准至少一张参考图及 Inventory。'}</span>}{artifact && artifact.status !== 'approved' && artifact.status !== 'stale' && <button className="button button--primary" disabled={busy} onClick={() => run(() => copilotApi.approveArtifact(project.id, 'style-contract'), { label: '批准并锁定风格', stage: 'style_resolution' })}><LockKeyhole size={16} />批准并锁定</button>}{artifact?.status === 'approved' && !strict && <button className="button button--primary" disabled={busy} onClick={() => run(() => copilotApi.runStage(project.id, 'visual_exploration'), { label: '生成 3 个视觉方向', stage: 'visual_exploration', total: 3 })}><WandSparkles size={16} />生成 3 个方向</button>}{artifact?.status === 'approved' && strict && <span className="stale-guidance">严格继承：先完成字体、组件与绑定，再生成组件感知布局。</span>}</div>
    </>;
}
