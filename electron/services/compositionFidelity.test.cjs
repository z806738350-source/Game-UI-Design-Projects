const test = require('node:test');
const assert = require('node:assert/strict');
const { createCompositionManifest } = require('./compositor.cjs');
const { finalApprovalGate, runFidelityChecks } = require('./fidelity.cjs');

function fixtures() {
  const hash = `sha256:${'a'.repeat(64)}`;
  const screenContract = { id: 'screen', status: 'approved', required_controls: [{ id: 'save', label: '保存', role: 'primary-action', required: true }] };
  const project = { screen_id: 'main', continuation_mode: 'existing-strict', canvas_spec: { width: 1000, height: 500 }, artifacts: { screenContract } };
  const bindings = { id: 'bindings', status: 'approved', coverage: { required_controls: 1 }, bindings: [{ control_id: 'save', component_id: 'button.primary', state: 'default', slot_id: 'bottom', approved: true, text: '保存', font_role: 'button-label' }] };
  const buttonState = { asset_path: 'style/components/button.png', asset_hash: hash };
  const componentContract = { id: 'components', status: 'approved', families: [{ id: 'button.primary', category: 'button', status: 'approved', reuse_mode: 'nine-slice', text_policy: 'text-slot', intrinsic_size: [400, 100], slice: { margins: [20, 20, 10, 10] }, states: { default: buttonState, pressed: buttonState, disabled: buttonState } }] };
  const fontManifest = { id: 'fonts', status: 'approved', fonts: [{ id: 'ui', family_name: 'Exact UI', postscript_name: 'ExactUI-Regular', format: 'ttf', local_path: 'style/fonts/ui.ttf', file_hash: hash, license_status: 'confirmed', license_confirmation: { confirmed: true }, coverage: { zh_cn: true } }], roles: { 'button-label': { font_id: 'ui', fidelity_mode: 'exact', identity_critical: true, required_coverage: ['zh_cn'], exact_confirmation: { confirmed: true } } } };
  const layout = { id: 'layout', status: 'approved', slots: [{ id: 'bottom', rect: { x: 0.3, y: 0.8, width: 0.4, height: 0.1 }, z_index: 50, underlay_policy: { keep_clear: true } }] };
  const styleContract = { id: 'style', status: 'approved', typography: { 'button-label': { size: 30, weight: 700, fill: '#fff', stroke: { width: 2, color: '#000' } } } };
  const critique = { id: 'critique', status: 'reviewed', result: 'passed', issues: [], manual_waivers: [] };
  return { project, bindings, componentContract, fontManifest, layout, styleContract, critique };
}

test('final composition deterministically records component and exact text provenance', () => {
  const input = fixtures();
  const manifest = createCompositionManifest({ ...input, underlay: { image_url: 'https://example.invalid/u.png' }, mode: 'final' });
  assert.deepEqual(manifest.layers.map((layer) => layer.type), ['component', 'text']);
  assert.equal(manifest.layers[0].asset_hash, `sha256:${'a'.repeat(64)}`);
  assert.equal(manifest.layers[1].font_hash, `sha256:${'a'.repeat(64)}`);
  assert.equal(manifest.renderer.engine, 'sharp-libvips');
  assert.equal(manifest.layers[0].renderer, 'nine-slice');
  assert.equal(manifest.layers[1].font_family, 'Exact UI');
  assert.equal(manifest.layers[1].font_license_confirmation.confirmed, true);
});

test('unconfirmed font authorization blocks final composition before approval', () => {
  const input = fixtures();
  input.fontManifest.fonts[0].license_status = 'unresolved';
  delete input.fontManifest.fonts[0].license_confirmation;
  assert.throws(() => createCompositionManifest({ ...input, underlay: { image_url: 'https://example.invalid/u.png' }, mode: 'final' }), (error) => error.code === 'COMPOSITION_GATE_FAILED' && /license is not confirmed/.test(error.message));
});

test('fidelity passes fresh exact composition and blocks unresolved typography', () => {
  const input = fixtures();
  const manifest = createCompositionManifest({ ...input, underlay: { image_url: 'https://example.invalid/u.png' }, mode: 'final' });
  const output = { schema_version: '1.0', id: `${manifest.id}-output`, version: 1, status: 'generated', source: { composition_manifest: manifest.id }, mode: 'final', path: 'screens/main/compositions/final-v1.png', hash: `sha256:${'b'.repeat(64)}`, width: 1000, height: 500, renderer_version: 'test', render_log: { layers: [{ control_id: 'save', font_role: 'button-label', actual_font_verified: true, actual_loaded_family: 'Exact UI', font_hash: `sha256:${'a'.repeat(64)}` }] } };
  manifest.output = { artifact_id: output.id, path: output.path, hash: output.hash, width: output.width, height: output.height };
  const outputVerification = { passed: true, issues: [] };
  const dependencies = [input.bindings, input.componentContract, input.fontManifest, input.layout, input.styleContract, input.critique, manifest, output];
  const report = runFidelityChecks({ ...input, manifest, output, outputVerification, dependencies });
  assert.equal(report.status, 'passed');
  assert.equal(finalApprovalGate(report).passed, true);
  assert.equal(finalApprovalGate({ ...report, status: 'stale' }).passed, false);
  const brokenFont = structuredClone(input.fontManifest); brokenFont.roles['button-label'].fidelity_mode = 'unresolved';
  const broken = runFidelityChecks({ ...input, fontManifest: brokenFont, manifest, output, outputVerification, dependencies });
  assert.ok(broken.issues.some((issue) => issue.code === 'TYPOGRAPHY_GATE_FAILED'));
  assert.equal(finalApprovalGate(broken).passed, false);
  const missingRenderEvidence = structuredClone(output);
  missingRenderEvidence.render_log.layers = [];
  const unverified = runFidelityChecks({ ...input, manifest, output: missingRenderEvidence, outputVerification, dependencies });
  assert.ok(unverified.issues.some((issue) => issue.code === 'FONT_RENDER_NOT_VERIFIED'));
  assert.equal(finalApprovalGate(unverified).passed, false);
});
