import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copilotApi } from '../../api';
import { makeProject } from '../../test-utils/fixtures';
import { ScreenManager } from './ScreenManager';

vi.mock('../../api', () => ({
  copilotApi: {
    createScreen: vi.fn(),
    duplicateScreen: vi.fn(),
    openProject: vi.fn(),
    setActiveScreen: vi.fn(),
    updateScreen: vi.fn()
  }
}));

const api = {
  createScreen: vi.mocked(copilotApi.createScreen),
  openProject: vi.mocked(copilotApi.openProject)
};

const projectWithScreens = () => makeProject({
  screens: [
    { id: 'screen-main', name: '商城主页', status: 'active', created_at: '', updated_at: '' },
    { id: 'screen-detail', name: '详情页', status: 'active', created_at: '', updated_at: '' }
  ]
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ScreenManager（Screen 隔离）', () => {
  it('正常路径：创建独立页面后刷新项目快照', async () => {
    const project = projectWithScreens();
    const user = userEvent.setup();
    const refreshed = projectWithScreens();
    api.createScreen.mockResolvedValue(project);
    api.openProject.mockResolvedValue(refreshed);
    const onProject = vi.fn();
    render(<ScreenManager project={project} busy={false} onProject={onProject} />);

    await user.type(screen.getByPlaceholderText('新页面名称'), '活动页');
    await user.click(screen.getByTestId('screen-manager-create'));
    expect(api.createScreen).toHaveBeenCalledWith('project-1', { name: '活动页' });
    expect(await vi.waitFor(() => onProject.mock.calls.length)).toBe(1);
    expect(onProject).toHaveBeenCalledWith(refreshed);
  });

  it('失败路径：页面操作失败时在自己的错误槽展示，不影响全局横幅', async () => {
    const project = projectWithScreens();
    const user = userEvent.setup();
    api.createScreen.mockRejectedValue(new Error("Error invoking remote method 'copilot:create-screen': Error: 页面名称已存在"));
    render(<ScreenManager project={project} busy={false} onProject={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('新页面名称'), '详情页');
    await user.click(screen.getByTestId('screen-manager-create'));
    const alert = await screen.findByTestId('screen-manager-error');
    expect(alert.textContent).toContain('页面名称已存在');
    expect(alert.getAttribute('role')).toBe('alert');
  });
});
