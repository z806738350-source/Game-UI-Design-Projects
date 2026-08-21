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
