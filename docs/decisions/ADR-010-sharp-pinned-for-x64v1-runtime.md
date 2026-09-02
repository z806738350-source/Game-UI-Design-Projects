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

advisory 同时给出无法升级时的官方缓解：`sharp.block({ operation: ["VipsForeignLoadNsgif", "VipsForeignLoadTiff", "VipsForeignLoadVips"] })`。线上既有 release 运行的 sharp 0.33.5 已提供 `sharp.block`（实测 `typeof === 'function'`）。

产品的解码面按证据分为三类：（1）用户提供的位图必须是 PNG/JPEG/WebP——`electron/services/imageMetadata.cjs` 的 `readImageMetadata` 先按扩展名拒绝，再由 `imageMetadataFromBuffer` 以魔数做内容级校验；（2）SVG 确实经 sharp 的 librsvg 加载器处理——`componentKit.cjs:24` 读取用户上传的 SVG 组件资产尺寸，`compositionRenderer.cjs:191` 与 `underlayReview.cjs:115,149` 光栅化程序内部生成的水印/遮罩 SVG，该路径既不在本次 block 的三个操作里，也不属于本 advisory 的受影响解码器；（3）GIF/TIFF/VIPS 在进入 release 的 `electron/services`、`server` 两个目录里没有任何引用（`grep -rniE "\.gif|\.tiff?|tiff"` 零命中），因此禁用它们不改变任何现有能力。

项目方（2026-09-02 裁定）选择：固定 0.33.5 + 官方 block 缓解 + 显式审计豁免，阶段 E 按期上线；不为此重启这台承载受保护服务（AI-CanvasPro 9010、Kunpo Gateway 9020）的共享服务器。

固定 0.33.5 后 CI 立刻暴露第二个问题：唯一在 Linux 上运行 Electron 的 `ui-e2e` 作业有 3 条用例失败、3 条未运行，Playwright 报 `Target page, context or browser has been closed`，应用日志末尾是 `***MEMORY-ERROR***: electron[<pid>]: GSlice: assertion failed: sinfo->n_allocated > 0`（run 33598861306 共 4 份日志）。对照证据：同一关键字在 main 上 sharp 0.35.3 的最近三次运行中出现 0 次——33596006914 与 33592904846 全绿（各 54 passed），33459070818 的 `ui-e2e` 因一条与本例外无关的 `project.json` 临时文件 rename ENOENT 竞态失败（45 passed / 1 failed / 1 did not run），但同样没有任何 GSlice 记录；纯 Node 的 `validate` 作业在 0.33.5 下全绿（合成、保真、排版用例均通过），说明冲突只发生在同时链接系统 GLib 的 Electron 进程内。

机制是两份 GLib 共存：Electron 在 Linux 动态链接系统 GLib，`ui-e2e` 当时钉在 `ubuntu-22.04`，其系统 GLib 为 2.72——最后一个仍带 GSlice magazine 分配器、`***MEMORY-ERROR***` 打印与 `G_SLICE` 环境变量解析的版本（GLib 2.76 起 `g_slice_alloc`/`g_slice_free1` 退化为 malloc/free 包装，2.76.0 的 `glib/gslice.c` 已从 61767 字节缩到 10947 字节）；而 `@img/sharp-libvips-linux-x64@1.0.4`（libvips 8.15.3，`versions.json` 记录 glib 2.81.1）把 GLib 静态链接进 `libvips-cpp.so.42`，并以默认可见性导出 `g_slice_alloc`、`g_slice_free1` 等 8 个符号。加载 libvips 后两侧符号相互插入，一侧分配的内存被另一侧的实现释放，2.72 的 `g_slice_free1` 在切片元数据里找不到分配记录即断言失败并 `abort()`。0.35.3 的 libvips 8.18.3（glib 2.89.1）在同一作业下不触发，因此这是 0.33.5 这条依赖线在旧 GLib 系统上的组合缺陷，而不是用例本身的问题。

先尝试过在 `sharpRuntime.cjs` 里于加载 sharp 之前写入 `process.env.G_SLICE = 'always-malloc'`：无效（run 33601376087 仍出现 5 次崩溃）。原因是系统 GLib 在 Electron 启动、GTK 初始化时就已完成分配器配置，JS 模块求值阶段再改环境变量已经太晚。该尝试已回滚，改为消除冲突的另一侧：把作业移到系统 GLib 已无切片分配器的 `ubuntu-24.04`。

上述数字的取证命令（复核用，避免只留结论）：

