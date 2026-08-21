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
    updateArtifact: vi.fn()
  }
}));

const runStage = vi.mocked(copilotApi.runStage);
const approveArtifact = vi.mocked(copilotApi.approveArtifact);
const generateUnderlayContract = vi.mocked(copilotApi.generateUnderlayContract);
const generateLayoutGuide = vi.mocked(copilotApi.generateLayoutGuide);

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
