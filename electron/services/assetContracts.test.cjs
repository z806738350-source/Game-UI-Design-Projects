const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { confirmFontUsage, importFontAsset, validateFontManifest } = require('./typographyAssets.cjs');
const { importComponentAsset, validateComponentContract } = require('./componentKit.cjs');

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
    const contract = { families: [{ id: 'button.primary', category: 'button', status: 'approved', reuse_mode: 'local-generated', intrinsic_size: [640, 180], states: { default: asset } }] };
    assert.deepEqual(validateComponentContract(contract, { strict: true }), ['button.primary cannot be local-generated in strict mode']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
