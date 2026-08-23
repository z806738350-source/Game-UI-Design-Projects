import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import { LayoutWorkbench } from './LayoutWorkbench';

// AUD-14：工作台 stale 分支只显示失效原因与证据，不再渲染任何恢复按钮；
// 恢复动作统一由 sticky Footer 按 layoutStaleGuidance 分派（点击覆盖见
// LayoutWorkspace.test.tsx）。

// 工作台现为受控组件：选择与备注由 LayoutWorkspace 持有，批准按钮也
// 移到常显底栏（见 LayoutWorkspace.test.tsx），这里只验证对照与失效分支。
const controlled = { selected: 'layout-a', onSelect: () => {}, notes: '', onNotes: () => {} };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('LayoutWorkbench（布局对照与失效分支）', () => {
  it('已批准且无修改时工作台内不再渲染批准按钮', () => {
    const project = makeProject({
      artifacts: {
        layouts: makeArtifact({ id: 'layouts-1', status: 'generated', proposals: [{ id: 'layout-a', name: '效率优先', strategy: 'efficiency' }] }),
        approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'approved', source_proposal: 'layout-a', manual_adjustments: [] })
      }
    });
    render(<LayoutWorkbench project={project} busy={false} {...controlled} />);
    expect(screen.queryByTestId('layout-approve')).toBeNull();
  });

  it('回归：stale 布局只能用于对照，批准按钮保持隐藏', () => {
    const project = makeProject({
      artifacts: {
        layouts: makeArtifact({ id: 'layouts-1', status: 'stale', proposals: [{ id: 'layout-a', name: '效率优先', strategy: 'efficiency' }] }),
        approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'stale', source_proposal: 'layout-a' })
      }
    });
    render(<LayoutWorkbench project={project} busy={false} {...controlled} />);
    expect(screen.queryByTestId('layout-approve')).toBeNull();
    expect(screen.getByText(/布局提案已失效/)).toBeTruthy();
    expect(screen.getByTestId('layout-stale-notice')).toBeTruthy();
    // AUD-14：工作台不再提供与 Footer 冲突的恢复按钮。
    expect(screen.queryByTestId('layout-generate')).toBeNull();
    expect(screen.queryByTestId('layout-repair')).toBeNull();
  });

  it('stale 原因区分：契约变化提示回到功能契约，不出现修复按钮', () => {
    const project = makeProject({
      artifacts: {
        layouts: makeArtifact({ id: 'layouts-1', status: 'stale', stale_reason: 'screen-contract_changed', proposals: [{ id: 'layout-a', name: '效率优先', strategy: 'efficiency' }] }),
        approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'stale', stale_reason: 'screen-contract_changed', source_proposal: 'layout-a' })
      }
    });
    render(<LayoutWorkbench project={project} busy={false} {...controlled} />);
    expect(screen.getByText(/功能契约或画布输入已变化/)).toBeTruthy();
    expect(screen.queryByTestId('layout-repair')).toBeNull();
    expect(screen.queryByTestId('layout-generate')).toBeNull();
  });

  it('旧版风格循环失效：非 strict 路线工作台只显示修复指引，不渲染修复按钮', () => {
    const project = makeProject({
      continuation_mode: 'existing-guided',
      artifacts: {
        layouts: makeArtifact({ id: 'layouts-1', status: 'stale', stale_reason: 'style_contract_regenerated', proposals: [{ id: 'layout-a', name: '效率优先', strategy: 'efficiency' }] }),
        approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'stale', stale_reason: 'style_contract_regenerated', source_proposal: 'layout-a' })
      }
    });
    render(<LayoutWorkbench project={project} busy={false} {...controlled} />);
    expect(screen.getByText(/旧版风格循环缺陷/)).toBeTruthy();
    expect(screen.queryByTestId('layout-repair')).toBeNull();
    expect(screen.queryByTestId('layout-generate')).toBeNull();
  });

  it('旧版失效原因出现在 strict 路线时不提供修复按钮，提示重新生成', () => {
    const project = makeProject({
      continuation_mode: 'existing-strict',
      artifacts: {
        layouts: makeArtifact({ id: 'layouts-1', status: 'stale', stale_reason: 'style_contract_regenerated', proposals: [{ id: 'layout-a', name: '效率优先', strategy: 'efficiency' }] }),
        approvedLayout: makeArtifact({ id: 'approved-layout-1', status: 'stale', stale_reason: 'style_contract_regenerated', source_proposal: 'layout-a' })
      }
    });
    render(<LayoutWorkbench project={project} busy={false} {...controlled} />);
    expect(screen.queryByTestId('layout-repair')).toBeNull();
    expect(screen.queryByTestId('layout-generate')).toBeNull();
    expect(screen.getByText(/风格规范已变化/)).toBeTruthy();
  });
});
