import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    expect(sendAssistantMessage).toHaveBeenCalledWith(meta.conversation_id, expect.objectContaining({ mode: 'execute', projectId: 'project-a', screenId: 'main' }));
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
    await screen.findByText('这是本轮建议。');
    const trigger = screen.getByRole('button', { name: '切换助手对话' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: /^删除对话/ }));
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
    await user.click(screen.getByRole('button', { name: /^删除对话/ }));
    dialog = screen.getByRole('dialog', { name: '删除对话' });
    expect((dialog as HTMLDialogElement).open).toBe(true);
  });
});

describe('截图消息', () => {
  const file = () => new File(['pixels'], '截图.png', { type: 'image/png' });
  async function setup() {
    listAssistantConversations.mockResolvedValue({ conversations: [meta], warnings: [] });
    openAssistantConversation.mockResolvedValue(assistantConversation());
    render(<AssistantPanel project={project} open inert={false} onClose={() => {}} />);
    await screen.findByLabelText('输入消息');
  }

  it('选择、移除、粘贴和纯图片发送，成功后清空附件', async () => {
    const user = userEvent.setup();
    await setup();
    sendAssistantMessage.mockImplementation(async (_id, input) => ({ ...assistantConversation(), messages: [{ id: 'image', role: 'user', content: input.content, attachments: input.attachments }] }));
    await user.upload(screen.getByLabelText('选择助手截图'), file());
    await screen.findByRole('img', { name: '截图.png' });
    await user.click(screen.getByRole('button', { name: '移除截图 1' }));
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.paste(screen.getByLabelText('输入消息'), { clipboardData: { files: [file()] } });
    await screen.findByRole('img', { name: '截图.png' });
    await user.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(sendAssistantMessage).toHaveBeenCalledWith(meta.conversation_id, expect.objectContaining({ content: '', attachments: [{ name: '截图.png', dataUrl: 'data:image/png;base64,cGl4ZWxz' }] })));
    expect(screen.queryByLabelText('待发送截图')).toBeNull();
    expect(screen.getByRole('img', { name: '截图.png' })).toBeTruthy();
  });

  it('发送失败保留文字与截图，拖入超限或错误格式不丢弃已有草稿', async () => {
    const user = userEvent.setup();
    await setup();
    sendAssistantMessage.mockRejectedValueOnce(new Error('网络不可用'));
    await user.upload(screen.getByLabelText('选择助手截图'), file());
    await screen.findByRole('img');
    await user.type(screen.getByLabelText('输入消息'), '这里怎么改');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText('网络不可用');
    expect((screen.getByLabelText('输入消息') as HTMLTextAreaElement).value).toBe('这里怎么改');
    expect(screen.getByRole('img')).toBeTruthy();
    fireEvent.drop(document.querySelector('.assistant-panel__composer')!, { dataTransfer: { files: Array.from({ length: 4 }, file) } });
    await screen.findByText('每条消息最多附加 4 张截图。');
    fireEvent.drop(document.querySelector('.assistant-panel__composer')!, { dataTransfer: { files: [new File(['x'], 'x.svg', { type: 'image/svg+xml' })] } });
    await screen.findByText('请使用 PNG、JPG 或 WebP 图片。');
    expect(screen.getAllByRole('img').length).toBe(1);
  });
});

