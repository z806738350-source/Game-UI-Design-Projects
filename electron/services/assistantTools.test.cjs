const test = require('node:test');
const assert = require('node:assert/strict');
const { createAssistantTools } = require('./assistantTools.cjs');

const draft = {
  page_purpose: { id: 'purpose', text: '让玩家升级', origin: 'designer' },
  player_tasks: [], core_flow: [], visible_controls: [], visible_information_and_states: [], uncertainties: []
};

test('server owns action risk and executes only through the public intent service', async () => {
  const calls = [];
  const intentStateStore = { saveIntentReview: async (...args) => { calls.push(args); return { noop: false }; } };
  const tools = createAssistantTools({ intentStateStore });
  const action = tools.describe({
    name: 'save_intent_review_draft', reason: '保存', args: { draft },
    risk: { writes_project: false, reversible: true }
  }, { input_revisions: { intent_review: 7 } });
  assert.deepEqual(action.risk, { writes_project: true, replaces_content: true, reversible: false, external_cost: false });
  await tools.execute(action, { project_id: 'project-a', screen_id: 'main' });
  assert.deepEqual(calls[0], ['project-a', 'main', { expectedIntentReviewRevision: 7, draft }]);
});

test('unknown actions and invalid or tampered drafts fail closed', async () => {
  const tools = createAssistantTools({ intentStateStore: { saveIntentReview: async () => ({}) } });
  assert.throws(() => tools.describe({ name: 'approve_artifact', args: {} }, { input_revisions: {} }), { code: 'ASSISTANT_ACTION_NOT_ALLOWED' });
  assert.throws(() => tools.describe({ name: 'save_intent_review_draft', args: {} }, { input_revisions: {} }), { code: 'ASSISTANT_ACTION_NOT_ALLOWED' });
  assert.throws(() => tools.describe({ name: 'save_intent_review_draft', args: { draft: { goal: '字段不完整' } } }, { input_revisions: {} }), { code: 'ASSISTANT_ACTION_NOT_ALLOWED' });
  await assert.rejects(tools.execute({ name: 'save_intent_review_draft', args: { expectedIntentReviewRevision: 1, draft: { goal: '磁盘篡改' } } }, { project_id: 'project-a', screen_id: 'main' }), { code: 'ASSISTANT_ACTION_NOT_ALLOWED' });
});
