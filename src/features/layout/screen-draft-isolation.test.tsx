// AUD-11 负向回归：Screen-scoped 工作台的本地草稿（方案选择、批准备注、
// 需求文本、美术方向）在切换 Screen 后必须重置，不得把 A 屏未保存的草稿
// 残留到 B 屏。
import { cleanup, fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copilotApi } from '../../api';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import type { RunTask } from '../shared/ui';
import { InputWorkspace } from '../input/InputWorkspace';
import { LayoutWorkspace } from './LayoutWorkspace';

vi.mock('../../api', () => ({
  copilotApi: {
    runStage: vi.fn(),
    approveArtifact: vi.fn(),
    saveProject: vi.fn(),
    draftRequirement: vi.fn(),
    importFile: vi.fn(),
    generateUnderlayContract: vi.fn(),
    generateLayoutGuide: vi.fn(),
    repairRouteCycle: vi.fn()
  }
}));

const run: RunTask = async (task) => task();

// 方案名同时出现在提案标签与详情面板，只查提案标签栏里的按钮。
const proposalTab = (name: string) => [...document.querySelectorAll('.proposal-tabs button')].find((button) => button.textContent?.includes(name)) as HTMLButtonElement;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const layoutProject = (screenId: string) => makeProject({
  project_type: 'new',
  continuation_mode: 'exploration' as never,
  screen_id: screenId,
  artifacts: {
    layouts: makeArtifact({
      id: `${screenId}-layouts`, status: 'generated',
      proposals: [
        { id: 'layout-a', name: '效率优先', strategy: 'efficiency', regions: {} },
        { id: 'layout-b', name: '表现优先', strategy: 'expressive', regions: {} }
      ]
    })
  }
} as never);

describe('AUD-11 布局工作台草稿隔离', () => {
  it('切换 Screen 后未保存的方案选择回到默认方案', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LayoutWorkspace project={layoutProject('screen-a')} busy={false} run={run} onNavigate={vi.fn()} />);
    await user.click(proposalTab('表现优先'));
    expect(proposalTab('表现优先').className).toContain('is-selected');
    // 切到 B 屏：A 屏的未保存选择不得残留。
    rerender(<LayoutWorkspace project={layoutProject('screen-b')} busy={false} run={run} onNavigate={vi.fn()} />);
    expect(proposalTab('效率优先').className).toContain('is-selected');
    expect(proposalTab('表现优先').className).not.toContain('is-selected');
  });

  it('同一 Screen 内 layouts 版本变化后旧选择同样重置', async () => {
    const user = userEvent.setup();
    const project = layoutProject('screen-a');
    const { rerender } = render(<LayoutWorkspace project={project} busy={false} run={run} onNavigate={vi.fn()} />);
    await user.click(proposalTab('表现优先'));
    // 批准/再生成会 bump 版本，旧选择不再有效，必须回到默认方案。
    const next = layoutProject('screen-a');
    (next.artifacts.layouts as { version: number }).version = 2;
    rerender(<LayoutWorkspace project={next} busy={false} run={run} onNavigate={vi.fn()} />);
    expect(proposalTab('效率优先').className).toContain('is-selected');
  });
});

describe('AUD-11 输入工作台草稿隔离', () => {
  it('切换 Screen 后未保存的需求与美术方向草稿重置为该屏事实', () => {
    const projectA = makeProject({ id: 'project-1', screen_id: 'screen-a', requirement: 'A 屏需求', art_direction: 'A 屏方向' });
    const { rerender } = render(<InputWorkspace project={projectA} busy={false} run={run} />);
    const textarea = document.querySelector('.design-brief-card textarea') as HTMLTextAreaElement;
    const directionInput = document.querySelector('.art-direction-card input') as HTMLInputElement;
    fireEvent.change(textarea, { target: { value: 'A 屏未保存的草稿' } });
    fireEvent.change(directionInput, { target: { value: '未保存的方向草稿' } });
    expect(textarea.value).toBe('A 屏未保存的草稿');
    // 切到 B 屏：草稿必须重置为 B 屏的事实值。
    const projectB = makeProject({ id: 'project-1', screen_id: 'screen-b', requirement: 'B 屏需求', art_direction: 'B 屏方向' });
    rerender(<InputWorkspace project={projectB} busy={false} run={run} />);
    expect(textarea.value).toBe('B 屏需求');
    expect(directionInput.value).toBe('B 屏方向');
  });
});