describe('审计问题回归', () => {
  it('跨目标待执行动作仍可取消，确认保持禁用', async () => {
    const user = userEvent.setup();
    const awaiting = assistantConversation(assistantRun());
    listAssistantConversations.mockResolvedValue({ conversations: [{ ...meta, has_pending_action: true }], warnings: [] });
    openAssistantConversation.mockResolvedValue(awaiting);
    cancelAssistantAction.mockResolvedValue(assistantConversation(assistantRun({ status: 'cancelled' })));
    render(<AssistantPanel project={makeProject({ id: 'project-b', screen_id: 'other' })} open inert={false} onClose={() => {}} />);
    const cancel = await screen.findByRole('button', { name: '拒绝执行' });
    expect((screen.getByRole('button', { name: '确认执行' }) as HTMLButtonElement).disabled).toBe(true);
    expect((cancel as HTMLButtonElement).disabled).toBe(false);
    await user.click(cancel);
    expect(cancelAssistantAction).toHaveBeenCalledWith(meta.conversation_id, awaiting.runs[0].run_id, action.action_id);
    await screen.findByText('已拒绝执行');
  });

  it('确认前展示完整草稿、待确认答案、可读目标与原内容', async () => {
    const proposed = { ...action, args: { draft: { page_purpose: { id: 'purpose', text: '将所有装备改成付费解锁', origin: 'ai_inference' }, player_tasks: [{ id: 'task', text: '展示购买前确认', origin: 'ai_inference' }], core_flow: [], visible_controls: [], visible_information_and_states: [], uncertainties: [{ id: 'q', question: '失败是否扣费？', review_status: 'answered', note: '失败不扣费', priority: 'blocking' }] } }, review: { project_name: '装备计划', screen_name: '升级页面', before: '全部装备免费获得', before_truncated: false } };
    listAssistantConversations.mockResolvedValue({ conversations: [meta], warnings: [] });
    openAssistantConversation.mockResolvedValue(assistantConversation(assistantRun({ proposed_action: proposed })));
    render(<AssistantPanel project={project} open inert={false} onClose={() => {}} />);
    await screen.findByText('将所有装备改成付费解锁');
    expect(screen.getByText('展示购买前确认')).toBeTruthy();
    expect(screen.getByText('补充：失败不扣费')).toBeTruthy();
    expect(screen.getByText('装备计划')).toBeTruthy();
    expect(screen.getByText('升级页面')).toBeTruthy();
    fireEvent.click(screen.getByText('对照修改前内容'));
    expect(screen.getByText('全部装备免费获得')).toBeTruthy();
  });

  it('恢复中的运行自动读到完成状态，关闭后重新打开也刷新', async () => {
    const running = assistantConversation(assistantRun({ status: 'executing' }));
    const onProjectRefresh = vi.fn(async () => {});
    const done = assistantConversation(assistantRun({ status: 'succeeded', proposed_action: null }));
    listAssistantConversations.mockResolvedValue({ conversations: [meta], warnings: [] });
    openAssistantConversation.mockResolvedValueOnce(running).mockResolvedValue(done);
    const view = render(<AssistantPanel project={project} open inert={false} onClose={() => {}} onProjectRefresh={onProjectRefresh} />);
    await screen.findByText('正在思考…');
    await waitFor(() => expect((screen.getByLabelText('输入消息') as HTMLTextAreaElement).disabled).toBe(false), { timeout: 3000 });
    expect(openAssistantConversation.mock.calls.length).toBe(2);
    expect(onProjectRefresh).toHaveBeenCalledWith(meta.project_id, meta.screen_id);
    view.rerender(<AssistantPanel project={project} open={false} inert={false} onClose={() => {}} />);
    const withReply = { ...done, messages: [...done.messages, { ...done.messages[0], id: 'latest', seq: 2, content: '重新打开后最新回复' }] };
    openAssistantConversation.mockResolvedValue(withReply);
    view.rerender(<AssistantPanel project={project} open inert={false} onClose={() => {}} />);
    await screen.findByText('重新打开后最新回复');
  });

  it('最新对话无法打开时仍列出并自动选择可用的旧对话', async () => {
    const healthy = { ...meta, conversation_id: '55555555-5555-4555-8555-555555555555', title: '完好旧对话' };
    listAssistantConversations.mockResolvedValue({ conversations: [meta, healthy], warnings: [] });
    openAssistantConversation.mockImplementation(async (id: string) => {
      if (id === meta.conversation_id) throw new Error('聊天记录损坏');
      return { ...assistantConversation(), meta: healthy };
    });
    render(<AssistantPanel project={project} open inert={false} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('assistant-conversation-switch').textContent).toContain('完好旧对话'));
    expect((screen.getByLabelText('输入消息') as HTMLTextAreaElement).disabled).toBe(false);
  });
});

it('conversation row actions target that row without switching or clearing the active draft', async () => {
  const user = userEvent.setup();
  const other = { ...meta, conversation_id: '66666666-6666-4666-8666-666666666666', title: 'Other conversation' };
  let items = [meta, other];
  listAssistantConversations.mockImplementation(async () => ({ conversations: items, warnings: [] }));
  openAssistantConversation.mockResolvedValue(assistantConversation());
  renameAssistantConversation.mockImplementation(async (id: string, title: string) => {
    expect(id).toBe(other.conversation_id);
    items = [meta, { ...other, title }];
    return { ...assistantConversation(), meta: { ...other, title } };
  });
  deleteAssistantConversation.mockImplementation(async (id: string) => { items = items.filter((item) => item.conversation_id !== id); return { deleted: true }; });
  render(<AssistantPanel project={project} open inert={false} onClose={() => {}} />);
  const input = await screen.findByLabelText('输入消息');
  await user.type(input, 'Keep this unsent draft');
  const trigger = screen.getByRole('button', { name: '切换助手对话' });
  await user.click(trigger);
  await user.click(screen.getByRole('button', { name: '重命名对话「Other conversation」' }));
  const rename = screen.getByRole('dialog', { name: '重命名对话' });
  await user.clear(within(rename).getByLabelText('对话标题'));
  await user.type(within(rename).getByLabelText('对话标题'), 'Renamed conversation');
  await user.click(within(rename).getByRole('button', { name: '保存' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(trigger.textContent).toContain(meta.title);
  expect((input as HTMLTextAreaElement).value).toBe('Keep this unsent draft');
  await user.click(trigger);
  await user.click(screen.getByRole('button', { name: '删除对话「Renamed conversation」' }));
  const deletion = screen.getByRole('dialog', { name: '删除对话' });
  expect(deletion.textContent).toContain('Renamed conversation');
  await user.click(within(deletion).getByRole('button', { name: '删除对话' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(deleteAssistantConversation).toHaveBeenCalledWith(other.conversation_id);
  expect(trigger.textContent).toContain(meta.title);
  expect((input as HTMLTextAreaElement).value).toBe('Keep this unsent draft');
  expect(openAssistantConversation).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.assistant-panel__conversation-tools')).toBeNull();
  await user.click(trigger);
  await user.keyboard('{Escape}');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
});
