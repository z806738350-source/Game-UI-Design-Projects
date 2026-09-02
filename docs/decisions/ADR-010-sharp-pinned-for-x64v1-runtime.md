# ADR-010：sharp 固定 0.33.5 与 libvips 解码器缓解（批准的例外）

- 状态：已接受（批准的例外，Approved Exception）
- 日期：2026-09-02
- 关联：阶段 E（在线版部署）、GHSA-f88m-g3jw-g9cj、`docs/dev/RELEASE-CHECKLIST.md` §2、`deploy/online/prepare-dual-version.sh`、`.github/workflows/ci.yml`（`ui-e2e` 作业）、ADR-007

## 背景

CI 生产审计门 `.github/workflows/ci.yml` 的 `pnpm audit --prod --audit-level high` 要求生产依赖无 high 级漏洞。GHSA-f88m-g3jw-g9cj（high，sharp 继承 libvips 的 CVE-2026-33327、CVE-2026-33328、CVE-2026-35590、CVE-2026-35591，影响处理不可信输入的解码路径）首个修复版本为 **0.35.0**，因此 main 一度固定 `sharp 0.35.3`。

在线版服务器 `kunpo-ubuntu-online`（10.8.0.176，Ubuntu 24.04.4 LTS）是 KVM 客户机，`lscpu` 的 Model name 为 `Common KVM processor`，flags 中没有 `ssse3`/`sse4_1`/`sse4_2`/`popcnt`，即只支持 **x86-64 baseline（v1）**。sharp ≥ 0.34 的 Linux 预编译包 `@img/sharp-linux-x64` 要求 **x86-64-v2**，阶段 E 候选 release 预检在 `require('sharp')` 处直接失败：

```text
Error: Could not load the "sharp" module using the linux-x64 runtime
Unsupported CPU: Prebuilt binaries for Linux x64 require v2 microarchitecture
```

npm 上 0.35.x 的 optionalDependencies 只提供 `linux-x64`（v2）、arm/arm64/ppc64/riscv64/s390x、linuxmusl 与 wasm32 变体，**没有 v1/legacy 的 x64 预编译包**。生产代码有 6 个模块在加载期 `require('sharp')`（componentKit、compositionRenderer、designPipeline、fidelityInspector、typographyRenderer、underlayReview），`server/webServer.cjs` 经 designPipeline 传递依赖，因此在线服务启动即需要可用的 sharp，无法绕过。

advisory 同时给出无法升级时的官方缓解：`sharp.block({ operation: ["VipsForeignLoadNsgif", "VipsForeignLoadTiff", "VipsForeignLoadVips"] })`。线上既有 release 运行的 sharp 0.33.5 已提供 `sharp.block`（实测 `typeof === 'function'`）。本产品只处理 PNG/JPEG/WebP（`electron/services/imageMetadata.cjs` 的 `SUPPORTED_EXTENSIONS`），静态资源另含 SVG/ICO，不解码 GIF/TIFF/VIPS。

项目方（2026-09-02 裁定）选择：固定 0.33.5 + 官方 block 缓解 + 显式审计豁免，阶段 E 按期上线；不为此重启这台承载受保护服务（AI-CanvasPro 9010、Kunpo Gateway 9020）的共享服务器。

固定 0.33.5 后 CI 立刻暴露第二个问题：唯一在 Linux 上运行 Electron 的 `ui-e2e` 作业有 3 条用例失败、3 条未运行，Playwright 报 `Target page, context or browser has been closed`，应用日志末尾是 `***MEMORY-ERROR***: electron[<pid>]: GSlice: assertion failed: sinfo->n_allocated > 0`（run 33598861306 共 4 份日志）。对照证据：同一关键字在 main 上 sharp 0.35.3 的最近三次运行（33596006914、33592904846、33459070818）出现 0 次；纯 Node 的 `validate` 作业在 0.33.5 下全绿（合成、保真、排版用例均通过），说明冲突只发生在同时链接系统 GLib 的 Electron 进程内。

机制是两份 GLib 共存：Electron 在 Linux 动态链接系统 GLib，`ui-e2e` 当时钉在 `ubuntu-22.04`，其系统 GLib 为 2.72——最后一个仍带 GSlice magazine 分配器、`***MEMORY-ERROR***` 打印与 `G_SLICE` 环境变量解析的版本（GLib 2.76 起 `g_slice_alloc`/`g_slice_free1` 退化为 malloc/free 包装，2.76.0 的 `glib/gslice.c` 已从 61767 字节缩到 10947 字节）；而 `@img/sharp-libvips-linux-x64@1.0.4`（libvips 8.15.3，`versions.json` 记录 glib 2.81.1）把 GLib 静态链接进 `libvips-cpp.so.42`，并以默认可见性导出 `g_slice_alloc`、`g_slice_free1` 等 8 个符号。加载 libvips 后两侧符号相互插入，一侧分配的内存被另一侧的实现释放，2.72 的 `g_slice_free1` 在切片元数据里找不到分配记录即断言失败并 `abort()`。0.35.3 的 libvips 8.18.3（glib 2.89.1）在同一作业下不触发，因此这是 0.33.5 这条依赖线在旧 GLib 系统上的组合缺陷，而不是用例本身的问题。

