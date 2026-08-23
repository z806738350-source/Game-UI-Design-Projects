import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copilotApi } from '../../api';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import type { DesignProject } from '../../types';
import { StrictProductionPanel } from './StrictProductionPanel';

vi.mock('../../api', () => ({
  copilotApi: {
    runUnderlayCritique: vi.fn(),
    repairUnderlay: vi.fn(),
    approveUnderlayWaiver: vi.fn(),
    approveUnderlayManualReview: vi.fn(),
    composeVisual: vi.fn(),
    runFidelity: vi.fn(),
    approveArtifact: vi.fn(),
    exportVisual: vi.fn()
  }
}));

vi.mock('../production/fontFaceLoader', () => ({ loadProjectExactFonts: vi.fn().mockResolvedValue(undefined) }));

const approveUnderlayManualReview = vi.mocked(copilotApi.approveUnderlayManualReview);

const withCritique = (critique: Record<string, unknown> | null) => makeProject({
  artifacts: { underlayCritique: critique ? makeArtifact(critique) : null }
});

const run = async (task: () => Promise<DesignProject>) => task();

afterEach(() => { cleanup(); vi.clearAllMocks(); });

// P0-03：manual_review.required 的 Critique 必须有可达的人工复核完成入口，
// 且入口必须记录结论与理由，不能空提交。
describe('StrictProductionPanel（人工复核入口）', () => {
  it('要求人工复核时展示复核面板，结论与理由齐备后才可提交', async () => {
    const user = userEvent.setup();
    render(<StrictProductionPanel project={withCritique({ id: 'critique-1', status: 'reviewed', result: 'manual-review', issues: [], evidence: {}, manual_review: { required: true, approved: false }, manual_waivers: [] })} underlayId="v1" busy={false} run={run} />);
    expect(screen.getByTestId('underlay-manual-review-panel')).toBeTruthy();
    const submit = screen.getByTestId('underlay-manual-review');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByPlaceholderText(/已逐区核对底层图/), '人工确认底层图干净可用');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByPlaceholderText(/说明判断依据/), '已对照主参考页核查全部保留区域');
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await user.click(submit);
    expect(approveUnderlayManualReview).toHaveBeenCalledWith('project-1', { conclusion: '人工确认底层图干净可用', reason: '已对照主参考页核查全部保留区域' });
  });

  it('人工复核完成后展示审计记录，不再出现复核表单', () => {
    render(<StrictProductionPanel project={withCritique({ id: 'critique-1', status: 'reviewed', result: 'passed', issues: [], evidence: {}, manual_review: { required: true, approved: true, approved_by: 'ui-designer', approved_at: '2026-08-21T00:00:00.000Z', conclusion: '人工确认底层图干净可用' }, manual_waivers: [] })} underlayId="v1" busy={false} run={run} />);
    expect(screen.queryByTestId('underlay-manual-review-panel')).toBeNull();
    expect(screen.getByTestId('underlay-manual-review-done')).toBeTruthy();
  });

  it('未要求人工复核的审查不出现复核面板', () => {
    render(<StrictProductionPanel project={withCritique({ id: 'critique-1', status: 'reviewed', result: 'failed', issues: [], evidence: {}, manual_review: { required: false, approved: false }, manual_waivers: [] })} underlayId="v1" busy={false} run={run} />);
    expect(screen.queryByTestId('underlay-manual-review-panel')).toBeNull();
    expect(screen.queryByTestId('underlay-manual-review-done')).toBeNull();
  });
});

// P0-04：证据链匹配——选中底图必须是被审查的那张，否则合成入口禁用
// 并展示警告条，避免 A 的审查证据被用于合成 B。
describe('StrictProductionPanel（证据链匹配守卫）', () => {
  const withSource = (underlay: string) => withCritique({ id: 'critique-1', status: 'reviewed', result: 'passed', source: { underlay }, issues: [], evidence: {}, manual_waivers: [] });

  it('选中底图与审查对象不一致时展示警告并禁用合成入口', () => {
    render(<StrictProductionPanel project={withSource('v1')} underlayId="v2" busy={false} run={run} />);
    const warning = screen.getByTestId('underlay-evidence-mismatch');
    expect(warning.textContent).toContain('审查对象是 v1');
    expect(warning.textContent).toContain('选中底图是 v2');
    expect((screen.getByTestId('composition-preview') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('composition-final') as HTMLButtonElement).disabled).toBe(true);
  });

  it('证据匹配时不出现警告条，合成入口不因证据链禁用', () => {
    render(<StrictProductionPanel project={withSource('v1')} underlayId="v1" busy={false} run={run} />);
    expect(screen.queryByTestId('underlay-evidence-mismatch')).toBeNull();
    expect((screen.getByTestId('composition-preview') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('composition-final') as HTMLButtonElement).disabled).toBe(false);
  });
});

// AUD-05：UI 层与后端 reviewGate 预对齐——stale Critique 或审查时冻结的
// visual_results_version 与当前版本不一致，都不得显示绿灯或放开合成入口。
describe('StrictProductionPanel（stale/版本证据守卫）', () => {
  const passedCritique = (extra: Record<string, unknown> = {}) => ({
    id: 'critique-1', status: 'reviewed', result: 'passed', source: { underlay: 'v1', visual_results_version: 2 },
    issues: [], evidence: {}, manual_waivers: [], ...extra
  });

  it('stale Critique 不显示绿灯并禁用合成入口', () => {
    const project = makeProject({
      artifacts: {
        underlayCritique: makeArtifact(passedCritique({ status: 'stale' })),
        visualResults: makeArtifact({ id: 'visuals-1', status: 'generated', version: 2, variations: [] })
      }
    });
    render(<StrictProductionPanel project={project} underlayId="v1" busy={false} run={run} />);
    expect(screen.getByTestId('critique-stale-warning')).toBeTruthy();
    expect(screen.getByTestId('strict-gate-critique').className).not.toContain('is-ready');
    expect((screen.getByTestId('composition-preview') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('composition-final') as HTMLButtonElement).disabled).toBe(true);
  });

  it('审查冻结版本与当前 Visual Results 版本不一致时禁用合成入口', () => {
    const project = makeProject({
      artifacts: {
        underlayCritique: makeArtifact(passedCritique()),
        visualResults: makeArtifact({ id: 'visuals-1', status: 'generated', version: 3, variations: [] })
      }
    });
    render(<StrictProductionPanel project={project} underlayId="v1" busy={false} run={run} />);
    const warning = screen.getByTestId('critique-version-mismatch');
    expect(warning.textContent).toContain('V2');
    expect(warning.textContent).toContain('V3');
    expect(screen.getByTestId('strict-gate-critique').className).not.toContain('is-ready');
    expect((screen.getByTestId('composition-final') as HTMLButtonElement).disabled).toBe(true);
  });

  it('版本一致且非 stale 时绿灯与合成入口照常', () => {
    const project = makeProject({
      artifacts: {
        underlayCritique: makeArtifact(passedCritique()),
        visualResults: makeArtifact({ id: 'visuals-1', status: 'generated', version: 2, variations: [] })
      }
    });
    render(<StrictProductionPanel project={project} underlayId="v1" busy={false} run={run} />);
    expect(screen.queryByTestId('critique-stale-warning')).toBeNull();
    expect(screen.queryByTestId('critique-version-mismatch')).toBeNull();
    expect(screen.getByTestId('strict-gate-critique').className).toContain('is-ready');
    expect((screen.getByTestId('composition-final') as HTMLButtonElement).disabled).toBe(false);
  });
});
