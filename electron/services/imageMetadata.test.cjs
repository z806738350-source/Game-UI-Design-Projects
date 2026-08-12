const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { canvasSpec, readImageMetadata } = require('./imageMetadata.cjs');

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

test('canvasSpec preserves portrait orientation and provider ratio', () => {
  assert.deepEqual(canvasSpec(1080, 1920), {
    width: 1080, height: 1920, orientation: 'portrait', aspect_ratio: '9:16', generation_size: '864x1536'
  });
});

test('readImageMetadata validates content rather than trusting an extension', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-copilot-image-'));
  try {
    const valid = path.join(temporaryRoot, 'portrait.png');
    const invalid = path.join(temporaryRoot, 'fake.png');
    const svg = path.join(temporaryRoot, 'wireframe.svg');
    await fs.writeFile(valid, pngHeader(1080, 1920));
    await fs.writeFile(invalid, 'not an image');
    await fs.writeFile(svg, '<svg/>');
    assert.equal((await readImageMetadata(valid)).canvas_spec.orientation, 'portrait');
    await assert.rejects(() => readImageMetadata(invalid), /无法识别|损坏/);
    await assert.rejects(() => readImageMetadata(svg), /不支持/);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
