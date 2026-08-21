import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copilotApi } from '../../api';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import type { RunTask } from '../shared/ui';
import { ContractWorkspace } from './ContractWorkspace';

vi.mock('../../api', () => ({
  copilotApi: {
    runStage: vi.fn(),
    approveArtifact: vi.fn(),
    updateArtifact: vi.fn()
  }
}));

const runStage = vi.mocked(copilotApi.runStage);

// 已批准的契约：footer CTA 按路线分叉（strict 去风格锁定，其余生成布局）。
const approvedContractProject = (mode: string) => makeProject({
  continuation_mode: mode as never,
  artifacts: {
    screenContract: makeArtifact({
      id: 'screen-contract-1', status: 'approved', screen_name: '队伍编成', purpose: '选择出战阵容', primary_action: '确认编成',
      required_controls: [], required_information: [], states: [], edge_cases: []
    })
  }
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ContractWorkspace（路线感知 CTA）', () => {
  it('严格路线：批准契约后点击"进入风格锁定"只导航，不执行模型', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const run: RunTask = async (task) => task();
    render(<ContractWorkspace project={approvedContractProject('existing-strict')} busy={false} run={run} onNavigate={onNavigate} />);

    expect(screen.queryByTestId('layout-generate')).toBeNull();
    await user.click(screen.getByTestId('style-enter'));
    expect(onNavigate).toHaveBeenCalledWith('style_resolution');
    expect(runStage).not.toHaveBeenCalled();
  });

  it('探索路线：批准契约后 CTA 为生成布局提案并直接执行 layout_design', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const run: RunTask = async (task) => task();
    render(<ContractWorkspace project={approvedContractProject('exploration')} busy={false} run={run} onNavigate={onNavigate} />);

    expect(screen.queryByTestId('style-enter')).toBeNull();
    await user.click(screen.getByTestId('layout-generate'));
    expect(runStage).toHaveBeenCalledWith('project-1', 'layout_design');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('引导路线与探索路线一致：先生成布局而非进入风格', () => {
    const run: RunTask = async (task) => task();
    render(<ContractWorkspace project={approvedContractProject('existing-guided')} busy={false} run={run} onNavigate={vi.fn()} />);
    expect(screen.queryByTestId('style-enter')).toBeNull();
    expect(screen.getByTestId('layout-generate')).toBeTruthy();
  });
});
