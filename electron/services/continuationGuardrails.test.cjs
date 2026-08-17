const test = require('node:test');
const assert = require('node:assert/strict');
const { visualTask } = require('./prompts.cjs');
const { providerCapabilities } = require('./providerCapabilities.cjs');
const { buildReferencePack } = require('./referencePack.cjs');

test('existing strict visual task generates underlay and forbids shared UI and formal text', () => {
  const project = { id: 'p', name: 'P', project_type: 'existing', continuation_mode: 'existing-strict', screen_id: 'main', canvas_spec: { generation_size: '1536x864', aspect_ratio: '16:9' } };
  const task = visualTask(project, { id: 'layout' }, { id: 'style' }, 'conservative');
  assert.equal(task.production_mode, 'underlay-only');
  assert.match(task.prompt, /Do not generate shared buttons/);
  assert.match(task.prompt, /formal UI text/);
  assert.doesNotMatch(task.prompt, /component treatment/);
});

test('reference pack is deterministic and records capacity omissions', () => {
  const assets = [
    { id: 'support', path: '/s', role: 'supporting', order: 0 },
    { id: 'primary', path: '/p', role: 'primary', order: 1 },
    { id: 'component', path: '/c', role: 'component', order: 2 }
  ];
  const pack = buildReferencePack({ assets, capabilities: providerCapabilities({ max_reference_images: 2 }), purpose: 'test' });
  assert.deepEqual(pack.selected.map((asset) => asset.id), ['component', 'primary']);
  assert.deepEqual(pack.omitted, [{ id: 'support', name: undefined, role: 'supporting', reason: 'provider-capacity:2' }]);
  assert.deepEqual(pack.capacity_decision, { used: 2, limit: 2, omitted: 1 });
});
