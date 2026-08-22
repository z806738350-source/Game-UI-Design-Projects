import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

// strict 生产面板有自己的测试套件；本文件只关注视觉选择逻辑。
vi.mock('../strict-continuation/StrictProductionPanel', () => ({ StrictProductionPanel: () => null }));

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

// P0-04：strict 路线评审选择必须自动对齐到已审查的底图，保证
// 合成入口（selected[0]）永远落在证据链上。
describe('VisualWorkspace（strict 选择自动对齐审查证据）', () => {
  const strictProject = (critiqueUnderlay: string) => makeProject({
    continuation_mode: 'existing-strict' as never,
    artifacts: {
      visualResults: makeArtifact({
        id: 'visual-results-1', status: 'generated',
        variations: [
          { id: 'v1', strategy: 'conservative', image_url: 'https://example.com/v1.png' },
          { id: 'v2', strategy: 'expressive', image_url: 'https://example.com/v2.png' }
        ]
      }),
      underlayCritique: makeArtifact({ id: 'critique-1', status: 'reviewed', result: 'passed', source: { underlay: critiqueUnderlay } })
    }
  });

  it('审查对象存在时选择自动对齐，而不是默认第一张', () => {
    render(<VisualWorkspace project={strictProject('v2')} busy={false} run={run} canCancel={false} onCancel={vi.fn()} />);
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(true);
  });

  it('审查对象不在当前方向列表时回退默认选择', () => {
    render(<VisualWorkspace project={strictProject('v-removed')} busy={false} run={run} canCancel={false} onCancel={vi.fn()} />);
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
  });
});

describe('VisualWorkspace（P1-07/P1-11 评审上下文与组合语义）', () => {
  const variations = [
    { id: 'v1', strategy: 'conservative', image_url: 'data:v1' },
    { id: 'v2', strategy: 'expressive', image_url: 'data:v2' }
  ];
  const reviewProject = (screenId: string, notes: string) => makeProject({
    project_type: 'new',
    continuation_mode: 'exploration' as never,
    screen_id: screenId,
    artifacts: {
      visualResults: makeArtifact({ id: 'visual-results-1', status: 'reviewed', version: 1, variations, review: { mode: 'selected', selected_variation_ids: ['v1'], notes } })
    }
  });

  it('P1-11：组合按钮语义为记录评审建议，不再承诺成图', () => {
    render(<VisualWorkspace project={reviewProject('screen-a', '')} busy={false} run={run} canCancel={false} onCancel={vi.fn()} />);
    expect(screen.getByText('记录组合建议')).toBeTruthy();
    expect(screen.queryByText('组合所选')).toBeNull();
  });

  it('P1-07：切换 Screen 时批注重置，不携带上一屏上下文', () => {
    const { rerender } = render(<VisualWorkspace project={reviewProject('screen-a', '保留 A 屏的主视觉')} busy={false} run={run} canCancel={false} onCancel={vi.fn()} />);
    const textarea = screen.getByPlaceholderText(/保留 V2/) as HTMLTextAreaElement;
    expect(textarea.value).toBe('保留 A 屏的主视觉');
    rerender(<VisualWorkspace project={reviewProject('screen-b', '')} busy={false} run={run} canCancel={false} onCancel={vi.fn()} />);
    expect(textarea.value).toBe('');
  });
});

// AUD-03：链式任务失败不得启动后续链。否决记录失败时，重新探索绝不能被触发。
describe('VisualWorkspace（AUD-03 失败不继续链）', () => {
  const variations = [
    { id: 'v1', strategy: 'conservative', image_url: 'data:v1' },
    { id: 'v2', strategy: 'expressive', image_url: 'data:v2' },
    { id: 'v3', strategy: 'innovative', image_url: 'data:v3' }
  ];
  const generatedProject = () => makeProject({
    project_type: 'new',
    continuation_mode: 'exploration' as never,
    artifacts: {
      visualResults: makeArtifact({ id: 'visual-results-1', status: 'generated', variations })
    }
  });
  // 模拟 App.run 的失败语义：失败返回 undefined 而不是 resolve 为成功
  const failingRun: RunTask = async (task) => { try { return await task(); } catch { return undefined; } };

  it('否决记录失败时不启动根据反馈重新探索', async () => {
    const user = userEvent.setup();
    vi.mocked(copilotApi.updateArtifact).mockRejectedValueOnce(new Error('拒绝写入失败'));
    render(<VisualWorkspace project={generatedProject()} busy={false} run={failingRun} canCancel={false} onCancel={vi.fn()} />);
    await user.click(screen.getByText('全部否决并重探'));
    await waitFor(() => expect(copilotApi.updateArtifact).toHaveBeenCalledTimes(1));
    expect(runStage).not.toHaveBeenCalled();
  });

  it('否决记录成功后才启动重新探索', async () => {
    const user = userEvent.setup();
    vi.mocked(copilotApi.updateArtifact).mockResolvedValueOnce(makeProject());
    vi.mocked(copilotApi.runStage).mockResolvedValue(makeProject());
    render(<VisualWorkspace project={generatedProject()} busy={false} run={failingRun} canCancel={false} onCancel={vi.fn()} />);
    await user.click(screen.getByText('全部否决并重探'));
    await waitFor(() => expect(runStage).toHaveBeenCalledTimes(1));
    expect(runStage).toHaveBeenCalledWith('project-1', 'visual_exploration', expect.objectContaining({ feedback: '' }));
  });
});
