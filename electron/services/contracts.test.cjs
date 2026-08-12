const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJson, validateArtifact, withCommonFields } = require('./contracts.cjs');

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
