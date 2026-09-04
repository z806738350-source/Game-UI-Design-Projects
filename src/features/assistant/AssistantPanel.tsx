import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, LoaderCircle, Pencil, Plus, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { copilotApi } from '../../api';
import type { AssistantAction, AssistantConversation, AssistantConversationMeta, AssistantMode, AssistantRun, DesignProject } from '../../types';
import { Dropdown, Modal, friendlyError, statusLabel } from '../shared/ui';

const unfinishedStatuses = new Set(['queued', 'running', 'awaiting_confirmation', 'executing']);

function latestRun(conversation: AssistantConversation | null) {
  return conversation?.runs.at(-1) || null;
}

function actionButtonClass(action: AssistantAction) {
  return action.risk.replaces_content || !action.risk.reversible ? 'button--danger' : 'button--secondary';
}

function changedLabel(kind: string) {
  return ({ input_revision: '输入版本', artifact_version: '产物版本', artifact_status: '产物状态' } as Record<string, string>)[kind] || '项目状态';
}

function changedKey(key: string) {
  return ({ intent_review: '意图审查' } as Record<string, string>)[key] || key.replaceAll('_', ' ');
}

function displayChangedValue(value: string | number) {
  return typeof value === 'string' ? statusLabel(value) : String(value);
}

function ActionCard({ run, binding, disabled, busy, onConfirm, onCancel, onRegenerate }: {
  run: AssistantRun;
  binding: AssistantConversationMeta;
  disabled: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onRegenerate: () => void;
}) {
  const action = run.proposed_action;
  if (!action && !run.error) return null;
  const stateClass = run.status === 'executing' ? 'is-thinking' : run.status === 'succeeded' ? 'is-succeeded' : run.status === 'stale' ? 'is-stale' : ['failed', 'interrupted'].includes(run.status) ? 'is-failed' : '';
  return <section className={`assistant-panel__action-card ${stateClass}`} aria-label={action?.label || '助手运行结果'}>
    <header><div><span>ACTION</span><b>{action?.label || '本次运行未完成'}</b></div><strong>{statusLabel(run.status)}</strong></header>
    {action && <><p>{action.reason}</p><dl><div><dt>目标项目</dt><dd title={binding.project_id}>{binding.project_id}</dd></div><div><dt>目标 Screen</dt><dd title={binding.screen_id}>{binding.screen_id}</dd></div><div><dt>读取对象</dt><dd>当前项目与 Screen 上下文</dd></div><div><dt>写入对象</dt><dd>意图审查与需求文本</dd></div>{Object.entries(run.context.input_revisions).map(([key, value]) => <div key={`input:${key}`}><dt>{changedKey(key)}提议版本</dt><dd>{value}</dd></div>)}{Object.entries(run.context.artifact_versions).map(([key, value]) => <div key={`artifact:${key}`}><dt>{key.replaceAll('_', ' ')}提议版本</dt><dd>{value}</dd></div>)}<div><dt>替换内容</dt><dd>{action.risk.replaces_content ? '是' : '否'}</dd></div><div><dt>可撤销</dt><dd>{action.risk.reversible ? '是' : '否'}</dd></div><div><dt>外部费用</dt><dd>{action.risk.external_cost ? '可能产生' : '无'}</dd></div></dl></>}
    {action?.risk.external_cost && <p className="assistant-panel__neutral-note">本动作会调用图像模型，可能产生费用。</p>}
    {run.error && <div className="assistant-panel__run-error" role="alert"><b>{statusLabel(run.status)}</b><span>{run.error.message}</span>{run.error.changed?.map((item) => <small key={`${item.kind}:${item.key}`}>{changedLabel(item.kind)} · {changedKey(item.key)}：{displayChangedValue(item.expected)} → {displayChangedValue(item.actual)}</small>)}</div>}
    {run.status === 'awaiting_confirmation' && action && <div className="assistant-panel__action-buttons"><button className="button button--ghost" type="button" disabled={busy || disabled} onClick={onCancel}>取消待执行动作</button><button className={`button ${actionButtonClass(action)}`} type="button" disabled={busy || disabled} onClick={onConfirm}><Check size={15} />确认执行</button></div>}
    {run.status === 'stale' && <div className="assistant-panel__action-buttons"><button className="button button--ghost" type="button" disabled={busy || disabled} onClick={onRegenerate}><RefreshCw size={15} />重新生成计划</button></div>}
  </section>;
}

