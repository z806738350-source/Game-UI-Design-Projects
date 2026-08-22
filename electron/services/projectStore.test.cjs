const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectStore } = require('./projectStore.cjs');

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

test('project store preserves upload metadata and duplicates projects independently', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-store-'));
  const previousWorkspace = process.env.DESIGN_COPILOT_WORKSPACE;
  process.env.DESIGN_COPILOT_WORKSPACE = temporaryRoot;
  try {
    const store = createProjectStore();
    let project = await store.create({ name: 'Character Growth', projectType: 'new' });
    const sourceImage = path.join(temporaryRoot, '角色养成线框.png');
    await fs.writeFile(sourceImage, pngHeader(1080, 1920));
    project = await store.importFile(project.id, sourceImage, 'wireframe');
    assert.equal(project.wireframe_name, '角色养成线框.png');
    assert.match(project.wireframe_preview, /^data:image\/png;base64,/);
    assert.deepEqual(project.canvas_spec, { width: 1080, height: 1920, orientation: 'portrait', aspect_ratio: '9:16', generation_size: '864x1536' });
    const referenceOne = path.join(temporaryRoot, 'reference-1.png');
    const referenceTwo = path.join(temporaryRoot, 'reference-2.png');
    await fs.writeFile(referenceOne, pngHeader(1920, 1080));
    await fs.writeFile(referenceTwo, pngHeader(1920, 1080));
    project = await store.importFile(project.id, referenceOne, 'reference');
    project = await store.importFile(project.id, referenceTwo, 'reference');
    assert.equal(project.reference_assets.length, 2);
    assert.equal(project.reference_assets[0].role, 'primary');
    ({ project } = await store.manageReference(project.id, { id: project.reference_assets[1].id, action: 'role', role: 'primary' }));
    assert.equal(project.reference_assets[1].role, 'primary');
    assert.equal(project.reference_assets[0].role, 'supporting');
    ({ project } = await store.manageReference(project.id, { id: project.reference_assets[1].id, action: 'move', direction: 'up' }));
    assert.equal(project.reference_assets[0].role, 'primary');
    // AUD-07：无变化的操作必须是 no-op——重复设置同角色、移动到原位置、
    // 重复批准同状态、blur 未改内容都不得 bump input_revisions。
    const revisionBefore = project.input_revisions?.references;
    let noop = await store.manageReference(project.id, { id: project.reference_assets[0].id, action: 'role', role: 'primary' });
    assert.equal(noop.changed, false);
    noop = await store.manageReference(project.id, { id: project.reference_assets[0].id, action: 'move', direction: 'up' });
    assert.equal(noop.changed, false);
    noop = await store.manageReference(project.id, { id: project.reference_assets[0].id, action: 'details', screenType: '', contains: [], baseline: '', notes: '' });
    assert.equal(noop.changed, false);
    noop = await store.manageReference(project.id, { id: project.reference_assets[0].id, action: 'approval', approved: false });
    assert.equal(noop.changed, false);
    assert.equal(noop.project.input_revisions?.references, revisionBefore);
    ({ project } = await store.manageReference(project.id, { id: project.reference_assets[1].id, action: 'remove' }));
    assert.equal(project.reference_assets.length, 1);
    const duplicate = await store.duplicate(project.id);
    assert.notEqual(duplicate.id, project.id);
    assert.equal(duplicate.name, 'Character Growth · 副本');
    assert.equal(duplicate.wireframe_path.startsWith(duplicate.workspacePath), true);
    assert.notEqual(duplicate.wireframe_path, project.wireframe_path);
    assert.equal(duplicate.artifacts.referenceInventory.assets[0].path.startsWith(duplicate.workspacePath), true);
    assert.notEqual(duplicate.artifacts.referenceInventory.assets[0].path, project.artifacts.referenceInventory.assets[0].path);
    const archived = await store.saveProject(duplicate.id, { status: 'archived' });
    assert.equal(archived.status, 'archived');
  } finally {
    if (previousWorkspace === undefined) delete process.env.DESIGN_COPILOT_WORKSPACE;
    else process.env.DESIGN_COPILOT_WORKSPACE = previousWorkspace;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
