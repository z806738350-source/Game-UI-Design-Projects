import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    updateArtifact: vi.fn(),
    repairRouteCycle: vi.fn()
  }
}));

const runStage = vi.mocked(copilotApi.runStage);
const approveArtifact = vi.mocked(copilotApi.approveArtifact);
const generateUnderlayContract = vi.mocked(copilotApi.generateUnderlayContract);
const generateLayoutGuide = vi.mocked(copilotApi.generateLayoutGuide);
const repairRouteCycle = vi.mocked(copilotApi.repairRouteCycle);

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

  it('布局未批准时批准与风格入口并排常显，入口置灰直至批准', () => {
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
    expect(screen.getByTestId('layout-approve')).toBeTruthy();
    expect(((screen.getByTestId('style-enter')) as HTMLButtonElement).disabled).toBe(true);
  });

  it('批准所选方案时把 proposalId 与备注交给后端门禁', async () => {
    const user = userEvent.setup();
    const project = makeProject({
      project_type: 'new',
      continuation_mode: 'exploration' as never,
      artifacts: {
        layouts: makeArtifact({
          id: 'layouts-1', status: 'generated',
          proposals: [
            { id: 'layout-a', name: '效率优先', strategy: 'efficiency', regions: {} },
            { id: 'layout-b', name: '表现优先', strategy: 'expressive', regions: {} }
          ]
        })
      }
    });
    approveArtifact.mockResolvedValue(project);
    const run: RunTask = async (task) => task();
    render(<LayoutWorkspace project={project} busy={false} run={run} onNavigate={vi.fn()} />);

    await user.click(screen.getByText('方案 B'));
    await user.click(screen.getByTestId('layout-approve'));
    expect(approveArtifact).toHaveBeenCalledWith('project-1', 'approved-layout', expect.objectContaining({ proposalId: 'layout-b', manualAdjustments: [] }));
  });

  it('批准后切换回未批准的方案时风格入口重新置灰', async () => {
    const user = userEvent.setup();
    const project = approvedExplorationProject({
      artifacts: {
        layouts: makeArtifact({
          id: 'layouts-1', status: 'generated',
          proposals: [
            { id: 'layout-a', name: '效率优先', strategy: 'efficiency', regions: {} },
            { id: 'layout-b', name: '表现优先', strategy: 'expressive', regions: {} }
          ]
        }),
        approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'approved', source_proposal: 'layout-a', manual_adjustments: [] })
      }
    });
    const run: RunTask = async (task) => task();
    render(<LayoutWorkspace project={project} busy={false} run={run} onNavigate={vi.fn()} />);
    expect(((screen.getByTestId('style-enter')) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByText('方案 B'));
    expect(((screen.getByTestId('style-enter')) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('layout-approve')).toBeTruthy();
  });
});

// P0-01：严格路线下一步必须按 Underlay Contract 完整状态判断；stale 时
// 旧 layout_guide 仍留在对象里，只看 Guide 会永远指向“生成底层图”死循环。
const strictWithUnderlay = (underlay: Record<string, unknown> | null) => makeProject({
  project_type: 'existing',
  artifacts: {
    layouts: makeArtifact({
      id: 'layouts-1', status: 'generated',
      proposals: [{ id: 'layout-a', name: '效率优先', strategy: 'efficiency', regions: {} }]
    }),
    approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'approved', source_proposal: 'layout-a', manual_adjustments: [] }),
    styleContract: makeArtifact({ id: 'style-1', status: 'approved' }),
    underlayContract: underlay ? makeArtifact(underlay) : null
  }
});

