const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fsSync = require('node:fs');
const sharp = require('sharp');
const { createDesignPipeline } = require('./designPipeline.cjs');
const { createProjectStore } = require('./projectStore.cjs');
const {
  assertFinalApprovalForExport,
  exactRenderer,
  exportCompositionOutput,
  hashBuffer,
  nineSliceRenderer,
  renderComposition,
  vectorTokenRenderer,
  verifyCompositionOutput
} = require('./compositionRenderer.cjs');
const { inspectFont } = require('./typographyAssets.cjs');

async function temporaryProject(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(root, 'style', 'components'), { recursive: true });
  await fs.mkdir(path.join(root, 'screens', 'main', 'compositions'), { recursive: true });
  return root;
}

function pixelFixture(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  const colour = (x, y) => {
    if (x < 3 && y < 3) return [255, 0, 0, 255];
    if (x >= width - 3 && y < 3) return [0, 255, 0, 255];
    if (x < 3 && y >= height - 3) return [0, 0, 255, 255];
    if (x >= width - 3 && y >= height - 3) return [255, 255, 0, 255];
    if (y < 3 || y >= height - 3) return [180, 0, 180, 255];
    if (x < 3 || x >= width - 3) return [0, 180, 180, 255];
    return [80, 80, 80, 255];
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      Buffer.from(colour(x, y)).copy(pixels, offset);
    }
  }
  return pixels;
}

async function rawPatch(input, extract) {
  return sharp(input).extract(extract).ensureAlpha().raw().toBuffer();
}