```sh
# GLib 各版本是否仍带 GSlice 分配器（2.70 有断言，2.76 起没有）
for t in 2.70.0 2.76.0 2.80.0; do
  printf '%s %s bytes, assertion=%s\n' "$t" \
    "$(curl -s "https://raw.githubusercontent.com/GNOME/glib/$t/glib/gslice.c" | tee /tmp/gslice-$t.c | wc -c)" \
    "$(grep -c 'sinfo->n_allocated > 0' /tmp/gslice-$t.c)"
done

# libvips 预编译包内静态链接的 GLib 版本、导出的 g_slice_* 符号数、断言字符串是否存在
u=https://registry.npmjs.org/@img/sharp-libvips-linux-x64/-/sharp-libvips-linux-x64-1.0.4.tgz
curl -s "$u" | tar -xzO -f - package/versions.json | grep -E '"glib"|"vips"'
curl -s "$u" | tar -xzO -f - package/lib/libvips-cpp.so.42 > /tmp/libvips-cpp.so.42
nm -D --defined-only /tmp/libvips-cpp.so.42 | grep -c ' g_slice_'        # 8
strings -a /tmp/libvips-cpp.so.42 | grep -cE 'MEMORY-ERROR|n_allocated'  # 0：断言不在这份 GLib 里

# CI 崩溃计数（run 为 33598861306 / 33601376087 / 33603031952 等）
gh run view <run-id> --log | grep -cE 'MEMORY-ERROR|GSlice'
```

## 决策

1. `package.json` 固定 `sharp: 0.33.5`（x86-64-v1 可运行的最后一个版本线）。
2. 缓解集中在 `electron/services/sharpRuntime.cjs`：加载时按 advisory 官方 workaround 调用 `sharp.block` 禁用 `VipsForeignLoadNsgif`、`VipsForeignLoadTiff`、`VipsForeignLoadVips` 三个解码器，并导出同一 sharp 实例；6 个生产模块一律经该模块引入 sharp。
3. 审计豁免写在 `pnpm-workspace.yaml` 的 `auditConfig.ignoreGhsas: [GHSA-f88m-g3jw-g9cj]`（11.x 版本的 pnpm 已不再读取 `package.json` 里的 `pnpm` 字段，写在那里只会得到告警并被忽略），只豁免这一条 GHSA，其余 high 级漏洞继续阻断合并。
4. `electron/services/sharpRuntime.test.cjs` 四项回归：GIF/TIFF 在缓解前可解码、缓解后被拒（未缓解行为用子进程取证，避免同进程 runner 下断言静默退化为永真）；PNG/JPEG/WebP 缓解后仍正常；SVG 缓解后仍可解码（这是产品真实使用的 librsvg 路径，防止有人把 SVG 一并加进 block）；进入 release 的生产目录（`electron/services`、`server`）中的非测试 `.cjs` 受三条规则约束——不得出现 sharp 说明符（含内联链式 `createRequire(...)('sharp')`），出现 `sharp(` / `sharp.` 时必须经 `./sharpRuntime.cjs` 引入，且不得使用 `createRequire`。第三条是必需的：绑定改名后（`const img = nodeRequire('sharp')` 再用 `img(...)`）前两条实测漏检，而 CJS 模块本就有 `require`，`createRequire` 在发布目录里没有正当用途。扫描范围与 `deploy/online/build-release.sh` 的 release 白名单一致；六项对照实测（基线、直接 require、内联链式 createRequire、两步式别名仍叫 sharp、两步式改名为 img、合规经 sharpRuntime）结果均符合预期。
5. `.github/workflows/ci.yml` 的 `ui-e2e` 作业由 `ubuntu-22.04` 改为 `ubuntu-24.04`，Electron 系统依赖同步换成 noble 的 t64 包名（`libatk1.0-0t64`、`libatk-bridge2.0-0t64`、`libcups2t64`、`libgtk-3-0t64`、`libasound2t64`；jammy 的旧包名在 noble 上已不存在）。用例集、Electron 版本、`xvfb-run` 启动方式与超时全部不变，只更换承载它的系统 GLib。
6. `deploy/online/prepare-dual-version.sh` 的候选 release 预检由 `require('sharp')` 改为 require 暂存目录内的 `./electron/services/sharpRuntime.cjs`，并断言 GIF 解码被拒绝、打印解析到的 sharp 与 libvips 版本。理由：`require('sharp')` 只证明原生模块能在这台 v1 CPU 上加载，无法发现候选包缺失 `sharpRuntime.cjs`、或该文件里的 `sharp.block` 调用被移除/变成空操作——而这两种情况下审计豁免所依赖的缓解已经不存在，线上会带着未缓解的 high 级解码器运行。该断言与本例外同生命周期，恢复动作里必须同步放宽。

