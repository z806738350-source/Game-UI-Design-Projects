// v1.4 §10.6：Candidate Diff 只做比较不自动合并——匹配优先级、
// 采用/丢弃回调、基线过期时禁用采用。
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeProject } from '../../test-utils/fixtures';
import type { IntentCandidate } from '../../types';
import { IntentCandidateDiff } from './IntentCandidateDiff';
import type { StructuredReview } from './intentModel';

const currentReview: StructuredReview = {
  revision: 1,
  page_purpose: { id: 'pp', text: '编成侠客队伍', origin: 'ai_visible', source_evidence_ids: ['layer-1'] },
  player_tasks: [
    { id: 't1', text: '选择侠客', origin: 'ai_visible', source_evidence_ids: ['layer-1'] },
    { id: 't-old', text: '已删除的旧任务', origin: 'designer', designer_modified: true }
  ],
  core_flow: [],
  visible_controls: [],
  visible_information_and_states: [],
  uncertainties: []
};

const makeCandidate = (overrides: Partial<IntentCandidate> = {}): IntentCandidate => ({
  candidate_id: 'cand-1',
  screen_id: 'screen-main',
  status: 'ready',
  generated_at: '2026-01-02T00:00:00.000Z',
  source_context: { wireframe_revision: 1, project_type: 'existing' },
  base_current_revisions: { requirement: 1, intent_review: 1, intent_context: 0 },
  review: {
    page_purpose: { id: 'pp', text: '编成侠客队伍', origin: 'ai_visible' },
    player_tasks: [
      { id: 't1', text: '选择侠客并编成', origin: 'ai_visible' },
      { id: 't-new', text: '保存编成结果', origin: 'ai_inference' }
    ],
    core_flow: [],
    visible_controls: [],
    visible_information_and_states: [],
    uncertainties: []
  },
  ...overrides
} as IntentCandidate);

// 与 candidate 基线一致的项目输入版本。
const freshProject = () => makeProject({
  requirement: '编成侠客队伍',
  input_revisions: { requirement: 1, intent_review: 1, intent_context: 0, wireframe: 1 }
} as never);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('IntentCandidateDiff', () => {
  it('稳定 ID 匹配优先：同 ID 文本变化显示“内容有变化”，多出的条目分别显示新增/无', () => {
    render(<IntentCandidateDiff project={freshProject()} candidate={makeCandidate()} currentReview={currentReview} busy={false} onAdopt={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getAllByText('内容有变化')).toHaveLength(1);
    expect(screen.getAllByText('candidate 新增')).toHaveLength(1);
    expect(screen.getAllByText('candidate 中无')).toHaveLength(1);
  });

  it('无 ID 匹配但规范化文本一致时只给“疑似同条”建议', () => {
    const candidate = makeCandidate({
      review: {
        page_purpose: { id: 'pp', text: '编成侠客队伍', origin: 'ai_visible' },
        player_tasks: [{ id: 't-other-id', text: ' 选择侠客 ', origin: 'ai_visible' }],
        core_flow: [], visible_controls: [], visible_information_and_states: [], uncertainties: []
      }
    } as Partial<IntentCandidate>);
    const current: StructuredReview = { ...currentReview, player_tasks: [{ id: 't1', text: '选择侠客', origin: 'ai_visible', source_evidence_ids: ['layer-1'] }] };
    render(<IntentCandidateDiff project={freshProject()} candidate={candidate} currentReview={current} busy={false} onAdopt={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getAllByText(/疑似同条/)).toHaveLength(1);
  });

  it('采用与丢弃分别回调，采用即整版替换由编排层执行', () => {
    const onAdopt = vi.fn();
    const onDiscard = vi.fn();
    render(<IntentCandidateDiff project={freshProject()} candidate={makeCandidate()} currentReview={currentReview} busy={false} onAdopt={onAdopt} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByTestId('intent-candidate-adopt'));
    expect(onAdopt).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('intent-candidate-discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('基线过期时禁止采用并给出可朗读的警告', () => {
    const project = makeProject({
      requirement: '编成侠客队伍',
      // 生成 candidate 后评审又被保存过：基线落后于当前版本。
      input_revisions: { requirement: 1, intent_review: 5, intent_context: 0, wireframe: 1 }
    } as never);
    render(<IntentCandidateDiff project={project} candidate={makeCandidate()} currentReview={currentReview} busy={false} onAdopt={vi.fn()} onDiscard={vi.fn()} />);
    expect((screen.getByTestId('intent-candidate-adopt') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('intent-candidate-discard') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain('无法直接采用');
  });
});
