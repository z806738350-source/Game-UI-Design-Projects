const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { confirmFontUsage, importFontAsset, validateFontManifest } = require('./typographyAssets.cjs');
const { importComponentAsset, importForgeManifest, validateComponentAssets, validateComponentContract } = require('./componentKit.cjs');

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}

test('strict font gate rejects unresolved identity roles and missing coverage', () => {
  const manifest = {
    fonts: [{ id: 'body', family_name: 'Body', postscript_name: 'Body-Regular', format: 'ttf', local_path: 'style/fonts/body.ttf', file_hash: `sha256:${'a'.repeat(64)}`, license_status: 'confirmed', license_confirmation: { confirmed: true }, coverage: { latin: true, digits: false } }],
    roles: { numeric: { font_id: 'body', fidelity_mode: 'approved-substitute', identity_critical: true, required_coverage: ['digits'] } }
  };
  assert.deepEqual(validateFontManifest(manifest, { strict: true }), [
    'identity-critical role numeric must use exact fidelity',
    'font body lacks digits coverage required by numeric'
  ]);
});

test('font import never trusts attempted authorization and explicit confirmation records evidence', async () => {
  const candidates = [
    '/System/Library/Fonts/Supplemental/Georgia.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf'
  ];
  const source = candidates.find((candidate) => require('node:fs').existsSync(candidate));
  assert.ok(source, 'a real system TTF is required for this test');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-font-'));
  try {
    const font = await importFontAsset(root, source, { id: 'ui', licenseStatus: 'confirmed' });
    assert.equal(font.license_status, 'unresolved');
    assert.ok(font.family_name && font.postscript_name);
    const manifest = { fonts: [font], roles: {} };
    assert.throws(() => confirmFontUsage(manifest, { fontId: 'ui', roleId: 'button-label', licenseConfirmed: false, exactConfirmed: true }), (error) => error.code === 'FONT_LICENSE_CONFIRMATION_REQUIRED');
    const confirmed = confirmFontUsage(manifest, { fontId: 'ui', roleId: 'button-label', licenseConfirmed: true, exactConfirmed: true }, { confirmedBy: 'test-designer', now: '2026-08-17T00:00:00.000Z' });
    assert.equal(confirmed.fonts[0].license_confirmation.confirmed_by, 'test-designer');
    assert.equal(confirmed.roles['button-label'].exact_confirmation.confirmed, true);
    assert.deepEqual(validateFontManifest(confirmed, { strict: true }), []);
    await assert.rejects(importFontAsset(root, path.join(root, 'unsupported.woff2')), /WOFF\/WOFF2 import is disabled/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('component import records asset identity and strict gate rejects generated shared controls', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-component-'));
  try {
    const source = path.join(root, 'button.png');
    await fs.writeFile(source, pngHeader(640, 180));
    const asset = await importComponentAsset(root, source, { componentId: 'button.primary', state: 'default' });
    assert.match(asset.asset_hash, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(asset.intrinsic_size, [640, 180]);
    const contract = { families: [{ id: 'button.primary', category: 'icon', status: 'approved', reuse_mode: 'local-generated', intrinsic_size: [640, 180], states: { default: asset } }] };
    assert.deepEqual(validateComponentContract(contract, { strict: true }), ['button.primary cannot be local-generated in strict mode']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('component approval evidence verifies alpha, critical states, files and Forge mapping', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-forge-'));
  try {
    const sourceDir = path.join(root, 'forge'); await fs.mkdir(sourceDir);
    for (const state of ['default', 'pressed', 'disabled']) {
      await sharp({ create: { width: 48, height: 24, channels: 4, background: { r: 80, g: 120, b: 180, alpha: .7 } } }).png().toFile(path.join(sourceDir, `${state}.png`));
    }
    const manifestPath = path.join(sourceDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify({ components: ['default', 'pressed', 'disabled'].map((state) => ({ component_id: 'button.primary', name: 'Primary', category: 'button', state, path: `${state}.png`, reuse_mode: 'exact' })) }));
    const families = await importForgeManifest(root, manifestPath);
    families[0].status = 'approved';
    assert.deepEqual(validateComponentContract({ families }, { strict: true }), []);
    assert.deepEqual(await validateComponentAssets(root, { families }), []);
    const svgPath = path.join(sourceDir, 'icon.svg');
    await fs.writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="20" viewBox="0 0 32 20"><path fill="#fff" d="M0 0h32v20H0z"/></svg>');
    const svgAsset = await importComponentAsset(root, svgPath, { componentId: 'icon.currency', state: 'default' });
    assert.deepEqual(svgAsset.intrinsic_size, [32, 20]);
    assert.deepEqual(svgAsset.source_bbox, [0, 0, 32, 20]);
    assert.equal(svgAsset.alpha_channel, true);
    assert.deepEqual(await validateComponentAssets(root, { families: [{ id: 'icon.currency', states: { default: svgAsset } }] }), []);
    await fs.unlink(path.join(root, families[0].states.disabled.asset_path));
    assert.match((await validateComponentAssets(root, { families })).join(';'), /disabled asset file is missing/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
