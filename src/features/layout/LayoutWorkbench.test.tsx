import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copilotApi } from '../../api';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import type { RunTask } from '../shared/ui';
import { LayoutWorkbench } from './LayoutWorkbench';

vi.mock('../../api', () => ({
  copilotApi: {
    approveArtifact: vi.fn(),
    repairRouteCycle: vi.fn(),
    runStage: vi.fn()
  }
}));

const api = {
  approveArtifact: vi.mocked(copilotApi.approveArtifact),
  repairRouteCycle: vi.mocked(copilotApi.repairRouteCycle),
  runStage: vi.mocked(copilotApi.runStage)
};

const projectWithProposals = () => makeProject({
  artifacts: {
    layouts: makeArtifact({
      id: 'layouts-1', status: 'generated',
      proposals: [
        { id: 'layout-a', name: '效率优先', strategy: 'efficiency', regions: { header: { label: '顶部导航', recommended_ratio: 0.2 } } },
        { id: 'layout-b', name: '表现优先', strategy: 'expressive', regions: {} }
      ]
    })
  }
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('LayoutWorkbench（布局批准）', () => {
  it('正常路径：批准所选布局时把 proposalId 与备注交给后端门禁', async () => {
    const project = projectWithProposals();
    const user = userEvent.setup();
    api.approveArtifact.mockResolvedValue(project);
    const run: RunTask = async (task) => task();
    render(<LayoutWorkbench project={project} busy={false} run={run} />);

    await user.click(screen.getByText('方案 B'));
    await user.click(screen.getByTestId('layout-approve'));
    expect(api.approveArtifact).toHaveBeenCalledWith('project-1', 'approved-layout', expect.objectContaining({ proposalId: 'layout-b', manualAdjustments: [] }));
  });

  it('失败路径：独立运行时后端拒绝会显示在工作台错误槽', async () => {
    const project = projectWithProposals();
    const user = userEvent.setup();
    api.approveArtifact.mockRejectedValue(new Error("Error invoking remote method 'copilot:approve': Error: 布局上游契约已变化，不能批准"));
    render(<LayoutWorkbench project={project} busy={false} />);

    await user.click(screen.getByTestId('layout-approve'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('布局上游契约已变化');
  });

  it('已批准且无修改时不再重复显示批准按钮', () => {
    const project = makeProject({
      artifacts: {
        layouts: makeArtifact({ id: 'layouts-1', status: 'generated', proposals: [{ id: 'layout-a', name: '效率优先', strategy: 'efficiency' }] }),
        approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'approved', source_proposal: 'layout-a', manual_adjustments: [] })
      }
    });
    render(<LayoutWorkbench project={project} busy={false} />);
    expect(screen.queryByTestId('layout-approve')).toBeNull();
  });

  it('回归：stale 布局只能用于对照，批准按钮保持隐藏', () => {
    const project = makeProject({
      artifacts: {
        layouts: makeArtifact({ id: 'layouts-1', status: 'stale', proposals: [{ id: 'layout-a', name: '效率优先', strategy: 'efficiency' }] }),
        approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'stale', source_proposal: 'layout-a' })
      }
    });
    render(<LayoutWorkbench project={project} busy={false} />);
    expect(screen.queryByTestId('layout-approve')).toBeNull();
    expect(screen.getByText(/布局提案已失效/)).toBeTruthy();
    expect(screen.getByTestId('layout-generate')).toBeTruthy();
  });

  it('stale 原因区分：契约变化提示回到功能契约，不出现修复按钮', () => {
    const project = makeProject({
      artifacts: {
        layouts: makeArtifact({ id: 'layouts-1', status: 'stale', stale_reason: 'screen-contract_changed', proposals: [{ id: 'layout-a', name: '效率优先', strategy: 'efficiency' }] }),
        approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'stale', stale_reason: 'screen-contract_changed', source_proposal: 'layout-a' })
      }
    });
    render(<LayoutWorkbench project={project} busy={false} />);
    expect(screen.getByText(/功能契约或画布输入已变化/)).toBeTruthy();
    expect(screen.queryByTestId('layout-repair')).toBeNull();
  });

  it('旧版风格循环失效：非 strict 路线提供一次性修复按钮并调用修复 API', async () => {
    const project = makeProject({
      continuation_mode: 'existing-guided',
      artifacts: {
        layouts: makeArtifact({ id: 'layouts-1', status: 'stale', stale_reason: 'style_contract_regenerated', proposals: [{ id: 'layout-a', name: '效率优先', strategy: 'efficiency' }] }),
        approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'stale', stale_reason: 'style_contract_regenerated', source_proposal: 'layout-a' })
      }
    });
    api.repairRouteCycle.mockResolvedValue(project);
    const user = userEvent.setup();
    render(<LayoutWorkbench project={project} busy={false} />);
    expect(screen.getByText(/旧版风格循环缺陷/)).toBeTruthy();
    await user.click(screen.getByTestId('layout-repair'));
    expect(api.repairRouteCycle).toHaveBeenCalledWith('project-1');
  });

  it('旧版失效原因出现在 strict 路线时不提供修复按钮，提示重新生成', () => {
    const project = makeProject({
      continuation_mode: 'existing-strict',
      artifacts: {
        layouts: makeArtifact({ id: 'layouts-1', status: 'stale', stale_reason: 'style_contract_regenerated', proposals: [{ id: 'layout-a', name: '效率优先', strategy: 'efficiency' }] }),
        approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'stale', stale_reason: 'style_contract_regenerated', source_proposal: 'layout-a' })
      }
    });
    render(<LayoutWorkbench project={project} busy={false} />);
    expect(screen.queryByTestId('layout-repair')).toBeNull();
    expect(screen.getByText(/风格规范已变化/)).toBeTruthy();
  });
});
