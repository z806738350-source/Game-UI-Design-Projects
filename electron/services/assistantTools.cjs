const { randomUUID } = require('node:crypto');
const { ERROR_CODES } = require('./errorCodes.cjs');
const { validateIntentReview } = require('./intentAnalysis.cjs');

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

function createAssistantTools({ intentStateStore }) {
  if (!intentStateStore || typeof intentStateStore.saveIntentReview !== 'function') throw new Error('assistantTools requires public intentStateStore.saveIntentReview.');

  function describe(candidate, project) {
    const descriptor = ACTIONS[candidate?.name];
    if (!descriptor) throw actionError('助手提出了未授权动作，已拒绝执行。');
    const draft = candidate?.args?.draft;
    if (!draft || typeof draft !== 'object' || Array.isArray(draft) || JSON.stringify(draft).length > 30_000) {
      throw actionError('意图审查草稿参数无效或过大。');
    }
    if (validateIntentReview(draft).errors.length) throw actionError('意图审查草稿未通过结构校验，已拒绝生成待确认动作。');
    const expectedIntentReviewRevision = Number(project?.input_revisions?.intent_review || 0);
    return {
      action_id: randomUUID(),
      name: descriptor.name,
      label: descriptor.label,
      reason: String(candidate.reason || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 1_000) || '保存本轮意图审查草稿。',
      args: { draft, expectedIntentReviewRevision },
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
      draft
    });
  }

  return { actions: ACTIONS, describe, execute };
}

module.exports = { ACTIONS, createAssistantTools };