test('nine-slice keeps all four corner patches byte-identical and stretches regions by axis', async () => {
  const root = await temporaryProject('composition-nine-slice-');
  try {
    const sourcePixels = pixelFixture(12, 12);
    const source = await sharp(sourcePixels, { raw: { width: 12, height: 12, channels: 4 } }).png().toBuffer();
    const assetPath = path.join(root, 'style', 'components', 'panel.png');
    await fs.writeFile(assetPath, source);
    const rendered = await nineSliceRenderer({
      projectPath: root,
      layer: { control_id: 'panel', component_id: 'panel.frame', asset_path: 'style/components/panel.png', asset_hash: hashBuffer(source), slice: { margins: [3, 3, 3, 3] } },
      target: { left: 0, top: 0, width: 30, height: 20 }
    });
    const corners = [
      [{ left: 0, top: 0, width: 3, height: 3 }, { left: 0, top: 0, width: 3, height: 3 }],
      [{ left: 9, top: 0, width: 3, height: 3 }, { left: 27, top: 0, width: 3, height: 3 }],
      [{ left: 0, top: 9, width: 3, height: 3 }, { left: 0, top: 17, width: 3, height: 3 }],
      [{ left: 9, top: 9, width: 3, height: 3 }, { left: 27, top: 17, width: 3, height: 3 }]
    ];
    for (const [sourceRect, targetRect] of corners) {
      assert.deepEqual(await rawPatch(source, sourceRect), await rawPatch(rendered.input, targetRect));
    }
    assert.equal(rendered.diagnostic.patches.length, 9);
    assert.equal(rendered.diagnostic.patches.filter((patch) => patch.fixed_corner).length, 4);
    assert.deepEqual(rendered.diagnostic.patches[1].source, { left: 3, top: 0, width: 6, height: 3 });
    assert.deepEqual(rendered.diagnostic.patches[1].destination, { left: 3, top: 0, width: 24, height: 3 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('exact renderer rejects non-uniform slots and records a valid uniform transform', async () => {
  const root = await temporaryProject('composition-exact-');
  try {
    const source = await sharp({ create: { width: 10, height: 5, channels: 4, background: '#ff0000ff' } }).png().toBuffer();
    await fs.writeFile(path.join(root, 'style', 'components', 'exact.png'), source);
    const layer = { control_id: 'badge', component_id: 'badge.exact', asset_path: 'style/components/exact.png', asset_hash: hashBuffer(source), intrinsic_size: [10, 5], scale_policy: { min_scale: 1, max_scale: 3 } };
    await assert.rejects(exactRenderer({ projectPath: root, layer, target: { left: 0, top: 0, width: 20, height: 20 } }), (error) => error.code === 'EXACT_NON_UNIFORM_SCALE');
    const rendered = await exactRenderer({ projectPath: root, layer, target: { left: 0, top: 0, width: 20, height: 10 } });
    assert.equal(rendered.diagnostic.renderer, 'exact');
    assert.deepEqual(rendered.diagnostic.transform, { scale_x: 2, scale_y: 2, uniform: true });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('vector-token renderer requires SVG and rasterizes through the vector path', async () => {
  const root = await temporaryProject('composition-vector-');
  try {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" rx="2" fill="#22cc88"/></svg>');
    await fs.writeFile(path.join(root, 'style', 'components', 'token.svg'), svg);
    const rendered = await vectorTokenRenderer({ projectPath: root, layer: { control_id: 'token', component_id: 'token.vector', asset_path: 'style/components/token.svg', asset_hash: hashBuffer(svg) }, target: { left: 0, top: 0, width: 40, height: 20 } });
    const metadata = await sharp(rendered.input).metadata();
    assert.deepEqual([metadata.width, metadata.height], [40, 20]);
    assert.equal(rendered.diagnostic.renderer, 'vector-token');
    assert.equal(rendered.diagnostic.transform.scalable_vector, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('composition writes a real deterministic PNG and verification fails after deletion', async () => {
  const root = await temporaryProject('composition-output-');
  try {
    const underlay = await sharp({ create: { width: 32, height: 16, channels: 4, background: '#203060ff' } }).png().toBuffer();
    const component = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ff8844ff' } }).png().toBuffer();
    await fs.writeFile(path.join(root, 'underlay.png'), underlay);
    await fs.writeFile(path.join(root, 'style', 'components', 'icon.png'), component);
    const manifest = {
      schema_version: '2.0', id: 'main-composition-final', version: 1, status: 'draft', source: {}, mode: 'final', canvas: [32, 16],
      underlay: { path: 'underlay.png' },
      layers: [{ type: 'component', control_id: 'icon', component_id: 'icon.exact', asset_path: 'style/components/icon.png', asset_hash: hashBuffer(component), intrinsic_size: [8, 8], scale_policy: { min_scale: 1, max_scale: 1 }, rect: [0.25, 0.25, 0.25, 0.5], renderer: 'exact', z_index: 1 }]
    };
    const first = await renderComposition({ manifest, projectPath: root, outputPath: 'screens/main/compositions/final-v1.png' });
    const second = await renderComposition({ manifest, projectPath: root, outputPath: 'screens/main/compositions/final-v1-repeat.png' });
    assert.equal(first.hash, second.hash);
    assert.deepEqual([first.width, first.height], [32, 16]);
    assert.notEqual(first.hash, hashBuffer(underlay));
    assert.equal((await verifyCompositionOutput(root, first, { requireFinal: true })).passed, true);
    const exportedPath = path.join(root, 'exported-final.png');
    const exported = await exportCompositionOutput(root, first, exportedPath);
    assert.equal(exported.hash, first.hash);
    assert.equal(hashBuffer(await fs.readFile(exportedPath)), first.hash);
    await fs.unlink(path.join(root, first.path));
    const missing = await verifyCompositionOutput(root, first, { requireFinal: true });
    assert.equal(missing.passed, false);
    assert.ok(missing.issues.some((issue) => issue.code === 'COMPOSITION_OUTPUT_UNREADABLE'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('strict pipeline persists final output and final approval fails when its PNG is deleted', async () => {
  const root = await temporaryProject('composition-pipeline-');
  try {
    const projectStore = createProjectStore({ workspaceRoot: root });
    let project = await projectStore.create({ name: 'Strict Output', projectType: 'existing', requirement: 'Render a strict UI.' });
    const underlay = await sharp({ create: { width: 32, height: 16, channels: 4, background: '#202844ff' } }).png().toBuffer();
    const wireframePath = path.join(root, 'wireframe.png');
    await fs.writeFile(wireframePath, underlay);
    project = await projectStore.importFile(project.id, wireframePath, 'wireframe');
    const relativeUnderlay = 'underlay.png';
    await fs.writeFile(path.join(project.workspacePath, relativeUnderlay), underlay);
    const component = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ff8844ff' } }).png().toBuffer();
    const componentPath = path.join(project.workspacePath, 'style', 'components', 'icon.png');
    await fs.mkdir(path.dirname(componentPath), { recursive: true });
    await fs.writeFile(componentPath, component);
    const base = { schema_version: '2.0', version: 1, status: 'approved', source: {} };
    await projectStore.saveArtifact(project.id, 'screen-contract', { ...base, id: 'screen', required_controls: [{ id: 'icon', label: 'Icon', role: 'icon-action', required: true }] });
    await projectStore.saveArtifact(project.id, 'component-bindings', { ...base, id: 'bindings', coverage: { required_controls: 1 }, bindings: [{ control_id: 'icon', component_id: 'icon.exact', state: 'default', slot_id: 'icon-slot', approved: true }] });
    await projectStore.saveArtifact(project.id, 'component-contract', { ...base, id: 'components', families: [{ id: 'icon.exact', category: 'icon', status: 'approved', reuse_mode: 'exact', text_policy: 'none', intrinsic_size: [8, 8], scale_policy: { min_scale: 1, max_scale: 1 }, states: { default: { asset_path: 'style/components/icon.png', asset_hash: hashBuffer(component) } } }] });
    await projectStore.saveArtifact(project.id, 'approved-layout', { ...base, id: 'layout', slots: [{ id: 'icon-slot', rect: { x: 0.25, y: 0.25, width: 0.25, height: 0.5 }, z_index: 1, underlay_policy: { keep_clear: true } }] });
    await projectStore.saveArtifact(project.id, 'style-contract', { ...base, id: 'style', typography: {} });
    const systemFont = ['/System/Library/Fonts/Supplemental/Georgia.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf'].find((candidate) => fsSync.existsSync(candidate));
    assert.ok(systemFont, 'a real system TTF is required');
    const fontPath = path.join(project.workspacePath, 'style', 'fonts', 'ui.ttf'); await fs.mkdir(path.dirname(fontPath), { recursive: true }); await fs.copyFile(systemFont, fontPath); const font = await inspectFont(fontPath);
    await projectStore.saveArtifact(project.id, 'font-manifest', { ...base, id: 'fonts', fonts: [{ id: 'ui', family_name: font.family_name, postscript_name: font.postscript_name, format: 'ttf', local_path: 'style/fonts/ui.ttf', file_hash: font.file_hash, license_status: 'confirmed', license_confirmation: { confirmed: true }, coverage: font.coverage }], roles: {} });
    await projectStore.saveArtifact(project.id, 'underlay-contract', { ...base, id: 'underlay-contract' });
    await projectStore.saveArtifact(project.id, 'underlay-critique', { ...base, id: 'critique', result: 'passed', issues: [], manual_waivers: [] });
    await projectStore.saveArtifact(project.id, 'visual-results', { ...base, id: 'visuals', variations: [{ id: 'underlay-v1', image_path: relativeUnderlay }] });
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    project = await pipeline.composeVisual(project.id, { screenId: 'main', variationId: 'underlay-v1', mode: 'final' });
    assert.equal(project.artifacts.compositionOutput.mode, 'final');
    assert.equal(project.artifacts.compositionManifest.output.hash, project.artifacts.compositionOutput.hash);
    assert.equal((await fs.stat(path.join(project.workspacePath, project.artifacts.compositionOutput.path))).isFile(), true);
    project = await pipeline.runFidelity(project.id, { screenId: 'main' });
    assert.equal(project.artifacts.fidelityReport.status, 'passed');
    assert.equal(project.artifacts.fidelityReport.manifest_consistency.passed, true);
    assert.equal(project.artifacts.fidelityReport.visual_fidelity.passed, true);
    assert.equal(project.artifacts.fidelityReport.evidence.check_version, 'pixel-fidelity-v1');
    await assert.rejects(pipeline.updateArtifact(project.id, 'fidelity-report', { screenId: 'main', status: 'passed', issues: [] }), (error) => error.code === 'GENERATED_EVIDENCE_READ_ONLY');
    const tamperedComponent = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#00ff00ff' } }).png().toBuffer();
    await fs.writeFile(componentPath, tamperedComponent);
    await assert.rejects(pipeline.approveArtifact(project.id, 'composition-manifest', { screenId: 'main' }), (error) => error.code === 'FIDELITY_CURRENT_EVIDENCE_FAILED');
    await fs.writeFile(componentPath, component);
    await fs.unlink(path.join(project.workspacePath, project.artifacts.compositionOutput.path));
    await assert.rejects(pipeline.approveArtifact(project.id, 'composition-manifest', { screenId: 'main' }), (error) => error.code === 'COMPOSITION_OUTPUT_INVALID');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a failed composition regeneration leaves the evidence chain stale (UIE2E-07B/07C backend)', async () => {
  const root = await temporaryProject('composition-stale-');
  try {
    const projectStore = createProjectStore({ workspaceRoot: root });
    let project = await projectStore.create({ name: 'Stale Composition', projectType: 'existing', requirement: 'Render a strict UI.' });
    const underlay = await sharp({ create: { width: 32, height: 16, channels: 4, background: '#202844ff' } }).png().toBuffer();
    const wireframePath = path.join(root, 'wireframe.png');
    await fs.writeFile(wireframePath, underlay);
    project = await projectStore.importFile(project.id, wireframePath, 'wireframe');
    const relativeUnderlay = 'underlay.png';
    await fs.writeFile(path.join(project.workspacePath, relativeUnderlay), underlay);
    const component = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ff8844ff' } }).png().toBuffer();
    const componentPath = path.join(project.workspacePath, 'style', 'components', 'icon.png');
    await fs.mkdir(path.dirname(componentPath), { recursive: true });
    await fs.writeFile(componentPath, component);
    const base = { schema_version: '2.0', version: 1, status: 'approved', source: {} };
    await projectStore.saveArtifact(project.id, 'screen-contract', { ...base, id: 'screen', required_controls: [{ id: 'icon', label: 'Icon', role: 'icon-action', required: true }] });
    await projectStore.saveArtifact(project.id, 'component-bindings', { ...base, id: 'bindings', coverage: { required_controls: 1 }, bindings: [{ control_id: 'icon', component_id: 'icon.exact', state: 'default', slot_id: 'icon-slot', approved: true }] });
    await projectStore.saveArtifact(project.id, 'component-contract', { ...base, id: 'components', families: [{ id: 'icon.exact', category: 'icon', status: 'approved', reuse_mode: 'exact', text_policy: 'none', intrinsic_size: [8, 8], scale_policy: { min_scale: 1, max_scale: 1 }, states: { default: { asset_path: 'style/components/icon.png', asset_hash: hashBuffer(component) } } }] });
    await projectStore.saveArtifact(project.id, 'approved-layout', { ...base, id: 'layout', slots: [{ id: 'icon-slot', rect: { x: 0.25, y: 0.25, width: 0.25, height: 0.5 }, z_index: 1, underlay_policy: { keep_clear: true } }] });
    await projectStore.saveArtifact(project.id, 'style-contract', { ...base, id: 'style', typography: {} });
    const systemFont = ['/System/Library/Fonts/Supplemental/Georgia.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf'].find((candidate) => fsSync.existsSync(candidate));
    assert.ok(systemFont, 'a real system TTF is required');
    const fontPath = path.join(project.workspacePath, 'style', 'fonts', 'ui.ttf'); await fs.mkdir(path.dirname(fontPath), { recursive: true }); await fs.copyFile(systemFont, fontPath); const font = await inspectFont(fontPath);
    await projectStore.saveArtifact(project.id, 'font-manifest', { ...base, id: 'fonts', fonts: [{ id: 'ui', family_name: font.family_name, postscript_name: font.postscript_name, format: 'ttf', local_path: 'style/fonts/ui.ttf', file_hash: font.file_hash, license_status: 'confirmed', license_confirmation: { confirmed: true }, coverage: font.coverage }], roles: {} });
    await projectStore.saveArtifact(project.id, 'underlay-contract', { ...base, id: 'underlay-contract' });
    await projectStore.saveArtifact(project.id, 'underlay-critique', { ...base, id: 'critique', result: 'passed', issues: [], manual_waivers: [] });
    await projectStore.saveArtifact(project.id, 'visual-results', { ...base, id: 'visuals', variations: [{ id: 'underlay-v1', image_path: relativeUnderlay }] });
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: {}, kunpoConfig: {} });
    project = await pipeline.composeVisual(project.id, { screenId: 'main', variationId: 'underlay-v1', mode: 'final' });
    project = await pipeline.runFidelity(project.id, { screenId: 'main' });
    assert.equal(project.artifacts.fidelityReport.status, 'passed');
    // Fault injection: the component asset disappears; the regeneration
    // attempt must fail AND demote the previous evidence chain, so no gate
    // can keep trusting the old composition.
    await fs.unlink(componentPath);
    await assert.rejects(pipeline.composeVisual(project.id, { screenId: 'main', variationId: 'underlay-v1', mode: 'final' }));
    const refreshed = await projectStore.open(project.id, { screenId: 'main' });
    assert.equal(refreshed.artifacts.compositionManifest.status, 'stale');
    assert.equal(refreshed.artifacts.compositionOutput.status, 'stale');
    assert.equal(refreshed.artifacts.fidelityReport.status, 'stale');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('final export requires an approved composition manifest (FINAL_APPROVAL_REQUIRED)', () => {
  const approved = { artifacts: { compositionManifest: { status: 'approved' } } };
  assert.doesNotThrow(() => assertFinalApprovalForExport(approved));
  for (const status of ['draft', 'generated', 'reviewed', 'stale', 'rejected']) {
    assert.throws(
      () => assertFinalApprovalForExport({ artifacts: { compositionManifest: { status } } }),
      (error) => error.code === 'FINAL_APPROVAL_REQUIRED'
    );
  }
  // 无 manifest（从未进入合成阶段）同样阻断
  assert.throws(() => assertFinalApprovalForExport({ artifacts: {} }), (error) => error.code === 'FINAL_APPROVAL_REQUIRED');
});