export function AssistantPanel({ project, open, inert, onClose, onProjectRefresh }: {
  project: DesignProject | null;
  open: boolean;
  inert: boolean;
  onClose: () => void;
  onProjectRefresh?: (projectId: string, screenId: string) => Promise<void>;
}) {
  const [conversations, setConversations] = useState<AssistantConversationMeta[]>([]);
  const [conversation, setConversation] = useState<AssistantConversation | null>(null);
  const [mode, setMode] = useState<AssistantMode>('qa');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  const run = latestRun(conversation);
  const targetMatches = Boolean(project && conversation && conversation.meta.project_id === project.id && conversation.meta.screen_id === project.screen_id);
  const hasUnfinished = Boolean(conversation?.runs.some((item) => unfinishedStatuses.has(item.status))
    || conversations.some((item) => item.has_pending_action));

  const refreshList = async () => {
    const result = await copilotApi.listAssistantConversations();
    setConversations(result.conversations);
    setWarning(result.warnings.length ? '有损坏的对话未加入列表，可在本地助手数据目录中检查。' : '');
    return result.conversations;
  };

  const selectConversation = async (conversationId: string) => {
    setBusy(true); setError('');
    try {
      const next = await copilotApi.openAssistantConversation(conversationId);
      setConversation(next); setTitle(next.meta.title); setRenaming(false);
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    let active = true;
    copilotApi.listAssistantConversations().then(async (result) => {
      if (!active) return;
      const next = result.conversations[0]
        ? await copilotApi.openAssistantConversation(result.conversations[0].conversation_id)
        : null;
      if (active) {
        setConversations(result.conversations);
        setWarning(result.warnings.length ? '有损坏的对话未加入列表，可在本地助手数据目录中检查。' : '');
        setConversation(next);
        setTitle(next?.meta.title || '');
      }
    }).catch((cause) => { if (active) setError(friendlyError(cause)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (open && messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [open, conversation?.messages.length, run?.status, thinking]);

  const createConversation = async () => {
    if (!project) return;
    setBusy(true); setError('');
    try {
      const next = await copilotApi.createAssistantConversation({ projectId: project.id, screenId: project.screen_id });
      setConversation(next); setTitle(next.meta.title); setRenaming(false);
      await refreshList();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };

  const saveTitle = async () => {
    if (!conversation || !title.trim() || title.trim() === conversation.meta.title) { setTitle(conversation?.meta.title || ''); setRenaming(false); return; }
    setBusy(true); setError('');
    try {
      const next = await copilotApi.renameAssistantConversation(conversation.meta.conversation_id, title.trim());
      setConversation(next); setTitle(next.meta.title); setRenaming(false); await refreshList();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };

  const deleteConversation = async () => {
    if (!conversation) return;
    const deletingId = conversation.meta.conversation_id;
    setBusy(true); setError('');
    try {
      await copilotApi.deleteAssistantConversation(deletingId);
      setDeleteOpen(false);
      const nextList = await refreshList();
      if (nextList[0]) {
        const next = await copilotApi.openAssistantConversation(nextList[0].conversation_id);
        setConversation(next); setTitle(next.meta.title);
      } else { setConversation(null); setTitle(''); }
    } catch (cause) { setError(friendlyError(cause)); setDeleteOpen(false); }
    finally { setBusy(false); }
  };

  const submit = async (nextContent = content, nextMode = mode) => {
    if (!conversation || !targetMatches || !nextContent.trim()) return;
    const conversationId = conversation.meta.conversation_id;
    setBusy(true); setThinking(true); setError('');
    if (nextContent === content) setContent('');
    try {
      const next = await copilotApi.sendAssistantMessage(conversationId, { mode: nextMode, content: nextContent.trim(), projectId: project!.id, screenId: project!.screen_id });
      setConversation((current) => current?.meta.conversation_id === conversationId ? next : current);
      await refreshList();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setThinking(false); setBusy(false); }
  };

  const updateAction = async (operation: 'confirm' | 'cancel') => {
    if (!conversation || !run?.proposed_action || !targetMatches) return;
    const conversationId = conversation.meta.conversation_id;
    setBusy(true); setError('');
    try {
      const next = operation === 'confirm'
        ? await copilotApi.confirmAssistantAction(conversationId, run.run_id, run.proposed_action.action_id)
        : await copilotApi.cancelAssistantAction(conversationId, run.run_id, run.proposed_action.action_id);
      setConversation((current) => current?.meta.conversation_id === conversationId ? next : current);
      await refreshList();
      if (operation === 'confirm' && onProjectRefresh) {
        try { await onProjectRefresh(conversation.meta.project_id, conversation.meta.screen_id); }
        catch { setError('动作结果已经保存，但项目视图刷新失败。请重新打开当前项目查看最新状态。'); }
      }
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };

  const conversationOptions = useMemo(() => conversations.map((item) => ({
    value: item.conversation_id,
    label: `${item.has_pending_action ? '待确认执行 · ' : ''}${item.title}`,
    className: item.has_pending_action ? 'is-pending' : undefined
  })), [conversations]);

  return <aside className="assistant-panel" hidden={!open} inert={inert} aria-label="内嵌智能 AI 助手" data-testid="assistant-panel">
    <header className="assistant-panel__head"><div><span>AI ASSISTANT</span><h2>内嵌智能助手</h2></div><button className="icon-button" type="button" aria-label="关闭助手" onClick={onClose}><X size={18} /></button></header>
    <div className="assistant-panel__list">
      <Dropdown testId="assistant-conversation-switch" ariaLabel="切换助手对话" value={conversation?.meta.conversation_id || ''} placeholder="尚无对话" options={conversationOptions} disabled={busy} onChange={(id) => void selectConversation(id)} />
      <button className="button button--secondary button--icon" type="button" aria-label="为当前项目和 Screen 新建对话" title="新建对话" disabled={busy || !project || Boolean(hasUnfinished)} onClick={() => void createConversation()}><Plus size={16} /></button>
    </div>
    {conversation && <div className="assistant-panel__conversation-tools">
      {renaming ? <form onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}><input autoFocus aria-label="对话标题" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} /><button className="button button--ghost button--small" disabled={busy || !title.trim()}>保存</button></form> : <b title={conversation.meta.title}>{conversation.meta.title}</b>}
      {!renaming && <button className="icon-button" type="button" aria-label="重命名对话" disabled={busy} onClick={() => setRenaming(true)}><Pencil size={14} /></button>}
      <button className="icon-button" type="button" aria-label="删除对话" disabled={busy || Boolean(run && unfinishedStatuses.has(run.status))} onClick={() => setDeleteOpen(true)}><Trash2 size={14} /></button>
    </div>}
    {conversation && !targetMatches && <div className="assistant-panel__neutral-note" role="status">该对话绑定的是另一个项目或 Screen，可查看但无法继续。<button className="button button--secondary button--small" disabled={busy || !project || Boolean(hasUnfinished)} onClick={() => void createConversation()}>为当前目标新建对话</button></div>}
    {warning && <div className="assistant-panel__local-error" role="status"><span>{warning}</span></div>}
    {error && <div className="assistant-panel__local-error" role="alert"><b>助手操作失败</b><span>{error}</span><button type="button" aria-label="关闭助手错误" onClick={() => setError('')}>×</button></div>}
    <div ref={messagesRef} className="assistant-panel__messages" aria-live="polite">
      {!conversation ? <div className="assistant-panel__empty"><Bot size={26} /><b>从当前设计上下文开始</b><p>{project ? `当前目标：${project.name} · ${project.screen_id}` : '请先建立或打开项目。'}</p><button className="button button--secondary" disabled={busy || !project} onClick={() => void createConversation()}><Plus size={15} />新建对话</button></div> : <>
        {conversation.messages.map((message) => <article key={message.id} className={`assistant-panel__message assistant-panel__message--${message.role}`}><span>{message.role === 'user' ? '你' : 'AI 助手'}</span><p>{message.content}</p></article>)}
        {thinking && <div className="assistant-panel__thinking" role="status"><LoaderCircle className="spin" size={14} />正在思考…</div>}
        {conversation.runs.map((item) => <ActionCard key={item.run_id} run={item} binding={conversation.meta} disabled={!targetMatches} busy={busy} onConfirm={() => void updateAction('confirm')} onCancel={() => void updateAction('cancel')} onRegenerate={() => void submit('请基于最新项目状态重新生成可执行计划。', 'execute')} />)}
      </>}
    </div>
    {conversation && <footer className="assistant-panel__composer"><div className="assistant-panel__mode" role="group" aria-label="助手模式"><button type="button" className={mode === 'qa' ? 'is-active' : ''} onClick={() => setMode('qa')}>问答</button><button type="button" className={mode === 'execute' ? 'is-active' : ''} onClick={() => setMode('execute')}>执行</button></div><label><span>输入消息</span><textarea value={content} disabled={busy || !targetMatches || Boolean(run && unfinishedStatuses.has(run.status))} maxLength={20_000} placeholder={targetMatches ? '询问当前项目，或让助手准备一个可确认的动作…' : '请为当前项目与 Screen 新建对话'} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} /></label><button className="button button--secondary" type="button" disabled={busy || !targetMatches || !content.trim() || Boolean(run && unfinishedStatuses.has(run.status))} onClick={() => void submit()}>{thinking ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}发送</button></footer>}
    {deleteOpen && conversation && <Modal title="删除对话" copy={`将移除「${conversation.meta.title}」及其完整消息和运行记录。`} onClose={() => setDeleteOpen(false)}><p className="settings-note">对话会移入本地助手回收目录，不会修改任何项目数据。</p><div className="dialog-actions"><button className="button button--ghost" type="button" onClick={() => setDeleteOpen(false)}>取消</button><button className="button button--danger" type="button" disabled={busy} onClick={() => void deleteConversation()}><Trash2 size={15} />删除对话</button></div></Modal>}
  </aside>;
}
