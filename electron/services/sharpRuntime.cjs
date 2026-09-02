// Linux 上 Electron 动态链接系统 GLib（>= 2.76，GSlice 已退化为 malloc 包装），而 sharp
// 0.33.5 自带的 libvips 8.15.3 静态链接了更早的 GLib；两份实现的 slice 分配器相互插入时，
// 旧 GLib 会释放到不是自己分配的指针并 SIGABRT（CI 现象：
// ***MEMORY-ERROR***: GSlice: assertion failed: sinfo->n_allocated > 0）。强制 slice 走系统
// malloc 让两侧共用同一分配器，该变量必须在加载 sharp 之前写入进程环境。
if (process.platform === 'linux') process.env.G_SLICE = 'always-malloc';

const sharp = require('sharp');

// sharp 固定 0.33.5：线上服务器 CPU 只支持 x86-64 baseline（v1），>= 0.34 的 Linux
// 预编译包要求 x86-64-v2，加载即失败。按 GHSA-f88m-g3jw-g9cj 的官方缓解禁用受影响的
// libvips 解码器；本产品只处理 PNG/JPEG/WebP（见 imageMetadata.SUPPORTED_EXTENSIONS）。
sharp.block({ operation: ['VipsForeignLoadNsgif', 'VipsForeignLoadTiff', 'VipsForeignLoadVips'] });

module.exports = sharp;
