import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copilotApi } from '../../api';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import type { RunTask } from '../shared/ui';
import { LayoutWorkspace } from './LayoutWorkspace';

vi.mock('../../api', () => ({
  copilotApi: {
    runStage: vi.fn(),
    approveArtifact: vi.fn(),
    generateUnderlayContract: vi.fn(),
    generateLayoutGuide: vi.fn(),
    updateArtifact: vi.fn()
  }
}));

const runStage = vi.mocked(copilotApi.runStage);

// 布局已批准的探索路线项目：CTA 应只导航到风格锁定，绝不触发模型执行。
const approvedExplorationProject = (overrides: Record<string, unknown> = {}) => makeProject({
  project_type: 'new',
  continuation_mode: 'exploration' as never,
  artifacts: {
    layouts: makeArtifact({
      id: 'layouts-1', status: 'generated',
      proposals: [{ id: 'layout-a', name: '效率优先', strategy: 'efficiency', regions: {} }]
    }),
    approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'approved', source_proposal: 'layout-a', manual_adjustments: [] })
  },
  ...overrides
} as never);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('LayoutWorkspace（导航与执行分离）', () => {
  it('新项目路线：点击"进入风格锁定"只导航，不调用任何模型接口', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const run: RunTask = async (task) => task();
    render(<LayoutWorkspace project={approvedExplorationProject()} busy={false} run={run} onNavigate={onNavigate} />);

    await user.click(screen.getByTestId('style-enter'));
    expect(onNavigate).toHaveBeenCalledWith('style_resolution');
    expect(runStage).not.toHaveBeenCalled();
  });

  it('现有项目无参考图时入口文案为添加参考，且同样只导航不执行', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const run: RunTask = async (task) => task();
    render(<LayoutWorkspace project={approvedExplorationProject({ project_type: 'existing' })} busy={false} run={run} onNavigate={onNavigate} />);

    await user.click(screen.getByText('进入风格锁定并添加参考'));
    expect(onNavigate).toHaveBeenCalledWith('style_resolution');
    expect(runStage).not.toHaveBeenCalled();
  });

  it('布局未批准时不显示风格入口，仅提示先批准', () => {
    const project = makeProject({
      project_type: 'new',
      continuation_mode: 'exploration' as never,
      artifacts: {
        layouts: makeArtifact({
          id: 'layouts-1', status: 'generated',
          proposals: [{ id: 'layout-a', name: '效率优先', strategy: 'efficiency', regions: {} }]
        })
      }
    });
    const run: RunTask = async (task) => task();
    render(<LayoutWorkspace project={project} busy={false} run={run} onNavigate={vi.fn()} />);
    expect(screen.queryByTestId('style-enter')).toBeNull();
    expect(screen.getByText('选择方案并批准后进入下一步。')).toBeTruthy();
  });
});