describe('LayoutWorkspace（严格底层规范状态机）', () => {
  const user = () => userEvent.setup();
  const run: RunTask = async (task) => task();
  beforeEach(() => {
    const next = makeProject();
    generateUnderlayContract.mockResolvedValue(next);
    approveArtifact.mockResolvedValue(next);
    generateLayoutGuide.mockResolvedValue(next);
  });

  it('无契约 → 建立底层规范（生成契约+批准+Guide）', async () => {
    render(<LayoutWorkspace project={strictWithUnderlay(null)} busy={false} run={run} onNavigate={vi.fn()} />);
    await user().click(screen.getByTestId('underlay-prepare'));
    expect(generateUnderlayContract).toHaveBeenCalledTimes(1);
    expect(approveArtifact).toHaveBeenCalledWith('project-1', 'underlay-contract');
    expect(generateLayoutGuide).toHaveBeenCalledTimes(1);
  });

  it('契约 stale（即使旧 Guide 仍在）→ 重新建立底层规范，绝不显示生成底层图', async () => {
    render(<LayoutWorkspace project={strictWithUnderlay({ id: 'underlay-1', status: 'stale', stale_reason: 'style_contract_regenerated', layout_guide: { path: 'screens/main/underlay-guide.md' } })} busy={false} run={run} onNavigate={vi.fn()} />);
    expect(screen.queryByTestId('underlay-generate')).toBeNull();
    await user().click(screen.getByTestId('underlay-rebuild'));
    expect(generateUnderlayContract).toHaveBeenCalledTimes(1);
  });

  it('契约待确认 → 批准契约并生成 Guide', async () => {
    render(<LayoutWorkspace project={strictWithUnderlay({ id: 'underlay-1', status: 'generated' })} busy={false} run={run} onNavigate={vi.fn()} />);
    await user().click(screen.getByTestId('underlay-approve'));
    expect(approveArtifact).toHaveBeenCalledWith('project-1', 'underlay-contract');
    expect(generateLayoutGuide).toHaveBeenCalledTimes(1);
  });

  it('契约已批准但无 Guide → 生成 Layout Guide', async () => {
    render(<LayoutWorkspace project={strictWithUnderlay({ id: 'underlay-1', status: 'approved' })} busy={false} run={run} onNavigate={vi.fn()} />);
    await user().click(screen.getByTestId('underlay-guide'));
    expect(generateLayoutGuide).toHaveBeenCalledTimes(1);
    expect(runStage).not.toHaveBeenCalled();
  });

  it('契约已批准且有 Guide → 生成底层图', async () => {
    render(<LayoutWorkspace project={strictWithUnderlay({ id: 'underlay-1', status: 'approved', layout_guide: { path: 'screens/main/underlay-guide.md' } })} busy={false} run={run} onNavigate={vi.fn()} />);
    await user().click(screen.getByTestId('underlay-generate'));
    expect(runStage).toHaveBeenCalledWith('project-1', 'visual_exploration', expect.anything());
  });
});

// AUD-14：布局 stale 时全部恢复动作集中在 sticky Footer，按
// layoutStaleGuidance 的 action 分派；工作台不再提供冲突按钮。
const staleLayouts = (staleReason: string | undefined, overrides: Record<string, unknown> = {}) => makeProject({
  project_type: 'existing',
  artifacts: {
    layouts: makeArtifact({
      id: 'layouts-1', status: 'stale', stale_reason: staleReason,
      proposals: [{ id: 'layout-a', name: '效率优先', strategy: 'efficiency', regions: {} }]
    }),
    approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'stale', stale_reason: staleReason, source_proposal: 'layout-a' })
  },
  ...overrides
} as never);

describe('LayoutWorkspace（stale Footer 统一分派）', () => {
  const run: RunTask = async (task) => task();

  it('契约变化 → Footer 按钮为“先更新功能契约”并导航回契约页', async () => {
    const onNavigate = vi.fn();
    render(<LayoutWorkspace project={staleLayouts('screen-contract_changed')} busy={false} run={run} onNavigate={onNavigate} />);
    await userEvent.setup().click(screen.getByText('先更新功能契约'));
    expect(onNavigate).toHaveBeenCalledWith('wireframe_interpretation');
    expect(runStage).not.toHaveBeenCalled();
  });

  it('旧版风格循环失效（非 strict）→ Footer 提供一次性修复并调用修复 API', async () => {
    repairRouteCycle.mockResolvedValue(makeProject());
    render(<LayoutWorkspace project={staleLayouts('style_contract_regenerated', { continuation_mode: 'existing-guided' })} busy={false} run={run} onNavigate={vi.fn()} />);
    await userEvent.setup().click(screen.getByText('执行一次性修复'));
    expect(repairRouteCycle).toHaveBeenCalledWith('project-1');
  });

  it('其余失效原因 → Footer 按钮为重新生成布局并执行布局阶段', async () => {
    runStage.mockResolvedValue(makeProject());
    render(<LayoutWorkspace project={staleLayouts(undefined)} busy={false} run={run} onNavigate={vi.fn()} />);
    await userEvent.setup().click(screen.getByText('重新生成布局'));
    expect(runStage).toHaveBeenCalledWith('project-1', 'layout_design');
  });
});
