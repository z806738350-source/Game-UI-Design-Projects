import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssistantAction, AssistantConversation, AssistantConversationList, AssistantConversationMeta, AssistantRun } from '../../types';

const listAssistantConversations = vi.fn(async (): Promise<AssistantConversationList> => ({ conversations: [], warnings: [] }));
const createAssistantConversation = vi.fn();
const openAssistantConversation = vi.fn();
const renameAssistantConversation = vi.fn();
const deleteAssistantConversation = vi.fn();
const sendAssistantMessage = vi.fn();
const confirmAssistantAction = vi.fn();
const cancelAssistantAction = vi.fn();

vi.mock('../../api', () => ({
  copilotApi: {
    listAssistantConversations: () => listAssistantConversations(),
    createAssistantConversation: (...args: unknown[]) => createAssistantConversation(...args),
    openAssistantConversation: (...args: unknown[]) => openAssistantConversation(...args),
    renameAssistantConversation: (...args: unknown[]) => renameAssistantConversation(...args),
    deleteAssistantConversation: (...args: unknown[]) => deleteAssistantConversation(...args),
    sendAssistantMessage: (...args: unknown[]) => sendAssistantMessage(...args),
    confirmAssistantAction: (...args: unknown[]) => confirmAssistantAction(...args),
    cancelAssistantAction: (...args: unknown[]) => cancelAssistantAction(...args)
  }
}));

import { AssistantPanel } from './AssistantPanel';
import { makeProject } from '../../test-utils/fixtures';

if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function close() { this.open = false; };

const meta: AssistantConversationMeta = {
  schema_version: '1.0' as const,
  conversation_id: '11111111-1111-4111-8111-111111111111',
  title: '主页修改', project_id: 'project-a', screen_id: 'main',
  created_at: '2026-09-05T00:00:00.000Z', updated_at: '2026-09-05T00:00:00.000Z'
};

const action: AssistantAction = {
  action_id: '22222222-2222-4222-8222-222222222222', name: 'save_intent_review_draft',
  label: '保存意图审查草稿', reason: '根据当前页面调整设计意图。', args: { draft: {} },
  risk: { writes_project: true, replaces_content: true, reversible: false, external_cost: false }
};

function assistantRun(overrides: Partial<AssistantRun> = {}): AssistantRun {
  return {
    schema_version: '1.0', run_id: '33333333-3333-4333-8333-333333333333', conversation_id: meta.conversation_id,
    status: 'awaiting_confirmation', mode: 'execute', request_message_id: null,
    context: { project_id: 'project-a', screen_id: 'main', input_revisions: { intent_review: 1 }, artifact_versions: {} },
    proposed_action: action, result: null, error: null,
    created_at: meta.created_at, updated_at: meta.updated_at, ...overrides
  };
}

function assistantConversation(run?: AssistantRun): AssistantConversation {
  return { meta, messages: [{ id: '44444444-4444-4444-8444-444444444444', seq: 1, role: 'assistant', content: '这是本轮建议。', created_at: meta.created_at }], runs: run ? [run] : [], summary: null };
}

const project = makeProject({ id: 'project-a', name: '项目 A', screen_id: 'main' });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  listAssistantConversations.mockResolvedValue({ conversations: [], warnings: [] });
});

