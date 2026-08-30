import { useState } from 'react';
import { HelpCircle, Plus } from 'lucide-react';
import { UNCERTAINTY_STATUS_META, newDesignerUncertainty, uncertaintySummary } from './intentModel';
import type { IntentUncertainty, StructuredReview } from './intentModel';

// v1.4 §10.5：待确认项操作——回答 / 暂时保留 / 不适用 / 恢复未检查 /
// 新增。门禁：blocking 不提供暂时保留；不适用必须填原因；存在
// unreviewed 时确认按钮在编排层阻断并聚焦第一条。

const CATEGORY_LABEL: Record<string, string> = {
  state_semantics: '状态语义',
  reward_rules: '奖励规则',
  entry_navigation: '入口与导航',
  unlock_preconditions: '解锁条件',
  resource_economy: '资源经济',
  interaction_limits: '交互限制',
  background_behavior: '后台行为',
  data_source_refresh: '数据刷新'
};

export function IntentUncertaintyPanel({ review, onChange, busy }: {
  review: StructuredReview;
  onChange: (next: StructuredReview) => void;
  busy: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [newPriority, setNewPriority] = useState<'optional' | 'blocking'>('optional');
  const summary = uncertaintySummary(review);
  const patch = (id: string, next: Partial<IntentUncertainty>) => {
    onChange({ ...review, uncertainties: review.uncertainties.map((item) => item.id === id ? { ...item, designer_modified: true, ...next } : item) });
  };
  const addUncertainty = () => {
    if (!newQuestion.trim()) return;
    onChange({ ...review, uncertainties: [...review.uncertainties, { ...newDesignerUncertainty(), review_status: 'unreviewed', question: newQuestion.trim(), priority: newPriority }] });
    setNewQuestion('');
    setAdding(false);
  };
  return (
    <section className="intent-uncertainties" aria-label="待确认项">
      <header>
        <h3><HelpCircle size={15} />待确认项<em>{summary.total} 条 · 未处理 {summary.unreviewed} 条{summary.blocking ? ` · 阻断级 ${summary.blocking} 条` : ''}</em></h3>
        <button type="button" className="button button--ghost button--small" disabled={busy} onClick={() => setAdding((value) => !value)}><Plus size={14} />新增待确认项</button>
      </header>
      {adding && (
        <div className="intent-uncertainty-add">
          <input aria-label="新待确认项问题" value={newQuestion} disabled={busy} placeholder="例如：这个数字是实时刷新的吗？" onChange={(event) => setNewQuestion(event.target.value)} />
          <select aria-label="新待确认项优先级" value={newPriority} disabled={busy} onChange={(event) => setNewPriority(event.target.value === 'blocking' ? 'blocking' : 'optional')}>
            <option value="optional">参考级</option>
            <option value="blocking">阻断级</option>
          </select>
          <button type="button" className="button button--secondary button--small" disabled={busy || !newQuestion.trim()} onClick={addUncertainty}>加入清单</button>
        </div>
      )}
      {review.uncertainties.length === 0 && !adding && <p className="intent-empty">AI 没有留下待确认项；你也可以手动新增。</p>}
      <ul className="intent-uncertainty-list">
        {review.uncertainties.map((uncertainty) => {
          const status = UNCERTAINTY_STATUS_META[uncertainty.review_status] || UNCERTAINTY_STATUS_META.unreviewed;
          const blocking = uncertainty.priority === 'blocking';
          return (
            <li key={uncertainty.id} className={`intent-uncertainty ${uncertainty.review_status === 'unreviewed' ? 'is-unreviewed' : ''}`} data-uncertainty-id={uncertainty.id}>
              <div className="intent-uncertainty-head">
                <i className={`intent-badge intent-badge--${status.tone}`}>{status.label}</i>
                {blocking && <i className="intent-badge intent-badge--danger">阻断级</i>}
                <i className="intent-badge intent-badge--muted">{CATEGORY_LABEL[uncertainty.category] || uncertainty.category}</i>
              </div>
              <p className="intent-uncertainty-question">{uncertainty.question}</p>
              <label className="intent-uncertainty-note">
                <span>{uncertainty.review_status === 'answered' ? '回答内容' : '备注 / 原因'}</span>
                <textarea
                  aria-label={`待确认项「${uncertainty.question || uncertainty.id}」的备注`}
                  rows={2}
                  disabled={busy}
                  value={uncertainty.note || ''}
                  placeholder={blocking ? '阻断级问题选择“不适用”时必须填写原因；选择“回答”时必须填写结论。' : '可留空'}
                  onChange={(event) => patch(uncertainty.id, { note: event.target.value })}
                />
              </label>
              <div className="intent-uncertainty-actions" role="group" aria-label={`处理待确认项「${uncertainty.question || uncertainty.id}」`}>
                <button type="button" className="button button--secondary button--small" disabled={busy || !(uncertainty.note || '').trim()} onClick={() => patch(uncertainty.id, { review_status: 'answered' })}>回答</button>
                <button type="button" className="button button--ghost button--small" disabled={busy || blocking} title={blocking ? '阻断级问题不允许暂时保留' : undefined} onClick={() => patch(uncertainty.id, { review_status: 'deferred' })}>暂时保留</button>
                <button type="button" className="button button--ghost button--small" disabled={busy || (blocking && !(uncertainty.note || '').trim())} title={blocking && !(uncertainty.note || '').trim() ? '阻断级问题标记不适用必须先填写原因' : undefined} onClick={() => patch(uncertainty.id, { review_status: 'not_applicable' })}>不适用</button>
                <button type="button" className="button button--ghost button--small" disabled={busy || uncertainty.review_status === 'unreviewed'} onClick={() => patch(uncertainty.id, { review_status: 'unreviewed' })}>恢复未检查</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
