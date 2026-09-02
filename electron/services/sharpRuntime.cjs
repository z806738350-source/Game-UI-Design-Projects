const sharp = require('sharp');

// sharp 固定 0.33.5：线上服务器 CPU 只支持 x86-64 baseline（v1），>= 0.34 的 Linux
// 预编译包要求 x86-64-v2，加载即失败。按 GHSA-f88m-g3jw-g9cj 的官方缓解禁用受影响的
// libvips 解码器：用户位图输入只有 PNG/JPEG/WebP（imageMetadata 先按扩展名再按魔数校验），
// SVG 走 librsvg 不在这三个操作里且不属于受影响解码器，GIF/TIFF/VIPS 在发布目录中零引用。
// 解码面的完整取证见 ADR-010。
sharp.block({ operation: ['VipsForeignLoadNsgif', 'VipsForeignLoadTiff', 'VipsForeignLoadVips'] });

module.exports = sharp;
