import type { DesignProject, IntentCandidate, IntentReview } from '../../types';

// v1.4 PR-I4：structured-v2 Intent 的 UI 纯逻辑层。只依赖数据形状，方便
// vitest 直接覆盖；真实校验仍以服务端 intentAnalysis.cjs 为准，这里只做
// 交互门禁与展示。

export type IntentItem = {
  id: string;
  text: string;
  origin: string;
  source_evidence_ids?: string[];
  designer_modified?: boolean;
};

export type IntentUncertainty = {
  id: string;
  category: string;
  question: string;
  priority: string;
  evidence_ids?: string[];
  created_by?: string;
  review_status: 'unreviewed' | 'answered' | 'deferred' | 'not_applicable' | string;
  note?: string;
  designer_modified?: boolean;
};

export type StructuredReview = {
  schema_version?: string;
  revision?: number;
  source_analysis_id?: string | null;
  source_wireframe_revision?: number;
  page_purpose: IntentItem;
  player_tasks: IntentItem[];
  core_flow: IntentItem[];
  visible_controls: IntentItem[];
  visible_information_and_states: IntentItem[];
  uncertainties: IntentUncertainty[];
  confirmed_at?: string | null;
};

export const INTENT_LIST_SECTIONS = ['player_tasks', 'core_flow', 'visible_controls', 'visible_information_and_states'] as const;
export type IntentListSection = typeof INTENT_LIST_SECTIONS[number];

// §10.1：六段标题与顺序固定，不可删除。
export const INTENT_SECTION_META: Record<IntentListSection | 'page_purpose', { title: string; hint: string }> = {
  page_purpose: { title: '页面目的', hint: '这个页面要让玩家理解或完成什么' },
  player_tasks: { title: '玩家任务', hint: '玩家在这个页面要做的事' },
  core_flow: { title: '核心流程', hint: '完成目标的步骤顺序，可重排' },
  visible_controls: { title: '可见控件', hint: '画面中可见、可交互的控件' },
  visible_information_and_states: { title: '可见信息与状态', hint: '画面中可见的数值、文案与状态' }
};

export const UNCERTAINTY_STATUS_META: Record<string, { label: string; tone: 'warn' | 'ok' | 'muted' }> = {
  unreviewed: { label: '需要确认', tone: 'warn' },
  answered: { label: '已回答', tone: 'ok' },
  deferred: { label: '暂时保留', tone: 'muted' },
  not_applicable: { label: '不适用', tone: 'muted' }
};

function asItem(raw: unknown, fallbackId: string): IntentItem {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<IntentItem>;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : fallbackId,
    text: typeof value.text === 'string' ? value.text : '',
    origin: typeof value.origin === 'string' ? value.origin : 'ai_inference',
    source_evidence_ids: Array.isArray(value.source_evidence_ids) ? value.source_evidence_ids.filter((entry) => typeof entry === 'string') : [],
    designer_modified: Boolean(value.designer_modified)
  };
}

function asUncertainty(raw: unknown, index: number): IntentUncertainty {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<IntentUncertainty>;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : `uncertainty-${index}`,
    category: typeof value.category === 'string' ? value.category : 'state_semantics',
    question: typeof value.question === 'string' ? value.question : '',
    priority: typeof value.priority === 'string' && value.priority ? value.priority : 'optional',
    evidence_ids: Array.isArray(value.evidence_ids) ? value.evidence_ids.filter((entry) => typeof entry === 'string') : [],
    created_by: typeof value.created_by === 'string' ? value.created_by : 'ai',
    review_status: typeof value.review_status === 'string' ? value.review_status : 'unreviewed',
    note: typeof value.note === 'string' ? value.note : '',
    designer_modified: Boolean(value.designer_modified)
  };
}

// 服务端形状宽容收敛为 UI 形状：缺段补空、坏条目兜底，不向用户暴露 JSON。
export function asStructuredReview(review: IntentReview | null | undefined): StructuredReview | null {
  if (!review || typeof review !== 'object') return null;
  const raw = review as Record<string, unknown>;
  const list = (key: string, prefix: string) => (Array.isArray(raw[key]) ? raw[key] : []).map((entry, index) => asItem(entry, `${prefix}-${index}`));
  return {
    schema_version: typeof raw.schema_version === 'string' ? raw.schema_version : '1.1',
    revision: typeof raw.revision === 'number' ? raw.revision : 0,
    source_analysis_id: typeof raw.source_analysis_id === 'string' ? raw.source_analysis_id : null,
    source_wireframe_revision: typeof raw.source_wireframe_revision === 'number' ? raw.source_wireframe_revision : 0,
    page_purpose: asItem(raw.page_purpose, 'page-purpose'),
    player_tasks: list('player_tasks', 'player-task'),
    core_flow: list('core_flow', 'core-flow'),
    visible_controls: list('visible_controls', 'visible-control'),
    visible_information_and_states: list('visible_information_and_states', 'visible-info'),
    uncertainties: (Array.isArray(raw.uncertainties) ? raw.uncertainties : []).map(asUncertainty),
    confirmed_at: typeof raw.confirmed_at === 'string' ? raw.confirmed_at : null
  };
}

