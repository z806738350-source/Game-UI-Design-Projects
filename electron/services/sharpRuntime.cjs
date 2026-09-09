const sharp = require('sharp');

// 线上 x86-64-v1 CPU 无法加载 sharp >= 0.34 的 v2 预编译包，暂保留 0.33.5。
// 按 GHSA-f88m-g3jw-g9cj 与 GHSA-rgj7-g3m4-5g8c 的官方缓解，禁用
// GIF/TIFF/VIPS 和 HEIF（含 AVIF）解码；PNG/JPEG/WebP 及 SVG 仍可用。
// 精确审计例外、实测与升级退出条件见 ADR-010；所有生产调用必须经此模块。
sharp.block({ operation: ['VipsForeignLoadNsgif', 'VipsForeignLoadTiff', 'VipsForeignLoadVips', 'VipsForeignLoadHeif'] });

module.exports = sharp;
