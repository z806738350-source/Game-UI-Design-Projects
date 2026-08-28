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

// 语义角色门禁路线感知：strict 才强制解析具体角色（绑定策略前置）；
// 探索/引导路线不生产绑定，通用 'action' 角色条目必须可直接保存。
const controlEditProject = (mode: string) => makeProject({
  continuation_mode: mode as never,
  artifacts: {
    screenContract: makeArtifact({
      id: 'screen-contract-1', status: 'reviewed', screen_name: '队伍编成', purpose: '选择出战阵容', primary_action: '确认编成',
      required_controls: [{ id: 'save-lineup', label: '保存阵容', role: 'action', required: true }],
      required_information: [], states: [], edge_cases: []
    })
  }
});

describe('ContractWorkspace（语义角色门禁路线感知）', () => {
  it('探索路线：角色可选，通用角色条目可直接保存，列表显示中文角色标签', async () => {
    const user = userEvent.setup();
    const view = render(<ContractWorkspace project={controlEditProject('exploration')} busy={false} run={async (task) => task()} onNavigate={vi.fn()} />);
    await user.click(screen.getByTestId('contract-open-required_controls'));
    await user.click(screen.getByTitle('编辑条目'));
    const save = screen.getByRole('button', { name: '保存条目' });
    expect(save.hasAttribute('disabled')).toBe(false);
    await user.click(save);
    expect(view.container.textContent).toContain('通用操作（待语义解析）');
    expect(view.container.textContent).toContain('有未保存修改');
  });

  it('strict 路线：必须先解析具体角色才能保存，下拉显示中文标签', async () => {
    const user = userEvent.setup();
    render(<ContractWorkspace project={controlEditProject('existing-strict')} busy={false} run={async (task) => task()} onNavigate={vi.fn()} />);
    await user.click(screen.getByTestId('contract-open-required_controls'));
    await user.click(screen.getByTitle('编辑条目'));
    const save = screen.getByRole('button', { name: '保存条目' });
    expect(save.hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('combobox', { name: '选择控件语义角色' }));
    await user.click(screen.getByRole('option', { name: '主操作按钮' }));
    expect(save.hasAttribute('disabled')).toBe(false);
  });
});

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

// 覆盖条必须如实展示后端重算结果：有差异时显示留痕条列出未保留项，
// 且不拦截批准（设计师调整结果为准确答案）；不得再显示假绿灯。
const coverageProject = (coverage: Record<string, unknown>) => makeProject({
  continuation_mode: 'exploration' as never,
  artifacts: {
    screenContract: makeArtifact({
      id: 'screen-contract-1', status: 'reviewed', screen_name: '选择材料', purpose: '选择上阵材料', primary_action: '确认选择',
      required_controls: [], required_information: [], states: [], edge_cases: [], coverage
    })
  }
});

describe('ContractWorkspace（诚实覆盖条与批准预对齐）', () => {
  it('覆盖完整：绿条显示 0 项遗漏且批准可点击', () => {
    const run: RunTask = async (task) => task();
    render(<ContractWorkspace project={coverageProject({ covered_items: ['保存阵容'], uncovered_items: [] })} busy={false} run={run} onNavigate={vi.fn()} />);
    const strip = screen.getByTestId('contract-coverage');
    expect(strip.textContent).toContain('UE 来源覆盖校验通过');
    expect(strip.textContent).toContain('0 项遗漏');
    expect(screen.getByTestId('contract-approve').hasAttribute('disabled')).toBe(false);
  });

  it('覆盖差异：留痕条展示未保留项且不拦截批准', () => {
    const run: RunTask = async (task) => task();
    render(<ContractWorkspace project={coverageProject({ covered_items: [], uncovered_items: ['底部导航-试炼按钮', '玩家头像'] })} busy={false} run={run} onNavigate={vi.fn()} />);
    const strip = screen.getByTestId('contract-coverage');
    expect(strip.textContent).toContain('来源清单对照');
    expect(strip.textContent).toContain('2 项本轮契约未保留');
    expect(strip.textContent).toContain('底部导航-试炼按钮');
    expect(strip.textContent).toContain('批准与下游以你的调整结果为准');
    expect(screen.getByTestId('contract-approve').hasAttribute('disabled')).toBe(false);
  });
});
