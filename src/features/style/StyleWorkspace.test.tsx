import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copilotApi } from '../../api';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import type { RunTask } from '../shared/ui';
import { StyleWorkspace } from './StyleWorkspace';

vi.mock('../../api', () => ({
  copilotApi: {
    runStage: vi.fn(),
    approveArtifact: vi.fn(),
    updateArtifact: vi.fn(),
    manageReference: vi.fn(),
    importFile: vi.fn()
  }
}));

const runStage = vi.mocked(copilotApi.runStage);

// 探索路线、布局已批准的新项目：风格分析按钮可用且只能手动触发。
const readyExplorationProject = (overrides: Record<string, unknown> = {}) => makeProject({
  project_type: 'new',
  continuation_mode: 'exploration' as never,
  artifacts: {
    approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'approved', source_proposal: 'layout-a', manual_adjustments: [] })
  },
  ...overrides
} as never);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('StyleWorkspace（风格分析只由用户显式触发）', () => {
  it('进入阶段初次渲染不调用任何模型接口（修复进入即自动分析）', () => {
    const run: RunTask = async (task) => task();
    render(<StyleWorkspace project={readyExplorationProject()} busy={false} run={run} />);
    expect(runStage).not.toHaveBeenCalled();
    expect(screen.getByTestId('style-generate')).toBeTruthy();
    expect(screen.getByText('开始风格分析')).toBeTruthy();
  });

  it('点击"开始风格分析"才执行 style_resolution 一次', async () => {
    const user = userEvent.setup();
    const run: RunTask = async (task) => task();
    render(<StyleWorkspace project={readyExplorationProject()} busy={false} run={run} />);

    await user.click(screen.getByTestId('style-generate'));
    expect(runStage).toHaveBeenCalledTimes(1);
    expect(runStage).toHaveBeenCalledWith('project-1', 'style_resolution', expect.objectContaining({ confirmReferenceOmissions: false }));
  });

  it('规范 stale 时文案提示重新解析，仍只能手动触发', () => {
    const project = readyExplorationProject({
      artifacts: {
        approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'approved', source_proposal: 'layout-a', manual_adjustments: [] }),
        styleContract: makeArtifact({ id: 'style-contract-1', status: 'stale' })
      }
    });
    const run: RunTask = async (task) => task();
    render(<StyleWorkspace project={project} busy={false} run={run} />);
    expect(runStage).not.toHaveBeenCalled();
    expect(screen.getByText('参考已变化，重新解析风格')).toBeTruthy();
    expect(screen.queryByTestId('style-approve')).toBeNull();
  });

  it('布局未批准时按钮禁用并提示先批准布局', () => {
    const project = makeProject({ project_type: 'new', continuation_mode: 'exploration' as never });
    const run: RunTask = async (task) => task();
    render(<StyleWorkspace project={project} busy={false} run={run} />);
    expect((screen.getByTestId('style-generate') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('请先批准布局。')).toBeTruthy();
    expect(runStage).not.toHaveBeenCalled();
  });

  it('风格锁定后「生成 3 个方向」只能由用户显式点击触发', async () => {
    const user = userEvent.setup();
    const project = readyExplorationProject({
      artifacts: {
        approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'approved', source_proposal: 'layout-a', manual_adjustments: [] }),
        styleContract: makeArtifact({ id: 'style-contract-1', status: 'approved' })
      }
    });
    const run: RunTask = async (task) => task();
    render(<StyleWorkspace project={project} busy={false} run={run} />);
    // 进入页面不会自动发起视觉生成
    expect(runStage).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('visual-generate'));
    expect(runStage).toHaveBeenCalledTimes(1);
    expect(runStage).toHaveBeenCalledWith('project-1', 'visual_exploration', expect.anything());
  });
});
