const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJson, validateArtifact, coverageGateErrors, withCommonFields } = require('./contracts.cjs');

test('extractJson accepts fenced model output', () => {
  assert.deepEqual(extractJson('```json\n{"ok":true}\n```'), { ok: true });
});

test('extractJson accepts the first balanced object and ignores trailing model chatter', () => {
  assert.deepEqual(extractJson('{"ok":true}\n{"duplicate":true} trailing'), { ok: true });
});

test('screen contract validator requires machine-readable arrays', () => {
  const artifact = withCommonFields({
    screen_id: 'main', screen_name: 'Main', purpose: 'Test', primary_action: 'play',
    secondary_actions: [], required_information: [], required_controls: [], states: [], edge_cases: [], data_dependencies: [],
    design_constraints: {},
    source_inventory: { requirement_functions: [], wireframe_controls: [], wireframe_information: [] },
    coverage: { covered_items: [], uncovered_items: [] }
  }, { id: 'main-contract', source: {} });
  assert.deepEqual(validateArtifact('screen-contract', artifact), []);
});

test('coverage validator accepts consolidated Chinese UI descriptions without requiring identical wording', () => {
  const artifact = withCommonFields({
    screen_id: 'main', screen_name: '阵容', purpose: '编队', primary_action: '保存阵容',
    secondary_actions: ['返回'], required_controls: ['顶部导航栏（返回/标题）', '侠客筛选区', '阵容拖拽区', '底部全局导航栏'],
    required_information: ['当前战力与铜钱', '推荐阵型与克制提示', '侠客卡片信息'], states: [], edge_cases: [], data_dependencies: [], design_constraints: {},
    source_inventory: {
      requirement_functions: ['筛选侠客', '阵容拖拽调整', '底部导航'],
      wireframe_controls: ['返回按钮', '标题', '底部导航栏页签'],
      wireframe_information: ['战力/铜钱文本', '推荐阵型/克制提示', '侠客立绘/卡片信息']
    },
    coverage: { covered_items: ['筛选侠客', '阵容拖拽调整', '底部导航', '返回按钮', '标题', '底部导航栏页签', '战力/铜钱文本', '推荐阵型/克制提示', '侠客立绘/卡片信息'], uncovered_items: [] }
  }, { id: 'semantic-contract', source: {} });
  assert.deepEqual(validateArtifact('screen-contract', artifact), []);
});

test('coverage superset is a generation-phase gate: validateArtifact no longer blocks uncovered, coverageGateErrors judges by server-side recompute', () => {
  const artifact = withCommonFields({
    screen_id: 'main', screen_name: 'Main', purpose: 'P', primary_action: 'go',
    secondary_actions: [], required_information: [], required_controls: [{ id: 'go', label: '出发', role: 'primary-action', required: true }],
    states: [], edge_cases: [], data_dependencies: [], design_constraints: {},
    source_inventory: { requirement_functions: ['出发', '返回'], wireframe_controls: [], wireframe_information: ['战力'] },
    coverage: { covered_items: ['出发'], uncovered_items: [] }
  }, { id: 'designer-truth', source: {} });
  assert.deepEqual(validateArtifact('screen-contract', artifact), []);
  const gate = coverageGateErrors(artifact);
  // 判定以服务端重算为准：即使模型自报无遗漏，未产出的来源条目仍必须
  // 列入修复反馈（required_controls 与 required_information 一并重算）。
  assert.ok(gate.some((error) => error.includes('返回') && error.includes('战力')), gate.join('; '));
});

test('M4-I3: model self-declared covered_items must not satisfy the generation gate (forged coverage enters repair loop)', () => {
  // 来源清单有「返回」，草稿没有产出任何「返回」控件，模型却把「返回」
  // 自填进 covered_items 并声称无遗漏——服务端重算必须识破，草稿必须
  // 带着 missing source items 反馈进入修复轮。
  const forged = withCommonFields({
    screen_id: 'main', screen_name: 'Main', purpose: 'P', primary_action: '确认',
    secondary_actions: [], required_information: [],
    required_controls: [{ id: 'confirm', label: '确认', role: 'primary-action', required: true }],
    states: [], edge_cases: [], data_dependencies: [], design_constraints: {},
    source_inventory: { requirement_functions: ['返回', '确认'], wireframe_controls: [], wireframe_information: [] },
    coverage: { covered_items: ['返回', '确认'], uncovered_items: [] }
  }, { id: 'forged-coverage', source: {} });
  const gate = coverageGateErrors(forged);
  assert.ok(gate.some((error) => error.includes('missing source items') && error.includes('返回')), `伪造的 covered_items 必须被服务端重算识破：${gate.join('; ')}`);
});

test('layout validator rejects shallow numeric regions that would render as an empty canvas', () => {
  const proposal = {
    id: 'a', name: '方案', strategy: '策略', visual_hierarchy: [], interaction_flow: [], tradeoffs: [], rationale: [],
    regions: { header: 0.1, content: 0.9 }
  };
  const artifact = withCommonFields({ screen_id: 'main', proposals: [proposal, { ...proposal, id: 'b' }, { ...proposal, id: 'c' }] }, { id: 'layouts', source: {} });
  assert.ok(validateArtifact('layout-proposals', artifact).some((error) => error.includes('regions.header must be an object')));
});

test('layout validator accepts three deeply structured proposals whose region ratios total one', () => {
  const proposal = {
    id: 'a', name: '方案', strategy: '策略', visual_hierarchy: [], interaction_flow: [], tradeoffs: [], rationale: [],
    regions: {
      header: { label: '顶部', recommended_ratio: 0.1 },
      content: { label: '主体', recommended_ratio: 0.9 }
    }
  };
  const artifact = withCommonFields({ screen_id: 'main', proposals: [proposal, { ...proposal, id: 'b' }, { ...proposal, id: 'c' }] }, { id: 'layouts', source: {} });
  assert.deepEqual(validateArtifact('layout-proposals', artifact), []);
});
