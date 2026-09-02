const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function rasterBuffer(format) {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 9, g: 8, b: 7 } } })[format]().toBuffer();
}

test('GIF and TIFF decode before the mitigation and are refused after it', async () => {
  // sharp.block 是进程级 libvips 操作黑名单，未缓解行为必须在加载 sharpRuntime 之前取证。
  const tiff = await rasterBuffer('tiff');
  assert.equal((await sharp(GIF_1X1).metadata()).format, 'gif');
  assert.equal((await sharp(tiff).metadata()).format, 'tiff');

  const mitigated = require('./sharpRuntime.cjs');
  assert.equal(mitigated, sharp);
  await assert.rejects(mitigated(GIF_1X1).metadata(), /unsupported image format/);
  await assert.rejects(mitigated(tiff).metadata(), /unsupported image format/);
});

test('product formats keep decoding after the mitigation', async () => {
  const mitigated = require('./sharpRuntime.cjs');
  for (const format of ['png', 'jpeg', 'webp']) {
    assert.equal((await mitigated(await rasterBuffer(format)).metadata()).format, format);
  }
});

test('shipped production modules load sharp only through sharpRuntime', () => {
  const offenders = [];
  for (const dir of ['electron/services', 'server']) {
    for (const entry of fs.readdirSync(path.join(__dirname, '..', '..', dir))) {
      if (!entry.endsWith('.cjs') || entry.endsWith('.test.cjs') || entry === 'sharpRuntime.cjs') continue;
      const source = fs.readFileSync(path.join(__dirname, '..', '..', dir, entry), 'utf8');
      if (/require\(\s*['"]sharp['"]\s*\)/.test(source)) offenders.push(`${dir}/${entry}`);
    }
  }
  assert.deepEqual(offenders, []);
});