## 明确不满足的部分（例外的边界）

- 生产依赖树仍包含一条 high 级 advisory（sharp 0.33.5 / libvips 8.15.3）；`pnpm audit --prod --audit-level high` 现在以“1 high (1 ignored)”通过，而不是以零漏洞通过；
- 缓解依赖代码级黑名单生效，两类残余风险不等价：模块绕过 `sharpRuntime.cjs` 引入 sharp 由第 4 条的三条规则静态阻止（含改名绑定）；而在 `sharpRuntime` 加载**之前**解码 GIF/TIFF/VIPS 属于加载顺序问题，静态扫描无法证明，只能靠「6 个生产模块一律经 sharpRuntime 引入」的约定与代码评审维持，该次解码不受保护；
- 禁用 GIF/TIFF/VIPS 解码是永久性的输入面收窄：日后若产品需要接收这三种格式，必须先解除本例外，不能直接放开 block；
- 部署门禁与本例外耦合（第 6 条）：候选 release 预检断言 GIF 被拒绝，属于有意的 fail-closed。代价是日后放宽输入面必须同时修订本 ADR 与 `prepare-dual-version.sh`，只改业务代码会在部署阶段被挡下；
- 桌面端（macOS/Windows）本可使用已修复的 0.35.x，为保持双端与线上运行时一致，一并固定在 0.33.5；
- `ui-e2e` 不再覆盖 Ubuntu 22.04（GLib 2.72）上的 Electron 运行。本产品不发布 Linux 桌面构建（仓库内没有 electron-builder 配置或打包目标），线上服务是纯 Node 进程、不链接 GTK/GLib，因此没有任何交付形态落在该冲突面上；但在 GLib < 2.76 的发行版上直接从源码运行 Electron 的开发者仍可能触发同一崩溃，已实测有效的规避只有把系统 GLib 升到 ≥ 2.76（进程内设置 `G_SLICE` 已实测无效）。

## 退出条件

满足以下任一时本例外失效，必须升级并移除豁免：

1. `kunpo-ubuntu-online` 的 guest CPU 模型改为暴露 x86-64-v2（host 直通或等价模型）——需负责人授权与维护窗口，因为重启会影响同机受保护的 AI-CanvasPro(9010) 与共享 Kunpo Gateway(9020)；
2. sharp 发布可在 x86-64-v1 上运行的 ≥ 0.35 预编译包；
3. 生产代码不再依赖 sharp（图像解码/合成全部改由其他运行时承担）。

恢复动作：升级 `sharp` 至 ≥ 0.35 的可用版本并同步 lockfile；删除 `pnpm-workspace.yaml` 的 `auditConfig.ignoreGhsas` 条目；确认 `pnpm audit --prod --audit-level high` 以零漏洞通过；评估是否移除 `sharpRuntime.cjs` 的 block（上游已修复则可移除，同时保留该模块作为统一引入点）；若移除 block，必须在同一次变更里放宽 `deploy/online/prepare-dual-version.sh` 的候选预检（GIF 拒绝断言会转为失败并挡住所有后续部署）与 `sharpRuntime.test.cjs` 的 GIF/TIFF 缓解用例，SVG 用例和绕过守卫保留；用 `deploy/online/prepare-dual-version.sh` 重跑候选预检，确认线上 sharp 运行时与版本输出符合预期后按阶段 E 流程激活。

## 后果

- 合成与保真记录中的 `renderer_version` 回到 `composition-v1/sharp-0.33.5/libvips-8.15.3`；`release-evidence/golden-samples/**` 中已有的 `sharp-0.35.3/libvips-8.18.3` 是当时运行的历史证据，不追溯改写；
- 阶段 E 候选 release 可从 main 可复现构建并在线上 CPU 通过预检，图库功能按期上线；
- `ui-e2e` 与线上服务器同为 Ubuntu 24.04，Electron 作业的系统库口径与部署环境一致；该 runner 变更与 sharp 版本无耦合，本例外退出后不需要回退；
- 该例外只影响 sharp 这一条依赖的版本口径与审计告警，不豁免任何其他代码、测试、文档或安全门禁要求。
