import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from './types';

// App shell 的顶栏帮助入口测试：openUserGuide 失败时必须在错误条反馈，
// 不允许静默无反应（PR#25 收口 P1）。
const openUserGuide = vi.fn();
vi.mock('./api', () => ({
  copilotApi: {
    getConfig: vi.fn(async (): Promise<AppConfig> => ({
      platform: 'darwin',
      workspaceRoot: '/tmp/workspace',
      kunpo: { configured: true, mode: 'gateway', modelSource: 'models.json', envSource: '.env' }
    } as AppConfig)),
    listProjects: vi.fn(async () => []),
    openUserGuide: (...args: unknown[]) => openUserGuide(...args)
  }
}));

import { App } from './App';

// jsdom 未实现 Element.scrollTo（App 在阶段切换时对主工作区调用），测试环境补空实现
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};

afterEach(() => {
  cleanup();
  openUserGuide.mockReset();
});

describe('App 顶栏帮助入口', () => {
  it('openUserGuide 返回 { ok: false } 时显示错误条并给出自助路径', async () => {
    const user = userEvent.setup();
    openUserGuide.mockResolvedValue({ ok: false });
    render(<App />);
    const helpButton = await screen.findByTitle('使用说明书（在浏览器中打开）');
    await user.click(helpButton);
    await screen.findByText(/无法打开使用说明书/);
    expect(screen.getByText(/docs\/user\/quick-start-guide\.html/)).toBeTruthy();
  });

  it('openUserGuide 成功时不出现错误条', async () => {
    const user = userEvent.setup();
    openUserGuide.mockResolvedValue({ ok: true });
    render(<App />);
    const helpButton = await screen.findByTitle('使用说明书（在浏览器中打开）');
    await user.click(helpButton);
    await waitFor(() => expect(openUserGuide).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.error-banner')).toBeNull();
  });

  it('openUserGuide 抛错时错误条展示友好错误', async () => {
    const user = userEvent.setup();
    openUserGuide.mockRejectedValue(new Error('IPC_GUIDE_OPEN_FAILED: shell busy'));
    render(<App />);
    const helpButton = await screen.findByTitle('使用说明书（在浏览器中打开）');
    await user.click(helpButton);
    await screen.findByText(/IPC_GUIDE_OPEN_FAILED/);
  });
});
