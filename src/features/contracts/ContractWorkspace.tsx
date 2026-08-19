import { useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Check, CheckSquare, Edit3, Layers3, MessageSquare, Plus, RefreshCw, Save, Search, Trash2, X
} from 'lucide-react';
import { copilotApi } from '../../api';
import type { ScreenControl } from '../../types';
import { CONTROL_ROLE_OPTIONS } from '../binding/BindingWorkbench';
import { EmptyArtifact, StatusPill, WireframeLightbox, WireframeReference, normalizeDraftControls, screenInput } from '../shared/ui';
import type { WorkspaceProps } from '../shared/ui';

type ContractCategoryKey = (typeof listFields)[number];
type ContractReviewStatus = 'unreviewed' | 'confirmed' | 'changed' | 'question';
type ContractDraft = { required_controls: ScreenControl[]; required_information: string[]; states: string[]; edge_cases: string[]; screen_name: string; purpose: string; primary_action: string };
type ContractReview = Record<ContractCategoryKey, ContractReviewStatus[]>;
type ContractEditingItem = { key: ContractCategoryKey; index: number; value: string; controlId?: string; role?: string; required?: boolean };

const listFields = ['required_controls', 'required_information', 'states', 'edge_cases'] as const;
const contractCategories = [
  { key: 'required_controls', label: '必需控件', eyebrow: 'CONTROLS', description: '玩家需要看到或操作的按钮、入口与控件' },
  { key: 'required_information', label: '必要信息', eyebrow: 'INFORMATION', description: '完成决策前必须理解的数据、提示与反馈' },
  { key: 'states', label: '交互状态', eyebrow: 'STATES', description: '页面、控件和流程在不同条件下的表现' },
  { key: 'edge_cases', label: '边界情况', eyebrow: 'EDGE CASES', description: '异常、冲突、空状态和失败后的处理规则' }
] as const;