先尝试过在 `sharpRuntime.cjs` 里于加载 sharp 之前写入 `process.env.G_SLICE = 'always-malloc'`：无效（run 33601376087 仍出现 5 次崩溃）。原因是系统 GLib 在 Electron 启动、GTK 初始化时就已完成分配器配置，JS 模块求值阶段再改环境变量已经太晚。该尝试已回滚，改为消除冲突的另一侧：把作业移到系统 GLib 已无切片分配器的 `ubuntu-24.04`。

## 决策

1. `package.json` 固定 `sharp: 0.33.5`（x86-64-v1 可运行的最后一个版本线）。
2. 缓解集中在 `electron/services/sharpRuntime.cjs`：加载时按 advisory 官方 workaround 调用 `sharp.block` 禁用 `VipsForeignLoadNsgif`、`VipsForeignLoadTiff`、`VipsForeignLoadVips` 三个解码器，并导出同一 sharp 实例；6 个生产模块一律经该模块引入 sharp。
3. 审计豁免写在 `pnpm-workspace.yaml` 的 `auditConfig.ignoreGhsas: [GHSA-f88m-g3jw-g9cj]`（11.x 版本的 pnpm 已不再读取 `package.json` 里的 `pnpm` 字段，写在那里只会得到告警并被忽略），只豁免这一条 GHSA，其余 high 级漏洞继续阻断合并。
4. `electron/services/sharpRuntime.test.cjs` 三项回归：GIF/TIFF 在缓解前可解码、缓解后被拒；PNG/JPEG/WebP 缓解后仍正常；进入 release 的生产目录（`electron/services`、`server`）中除 `sharpRuntime.cjs` 外不得再出现 `require('sharp')`。
5. `.github/workflows/ci.yml` 的 `ui-e2e` 作业由 `ubuntu-22.04` 改为 `ubuntu-24.04`，Electron 系统依赖同步换成 noble 的 t64 包名（`libatk1.0-0t64`、`libatk-bridge2.0-0t64`、`libcups2t64`、`libgtk-3-0t64`、`libasound2t64`；jammy 的旧包名在 noble 上已不存在）。用例集、Electron 版本、`xvfb-run` 启动方式与超时全部不变，只更换承载它的系统 GLib。

## 明确不满足的部分（例外的边界）

- 生产依赖树仍包含一条 high 级 advisory（sharp 0.33.5 / libvips 8.15.3）；`pnpm audit --prod --audit-level high` 现在以“1 high (1 ignored)”通过，而不是以零漏洞通过；
- 缓解依赖代码级黑名单生效：若未来有模块绕过 `sharpRuntime.cjs` 直接 `require('sharp')`，或在 `sharpRuntime` 加载前解码 GIF/TIFF/VIPS，则该次解码不受保护（第 4 条测试用于阻止前者）；
- 禁用 GIF/TIFF/VIPS 解码是永久性的输入面收窄：日后若产品需要接收这三种格式，必须先解除本例外，不能直接放开 block；
- 桌面端（macOS/Windows）本可使用已修复的 0.35.x，为保持双端与线上运行时一致，一并固定在 0.33.5；
- `ui-e2e` 不再覆盖 Ubuntu 22.04（GLib 2.72）上的 Electron 运行。本产品不发布 Linux 桌面构建（仓库内没有 electron-builder 配置或打包目标），线上服务是纯 Node 进程、不链接 GTK/GLib，因此没有任何交付形态落在该冲突面上；但在 GLib < 2.76 的发行版上直接从源码运行 Electron 的开发者仍可能触发同一崩溃，已实测有效的规避只有把系统 GLib 升到 ≥ 2.76（进程内设置 `G_SLICE` 已实测无效）。

## 退出条件

满足以下任一时本例外失效，必须升级并移除豁免：

1. `kunpo-ubuntu-online` 的 guest CPU 模型改为暴露 x86-64-v2（host 直通或等价模型）——需负责人授权与维护窗口，因为重启会影响同机受保护的 AI-CanvasPro(9010) 与共享 Kunpo Gateway(9020)；
2. sharp 发布可在 x86-64-v1 上运行的 ≥ 0.35 预编译包；
3. 生产代码不再依赖 sharp（图像解码/合成全部改由其他运行时承担）。

恢复动作：升级 `sharp` 至 ≥ 0.35 的可用版本并同步 lockfile；删除 `pnpm-workspace.yaml` 的 `auditConfig.ignoreGhsas` 条目；确认 `pnpm audit --prod --audit-level high` 以零漏洞通过；评估是否移除 `sharpRuntime.cjs` 的 block（上游已修复则可移除，同时保留该模块作为统一引入点）；用 `deploy/online/prepare-dual-version.sh` 重跑候选预检，确认线上 `require('sharp')` 通过后按阶段 E 流程激活。

## 后果

- 合成与保真记录中的 `renderer_version` 回到 `composition-v1/sharp-0.33.5/libvips-8.15.3`；`release-evidence/golden-samples/**` 中已有的 `sharp-0.35.3/libvips-8.18.3` 是当时运行的历史证据，不追溯改写；
- 阶段 E 候选 release 可从 main 可复现构建并在线上 CPU 通过预检，图库功能按期上线；
- `ui-e2e` 与线上服务器同为 Ubuntu 24.04，Electron 作业的系统库口径与部署环境一致；该 runner 变更与 sharp 版本无耦合，本例外退出后不需要回退；
- 该例外只影响 sharp 这一条依赖的版本口径与审计告警，不豁免任何其他代码、测试、文档或安全门禁要求。
