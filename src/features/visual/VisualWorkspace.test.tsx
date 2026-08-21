import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copilotApi } from '../../api';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import type { RunTask } from '../shared/ui';
import { VisualWorkspace } from './VisualWorkspace';

vi.mock('../../api', () => ({
  copilotApi: {
    runStage: vi.fn(),
    approveArtifact: vi.fn(),
    updateArtifact: vi.fn(),
    exportVisual: vi.fn(),
    runUnderlayCritique: vi.fn(),
    repairUnderlay: vi.fn(),
    composeVisual: vi.fn(),
    runFidelity: vi.fn()
  }
}));

const runStage = vi.mocked(copilotApi.runStage);

// P0-02：视觉生成的参考图容量确认必须有可达入口，且确认携带 Pack hash。
const underlayPack = (overrides: Record<string, unknown> = {}) => makeArtifact({
  id: 'underlay-generation-reference-pack', status: 'reviewed',
  purpose: 'underlay-generation', provider_limit: 2, pack_hash: 'pack-hash-1',
  requires_omission_confirmation: true,
  selected: [
    { id: 'component', name: '组件页', role: 'component' },
    { id: 'guide', name: 'main-underlay-layout-guide', role: 'structure-guide' }
  ],
  omitted: [{ id: 'support', name: '辅助页', role: 'supporting', reason: 'provider-capacity:2' }],
  capacity_decision: { used: 2, limit: 2, omitted: 1 },
  ...overrides
});

const projectWithPack = (pack: unknown) => makeProject({
  project_type: 'new',
  continuation_mode: 'exploration' as never,
  artifacts: {
    visualResults: makeArtifact({ id: 'visual-results-1', status: 'generated', variations: [] }),
    referencePack: pack as never
  }
});

const run: RunTask = async (task) => task();

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('VisualWorkspace（参考图容量确认入口）', () => {
  it('待确认 Pack 展示完整省略清单、Guide 占位与确认按钮', () => {
    render(<VisualWorkspace project={projectWithPack(underlayPack())} busy={false} run={run} canCancel={false} onCancel={vi.fn()} />);
    expect(screen.getByTestId('visual-omission-panel')).toBeTruthy();
    expect(screen.getByText(/组件页、main-underlay-layout-guide/)).toBeTruthy();
    expect(screen.getByText(/被省略参考：辅助页/)).toBeTruthy();
    expect(screen.getByText(/Layout Guide 占用 1 个附件位/)).toBeTruthy();
    expect(screen.getByText(/容量 2\/2 张附件位/)).toBeTruthy();
  });

  it('确认按钮携带当前 Pack hash 重新发起视觉生成', async () => {
    const user = userEvent.setup();
    render(<VisualWorkspace project={projectWithPack(underlayPack())} busy={false} run={run} canCancel={false} onCancel={vi.fn()} />);
    await user.click(screen.getByTestId('visual-omission-confirm'));
    expect(runStage).toHaveBeenCalledWith('project-1', 'visual_exploration', { confirmReferenceOmissions: true, referencePackHash: 'pack-hash-1' });
  });

  it('style-resolution Pack 与已确认 Pack 不触发视觉确认面板', () => {
    render(<VisualWorkspace project={projectWithPack(underlayPack({ purpose: 'style-resolution' }))} busy={false} run={run} canCancel={false} onCancel={vi.fn()} />);
    expect(screen.queryByTestId('visual-omission-panel')).toBeNull();
    render(<VisualWorkspace project={projectWithPack(underlayPack({ requires_omission_confirmation: false, status: 'approved' }))} busy={false} run={run} canCancel={false} onCancel={vi.fn()} />);
    expect(screen.queryAllByTestId('visual-omission-panel')).toHaveLength(0);
  });
});