describe('AssistantPanel', () => {
  it('无对话时为当前目标新建，失败反馈只留在面板内', async () => {
    const user = userEvent.setup();
    const created = assistantConversation();
    createAssistantConversation.mockResolvedValue(created);
    sendAssistantMessage.mockResolvedValue(assistantConversation(assistantRun({ status: 'failed', proposed_action: null, error: { code: 'ASSISTANT_RESPONSE_INVALID', message: '模型未返回有效内容。' } })));
    render(<AssistantPanel project={project} open inert={false} onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: '新建对话' }));
    expect(createAssistantConversation).toHaveBeenCalledWith({ projectId: 'project-a', screenId: 'main' });
    await user.type(screen.getByLabelText('输入消息'), '请检查当前设计');
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(sendAssistantMessage).toHaveBeenCalledWith(meta.conversation_id, expect.objectContaining({ projectId: 'project-a', screenId: 'main' }));
    await screen.findByText('模型未返回有效内容。');
    expect(document.querySelector('.overlay-bar')).toBeNull();
    expect(document.querySelector('.assistant-panel .button--primary')).toBeNull();
  });

  it('待确认写动作按服务端风险显示 danger，完成文案不写已批准', async () => {
    const user = userEvent.setup();
    const onProjectRefresh = vi.fn(async () => {});
    const awaiting = assistantConversation(assistantRun());
    const succeeded = assistantConversation(assistantRun({ status: 'succeeded', result: { intent_review_revision: 2 } }));
    listAssistantConversations.mockResolvedValue({ conversations: [{ ...meta, has_pending_action: true }], warnings: [] });
    openAssistantConversation.mockResolvedValue(awaiting);
    confirmAssistantAction.mockResolvedValue(succeeded);
    render(<AssistantPanel project={project} open inert={false} onClose={() => {}} onProjectRefresh={onProjectRefresh} />);
    const confirm = await screen.findByRole('button', { name: '确认执行' });
    expect(screen.getByTestId('assistant-conversation-switch').querySelector('.dropdown-button')?.className).toContain('is-pending');
    expect(document.querySelector('.assistant-panel__list')?.classList.contains('is-pending')).toBe(false);
    expect(confirm.className).toContain('button--danger');
    expect(document.querySelector('.assistant-panel .button--primary')).toBeNull();
    await user.click(confirm);
    await screen.findByText('已完成');
    expect(screen.queryByText('已批准')).toBeNull();
    expect(confirmAssistantAction).toHaveBeenCalledWith(meta.conversation_id, awaiting.runs[0].run_id, action.action_id);
    expect(onProjectRefresh).toHaveBeenCalledWith('project-a', 'main');
  });

  it('目标切换后只允许查看，stale 差异与重生成操作使用中文和 ghost', async () => {
    const stale = assistantConversation(assistantRun({
      status: 'stale',
      error: { code: 'ASSISTANT_ACTION_STALE', message: '项目状态已变化。', changed: [{ kind: 'artifact_status', key: 'screen_contract', expected: 'reviewed', actual: 'stale' }] }
    }));
    listAssistantConversations.mockResolvedValue({ conversations: [meta], warnings: [] });
    openAssistantConversation.mockResolvedValue(stale);
    render(<AssistantPanel project={makeProject({ id: 'project-b', name: '项目 B', screen_id: 'main' })} open inert={false} onClose={() => {}} />);
    await screen.findByText(/另一个项目或 Screen/);
    expect((screen.getByLabelText('输入消息') as HTMLTextAreaElement).disabled).toBe(true);
    expect(await screen.findByText('产物状态 · screen contract：待确认 → 需更新')).toBeTruthy();
    const regenerate = screen.getByRole('button', { name: '重新生成计划' });
    expect(regenerate.className).toContain('button--ghost');
    expect((regenerate as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('.assistant-panel__neutral-note.is-warning')).toBeNull();
  });

  it('删除确认用 Portal 原生 dialog，cancel 走受控关闭且可再次打开', async () => {
    const user = userEvent.setup();
    listAssistantConversations.mockResolvedValue({ conversations: [meta], warnings: [] });
    openAssistantConversation.mockResolvedValue(assistantConversation());
    render(<AssistantPanel project={project} open inert={false} onClose={() => {}} />);
    const trigger = await screen.findByRole('button', { name: '删除对话' });
    await user.click(trigger);
    let dialog = screen.getByRole('dialog', { name: '删除对话' });
    expect(dialog.parentElement).toBe(document.body);
    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(dialog.className).toContain('dialog-backdrop');
    const cancel = new Event('cancel', { bubbles: false, cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '删除对话' })).toBeNull());
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    dialog = screen.getByRole('dialog', { name: '删除对话' });
    expect((dialog as HTMLDialogElement).open).toBe(true);
  });
});
