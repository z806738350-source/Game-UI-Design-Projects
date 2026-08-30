const test = require('node:test');
const assert = require('node:assert/strict');
const intent = require('./intentAnalysis.cjs');
const { intentAnalysisV2Prompt, intentDraftPrompt, screenContractPrompt } = require('./prompts.cjs');

const project = {
  id: 'demo-project',
  screen_id: 'main',
  name: '武侠放置',
  project_type: 'new',
  requirement: '玩家需要领取每日奖励。',
  canvas_spec: { width: 1080, height: 1920, orientation: 'portrait', aspect_ratio: '9:16', generation_size: '864x1536' }
};

test('intentAnalysisV2Prompt opens with the fixed TASK_KIND routing line', () => {
  const prompt = intentAnalysisV2Prompt(project);
  assert.equal(prompt.split('\n')[0], 'TASK_KIND: intent-analysis-v2');
});

test('intentAnalysisV2Prompt keeps canvas/project_type context but marks them non-visual', () => {
  const prompt = intentAnalysisV2Prompt(project);
  assert.match(prompt, /Project name \(logging context only, never visual evidence\): 武侠放置/);
  assert.match(prompt, /Project type: new — a production constraint, NOT visual evidence/);
  assert.match(prompt, /Target canvas is 1080x1920, portrait, aspect ratio 9:16/);
});

test('intentAnalysisV2Prompt embeds the domain enums and server-owned field list', () => {
  const prompt = intentAnalysisV2Prompt(project);
  assert.ok(prompt.includes(JSON.stringify(intent.PAGE_TYPES)));
  assert.ok(prompt.includes(JSON.stringify(intent.LAYER_KINDS)));
  assert.ok(prompt.includes(JSON.stringify(intent.OVERLAY_LAYER_KINDS)));
  assert.ok(prompt.includes(JSON.stringify(intent.UNCERTAINTY_CATEGORIES)));
  assert.ok(prompt.includes(JSON.stringify(intent.UNCERTAINTY_PRIORITIES)));
  assert.ok(prompt.includes(JSON.stringify(intent.AUDIT_STATUSES)));
  assert.ok(prompt.includes(JSON.stringify(intent.SERVER_OWNED_ANALYSIS_FIELDS)));
  assert.match(prompt, /max 20/);
  assert.match(prompt, /max 12/);
});

test('intentAnalysisV2Prompt forbids free-form briefs and art-direction inference', () => {
  const prompt = intentAnalysisV2Prompt(project);
  assert.match(prompt, /Do not return requirement_draft or any free-form brief/);
  assert.doesNotMatch(prompt, /"requirement_draft"/);
  assert.doesNotMatch(prompt, /art direction/i);
  // §7.4 防推断：同实体证据规则必须写进 Prompt。
  assert.match(prompt, /SAME entity/);
});

test('screenContractPrompt never carries Art direction and states the input priority rule', () => {
  const prompt = screenContractPrompt(project);
  assert.doesNotMatch(prompt, /art direction:/i);
  assert.match(prompt, /reviewed designer content is authoritative/);
  assert.match(prompt, /never convert deferred items into facts/);
  assert.doesNotMatch(prompt, /Designer-confirmed Intent context/);
});

test('screenContractPrompt embeds the designer-confirmed intent context when provided', () => {
  const ctx = {
    context: { wireframe_revision: 2, project_type: 'new', review: { page_purpose: '玩家领取每日奖励' }, visible_facts: null, analysis_context_excluded: true, analysis_context_excluded_reason: 'wireframe_revision_mismatch' },
    hash: 'sha256:test',
    meta: { analysis_context_excluded: true, reason: 'wireframe_revision_mismatch' }
  };
  const prompt = screenContractPrompt(project, { intentContext: ctx });
  assert.match(prompt, /Designer-confirmed Intent context \(authoritative input\):/);
  assert.ok(prompt.includes(JSON.stringify(ctx.context)));
  assert.match(prompt, /The AI analysis context was excluded from this task \(wireframe_revision_mismatch\)/);
});

test('screenContractPrompt omits the exclusion note when analysis context is fresh', () => {
  const ctx = {
    context: { wireframe_revision: 2, project_type: 'new', review: {}, visible_facts: { layers: [], controls: [], information: [] }, analysis_context_excluded: false, analysis_context_excluded_reason: null },
    hash: 'sha256:test',
    meta: { analysis_context_excluded: false, reason: null }
  };
  const prompt = screenContractPrompt(project, { intentContext: ctx });
  assert.ok(prompt.includes(JSON.stringify(ctx.context)));
  assert.doesNotMatch(prompt, /analysis context was excluded/);
});

test('intentDraftPrompt (legacy v1) drops Art direction', () => {
  assert.doesNotMatch(intentDraftPrompt(project), /art direction/i);
});
