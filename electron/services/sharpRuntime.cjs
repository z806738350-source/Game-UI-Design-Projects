const sharp = require('sharp');

// sharp 固定 0.33.5：线上服务器 CPU 只支持 x86-64 baseline（v1），>= 0.34 的 Linux
// 预编译包要求 x86-64-v2，加载即失败。按 GHSA-f88m-g3jw-g9cj 的官方缓解禁用受影响的
// libvips 解码器；本产品只处理 PNG/JPEG/WebP（见 imageMetadata.SUPPORTED_EXTENSIONS）。
sharp.block({ operation: ['VipsForeignLoadNsgif', 'VipsForeignLoadTiff', 'VipsForeignLoadVips'] });

module.exports = sharp;
