// v1.4 §10.4：六段编辑器交互测试——增删改、重排、来源标签与 a11y name。
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntentReviewEditor } from './IntentReviewEditor';
import type { StructuredReview } from './intentModel';

const baseReview: StructuredReview = {
  revision: 1,
  page_purpose: { id: 'pp', text: '编成侠客队伍', origin: 'ai_visible', source_evidence_ids: ['layer-1'] },
  player_tasks: [
    { id: 't1', text: '选择侠客', origin: 'ai_visible', source_evidence_ids: ['layer-1'] },
    { id: 't2', text: '调整站位', origin: 'ai_inference', source_evidence_ids: [] }
  ],
  core_flow: [
    { id: 'f1', text: '进入编成页', origin: 'ai_visible', source_evidence_ids: ['layer-2'] },
    { id: 'f2', text: '确认编成', origin: 'ai_visible', source_evidence_ids: ['layer-2'] }
  ],
  visible_controls: [],
  visible_information_and_states: [],
  uncertainties: []
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('IntentReviewEditor 六段编辑器', () => {
  it('六段标题按固定顺序渲染，条目 textarea 有可访问名', () => {
    render(<IntentReviewEditor review={baseReview} onChange={vi.fn()} busy={false} />);
    const titles = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent?.split(/\d/)[0]);
    expect(titles[0]).toContain('页面目的');
    expect(titles).toEqual(expect.arrayContaining(['玩家任务', '核心流程', '可见控件', '可见信息与状态']));
    expect(screen.getByLabelText('页面目的', { selector: 'textarea' })).toBeTruthy();
    expect(screen.getByLabelText('玩家任务第 1 条')).toBeTruthy();
    expect(screen.getByLabelText('核心流程第 2 条')).toBeTruthy();
  });

  it('修改条目标记设计师已修改并保留稳定 ID', () => {
    const onChange = vi.fn();
    render(<IntentReviewEditor review={baseReview} onChange={onChange} busy={false} />);
    fireEvent.change(screen.getByLabelText('玩家任务第 2 条'), { target: { value: '调整站位并保存' } });
    const next = onChange.mock.calls.at(-1)![0] as StructuredReview;
    expect(next.player_tasks[1]).toMatchObject({ id: 't2', text: '调整站位并保存', designer_modified: true });
  });

  it('新增条目带设计师来源标签与唯一 ID', () => {
    const onChange = vi.fn();
    render(<IntentReviewEditor review={baseReview} onChange={onChange} busy={false} />);
    fireEvent.click(screen.getByLabelText('新增玩家任务条目'));
    const next = onChange.mock.calls.at(-1)![0] as StructuredReview;
    expect(next.player_tasks).toHaveLength(3);
    expect(next.player_tasks[2]).toMatchObject({ origin: 'designer', designer_modified: true, text: '' });
    expect(next.player_tasks[2].id).not.toBe('t1');
    expect(next.player_tasks[2].id).not.toBe('t2');
  });

  it('删除条目只移除目标条目', () => {
    const onChange = vi.fn();
    render(<IntentReviewEditor review={baseReview} onChange={onChange} busy={false} />);
    fireEvent.click(screen.getByLabelText('删除玩家任务第 1 条'));
    const next = onChange.mock.calls.at(-1)![0] as StructuredReview;
    expect(next.player_tasks.map((item) => item.id)).toEqual(['t2']);
  });

  it('core_flow 用上移/下移按钮重排，边界按钮禁用', () => {
    const onChange = vi.fn();
    render(<IntentReviewEditor review={baseReview} onChange={onChange} busy={false} />);
    expect((screen.getByLabelText('上移核心流程第 1 条') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('下移核心流程第 2 条') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('下移核心流程第 1 条'));
    const next = onChange.mock.calls.at(-1)![0] as StructuredReview;
    expect(next.core_flow.map((item) => item.id)).toEqual(['f2', 'f1']);
  });

  it('来源标签用文字表达，颜色不是唯一载体', () => {
    render(<IntentReviewEditor review={baseReview} onChange={vi.fn()} busy={false} />);
    expect(screen.getAllByText('图中可见').length).toBeGreaterThan(0);
    // t2 是 ai_inference 且无证据：必须提示缺少可追溯证据。
    expect(screen.getAllByText('缺少可追溯证据').length).toBe(1);
  });
});
