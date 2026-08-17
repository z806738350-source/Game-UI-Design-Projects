const test = require('node:test');
const assert = require('node:assert/strict');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { hashBuffer, nineSliceRenderer } = require('./compositionRenderer.cjs');
const { inspectFidelityEvidence } = require('./fidelityInspector.cjs');
const { inspectFont } = require('./typographyAssets.cjs');

const fontCandidates = ['/System/Library/Fonts/Supplemental/Georgia.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', '/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf'];

test('pixel inspector rehashes files and rejects output dimensions, text overflow, and deformed 9-slice corners', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-fidelity-'));
  try {
    const componentPath = path.join(root, 'style/components/panel.png'); const fontPath = path.join(root, 'style/fonts/ui.ttf'); const outputPath = path.join(root, 'final.png');
    await fs.mkdir(path.dirname(componentPath), { recursive: true }); await fs.mkdir(path.dirname(fontPath), { recursive: true });
    const component = await sharp({ create: { width: 12, height: 12, channels: 4, background: '#4488ccff' } }).png().toBuffer(); await fs.writeFile(componentPath, component);
    const systemFont = fontCandidates.find((candidate) => fsSync.existsSync(candidate)); assert.ok(systemFont); await fs.copyFile(systemFont, fontPath); const font = await inspectFont(fontPath);
    const outputBytes = await sharp({ create: { width: 100, height: 50, channels: 4, background: '#202838ff' } }).png().toBuffer(); await fs.writeFile(outputPath, outputBytes);
    const componentLayer = { type: 'component', control_id: 'panel', component_id: 'panel.frame', asset_path: 'style/components/panel.png', asset_hash: hashBuffer(component), slice: { margins: [3, 3, 3, 3] }, rect: [0.1, 0.1, 0.4, 0.4], renderer: 'nine-slice' };
    const renderedPanel = await nineSliceRenderer({ projectPath: root, layer: componentLayer, target: { left: 10, top: 5, width: 40, height: 20 } });
    const textLayer = { type: 'text', control_id: 'label', font_role: 'label', font_id: 'ui', font_path: 'style/fonts/ui.ttf', font_hash: font.file_hash, font_family: font.family_name, postscript_name: font.postscript_name, rect: [0.1, 0.6, 0.4, 0.2] };
    const manifest = { id: 'composition', version: 4, canvas: [100, 50], layers: [componentLayer, textLayer] };
    const output = { id: 'output', version: 4, mode: 'final', path: 'final.png', hash: hashBuffer(outputBytes), width: 100, height: 50, source: { composition_manifest: 'composition', composition_manifest_version: 4 }, renderer_version: 'test', render_log: { layers: [renderedPanel.diagnostic, { control_id: 'label', font_role: 'label', target_rect: { left: 10, top: 30, width: 40, height: 10 }, ink_bounds: { left: 3, top: 2, width: 30, height: 6, touches_boundary: false }, text_overflow: false }] } };
    const project = { artifacts: { approvedLayout: { slots: [{ id: 'panel-slot', safe_area_compliant: false }, { id: 'label-slot', safe_area_compliant: false }] }, bindings: { bindings: [{ control_id: 'panel', slot_id: 'panel-slot' }, { control_id: 'label', slot_id: 'label-slot' }] } } };
    const passed = await inspectFidelityEvidence({ projectPath: root, project, manifest, output }); assert.equal(passed.passed, true); assert.match(passed.evidence_digest, /^sha256:/);
    await fs.writeFile(componentPath, await sharp({ create: { width: 12, height: 12, channels: 4, background: '#ff0000ff' } }).png().toBuffer());
    const tampered = await inspectFidelityEvidence({ projectPath: root, project, manifest, output }); assert.ok(tampered.issues.some((issue) => issue.code === 'COMPONENT_ASSET_HASH_MISMATCH'));
    await fs.writeFile(componentPath, component); await fs.appendFile(fontPath, Buffer.from([0]));
    const fontTampered = await inspectFidelityEvidence({ projectPath: root, project, manifest, output }); assert.ok(fontTampered.issues.some((issue) => issue.code === 'FONT_ASSET_HASH_MISMATCH'));
    await fs.copyFile(systemFont, fontPath);
    const overflowOutput = structuredClone(output); overflowOutput.render_log.layers[1].text_overflow = true;
    const overflow = await inspectFidelityEvidence({ projectPath: root, project, manifest, output: overflowOutput }); assert.ok(overflow.issues.some((issue) => issue.code === 'TEXT_OVERFLOW'));
    const deformedOutput = structuredClone(output); deformedOutput.render_log.layers[0].patches.find((item) => item.fixed_corner).rendered_hash = `sha256:${'0'.repeat(64)}`;
    const deformed = await inspectFidelityEvidence({ projectPath: root, project, manifest, output: deformedOutput }); assert.ok(deformed.issues.some((issue) => issue.code === 'NINE_SLICE_FIXED_REGION_DEFORMED'));
    const overlapManifest = structuredClone(manifest); overlapManifest.layers.push({ ...componentLayer, control_id: 'panel-2' });
    const overlapOutput = structuredClone(output); overlapOutput.render_log.layers.push({ ...renderedPanel.diagnostic, control_id: 'panel-2' });
    const overlapProject = structuredClone(project); overlapProject.artifacts.approvedLayout.slots.push({ id: 'panel-2-slot', safe_area_compliant: false }); overlapProject.artifacts.bindings.bindings.push({ control_id: 'panel-2', slot_id: 'panel-2-slot' });
    const overlap = await inspectFidelityEvidence({ projectPath: root, project: overlapProject, manifest: overlapManifest, output: overlapOutput }); assert.ok(overlap.issues.some((issue) => issue.code === 'COMPONENT_OVERLAP'));
    const unsafeProject = structuredClone(project); unsafeProject.artifacts.approvedLayout.slots[0].safe_area_compliant = true;
    const unsafeManifest = structuredClone(manifest); unsafeManifest.layers[0].rect = [0.01, 0.1, 0.4, 0.4];
    const unsafe = await inspectFidelityEvidence({ projectPath: root, project: unsafeProject, manifest: unsafeManifest, output }); assert.ok(unsafe.issues.some((issue) => issue.code === 'SAFE_AREA_VIOLATION'));
    const transparentBytes = await sharp({ create: { width: 100, height: 50, channels: 4, background: '#00000000' } }).png().toBuffer(); await fs.writeFile(outputPath, transparentBytes);
    const transparentOutput = { ...output, hash: hashBuffer(transparentBytes) };
    const transparent = await inspectFidelityEvidence({ projectPath: root, project, manifest, output: transparentOutput }); assert.ok(transparent.issues.some((issue) => issue.code === 'FINAL_PIXELS_EMPTY'));
    const wrongSize = await sharp({ create: { width: 99, height: 50, channels: 4, background: '#202838ff' } }).png().toBuffer(); await fs.writeFile(outputPath, wrongSize);
    const resized = await inspectFidelityEvidence({ projectPath: root, project, manifest, output }); assert.ok(resized.issues.some((issue) => issue.code === 'COMPOSITION_OUTPUT_DIMENSION_MISMATCH'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