export function newDesignerId(prefix: string): string {
  const random = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID().slice(0, 13) : Math.random().toString(36).slice(2, 12);
  return `${prefix}-${random}`;
}

export function newDesignerItem(prefix: string): IntentItem {
  return { id: newDesignerId(prefix), text: '', origin: 'designer', source_evidence_ids: [], designer_modified: true };
}

export function newDesignerUncertainty(): IntentUncertainty {
  return { id: newDesignerId('uncertainty'), category: 'state_semantics', question: '', priority: 'optional', evidence_ids: [], created_by: 'designer', review_status: 'answered', note: '', designer_modified: true };
}

// §10.3：来源标签。颜色不是唯一载体，标签本身携带文字。
export function itemBadges(item: IntentItem): Array<{ key: string; label: string; tone: 'visible' | 'inferred' | 'designer' | 'warn' }> {
  const badges: Array<{ key: string; label: string; tone: 'visible' | 'inferred' | 'designer' | 'warn' }> = [];
  if (item.origin === 'ai_visible') badges.push({ key: 'visible', label: '图中可见', tone: 'visible' });
  else if (item.origin === 'designer') badges.push({ key: 'designer', label: item.designer_modified ? '设计师已修改' : '设计师新增', tone: 'designer' });
  else badges.push({ key: 'inferred', label: 'AI 推断', tone: 'inferred' });
  if (item.designer_modified && item.origin !== 'designer') badges.push({ key: 'modified', label: '设计师已修改', tone: 'designer' });
  if (item.origin === 'ai_inference' && !(item.source_evidence_ids || []).length) badges.push({ key: 'no-evidence', label: '缺少可追溯证据', tone: 'warn' });
  return badges;
}

export function uncertaintySummary(review: StructuredReview): { total: number; unreviewed: number; blocking: number; blockingUnreviewed: number } {
  const unreviewed = review.uncertainties.filter((item) => item.review_status === 'unreviewed');
  return {
    total: review.uncertainties.length,
    unreviewed: unreviewed.length,
    blocking: review.uncertainties.filter((item) => item.priority === 'blocking').length,
    blockingUnreviewed: unreviewed.filter((item) => item.priority === 'blocking').length
  };
}

// §10.5 确认门禁的客户端预览（服务端仍是权威）：返回按顺序展示的原因。
export function confirmBlockers(review: StructuredReview): string[] {
  const blockers: string[] = [];
  if (!review.page_purpose.text.trim()) blockers.push('页面目的不能为空');
  if (!review.player_tasks.length) blockers.push('玩家任务至少保留 1 条');
  if (!review.core_flow.length) blockers.push('核心流程至少保留 1 条');
  if (!review.visible_controls.length && !review.visible_information_and_states.length) blockers.push('可见控件与可见信息至少合计保留 1 条');
  for (const uncertainty of review.uncertainties) {
    if (uncertainty.review_status === 'unreviewed') blockers.push(`待确认项「${uncertainty.question || uncertainty.id}」尚未处理`);
    if (uncertainty.priority === 'blocking' && uncertainty.review_status === 'deferred') blockers.push(`阻断级问题「${uncertainty.question || uncertainty.id}」不允许暂时保留`);
    if (uncertainty.priority === 'blocking' && uncertainty.review_status === 'not_applicable' && !(uncertainty.note || '').trim()) blockers.push(`阻断级问题「${uncertainty.question || uncertainty.id}」标记不适用时必须填写原因`);
    if (uncertainty.review_status === 'answered' && !(uncertainty.note || '').trim()) blockers.push(`待确认项「${uncertainty.question || uncertainty.id}」已回答但内容为空`);
  }
  return blockers;
}

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();

// §10.6：Diff 只做比较，不自动合并。匹配优先级：稳定条目 ID → 分析实体
// ID（同一来源生成的条目共享 id）→ 规范化文本签名（仅展示建议）。
export type IntentDiffRow = {
  kind: 'same' | 'changed' | 'added' | 'removed' | 'suggested';
  current?: IntentItem;
  candidate?: IntentItem;
};

