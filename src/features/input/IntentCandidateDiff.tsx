import { GitCompareArrows, CheckCircle2, XCircle } from 'lucide-react';
import type { DesignProject, IntentCandidate } from '../../types';
import { INTENT_LIST_SECTIONS, INTENT_SECTION_META, asStructuredReview, canKeepUncertaintyAnswer, candidateBaselineStale, diffSection } from './intentModel';
import type { IntentDiffRow, StructuredReview } from './intentModel';

// v1.4 §10.6：Candidate Diff 只帮助比较，不自动合并。采用 = 整版替换；
// 保留当前版本 = 丢弃 candidate，不改当前输入。

const ROW_KIND_META: Record<IntentDiffRow['kind'], { label: string; tone: string }> = {
  same: { label: '一致', tone: 'muted' },
  changed: { label: '内容有变化', tone: 'warn' },
  suggested: { label: '疑似同条（仅建议）', tone: 'muted' },
  added: { label: 'candidate 新增', tone: 'info' },
  removed: { label: 'candidate 中无', tone: 'danger' }
};

function DiffRows({ rows }: { rows: IntentDiffRow[] }) {
  return (
    <ul className="intent-diff-rows">
      {rows.map((row, index) => {
        const meta = ROW_KIND_META[row.kind];
        return (
          <li key={`${row.current?.id || ''}-${row.candidate?.id || ''}-${index}`} className={`intent-diff-row intent-diff-row--${row.kind}`}>
            <i className={`intent-badge intent-badge--${meta.tone}`}>{meta.label}</i>
            <div className="intent-diff-texts">
              {row.current && <p className={row.kind === 'removed' ? 'is-strike' : ''}>{row.current.text}</p>}
              {row.candidate && row.kind !== 'same' && <p className="is-candidate">{row.candidate.text}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function IntentCandidateDiff({ project, candidate, currentReview, busy, onAdopt, onDiscard }: {
  project: DesignProject;
  candidate: IntentCandidate;
  currentReview: StructuredReview | null;
  busy: boolean;
  onAdopt: () => void;
  onDiscard: () => void;
}) {
  const candidateReview = asStructuredReview(candidate.review);
  if (!candidateReview) return null;
  const stale = candidateBaselineStale(candidate, project);
  const emptyCurrent: StructuredReview = { page_purpose: { id: 'page-purpose', text: '', origin: 'designer' }, player_tasks: [], core_flow: [], visible_controls: [], visible_information_and_states: [], uncertainties: [] };
  const current = currentReview || emptyCurrent;
  const keepableUncertainties = candidateReview.uncertainties.filter((next) => {
    const match = current.uncertainties.find((entry) => canKeepUncertaintyAnswer(entry, next));
    return match && match.review_status === 'answered' && (match.note || '').trim();
  });
  return (
    <section className="intent-candidate-diff" aria-label="Candidate 对比">
      <header>
        <h3><GitCompareArrows size={15} />AI 生成了一份新的 candidate<em>{stale ? '基线已过期' : '等待你的决定'}</em></h3>
        <p>采用是整版替换：当前六段会被 candidate 覆盖（旧版本自动进入历史）。保留当前版本会丢弃 candidate，不会改动你已确认的内容。</p>
      </header>
      {stale && <p className="intent-diff-warning" role="alert">candidate 生成后输入已变化（需求、评审或 UE 版本不一致），无法直接采用；请丢弃后重新预填。</p>}
      {INTENT_LIST_SECTIONS.map((section) => {
        const rows = diffSection(current[section], candidateReview[section]);
        if (!rows.length) return null;
        return (
          <details key={section} className="intent-diff-section" open={rows.some((row) => row.kind !== 'same')}>
            <summary>{INTENT_SECTION_META[section].title}（{rows.filter((row) => row.kind !== 'same').length} 处差异）</summary>
            <DiffRows rows={rows} />
          </details>
        );
      })}
      {Boolean(keepableUncertainties.length) && (
        <p className="intent-diff-keep-hint">有 {keepableUncertainties.length} 个待确认项与当前问题一致：采用后可在评审里手动沿用旧答案，系统不会自动合并。</p>
      )}
      <div className="intent-candidate-actions">
        <button type="button" className="button button--primary button--small" data-testid="intent-candidate-adopt" disabled={busy || stale} onClick={onAdopt}><CheckCircle2 size={14} />采用 candidate（整版替换）</button>
        <button type="button" className="button button--ghost button--small" data-testid="intent-candidate-discard" disabled={busy} onClick={onDiscard}><XCircle size={14} />保留当前版本并丢弃</button>
      </div>
    </section>
  );
}
