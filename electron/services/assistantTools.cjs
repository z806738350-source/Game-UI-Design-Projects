const { randomUUID } = require('node:crypto');
const { ERROR_CODES } = require('./errorCodes.cjs');
const { validateIntentReview, renderIntentReview, ORIGINS, REVIEW_STATUSES } = require('./intentAnalysis.cjs');

const ACTIONS = Object.freeze({
  save_intent_review_draft: Object.freeze({
    name: 'save_intent_review_draft',
    label: '保存意图审查草稿',
    risk: Object.freeze({ writes_project: true, replaces_content: true, reversible: false, external_cost: false })
  })
});

function actionError(message, status = 400) {
  return Object.assign(new Error(message), { code: ERROR_CODES.ASSISTANT_ACTION_NOT_ALLOWED, status });
}

const DRAFT_GUIDE = {
  description: '只保存未确认草稿，不批准需求、不运行流水线。返回完整替换草稿，保留未修改条目的 id、来源和已有内容。截图推断用 ai_inference，实际可见用 ai_visible；不得替用户回答未知规则或捏造 designer 确认。',
  origins: ORIGINS, review_statuses: REVIEW_STATUSES,
  draft_example: {
    page_purpose: { id: 'purpose', text: '页面目的', origin: 'ai_inference' },
    player_tasks: [{ id: 'task-1', text: '玩家任务', origin: 'ai_inference' }],
    core_flow: [{ id: 'flow-1', text: '核心流程', origin: 'ai_inference' }],
    visible_controls: [{ id: 'control-1', text: '控件', origin: 'ai_inference' }],
    visible_information_and_states: [],
    uncertainties: [{ id: 'question-1', question: '需要用户确认的规则？', priority: 'important', review_status: 'unreviewed', note: '' }]
  }
};

function validateAction(candidate) {
  if (!ACTIONS[candidate?.name]) return ['动作不在白名单中，只支持 save_intent_review_draft。'];
  const draft = candidate?.args?.draft;
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || JSON.stringify(draft).length > 30_000) return ['args.draft 必须是完整草稿对象，最多 30000 字符。'];
  return validateIntentReview(draft).errors;
}

function createAssistantTools({ intentStateStore }) {
  if (!intentStateStore || typeof intentStateStore.saveIntentReview !== 'function') throw new Error('assistantTools requires public intentStateStore.saveIntentReview.');

  function describe(candidate, project) {
    if (JSON.stringify(project.intent_review || '').length > 30_000 || (!project.intent_review && String(project.requirement || '').length > 6_000)) throw actionError('当前意图内容超过助手可完整读取的范围，请在项目输入中编辑，避免覆盖未读取的内容。');
    const errors = validateAction(candidate);
    if (errors.length) throw actionError(`意图审查草稿未通过结构校验：${errors.join('；')}`);
    const descriptor = ACTIONS[candidate.name];
    const draft = candidate.args.draft;
    const initialize = !(project.intent_mode === 'structured-v2' || project.intent_review || project.intent_analysis || project.intent_generation);
    const before = project.intent_review && !validateIntentReview(project.intent_review).errors.length ? renderIntentReview(project.intent_review) : String(project.requirement || '');
    const expectedIntentReviewRevision = Number(project?.input_revisions?.intent_review || 0);
    return {
      action_id: randomUUID(),
      name: descriptor.name,
      label: descriptor.label,
      reason: String(candidate.reason || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 1_000) || '保存本轮意图审查草稿。',
      args: { draft, expectedIntentReviewRevision, ...(initialize ? { initialize: true, expectedRequirementRevision: Number(project.input_revisions?.requirement || 0) } : {}) },
      review: { project_name: project.name, screen_name: project.screens?.find((screen) => screen.id === project.screen_id)?.name || project.screen_id, before: before.slice(0, 8_000), before_truncated: before.length > 8_000 },
      risk: descriptor.risk
    };
  }

  async function execute(action, binding) {
    if (action?.name !== 'save_intent_review_draft' || !ACTIONS[action.name]) throw actionError('动作不在助手白名单中。');
    const expectedIntentReviewRevision = Number(action.args?.expectedIntentReviewRevision);
    const draft = action.args?.draft;
    if (!Number.isSafeInteger(expectedIntentReviewRevision) || expectedIntentReviewRevision < 0 || !draft || typeof draft !== 'object' || Array.isArray(draft) || JSON.stringify(draft).length > 30_000 || validateIntentReview(draft).errors.length) {
      throw actionError('保存意图审查草稿的参数无效。');
    }
    // 必须从项目锁外调用公开领域方法；AssistantTools 永不接收或访问 __unsafe。
    return intentStateStore.saveIntentReview(binding.project_id, binding.screen_id, {
      expectedIntentReviewRevision,
      ...(action.args.initialize === true ? { initialize: true, expectedRequirementRevision: action.args.expectedRequirementRevision } : {}),
      draft
    });
  }

  return { actions: ACTIONS, describe, execute };
}

module.exports = { ACTIONS, DRAFT_GUIDE, validateAction, createAssistantTools };
