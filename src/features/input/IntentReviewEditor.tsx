import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { INTENT_LIST_SECTIONS, INTENT_SECTION_META, itemBadges, newDesignerItem } from './intentModel';
import type { IntentItem, IntentListSection, StructuredReview } from './intentModel';

// v1.4 §10.4：六段编辑器。段标题与顺序固定不可删；条目可增删改；
// core_flow 支持重排（按钮即键盘替代）；所有修改保留稳定 item ID。

function OriginBadges({ item }: { item: IntentItem }) {
  const badges = itemBadges(item);
  if (!badges.length) return null;
  return <span className="intent-badge-row" aria-label="来源标签">{badges.map((badge) => <i key={badge.key} className={`intent-badge intent-badge--${badge.tone}`}>{badge.label}</i>)}</span>;
}

export function IntentReviewEditor({ review, onChange, busy }: {
  review: StructuredReview;
  onChange: (next: StructuredReview) => void;
  busy: boolean;
}) {
  const patchItem = (section: IntentListSection, id: string, patch: Partial<IntentItem>) => {
    onChange({ ...review, [section]: review[section].map((item) => item.id === id ? { ...item, designer_modified: true, ...patch } : item) });
  };
  const removeItem = (section: IntentListSection, id: string) => {
    onChange({ ...review, [section]: review[section].filter((item) => item.id !== id) });
  };
  const addItem = (section: IntentListSection) => {
    const prefix = section.replace(/_/g, '-').replace(/^visible-information.*/, 'visible-info');
    onChange({ ...review, [section]: [...review[section], newDesignerItem(`designer-${prefix}`)] });
  };
  const moveItem = (section: IntentListSection, index: number, delta: -1 | 1) => {
    const items = [...review[section]];
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    onChange({ ...review, [section]: items });
  };
  return (
    <div className="intent-editor">
      <section className="intent-section" aria-label="页面目的">
        <header><h3>{INTENT_SECTION_META.page_purpose.title}</h3><small>{INTENT_SECTION_META.page_purpose.hint}</small>{review.page_purpose && <OriginBadges item={review.page_purpose} />}</header>
        <textarea
          aria-label="页面目的"
          rows={2}
          disabled={busy}
          value={review.page_purpose?.text ?? ''}
          onChange={(event) => onChange({ ...review, page_purpose: { ...review.page_purpose, text: event.target.value, designer_modified: true } })}
        />
      </section>
      {INTENT_LIST_SECTIONS.map((section) => {
        const meta = INTENT_SECTION_META[section];
        const items = review[section];
        return (
          <section key={section} className="intent-section" aria-label={meta.title}>
            <header>
              <h3>{meta.title}<em>{items.length} 条</em></h3>
              <small>{meta.hint}</small>
              <button type="button" className="button button--ghost button--small" disabled={busy} aria-label={`新增${meta.title}条目`} onClick={() => addItem(section)}><Plus size={14} />新增</button>
            </header>
            {items.length === 0 && <p className="intent-empty">暂无条目；确认前至少保留必要数量。</p>}
            <ol className="intent-item-list">
              {items.map((item, index) => (
                <li key={item.id} className="intent-item">
                  <span className="intent-item-index" aria-hidden>{index + 1}</span>
                  <div className="intent-item-body">
                    <textarea
                      aria-label={`${meta.title}第 ${index + 1} 条`}
                      rows={2}
                      disabled={busy}
                      value={item.text}
                      onChange={(event) => patchItem(section, item.id, { text: event.target.value })}
                    />
                    <OriginBadges item={item} />
                  </div>
                  <div className="intent-item-actions">
                    {section === 'core_flow' && <>
                      <button type="button" className="button button--ghost button--icon" disabled={busy || index === 0} aria-label={`上移${meta.title}第 ${index + 1} 条`} onClick={() => moveItem(section, index, -1)}><ChevronUp size={14} /></button>
                      <button type="button" className="button button--ghost button--icon" disabled={busy || index === items.length - 1} aria-label={`下移${meta.title}第 ${index + 1} 条`} onClick={() => moveItem(section, index, 1)}><ChevronDown size={14} /></button>
                    </>}
                    <button type="button" className="button button--ghost button--icon intent-item-delete" disabled={busy} aria-label={`删除${meta.title}第 ${index + 1} 条`} onClick={() => removeItem(section, item.id)}><Trash2 size={14} /></button>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