export function diffSection(current: IntentItem[], candidate: IntentItem[]): IntentDiffRow[] {
  const rows: IntentDiffRow[] = [];
  const remaining = [...candidate];
  for (const entry of current) {
    const byId = remaining.findIndex((item) => item.id === entry.id);
    if (byId >= 0) {
      const match = remaining.splice(byId, 1)[0];
      rows.push({ kind: normalizeText(match.text) === normalizeText(entry.text) ? 'same' : 'changed', current: entry, candidate: match });
      continue;
    }
    const byText = remaining.findIndex((item) => normalizeText(item.text) === normalizeText(entry.text) && item.text.trim());
    if (byText >= 0) {
      const match = remaining.splice(byText, 1)[0];
      rows.push({ kind: 'suggested', current: entry, candidate: match });
      continue;
    }
    rows.push({ kind: 'removed', current: entry });
  }
  for (const entry of remaining) rows.push({ kind: 'added', candidate: entry });
  return rows;
}

// uncertainty 保留旧答案的建议：category、question、evidence 都一致。
export function canKeepUncertaintyAnswer(current: IntentUncertainty, candidate: IntentUncertainty): boolean {
  return current.category === candidate.category
    && normalizeText(current.question) === normalizeText(candidate.question)
    && JSON.stringify([...(current.evidence_ids || [])].sort()) === JSON.stringify([...(candidate.evidence_ids || [])].sort());
}

// candidate 基线是否已过期（与服务端 §8.4 CAS 同构的展示判断）。
export function candidateBaselineStale(candidate: IntentCandidate, project: DesignProject): boolean {
  const baseline = candidate.base_current_revisions || {};
  const revisions = project.input_revisions || {};
  return Number(baseline.requirement ?? -1) !== Number(revisions.requirement ?? 0)
    || Number(baseline.intent_review ?? -1) !== Number(revisions.intent_review ?? 0)
    || Number(baseline.intent_context ?? -1) !== Number(revisions.intent_context ?? 0)
    || Number(candidate.source_context?.wireframe_revision ?? -1) !== Number(revisions.wireframe ?? 0);
}

// 分析是否仍对应当前 UE / Project Type（derived-stale 判断与服务端一致）。
export function analysisIsStale(project: DesignProject): boolean {
  const analysis = project.intent_analysis as { source_revision?: { wireframe?: number; project_type?: string } } | undefined;
  if (!analysis?.source_revision) return false;
  return Number(analysis.source_revision.wireframe ?? 0) !== Number(project.input_revisions?.wireframe ?? 0)
    || analysis.source_revision.project_type !== project.project_type;
}

export type IntentStatus = { key: string; label: string; tone: 'muted' | 'info' | 'ok' | 'warn' | 'danger' };

// §10.2 状态集合：从项目 + 候选推导展示状态（互斥取最先命中）。
export function deriveIntentStatus(project: DesignProject, candidate: IntentCandidate | null): IntentStatus {
  const review = asStructuredReview(project.intent_review);
  const generation = project.intent_generation || null;
  const structured = project.intent_mode === 'structured-v2' || Boolean(review);
  if (!project.wireframe_path) return { key: 'no-ue', label: '无 UE：先导入线框稿', tone: 'muted' };
  if (generation?.status === 'running') {
    return structured || Boolean(project.requirement?.trim())
      ? { key: 'candidate-generating', label: 'candidate 生成中：当前内容不受影响', tone: 'info' }
      : { key: 'first-generating', label: '首次 AI 生成中', tone: 'info' };
  }
  if (generation?.status === 'interrupted') return { key: 'interrupted', label: '生成已中断，可重新预填', tone: 'warn' };
  if (candidate?.status === 'ready') {
    if (candidateBaselineStale(candidate, project)) return { key: 'candidate-stale', label: 'candidate 已过期：请丢弃后重新预填', tone: 'danger' };
    return { key: 'candidate-ready', label: 'candidate 待处理：采用或丢弃前不可重新生成', tone: 'warn' };
  }
  if (generation && ['failed', 'validation-failed', 'provider-timeout'].includes(generation.status)) {
    return { key: 'generation-failed', label: 'candidate 生成失败：当前内容仍可用', tone: 'warn' };
  }
  if (!structured) {
    if (!project.requirement?.trim()) return { key: 'ue-ready', label: '有 UE 无意图：可开始 AI 预填', tone: 'info' };
    return { key: 'legacy-text', label: '旧版自由文本：重新预填将生成 candidate', tone: 'muted' };
  }
  if (!review) return { key: 'ue-ready', label: '有 UE 无意图：可开始 AI 预填', tone: 'info' };
  if (analysisIsStale(project)) return { key: 'based-on-old-ue', label: '基于旧 UE：请核对或重新预填', tone: 'warn' };
  if (project.requirement_confirmed && review.confirmed_at) return { key: 'confirmed', label: '当前输入已确认', tone: 'ok' };
  return { key: 'draft-pending', label: 'AI 草稿待审：请逐段确认', tone: 'info' };
}

export function historyReasonLabel(reason: string | undefined): string {
  switch (reason) {
    case 'review-save': return '保存前版本';
    case 'candidate-adopt': return '采用 candidate 前版本';
    case 'restore-before': return '恢复前版本';
    default: return reason || '历史版本';
  }
}
