const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');

const REPO_ROOT = path.join(__dirname, '..', '..');
const GIF_1X1_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const GIF_1X1 = Buffer.from(GIF_1X1_BASE64, 'base64');

// 规则一：sharp 说明符出现在 require/import/from 位置，含 tests/ui-e2e/helpers.ts 用的
// createRequire(...)('sharp') 写法（允许一层嵌套括号）。
const SHARP_SPECIFIER = /(?:\brequire|\bimport|\bfrom)\s*\(?\s*['"]sharp['"]|\bcreateRequire\s*\((?:[^()]|\([^()]*\))*\)\s*\(\s*['"]sharp['"]/;
// 规则二：用到 sharp 的模块必须经 sharpRuntime 引入。只匹配标识符用法，因此
// styleContractSchema.cjs 里作为转角语言枚举值的字符串 'sharp' 不会误报。
const USES_SHARP = /\bsharp\s*\(|\bsharp\./;
const VIA_SHARP_RUNTIME = /require\(\s*['"]\.\/sharpRuntime\.cjs['"]\s*\)/;

function rasterBuffer(format) {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 9, g: 8, b: 7 } } })[format]().toBuffer();
}

// sharp.block 是进程级 libvips 操作黑名单，未缓解行为必须在没加载过 sharpRuntime 的进程里取证；
// 用子进程而不是依赖本进程的加载顺序，断言才不会在换成同进程 runner 时静默退化为永真。
const UNSHIELDED_PROBE = `
const sharp = require('sharp');
(async () => {
  const gif = Buffer.from(${JSON.stringify(GIF_1X1_BASE64)}, 'base64');
  const tiff = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 9, g: 8, b: 7 } } }).tiff().toBuffer();
  process.stdout.write(JSON.stringify([(await sharp(gif).metadata()).format, (await sharp(tiff).metadata()).format]));
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;

test('GIF and TIFF decode before the mitigation and are refused after it', async () => {
  const unshielded = execFileSync(process.execPath, ['-e', UNSHIELDED_PROBE], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(unshielded), ['gif', 'tiff']);

  const tiff = await rasterBuffer('tiff');
  const mitigated = require('./sharpRuntime.cjs');
  assert.equal(mitigated, sharp, 'sharpRuntime 必须导出调用方拿到的同一个 sharp 实例，否则 block 不作用于生产路径');
  await assert.rejects(mitigated(GIF_1X1).metadata(), /unsupported image format/);
  await assert.rejects(mitigated(tiff).metadata(), /unsupported image format/);
});

test('product formats keep decoding after the mitigation', async () => {
  const mitigated = require('./sharpRuntime.cjs');
  for (const format of ['png', 'jpeg', 'webp']) {
    assert.equal((await mitigated(await rasterBuffer(format)).metadata()).format, format);
  }
});

test('SVG input keeps working after the mitigation', async () => {
  const mitigated = require('./sharpRuntime.cjs');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="#123456"/></svg>';
  const metadata = await mitigated(Buffer.from(svg)).metadata();
  assert.equal(metadata.format, 'svg');
  assert.equal(metadata.width, 4);
});

test('shipped production modules load sharp only through sharpRuntime', () => {
  // 扫描范围与 deploy/online/build-release.sh 的 release 白名单一致：只有 electron/services 与
  // server 下的非测试 .cjs 会进入 release，scripts/ 与 tests/ 不发布，因此不在本门禁范围内。
  const offenders = [];
  for (const dir of ['electron/services', 'server']) {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, dir))) {
      if (!entry.endsWith('.cjs') || entry.endsWith('.test.cjs') || entry === 'sharpRuntime.cjs') continue;
      const source = fs.readFileSync(path.join(REPO_ROOT, dir, entry), 'utf8');
      if (SHARP_SPECIFIER.test(source)) offenders.push(`${dir}/${entry}: 直接引入 sharp 说明符`);
      else if (USES_SHARP.test(source) && !VIA_SHARP_RUNTIME.test(source)) offenders.push(`${dir}/${entry}: 使用 sharp 但未经 ./sharpRuntime.cjs 引入`);
    }
  }
  assert.deepEqual(offenders, []);
});
