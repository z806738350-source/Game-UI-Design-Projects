const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReferencePack } = require('./referencePack.cjs');
const { attachmentInstructions } = require('./prompts.cjs');

test('reference pack records exact attachment order and blocks unconfirmed omissions', () => {
  const assets = [
    { id: 'support', name: '辅助页', role: 'supporting', path: '/support.png', approved: true },
    { id: 'component', name: '组件页', role: 'component', path: '/component.png', approved: true },
    { id: 'primary', name: '主基线', role: 'primary', path: '/primary.png', approved: true }
  ];
  const pack = buildReferencePack({ assets, capabilities: { max_reference_images: 2 }, purpose: 'style-resolution' });
  assert.deepEqual(pack.selected.map((item) => item.id), ['component', 'primary']);
  assert.deepEqual(pack.attachment_order.map((item) => item.index), [1, 2]);
  assert.equal(pack.requires_omission_confirmation, true);
  assert.match(attachmentInstructions(pack), /附件 1：组件页；角色：component/);
  assert.match(attachmentInstructions(pack), /附件 2：主基线；角色：primary/);
});

test('pack hash is deterministic and changes with selection, omission or capacity', () => {
  const assets = [
    { id: 'support', name: '辅助页', role: 'supporting', path: '/support.png', approved: true },
    { id: 'component', name: '组件页', role: 'component', path: '/component.png', approved: true },
    { id: 'primary', name: '主基线', role: 'primary', path: '/primary.png', approved: true }
  ];
  const pack = buildReferencePack({ assets, capabilities: { max_reference_images: 2 }, purpose: 'underlay-generation' });
  const same = buildReferencePack({ assets: [...assets].reverse(), capabilities: { max_reference_images: 2 }, purpose: 'underlay-generation' });
  assert.equal(typeof pack.pack_hash, 'string');
  assert.equal(pack.pack_hash, same.pack_hash, 'same selection must produce the same hash regardless of input order');
  const wider = buildReferencePack({ assets, capabilities: { max_reference_images: 3 }, purpose: 'underlay-generation' });
  assert.notEqual(pack.pack_hash, wider.pack_hash, 'capacity change must invalidate the confirmation');
  const otherPurpose = buildReferencePack({ assets, capabilities: { max_reference_images: 2 }, purpose: 'style-resolution' });
  assert.notEqual(pack.pack_hash, otherPurpose.pack_hash, 'purpose is part of the confirmation fact');
});
