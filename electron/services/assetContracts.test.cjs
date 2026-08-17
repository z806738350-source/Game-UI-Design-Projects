const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateFontManifest } = require('./typographyAssets.cjs');
const { importComponentAsset, validateComponentContract } = require('./componentKit.cjs');

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}

test('strict font gate rejects unresolved identity roles and missing coverage', () => {
  const manifest = {
    fonts: [{ id: 'body', local_path: 'style/fonts/body.ttf', file_hash: `sha256:${'a'.repeat(64)}`, license_status: 'confirmed', coverage: { latin: true, digits: false } }],
    roles: { numeric: { font_id: 'body', fidelity_mode: 'approved-substitute', identity_critical: true, required_coverage: ['digits'] } }
  };
  assert.deepEqual(validateFontManifest(manifest, { strict: true }), [
    'identity-critical role numeric must use exact fidelity',
    'font body lacks digits coverage required by numeric'
  ]);
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
