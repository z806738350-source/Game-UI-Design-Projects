import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from './types';

// App 顶栏帮助入口测试：点击打开应用内说明书弹窗（iframe 嵌入 guide HTML）；
// 弹窗内「在系统浏览器中打开」失败时必须在错误条反馈，不允许静默无反应（PR#25 收口 P1）。
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
  it('点击帮助按钮打开说明书弹窗，iframe 指向 guide HTML，且不触发系统浏览器', async () => {
    const user = userEvent.setup();
    render(<App />);
    const helpButton = await screen.findByTitle('使用说明书');
    await user.click(helpButton);
    const dialog = screen.getByRole('dialog', { name: '使用说明书' });
    const frame = dialog.querySelector('iframe.guide-frame');
    expect(frame?.getAttribute('src')).toBe('./guide/quick-start-guide.html');
    expect(openUserGuide).not.toHaveBeenCalled();
  });

  it('弹窗可通过关闭按钮与遮罩点击关闭', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTitle('使用说明书'));
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog', { name: '使用说明书' })).toBeNull();

    await user.click(screen.getByTitle('使用说明书'));
    const backdrop = screen.getByRole('dialog', { name: '使用说明书' }).parentElement!;
    await user.click(backdrop);
    expect(screen.queryByRole('dialog', { name: '使用说明书' })).toBeNull();
  });

  it('弹窗内「在系统浏览器中打开」返回 { ok: false } 时显示错误条并给出自助路径', async () => {
    const user = userEvent.setup();
    openUserGuide.mockResolvedValue({ ok: false });
    render(<App />);
    await user.click(await screen.findByTitle('使用说明书'));
    await user.click(screen.getByRole('button', { name: '在系统浏览器中打开' }));
    await screen.findByText(/无法打开使用说明书/);
    const banner = document.querySelector('.error-banner');
    expect(banner?.textContent).toContain('docs/user/quick-start-guide.html');
  });

  it('「在系统浏览器中打开」成功时不出现错误条', async () => {
    const user = userEvent.setup();
    openUserGuide.mockResolvedValue({ ok: true });
    render(<App />);
    await user.click(await screen.findByTitle('使用说明书'));
    await user.click(screen.getByRole('button', { name: '在系统浏览器中打开' }));
    await waitFor(() => expect(openUserGuide).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.error-banner')).toBeNull();
  });

  it('「在系统浏览器中打开」抛错时错误条展示友好错误', async () => {
    const user = userEvent.setup();
    openUserGuide.mockRejectedValue(new Error('IPC_GUIDE_OPEN_FAILED: shell busy'));
    render(<App />);
    await user.click(await screen.findByTitle('使用说明书'));
    await user.click(screen.getByRole('button', { name: '在系统浏览器中打开' }));
    await screen.findByText(/IPC_GUIDE_OPEN_FAILED/);
  });
});