// Contract workbench owns its own draft/review state; App only supplies the
// project snapshot and the shared run() progress/error boundary.
export function ContractWorkspace({ project, busy, run }: WorkspaceProps) {
  const artifact = project.artifacts.screenContract;
  const [activeCategory, setActiveCategory] = useState<ContractCategoryKey>('required_controls');
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ContractEditingItem | null>(null);
  const [wireframeOpen, setWireframeOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ContractReviewStatus>('all');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const makeDraft = (): ContractDraft => ({
    screen_name: String(artifact?.screen_name || ''), purpose: String(artifact?.purpose || ''), primary_action: String(artifact?.primary_action || ''),
    required_controls: normalizeDraftControls(artifact?.required_controls),
    required_information: Array.isArray(artifact?.required_information) ? (artifact.required_information as unknown[]).map(String) : [],
    states: Array.isArray(artifact?.states) ? (artifact.states as unknown[]).map(String) : [],
    edge_cases: Array.isArray(artifact?.edge_cases) ? (artifact.edge_cases as unknown[]).map(String) : []
  });
  const makeReview = (): ContractReview => {
    const stored = (artifact?.review_metadata || {}) as Partial<Record<ContractCategoryKey, unknown>>;
    return Object.fromEntries(listFields.map((key) => {
      const source = Array.isArray(stored[key]) ? stored[key] as unknown[] : [];
      const length = Array.isArray(artifact?.[key]) ? (artifact?.[key] as unknown[]).length : 0;
      return [key, Array.from({ length }, (_, index) => ['confirmed', 'changed', 'question'].includes(String(source[index])) ? source[index] as ContractReviewStatus : 'unreviewed')];
    })) as ContractReview;
  };
  const [draft, setDraft] = useState<ContractDraft>(makeDraft);
  const [review, setReview] = useState<ContractReview>(makeReview);
  useEffect(() => { setDraft(makeDraft()); setReview(makeReview()); setEditingItem(null); setCloseConfirm(false); }, [artifact?.id, artifact?.version]);
  useEffect(() => { setCategoryQuery(''); setStatusFilter('all'); setEditingItem(null); }, [activeCategory]);
  const baselineDraft = makeDraft();
  const baselineReview = makeReview();
  const dirty = JSON.stringify(draft) !== JSON.stringify(baselineDraft) || JSON.stringify(review) !== JSON.stringify(baselineReview);
  const itemsFor = (key: ContractCategoryKey) => draft[key];
  const reviewFor = (key: ContractCategoryKey) => review[key] || [];
  const openWorkbench = (key: ContractCategoryKey) => { setActiveCategory(key); setSummaryOpen(false); setWorkbenchOpen(true); setCloseConfirm(false); };
  const requestCloseWorkbench = () => { if (dirty) setCloseConfirm(true); else setWorkbenchOpen(false); };
  const discardAndClose = () => { setDraft(makeDraft()); setReview(makeReview()); setEditingItem(null); setSummaryOpen(false); setCloseConfirm(false); setWorkbenchOpen(false); };
  const commitItem = () => {
    if (!editingItem || !editingItem.value.trim()) return;
    const value = editingItem.value.trim();
    setDraft((current) => {
      if (editingItem.key === 'required_controls') {
        const control = {
          id: String(editingItem.controlId || '').trim(), label: value,
          // Roles use the controlled binding-policy vocabulary; the generic
          // legacy 'action' role can never be (re)assigned to a control.
          role: CONTROL_ROLE_OPTIONS.includes(String(editingItem.role || '')) ? String(editingItem.role).trim() : 'primary-action',
          required: editingItem.required !== false
        };
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(control.id)) return current;
        return { ...current, required_controls: editingItem.index < 0 ? [...current.required_controls, control] : current.required_controls.map((item, index) => index === editingItem.index ? { ...item, ...control } : item) };
      }
      const key = editingItem.key as 'required_information' | 'states' | 'edge_cases';
      return { ...current, [key]: editingItem.index < 0 ? [...current[key], value] : current[key].map((item, index) => index === editingItem.index ? value : item) };
    });
    setReview((current) => ({ ...current, [editingItem.key]: editingItem.index < 0 ? [...current[editingItem.key], 'changed'] : current[editingItem.key].map((status, index) => index === editingItem.index ? 'changed' : status) }));
    setEditingItem(null);
  };
  const removeItem = (key: ContractCategoryKey, index: number) => {
    setDraft((current) => ({ ...current, [key]: current[key].filter((_, itemIndex) => itemIndex !== index) }));
    setReview((current) => ({ ...current, [key]: current[key].filter((_, itemIndex) => itemIndex !== index) }));
  };
  const setItemStatus = (key: ContractCategoryKey, index: number, status: ContractReviewStatus) => setReview((current) => ({ ...current, [key]: current[key].map((item, itemIndex) => itemIndex === index ? status : item) }));
  const saveWorkbench = async () => {
    if (!artifact || !dirty) return;
    const result = await run(() => copilotApi.updateArtifact(project.id, 'screen-contract', screenInput(project, { ...draft, review_metadata: review })), { label: '保存本轮功能契约检查', stage: 'wireframe_interpretation' });
    if (result) { setWorkbenchOpen(false); setCloseConfirm(false); }
  };
  const activeDefinition = contractCategories.find((item) => item.key === activeCategory)!;
  const activeItems = itemsFor(activeCategory);
  const itemLabel = (item: string | ScreenControl) => typeof item === 'string' ? item : item.label;
  const filteredActiveItems = activeItems.map((item, index) => ({ item, index, status: reviewFor(activeCategory)[index] || 'unreviewed' })).filter(({ item, status }) => itemLabel(item).toLowerCase().includes(categoryQuery.trim().toLowerCase()) && (statusFilter === 'all' || status === statusFilter));
  const reviewStats = (key: ContractCategoryKey) => {
    const statuses = reviewFor(key);
    return { reviewed: statuses.filter((status) => status !== 'unreviewed').length, changed: statuses.filter((status) => status === 'changed').length, questions: statuses.filter((status) => status === 'question').length };
  };
  const statusCopy: Record<ContractReviewStatus, string> = { unreviewed: '未检查', confirmed: '已确认', changed: '已调整', question: '有疑问' };
  return <>
    <div className="workspace-content">
    <section className="workspace-heading contract-heading"><div><span className="kicker">01 · FUNCTION CONTRACT</span><h1>校对功能页面契约</h1><p>先看四类信息的检查进度，再进入专注工作台连续核对；整轮修改只生成一个新版本。</p></div>{artifact && <StatusPill status={artifact.status} />}</section>
    {!artifact ? <EmptyArtifact title={busy ? '正在生成功能契约' : '尚未生成功能契约'} copy={busy ? 'AI 正在结合已确认的设计意图读取 UE；完成后会自动展示四类关键信息。' : '回到项目输入，导入 UE Wireframe 后开始功能解读。'} /> : <><section className="contract-overview">
      <div className="contract-overview-main"><span>页面名称</span><div className="summary-value"><h2>{String(artifact.screen_name)}</h2></div><span>页面目的</span><div className="summary-value"><p>{String(artifact.purpose)}</p></div></div>
      <div className="primary-action-card"><span>核心动作</span><b>{String(artifact.primary_action)}</b></div>
    </section>
    {Boolean(artifact.coverage) && <div className="coverage-strip"><CheckSquare size={17} /><b>UE 来源覆盖校验通过</b><span>{((artifact.coverage as Record<string, unknown>).covered_items as string[])?.length || 0} 项已映射，0 项遗漏</span></div>}
    <section className="contract-category-overview"><header><div><span>四类关键信息</span><h3>选择一类开始检查</h3></div><small>进入后可连续滚动全部条目，无需翻页</small></header><div>{contractCategories.map((category) => { const stats = reviewStats(category.key); const total = itemsFor(category.key).length; return <button key={category.key} onClick={() => openWorkbench(category.key)}><span>{category.eyebrow}</span><div><h3>{category.label}</h3><em>{total} 项</em></div><p>{category.description}</p><footer><b>{stats.reviewed} / {total} 已检查</b><i style={{ '--progress': `${total ? stats.reviewed / total * 100 : 0}%` } as React.CSSProperties} /><small>{stats.changed ? `${stats.changed} 项修改` : '暂无修改'}{stats.questions ? ` · ${stats.questions} 项疑问` : ''}</small></footer><strong>检查与调整 <ArrowRight size={16} /></strong></button>; })}</div></section></>}
    </div>
    {artifact && <div className="workspace-footer"><button className="button button--ghost" data-testid="contract-rerun" disabled={busy} onClick={() => run(() => copilotApi.runStage(project.id, 'wireframe_interpretation'), { label: artifact.status === 'stale' ? '根据新输入重新解读功能' : '重新解读功能', stage: 'wireframe_interpretation' })}><RefreshCw size={16} />{artifact.status === 'stale' ? '输入已变化，重新解读' : '重新解读'}</button>{artifact.status === 'stale' ? <span className="stale-guidance">上游输入已变化，旧契约不能再次批准。</span> : artifact.status !== 'approved' ? <button className="button button--primary" data-testid="contract-approve" disabled={busy} onClick={() => run(() => copilotApi.approveArtifact(project.id, 'screen-contract'), { label: '批准功能契约', stage: 'wireframe_interpretation' })}><Check size={17} />批准功能契约</button> : <button className="button button--primary" data-testid="layout-generate" disabled={busy} onClick={() => run(() => copilotApi.runStage(project.id, 'layout_design'), { label: '生成布局提案', stage: 'layout_design' })}><Layers3 size={17} />生成布局提案</button>}</div>}
    {artifact && workbenchOpen && <div className="contract-focus-backdrop"><section className={`contract-focus-workbench ${summaryOpen ? 'has-summary' : ''}`}><header className="focus-header"><div><span>01 · CONTRACT REVIEW</span><h2>功能契约专注检查</h2><p>所有修改先保存在本轮草稿中，点击“保存本轮修改”后统一生成一个版本。</p></div><div><span className={dirty ? 'draft-state is-dirty' : 'draft-state'}>{dirty ? '有未保存修改' : '当前内容已保存'}</span><button className="icon-button" onClick={requestCloseWorkbench} aria-label="关闭专注检查"><X size={20} /></button></div></header>
      <nav className="focus-tabs" aria-label="功能契约分类">{contractCategories.map((category) => { const stats = reviewStats(category.key); return <button key={category.key} className={activeCategory === category.key ? 'is-active' : ''} onClick={() => setActiveCategory(category.key)}><span>{category.eyebrow}</span><b>{category.label}</b><em>{stats.reviewed}/{itemsFor(category.key).length}</em></button>; })}</nav>
      {summaryOpen && <section className="focus-summary-editor"><label><span>页面名称</span><input value={draft.screen_name} onChange={(event) => setDraft({ ...draft, screen_name: event.target.value })} /></label><label><span>核心动作</span><input value={draft.primary_action} onChange={(event) => setDraft({ ...draft, primary_action: event.target.value })} /></label><label className="span-2"><span>页面目的</span><textarea value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value })} /></label></section>}
      <div className="focus-body"><main className="focus-list-panel"><header className="focus-category-heading"><div><span>{activeDefinition.eyebrow}</span><h3>{activeDefinition.label}<em>{activeItems.length} 项</em></h3><p>{activeDefinition.description}</p></div><button className="button button--secondary" onClick={() => setSummaryOpen((current) => !current)}><Edit3 size={15} />{summaryOpen ? '收起页面摘要' : '编辑页面摘要'}</button></header>
        <div className="focus-tools"><label className="category-search"><Search size={16} /><input value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} placeholder={`搜索全部${activeDefinition.label}`} /></label><div className="status-filters">{([['all', '全部'], ['unreviewed', '未检查'], ['confirmed', '已确认'], ['changed', '已修改'], ['question', '有疑问']] as const).map(([value, label]) => <button key={value} className={statusFilter === value ? 'is-active' : ''} onClick={() => setStatusFilter(value)}>{label}</button>)}</div></div>
        <div className="focus-items">{filteredActiveItems.length ? filteredActiveItems.map(({ item, index, status }) => editingItem?.key === activeCategory && editingItem.index === index ? <div className="focus-item is-editing" key={`${activeCategory}-${index}`}>{activeCategory === 'required_controls' && <div className="control-identity-fields"><label><span>稳定 ID</span><input value={editingItem.controlId || ''} onChange={(event) => setEditingItem({ ...editingItem, controlId: event.target.value })} /></label><label><span>语义角色</span><select value={CONTROL_ROLE_OPTIONS.includes(editingItem.role || '') ? editingItem.role : ''} onChange={(event) => setEditingItem({ ...editingItem, role: event.target.value })}><option value="" disabled>选择具体角色（不得为 action）</option>{CONTROL_ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}</select></label><label><input type="checkbox" checked={editingItem.required !== false} onChange={(event) => setEditingItem({ ...editingItem, required: event.target.checked })} />必需控件</label></div>}<textarea autoFocus value={editingItem.value} onChange={(event) => setEditingItem({ ...editingItem, value: event.target.value })} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') commitItem(); if (event.key === 'Escape') setEditingItem(null); }} /><div><small>⌘ Enter 保存</small><button className="button button--primary" onClick={commitItem} disabled={!editingItem.value.trim() || (activeCategory === 'required_controls' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(editingItem.controlId || ''))}><Save size={15} />保存条目</button><button className="button button--ghost" onClick={() => setEditingItem(null)}>取消</button></div></div> : <article className={`focus-item status-${status}`} key={`${activeCategory}-${index}-${itemLabel(item)}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{itemLabel(item)}{typeof item !== 'string' && <small className="control-id-copy">{item.id} · {item.role}{item.role === 'action' ? '（待语义解析）' : ''} · {item.required ? '必需' : '可选'}</small>}</p><div className="item-status"><em>{statusCopy[status]}</em><button className={status === 'confirmed' ? 'is-active' : ''} title="标记为已确认" onClick={() => setItemStatus(activeCategory, index, 'confirmed')}><Check size={15} /></button><button className={status === 'question' ? 'is-active is-question' : ''} title="标记为有疑问" onClick={() => setItemStatus(activeCategory, index, 'question')}><MessageSquare size={15} /></button><button title="编辑条目" onClick={() => setEditingItem({ key: activeCategory, index, value: itemLabel(item), ...(typeof item === 'string' ? {} : { controlId: item.id, role: item.role, required: item.required }) })}><Edit3 size={15} /></button><button className="is-delete" title="删除条目" onClick={() => removeItem(activeCategory, index)}><Trash2 size={15} /></button></div></article>) : <div className="contract-items-empty">没有匹配条目，可以切换筛选条件或新增条目。</div>}</div>
        <div className="focus-add">{editingItem?.key === activeCategory && editingItem.index < 0 ? <div className="focus-item is-editing is-new">{activeCategory === 'required_controls' && <div className="control-identity-fields"><label><span>稳定 ID</span><input autoFocus placeholder="例如 confirm-purchase" value={editingItem.controlId || ''} onChange={(event) => setEditingItem({ ...editingItem, controlId: event.target.value })} /></label><label><span>语义角色</span><select value={CONTROL_ROLE_OPTIONS.includes(editingItem.role || '') ? editingItem.role : ''} onChange={(event) => setEditingItem({ ...editingItem, role: event.target.value })}><option value="" disabled>选择具体角色（不得为 action）</option>{CONTROL_ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}</select></label><label><input type="checkbox" checked={editingItem.required !== false} onChange={(event) => setEditingItem({ ...editingItem, required: event.target.checked })} />必需控件</label></div>}<textarea autoFocus={activeCategory !== 'required_controls'} placeholder={`输入新的${activeDefinition.label}标签`} value={editingItem.value} onChange={(event) => setEditingItem({ ...editingItem, value: event.target.value })} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') commitItem(); if (event.key === 'Escape') setEditingItem(null); }} /><div><button className="button button--primary" onClick={commitItem} disabled={!editingItem.value.trim() || (activeCategory === 'required_controls' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(editingItem.controlId || ''))}><Save size={15} />加入草稿</button><button className="button button--ghost" onClick={() => setEditingItem(null)}>取消</button></div></div> : <button className="add-contract-item" onClick={() => setEditingItem({ key: activeCategory, index: -1, value: '', ...(activeCategory === 'required_controls' ? { controlId: `control-${draft.required_controls.length + 1}`, role: 'primary-action', required: true } : {}) })}><Plus size={18} />新增{activeDefinition.label}条目</button>}</div>
      </main><aside className="focus-reference"><WireframeReference project={project} onOpen={() => setWireframeOpen(true)} /></aside></div>
      <footer className="focus-footer"><div><b>{filteredActiveItems.length} 项当前可见</b><span>连续滚动浏览，不再分页</span></div><div><button className="button button--ghost" onClick={requestCloseWorkbench}>关闭</button><button className="button button--primary" disabled={busy || !dirty || !draft.screen_name.trim() || !draft.purpose.trim() || !draft.primary_action.trim()} onClick={saveWorkbench}><Save size={16} />{dirty ? '保存本轮修改' : '暂无待保存更改'}</button></div></footer>
      {closeConfirm && <div className="focus-close-confirm" role="dialog" aria-modal="true" aria-labelledby="close-confirm-title"><section><i><AlertTriangle size={22} /></i><div><span>UNSAVED CHANGES</span><h3 id="close-confirm-title">要保存本轮修改吗？</h3><p>当前草稿尚未写入项目版本。你可以先保存并关闭，也可以放弃这些修改。</p></div><footer><button className="button button--ghost" onClick={() => setCloseConfirm(false)}>继续检查</button><button className="button button--danger" onClick={discardAndClose}>不保存并关闭</button><button className="button button--primary" disabled={busy || !draft.screen_name.trim() || !draft.purpose.trim() || !draft.primary_action.trim()} onClick={saveWorkbench}><Save size={16} />保存并关闭</button></footer></section></div>}
    </section></div>}
    {wireframeOpen && <WireframeLightbox project={project} onClose={() => setWireframeOpen(false)} />}
    </>;
}
