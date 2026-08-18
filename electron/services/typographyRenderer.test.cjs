const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const systemCandidates = [
  '/System/Library/Fonts/Supplemental/Georgia.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf'
];
const systemFont = systemCandidates.find((candidate) => fsSync.existsSync(candidate));
assert.ok(systemFont, 'a real system TTF is required for typography renderer tests');

const fontconfigRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'copilot-fontconfig-'));
const fontDirs = [...new Set(systemCandidates.filter((candidate) => fsSync.existsSync(candidate)).map((candidate) => path.dirname(candidate)))];
fsSync.writeFileSync(path.join(fontconfigRoot, 'fonts.conf'), `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>${fontDirs.map((directory) => `<dir>${directory}</dir>`).join('')}<cachedir>${path.join(fontconfigRoot, 'cache')}</cachedir></fontconfig>`);
process.env.FONTCONFIG_FILE = path.join(fontconfigRoot, 'fonts.conf');

const sharp = require('sharp');
const { renderTextLayer } = require('./typographyRenderer.cjs');
const { inspectFont } = require('./typographyAssets.cjs');

function hashBuffer(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function resolveProjectPath(projectPath, filePath) {
  const resolved = path.resolve(projectPath, filePath);
  if (path.relative(projectPath, resolved).startsWith('..')) throw new Error('path escaped');
  return resolved;
}

test('exact fontfile rendering records actual identity and differs from preview fallback pixels', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-type-render-'));
  try {
    const relative = 'style/fonts/exact.ttf';
    const targetPath = path.join(root, relative);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(systemFont, targetPath);
    const inspected = await inspectFont(targetPath);
    const common = {
      control_id: 'score', font_role: 'numeric', content: 'GAME UI 1234', rect: [0, 0, 1, 1],
      typography: { size: 30, weight: 700, fill: '#f8e7a0', letter_spacing: 1.5, line_height: 1.25, stroke: { width: 1, color: '#241a08' }, shadow: { color: '#000000', blur: 1, offset_x: 2, offset_y: 2 }, gradient: { from: '#fff4b0', to: '#d28a24', angle: 25 }, baseline_offset: 1, numeric_style: 'tabular' }
    };
    const exact = await renderTextLayer({ projectPath: root, target: { width: 360, height: 96 }, resolveProjectPath, hashBuffer, layer: { ...common, composition_mode: 'final', font_path: relative, font_hash: inspected.file_hash, font_family: inspected.family_name, postscript_name: inspected.postscript_name, font_license_status: 'confirmed', font_license_confirmation: { confirmed: true }, fidelity_mode: 'exact', exact_confirmation: { confirmed: true } } });
    assert.equal(exact.diagnostic.actual_font_verified, true);
    assert.equal(exact.diagnostic.actual_loaded_family, inspected.family_name);
    assert.equal(exact.diagnostic.actual_postscript_name, inspected.postscript_name);
    assert.equal(exact.diagnostic.effects.numeric_style, 'tabular');
    assert.equal((await sharp(exact.input).metadata()).width, 360);
    assert.ok((await sharp(exact.input).stats()).channels[3].max > 0, 'exact text render must contain visible alpha pixels');
    const fallback = await renderTextLayer({ projectPath: root, target: { width: 360, height: 96 }, resolveProjectPath, hashBuffer, layer: { ...common, composition_mode: 'preview', font_path: 'style/fonts/missing.ttf', font_hash: inspected.file_hash, font_family: inspected.family_name, fidelity_mode: 'unresolved' } });
    assert.equal(fallback.diagnostic.actual_font_verified, false);
    assert.notEqual(hashBuffer(exact.input), hashBuffer(fallback.input));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('final rendering blocks missing font files instead of falling back', async () => {
  await assert.rejects(renderTextLayer({
    projectPath: os.tmpdir(), target: { width: 240, height: 80 }, resolveProjectPath, hashBuffer,
    layer: { control_id: 'save', font_role: 'button-label', content: 'Save', composition_mode: 'final', font_path: 'missing.ttf', font_hash: `sha256:${'a'.repeat(64)}`, font_family: 'Missing', postscript_name: 'Missing-Regular', font_license_status: 'confirmed', font_license_confirmation: { confirmed: true }, fidelity_mode: 'exact', exact_confirmation: { confirmed: true }, typography: { size: 24 } }
  }), (error) => error.code === 'FONT_ACTUAL_LOAD_FAILED');
});

test('solid typography fill colors the glyph pixels instead of leaving the black source mask', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-type-color-'));
  try {
    const relative = 'style/fonts/exact.ttf'; const targetPath = path.join(root, relative);
    await fs.mkdir(path.dirname(targetPath), { recursive: true }); await fs.copyFile(systemFont, targetPath);
    const inspected = await inspectFont(targetPath);
    const rendered = await renderTextLayer({
      projectPath: root, target: { width: 240, height: 80 }, resolveProjectPath, hashBuffer,
      layer: { control_id: 'label', font_role: 'body', content: 'WHITE', composition_mode: 'final', font_path: relative, font_hash: inspected.file_hash, font_family: inspected.family_name, postscript_name: inspected.postscript_name, font_license_status: 'confirmed', font_license_confirmation: { confirmed: true }, fidelity_mode: 'exact', exact_confirmation: { confirmed: true }, typography: { size: 28, fill: '#ffffff' } }
    });
    const { data, info } = await sharp(rendered.input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const visible = [];
    for (let index = 0; index < data.length; index += info.channels) if (data[index + 3] > 128) visible.push(data[index]);
    assert.ok(visible.length > 0);
    assert.ok(visible.reduce((sum, value) => sum + value, 0) / visible.length > 240);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test.after(async () => { await fs.rm(fontconfigRoot, { recursive: true, force: true }); });
