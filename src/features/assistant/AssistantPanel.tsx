import { useEffect, useId, useRef, useState } from 'react';
import { Bot, ChevronDown, ImagePlus, Check, LoaderCircle, Pencil, Plus, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { copilotApi } from '../../api';
import type { AssistantAction, AssistantAttachment, AssistantConversation, AssistantConversationMeta, AssistantRun, DesignProject, IntentReview } from '../../types';
import { Modal, friendlyError, statusLabel } from '../shared/ui';
import type { StageId } from '../shared/ui';

import { asStructuredReview, INTENT_LIST_SECTIONS, INTENT_SECTION_META, UNCERTAINTY_STATUS_META } from '../input/intentModel';

const unfinishedStatuses = new Set(['queued', 'running', 'awaiting_confirmation', 'executing']);

function ConversationMenu({ conversations, current, busy, open, onSelect, onRename, onDelete }: {
  conversations: AssistantConversationMeta[]; current: AssistantConversation | null; busy: boolean; open: boolean;
  onSelect: (id: string) => void; onRename: (item: AssistantConversationMeta) => void; onDelete: (item: AssistantConversationMeta) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = () => { setExpanded(false); trigger.current?.focus(); };
  useEffect(() => { if (!open || busy) setExpanded(false); }, [open, busy]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setExpanded(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [expanded]);
  const label = (item: AssistantConversationMeta) => `${item.message_error ? '记录损坏 · ' : ''}${item.has_pending_action ? '待确认执行 · ' : ''}${item.title}`;
  const selected = conversations.find((item) => item.conversation_id === current?.meta.conversation_id);
  return <div className="dropdown assistant-panel__conversation-menu" ref={root} data-testid="assistant-conversation-switch" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false); }} onKeyDown={(event) => {
    if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <button ref={trigger} type="button" className={`dropdown-button${selected?.has_pending_action ? ' is-pending' : ''}`} aria-label="切换助手对话" aria-expanded={expanded} aria-controls={menuId} disabled={busy} onClick={() => setExpanded(!expanded)}><span>{selected ? label(selected) : current?.meta.title || '尚无对话'}</span><ChevronDown size={14} /></button>
    {expanded && <div className="dropdown-menu" id={menuId} role="group" aria-label="对话列表">
      {conversations.map((item) => {
        const selected = item.conversation_id === current?.meta.conversation_id;
        const unfinished = item.has_pending_action || (selected && current.runs.some((run) => unfinishedStatuses.has(run.status)));
        return <div key={item.conversation_id} className={`assistant-panel__conversation-row${selected ? ' is-selected' : ''}`}>
          <button type="button" className="dropdown-option" data-value={item.conversation_id} aria-pressed={selected} title={label(item)} onClick={() => { close(); if (!selected) onSelect(item.conversation_id); }}><Check size={12} className="dropdown-check" /><span>{label(item)}</span></button>
          <button type="button" className="icon-button" aria-label={`重命名对话「${item.title}」`} title="重命名对话" onClick={() => { close(); onRename(item); }}><Pencil size={14} /></button>
          <button type="button" className="icon-button" aria-label={`删除对话「${item.title}」`} title={unfinished ? '请先结束此对话的待执行动作' : '删除对话'} disabled={Boolean(unfinished)} onClick={() => { close(); onDelete(item); }}><Trash2 size={14} /></button>
        </div>;
      })}
      {!conversations.length && <p className="dropdown-option">暂无对话</p>}
    </div>}
  </div>;
}

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
  return ({ intent_review: '意图审查', requirement: '需求文本' } as Record<string, string>)[key] || key.replaceAll('_', ' ');
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
  const draft = asStructuredReview(action?.args.draft as IntentReview | undefined);
  if (!action && !run.error) return null;
  const stateClass = run.status === 'executing' ? 'is-thinking' : run.status === 'succeeded' ? 'is-succeeded' : run.status === 'stale' ? 'is-stale' : ['failed', 'interrupted'].includes(run.status) ? 'is-failed' : '';
  return <section className={`assistant-panel__action-card ${stateClass}`} data-pending-action={run.status === 'awaiting_confirmation'} aria-label={action?.label || '助手运行结果'}>
    <header><div><span>ACTION</span><b>{action?.label || '本次运行未完成'}</b></div><strong>{run.status === 'cancelled' && action ? '已拒绝执行' : statusLabel(run.status)}</strong></header>
    {action && <><p>{action.reason}</p><p>目标：{action.review?.project_name || binding.project_id} · {action.review?.screen_name || binding.screen_id}</p><details className="assistant-panel__action-details"><summary>写入范围、风险与版本</summary><dl><div><dt>目标项目</dt><dd title={binding.project_id}>{action.review?.project_name || binding.project_id}</dd></div><div><dt>目标 Screen</dt><dd title={binding.screen_id}>{action.review?.screen_name || binding.screen_id}</dd></div><div><dt>读取对象</dt><dd>当前项目与 Screen 上下文</dd></div><div><dt>写入对象</dt><dd>意图审查与需求文本</dd></div>{Object.entries(run.context.input_revisions).map(([key, value]) => <div key={`input:${key}`}><dt>{changedKey(key)}提议版本</dt><dd>{value}</dd></div>)}{Object.entries(run.context.artifact_versions).map(([key, value]) => <div key={`artifact:${key}`}><dt>{key.replaceAll('_', ' ')}提议版本</dt><dd>{value}</dd></div>)}<div><dt>替换内容</dt><dd>{action.risk.replaces_content ? '是' : '否'}</dd></div><div><dt>可撤销</dt><dd>{action.risk.reversible ? '是' : '否'}</dd></div><div><dt>外部费用</dt><dd>{action.risk.external_cost ? '可能产生' : '无'}</dd></div></dl></details></>}
    {action && draft && <div className="assistant-panel__draft" aria-label="拟保存的完整草稿">
      <b>确认后将整版替换为以下草稿</b>
      <p>只保存草稿，需求仍需在项目输入中检查并确认。</p>
      {action.review && <details><summary>对照修改前内容{action.review.before_truncated ? '（仅展示前 8000 字）' : ''}</summary><pre>{action.review.before || '原内容为空'}</pre></details>}
      <h4>页面目的</h4><p>{draft.page_purpose.text || '暂无内容'}</p>
      {INTENT_LIST_SECTIONS.map((section) => <section key={section}><h4>{INTENT_SECTION_META[section].title}</h4>{draft[section].length ? <ol>{draft[section].map((item) => <li key={item.id}>{item.text}</li>)}</ol> : <p>暂无内容</p>}</section>)}
      <h4>待确认项</h4>{draft.uncertainties.length ? <ul>{draft.uncertainties.map((item) => <li key={item.id}>{item.question}<small> · {UNCERTAINTY_STATUS_META[item.review_status]?.label || item.review_status}{item.priority === 'blocking' ? ' · 阻断项' : ''}</small>{item.note && <p>补充：{item.note}</p>}</li>)}</ul> : <p>本草稿未列出待确认项，请检查是否有遗漏。</p>}
    </div>}
    {action?.risk.external_cost && <p className="assistant-panel__neutral-note">本动作会调用图像模型，可能产生费用。</p>}
    {run.status === 'cancelled' && action && <p>你已拒绝此方案，未执行。可以继续补充需求或提出其他问题。</p>}
    {run.error && <div className="assistant-panel__run-error" role="alert"><b>{statusLabel(run.status)}</b><span>{run.error.message}</span>{run.error.changed?.map((item) => <small key={`${item.kind}:${item.key}`}>{changedLabel(item.kind)} · {changedKey(item.key)}：{displayChangedValue(item.expected)} → {displayChangedValue(item.actual)}</small>)}</div>}
    {run.status === 'awaiting_confirmation' && action && <div className="assistant-panel__action-buttons"><button className="button button--ghost" type="button" disabled={busy} onClick={onCancel}>拒绝执行</button><button className={`button ${actionButtonClass(action)}`} type="button" disabled={busy || disabled} onClick={onConfirm}><Check size={15} />确认执行</button></div>}
    {run.status === 'stale' && <div className="assistant-panel__action-buttons"><button className="button button--ghost" type="button" disabled={busy || disabled} onClick={onRegenerate}><RefreshCw size={15} />重新生成计划</button></div>}
  </section>;
}

export function AssistantPanel({ project, open, inert, onClose, onProjectRefresh, activeStage }: {
  project: DesignProject | null;
  open: boolean;
  inert: boolean;
  onClose: () => void;
  activeStage?: StageId;
  onProjectRefresh?: (projectId: string, screenId: string) => Promise<void>;
}) {
  const [conversations, setConversations] = useState<AssistantConversationMeta[]>([]);
  const [conversation, setConversation] = useState<AssistantConversation | null>(null);
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [readingImages, setReadingImages] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftGeneration = useRef(0);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [renameTarget, setRenameTarget] = useState<AssistantConversationMeta | null>(null);
  const [title, setTitle] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AssistantConversationMeta | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const run = latestRun(conversation);
  const targetMatches = Boolean(project && conversation && conversation.meta.project_id === project.id && conversation.meta.screen_id === project.screen_id);
  const hasUnfinished = Boolean(conversation?.runs.some((item) => unfinishedStatuses.has(item.status))
    || conversations.some((item) => item.has_pending_action));

  const composerDisabled = busy || readingImages || !targetMatches || hasUnfinished || Boolean(conversation?.message_error);

  useEffect(() => {
    draftGeneration.current += 1;
    setContent(''); setAttachments([]);
  }, [conversation?.meta.conversation_id, project?.id, project?.screen_id]);

  const addImages = async (files: File[]) => {
    if (composerDisabled || !files.length) return;
    const generation = draftGeneration.current;
    setReadingImages(true); setError('');
    try {
      if (files.length + attachments.length > 4) throw new Error('每条消息最多附加 4 张截图。');
      if (files.some((file) => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) throw new Error('请使用 PNG、JPG 或 WebP 图片。');
      if (files.some((file) => file.size > 5 * 1024 * 1024)) throw new Error('单张截图不能超过 5MB，请压缩后重试。');
      const images = await Promise.all(files.map((file) => new Promise<AssistantAttachment>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name.slice(0, 120) || '截图.png', dataUrl: String(reader.result) });
        reader.onerror = () => reject(new Error('截图读取失败，请重新选择。'));
        reader.onabort = () => reject(new Error('截图读取已取消。'));
        reader.readAsDataURL(file);
      })));
      const next = [...attachments, ...images];
      if (next.reduce((size, image) => size + Math.floor(image.dataUrl.split(',')[1].replace(/=+$/u, '').length * 3 / 4), 0) > 12 * 1024 * 1024) throw new Error('截图合计不能超过 12MB，请减少图片或压缩后重试。');
      if (generation === draftGeneration.current) setAttachments(next);
    } catch (cause) { if (generation === draftGeneration.current) setError(friendlyError(cause)); }
    finally { setReadingImages(false); }
  };

  const refreshList = async () => {
    const result = await copilotApi.listAssistantConversations();
    setConversations(result.conversations);
    setWarning(result.warnings.length ? '部分对话记录损坏，其他对话仍可使用。无法读取的记录保留在本地助手数据目录。' : '');
    return result.conversations;
  };

  const selectConversation = async (conversationId: string) => {
    setBusy(true); setError('');
    try {
      const next = await copilotApi.openAssistantConversation(conversationId);
      setConversation(next); setTitle(next.meta.title); setRenameTarget(null);
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    let active = true;
    copilotApi.listAssistantConversations().then(async (result) => {
      if (!active) return;
      setConversations(result.conversations);
      setWarning(result.warnings.length ? '部分对话记录损坏，其他对话仍可使用。' : '');
      for (const item of [...result.conversations].sort((a, b) => Number(Boolean(a.message_error)) - Number(Boolean(b.message_error)))) {
        try {
          const next = await copilotApi.openAssistantConversation(item.conversation_id);
          if (active) { setConversation(next); setTitle(next.meta.title); }
          break;
        } catch { if (active) setWarning('部分对话无法打开，请从列表选择其他对话。'); }
      }
    }).catch((cause) => { if (active) setError(friendlyError(cause)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const messages = messagesRef.current;
    if (!open || !messages) return;
    const pending = messages.querySelector('[data-pending-action="true"]');
    messages.scrollTop = pending ? messages.scrollTop + pending.getBoundingClientRect().top - messages.getBoundingClientRect().top - 12 : messages.scrollHeight;
  }, [open, conversation?.meta.conversation_id, conversation?.messages.length, run?.status, thinking]);

  useEffect(() => {
    if (!open || busy || !conversation || !['queued', 'running', 'executing'].includes(run?.status || '')) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const id = conversation.meta.conversation_id;
    const refresh = async () => {
      try {
        const next = await copilotApi.openAssistantConversation(id);
        if (!active) return;
        setConversation((current) => current?.meta.conversation_id === id ? next : current);
        if (run?.status === 'executing' && next.runs.at(-1)?.status === 'succeeded') {
          await onProjectRefresh?.(next.meta.project_id, next.meta.screen_id).catch(() => setError('动作已完成，但项目视图刷新失败，请重新打开项目。'));
        }
        if (next.runs.some((item) => ['queued', 'running', 'executing'].includes(item.status))) timer = setTimeout(refresh, 1500);
        else await refreshList();
      } catch { if (active) { setWarning('运行状态刷新失败，正在重试。'); timer = setTimeout(refresh, 5000); } }
    };
    timer = setTimeout(refresh, 1500);
    return () => { active = false; clearTimeout(timer); };
    // Run status is refreshed here; including the returned object would create a request loop.
  }, [open, busy, conversation?.meta.conversation_id, run?.status]);

  useEffect(() => {
    if (!open || busy || !conversation) return;
    let active = true;
    const id = conversation.meta.conversation_id;
    copilotApi.openAssistantConversation(id).then(async (next) => {
      if (!active) return;
      setConversation((current) => current?.meta.conversation_id === id ? next : current);
      if (run?.status === 'executing' && next.runs.at(-1)?.status === 'succeeded') {
        await onProjectRefresh?.(next.meta.project_id, next.meta.screen_id).catch(() => setError('动作已完成，但项目视图刷新失败，请重新打开项目。'));
      }
    }).catch(() => { if (active) setWarning('对话刷新失败，请重新打开面板重试。'); });
    return () => { active = false; };
    // Only reopening triggers this read; normal operations already return the latest conversation.
  }, [open]);

  const createConversation = async () => {
    if (!project) return;
    setBusy(true); setError('');
    try {
      const next = await copilotApi.createAssistantConversation({ projectId: project.id, screenId: project.screen_id });
      setConversation(next); setTitle(next.meta.title); setRenameTarget(null);
      await refreshList();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };

  const saveTitle = async () => {
    if (!renameTarget || !title.trim()) return;
    if (title.trim() === renameTarget.title) { setRenameTarget(null); return; }
    const id = renameTarget.conversation_id;
    setBusy(true); setError('');
    try {
      const next = await copilotApi.renameAssistantConversation(id, title.trim());
      setConversation((current) => current?.meta.conversation_id === id ? next : current);
      setRenameTarget(null); await refreshList();
    } catch (cause) { setError(friendlyError(cause)); setRenameTarget(null); }
    finally { setBusy(false); }
  };

  const deleteConversation = async () => {
    if (!deleteTarget) return;
    const deletingId = deleteTarget.conversation_id;
    const deletingCurrent = conversation?.meta.conversation_id === deletingId;
    setBusy(true); setError('');
    try {
      await copilotApi.deleteAssistantConversation(deletingId);
      setDeleteTarget(null);
      if (deletingCurrent) setConversation(null);
      const nextList = await refreshList();
      if (deletingCurrent && nextList[0]) setConversation(await copilotApi.openAssistantConversation(nextList[0].conversation_id));
    } catch (cause) { setError(friendlyError(cause)); setDeleteTarget(null); }
    finally { setBusy(false); }
  };

  const submit = async (nextContent = content, nextAttachments = attachments) => {
    if (!conversation || composerDisabled || (!nextContent.trim() && !nextAttachments.length)) return;
    const conversationId = conversation.meta.conversation_id;
    const generation = draftGeneration.current;
    setBusy(true); setThinking(true); setError('');
    try {
      const next = await copilotApi.sendAssistantMessage(conversationId, { mode: 'execute', ...(activeStage ? { currentStage: activeStage } : {}), content: nextContent.trim(), ...(nextAttachments.length ? { attachments: nextAttachments } : {}), projectId: project!.id, screenId: project!.screen_id });
      setConversation((current) => current?.meta.conversation_id === conversationId ? next : current);
      if (generation === draftGeneration.current && nextContent === content && nextAttachments === attachments && next.runs.at(-1)?.status !== 'failed') { setContent(''); setAttachments([]); }
      await refreshList();
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setThinking(false); setBusy(false); }
  };

  const updateAction = async (operation: 'confirm' | 'cancel', actionRun: AssistantRun) => {
    if (!conversation || !actionRun.proposed_action || (operation === 'confirm' && (!targetMatches || conversation.message_error))) return;
    const conversationId = conversation.meta.conversation_id;
    setBusy(true); setError('');
    try {
      const next = operation === 'confirm'
        ? await copilotApi.confirmAssistantAction(conversationId, actionRun.run_id, actionRun.proposed_action!.action_id)
        : await copilotApi.cancelAssistantAction(conversationId, actionRun.run_id, actionRun.proposed_action!.action_id);
      setConversation((current) => current?.meta.conversation_id === conversationId ? next : current);
      await refreshList();
      if (operation === 'confirm' && onProjectRefresh) {
        try { await onProjectRefresh(conversation.meta.project_id, conversation.meta.screen_id); }
        catch { setError('动作结果已经保存，但项目视图刷新失败。请重新打开当前项目查看最新状态。'); }
      }
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  };

  return <aside className="assistant-panel" hidden={!open} inert={inert} aria-label="内嵌智能 AI 助手" data-testid="assistant-panel">
    <header className="assistant-panel__list">
      <ConversationMenu conversations={conversations} current={conversation} busy={busy} open={open} onSelect={(id) => void selectConversation(id)} onRename={(item) => { setTitle(item.title); setRenameTarget(item); }} onDelete={setDeleteTarget} />
      <button className="button button--secondary button--icon" type="button" aria-label="为当前项目和 Screen 新建对话" title="新建对话" disabled={busy || !project || Boolean(hasUnfinished)} onClick={() => void createConversation()}><Plus size={16} /></button>
      <button className="icon-button" type="button" aria-label="关闭助手" onClick={onClose}><X size={18} /></button>
    </header>
    {conversation && !targetMatches && <div className="assistant-panel__neutral-note" role="status">该对话绑定的是另一个项目或 Screen，可查看但无法继续。<button className="button button--secondary button--small" disabled={busy || !project || Boolean(hasUnfinished)} onClick={() => void createConversation()}>为当前目标新建对话</button></div>}
    {conversation?.message_error && <p className="assistant-panel__local-error" role="alert">{conversation.message_error} 原文件已保留。请拒绝执行后删除此对话（移入回收目录），或切换到其他对话。</p>}
    {warning && <div className="assistant-panel__local-error" role="status"><span>{warning}</span></div>}
    {error && <div className="assistant-panel__local-error" role="alert"><b>助手操作失败</b><span>{error}</span><button type="button" aria-label="关闭助手错误" onClick={() => setError('')}>×</button></div>}
    <div ref={messagesRef} className="assistant-panel__messages" aria-live="polite">
      {!conversation ? <div className="assistant-panel__empty"><Bot size={26} /><b>从当前设计上下文开始</b><p>{project ? `当前目标：${project.name} · ${project.screen_id}` : '请先建立或打开项目。'}</p><button className="button button--secondary" disabled={busy || !project} onClick={() => void createConversation()}><Plus size={15} />新建对话</button></div> : <>
        {conversation.messages.map((message) => <article key={message.id} className={`assistant-panel__message assistant-panel__message--${message.role}`}><span>{message.role === 'user' ? '你' : 'AI 助手'}</span><p>{message.content}</p>{message.attachments?.map((image, index) => <img key={index} className="assistant-panel__sent-image" src={image.dataUrl} alt={image.name} loading="lazy" />)}</article>)}
        {(thinking || ['queued', 'running', 'executing'].includes(run?.status || '')) && <div className="assistant-panel__thinking" role="status"><LoaderCircle className="spin" size={14} />正在思考…</div>}
        {conversation.runs.map((item) => <ActionCard key={item.run_id} run={item} binding={conversation.meta} disabled={!targetMatches || Boolean(conversation.message_error)} busy={busy} onConfirm={() => void updateAction('confirm', item)} onCancel={() => void updateAction('cancel', item)} onRegenerate={() => void submit('请基于最新项目状态重新生成可执行计划。', [])} />)}
      </>}
    </div>
    {conversation && <footer className="assistant-panel__composer"
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDrop={(event) => { event.preventDefault(); void addImages(Array.from(event.dataTransfer.files)); }}>
      {!!attachments.length && <div className="assistant-panel__attachments" aria-label="待发送截图">{attachments.map((image, index) => <figure key={index}><img src={image.dataUrl} alt={image.name} /><figcaption title={image.name}>{image.name}</figcaption><button className="icon-button" type="button" aria-label={`移除截图 ${index + 1}`} disabled={busy || readingImages} onClick={() => setAttachments((items) => items.filter((_, position) => position !== index))}><X size={14} /></button></figure>)}</div>}
      <label><span>输入消息</span><textarea value={content} disabled={composerDisabled} maxLength={20_000} placeholder={targetMatches ? '粘贴截图，告诉我哪里不对，或想实现什么…' : '请为当前项目与 Screen 新建对话'} onChange={(event) => setContent(event.target.value)}
        onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void addImages(files); } }}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} /></label>
      <div className="assistant-panel__composer-actions"><input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="选择助手截图" disabled={composerDisabled} onChange={(event) => { void addImages(Array.from(event.target.files || [])); event.target.value = ''; }} />
        <button className="button button--ghost button--small" type="button" disabled={composerDisabled || attachments.length >= 4} onClick={() => fileInputRef.current?.click()}>{readingImages ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}添加截图</button><span>粘贴 / 拖入 · 最多 4 张</span>
        <button className="button button--secondary" type="button" disabled={composerDisabled || (!content.trim() && !attachments.length)} onClick={() => void submit()}>{thinking ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}发送</button>
      </div>
    </footer>}
    {renameTarget && <Modal title="重命名对话" copy={`修改「${renameTarget.title}」的名称。`} onClose={() => setRenameTarget(null)}><form onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}><label className="assistant-panel__rename-field">对话名称<input autoFocus aria-label="对话标题" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} /></label><div className="dialog-actions"><button className="button button--ghost" type="button" onClick={() => setRenameTarget(null)}>取消</button><button className="button button--secondary" type="submit" disabled={busy || !title.trim()}>保存</button></div></form></Modal>}
    {deleteTarget && <Modal title="删除对话" copy={`将移除「${deleteTarget.title}」及其完整消息和运行记录。`} onClose={() => setDeleteTarget(null)}><p className="settings-note">对话会移入本地助手回收目录，不会修改任何项目数据。</p><div className="dialog-actions"><button className="button button--ghost" type="button" onClick={() => setDeleteTarget(null)}>取消</button><button className="button button--danger" type="button" disabled={busy} onClick={() => void deleteConversation()}><Trash2 size={15} />删除对话</button></div></Modal>}
  </aside>;
}
