# Game UI Design Copilot

面向游戏 UI 设计师的 Artifact-driven AI 设计流水线。

> **发布状态：`0.2.2`（2026-08-19）。** v0.2.1 审核尾项的最终合规与治理收口版本：F-01 Binding State/Font Role 真正显式化（冻结 BINDING_VALIDATION_CODES 门禁、无自动默认、compositor 无回退）、F-03 UI E2E 原场景逐项覆盖（多 Screen 生命周期、nine-slice、字体/组件文件故障与 stale 链，全部经 UI 驱动）、F-02 文档事实完整性（三注册表 ↔ ERROR-CATALOG 双向校验、文档命令校验、项目树三方校验与负向 Fixture）。`0.2.1` 的 REM-01~06 结论与 `0.2.0` 的整改 Definition of Done 依然有效：五组真实 provider Golden Samples 全部 pipeline-passed（三组校准 + 两组保留，含简体中文样本），fixture E2E 在 CI 中重放已发布证据链，设计师签核（韩枫，UI设计师）五组全部 APPROVED，`release-evidence/golden-samples/index.json` 派生为 `released`。整改范围与门禁见 `docs/Game-UI-Design-Copilot-整改审核与执行基线-v1.0.md` 与 `docs/baseline/pr8-golden-release.md`；本轮尾项要求与执行见 `docs/Game-UI-Design-Copilot-v0.2.1-剩余未闭环要求与最终整改执行指导.md`。

当前版本已覆盖的能力包括：

1. 策划需求 + UE Wireframe 输入
2. Functional Screen Contract 生成与人工批准
3. 三套 Layout Proposal 生成、比较与人工批准
4. 新项目风格探索 / 已有项目风格重建
5. Style Contract 批准与 Style Lock
6. 已有项目默认 `existing-strict`，新项目保留探索模式
7. Font Manifest、Component Contract 与必要控件 100% Binding
8. Binding 语义门禁（`binding-policy-v1` 角色词表冻结策略，禁止隐式默认绑定）
9. Workbench 边界（每个工作台只能调用本阶段允许的 IPC 操作）
10. 多 Screen、Schema 2.0 安全迁移与细粒度 stale 传播
11. Underlay Contract、结构 Guide、真实 Review Overlay/指标、自动 Critique 与有限次数 Repair 闭环
12. Composition Manifest + 真实 Composition Output、独立组件/字体 renderer、final PNG 落盘/导出与初步 Fidelity Gate
13. UI E2E（Playwright + Electron，本地 FixtureProvider 模拟网关）进入 CI
14. 执行级文档体系：11 份契约文档 + 用户 SOP + 开发运维文档，由 docs-validate 门禁自动校验

## 本地运行

需要 Node.js、pnpm 和可用的 Kunpo 配置：

macOS 可以直接双击项目根目录的：

```text
Start Game UI Design Copilot.command
```

也可以在终端快速启动：

```bash
pnpm quick-start
```

常规开发模式：

```bash
pnpm install
pnpm dev
```

构建与测试：

```bash
pnpm build
pnpm test
```

文档与门禁校验：

```bash
pnpm test:docs          # check-docs + check-error-docs
pnpm test:fixture-e2e   # 证据链重放
pnpm test:ui-unit       # 前端组件单测
pnpm test:ui-e2e        # Playwright Electron E2E（需先 pnpm build）
```

## 在线运行

生产环境使用 `pnpm build` 生成前端，再由 `node server/webServer.cjs` 提供静态页面、服务端 API、飞书 OAuth 和按用户隔离的持久化空间。浏览器不会读取 Kunpo Key；服务端通过 `KUNPO_GATEWAY_BASE_URL` 调用受控公共 Gateway。

在线版所需变量名称见 `.env.example`。真实 `FEISHU_APP_SECRET` 与 `SESSION_SECRET` 只能保存在服务器受限环境文件中，不得提交到仓库。飞书登录使用 OAuth v3 token 接口，仅以基础用户信息中的 `tenant_key + open_id` 映射内部 tenant UUID，不申请通讯录、邮箱、手机号或离线访问权限。

## Kunpo 配置

推荐让桌面端后端调用本地 Gateway：

```env
KUNPO_GATEWAY_BASE_URL=http://127.0.0.1:9020/v1
```

本地开发也支持直连配置，但 Key 只在 Electron 主进程中读取，不会进入 renderer：

```env
KUNPO_API_BASE_URL=https://your-kunpo-host/v1
KUNPO_API_KEY=your-local-key
```

工具按顺序查找：

1. `DESIGN_COPILOT_ENV_FILE` 指定的文件
2. 当前项目 `.env`
3. 同级 `Game UI Forge/.env`（仅作为本地迁移兼容）

不要提交真实 Key。2026-08-09 已完成 Provider 连通性 Smoke Test：多模态 Screen Contract 请求通过，Image-GPT2 异步提交、任务轮询和永久 Kunpo CDN 结果返回均通过。该结果只证明 Provider 链路可用，不等同于 strict E2E 或正式产品验收。

## 项目 Artifact

默认项目目录为 `~/Game UI Design Projects`（此树由 `docs/schemas/project-directory.required.json` 机器事实源校验，修改时同步两处）：

<!-- PROJECT_TREE:BEGIN -->
```text
project/
├── project.json
├── screens/
│   ├── index.json
│   └── main/
│       ├── inputs.json
│       ├── inputs/
│       │   ├── requirement.md
│       │   └── wireframe.png
│       ├── screen-contract.json
│       ├── layout-proposals.json
│       ├── approved-layout.json
│       ├── component-bindings.json
│       ├── reference-pack.json
│       ├── underlay-contract.json
│       ├── underlay-layout-guide.png
│       ├── underlay-critique.json
│       ├── underlay-repair-task.json
│       ├── visual-task.json
│       ├── composition-manifest.json
│       ├── composition-output.json
│       ├── fidelity-report.json
│       ├── underlays/*.png
│       ├── compositions/{mode}-v{version}.png
│       ├── reviews/{id}-semantic-response.json
│       └── explorations/results.json
├── style/
│   ├── style-contract.json
│   ├── font-manifest.json
│   ├── component-contract.json
│   ├── reference-inventory.json
│   ├── references/
│   ├── fonts/
│   └── components/
└── workflow/
    ├── state.json
    ├── artifact-history.json
    └── migration-log.json
```
<!-- PROJECT_TREE:END -->

所有模型 Artifact 都包含 `schema_version`、`id`、`version`、`status` 和 `source`。上游 Artifact 重新生成时，下游结果会标记为 `stale`，避免旧批准结果被误用。

## 与 Game UI Forge 的合并边界

本项目负责前半段：

```text
需求 / UE → 功能契约 → 布局批准 → 风格锁定 → 视觉探索
```

Game UI Forge 负责后半段：

```text
批准视觉稿 → 元素识别 → 提取计划 → 合图 → 切图 → Manifest / ZIP
```

后续合并时应共享 Project Store、Provider Client、Task Runner 和 Artifact Registry，但保留两个独立 Feature Workbench，避免形成一个巨型组件。

专项说明见 `docs/EXISTING-PROJECT-WORKFLOW.md`，执行拆分见 `docs/PR-MILESTONES.md`。

## 文档索引

执行级文档由 `pnpm test:docs` 与 CI `docs-validate` job 自动校验（`scripts/check-docs.cjs` + `scripts/check-error-docs.cjs`）。

契约文档（`docs/contracts/`）：

- `STYLE-CONTRACT-2.0.md`、`FONT-MANIFEST.md`、`COMPONENT-CONTRACT.md`、`SCREEN-CONTRACT.md`、`COMPONENT-BINDINGS.md`、`APPROVED-LAYOUT.md`、`UNDERLAY-CONTRACT.md`、`UNDERLAY-CRITIQUE.md`、`COMPOSITION-MANIFEST.md`、`COMPOSITION-OUTPUT.md`、`FIDELITY-REPORT.md`

用户文档（`docs/user/`）：

- `EXISTING-PROJECT-SOP.md`、`STRICT-CONTINUATION-GUIDE.md`、`WORKBENCH-GUIDE.md`、`FAILURE-RECOVERY.md`

开发运维文档（`docs/dev/`）：

- `PIPELINE-STATE-MACHINE.md`、`ARTIFACT-DEPENDENCY-GRAPH.md`、`API-IPC-REFERENCE.md`、`PROJECT-DIRECTORY.md`、`ERROR-CATALOG.md`、`PROVIDER-TROUBLESHOOTING.md`、`MIGRATION-ROLLBACK.md`、`RELEASE-CHECKLIST.md`

错误码以 `electron/services/errorCodes.cjs` 冻结注册表为唯一事实来源，`docs/dev/ERROR-CATALOG.md` 与注册表双向校验。

## 分支与发布治理

- main 分支受 GitHub Ruleset 保护：禁止直推与绕过，合并必须通过全部 Required Checks（validate、fixture-e2e、ui-unit、ui-e2e、docs-validate、secret-scan、macos-validate）；
- 全部变更走 PR：push 前运行 L3 深度安全扫描，PR 经 CodeReview 实质审查与 CI 全绿后合并；
- 仓库为单人维护，REM-05 的真实技术协作者 Review 与 Approving Review 要求按 `docs/decisions/ADR-007-single-maintainer-review-governance.md` 以批准的例外关闭（七项 CI 强制 + CodeReview 子代理实质审查 + L3 扫描），协作者加入后自动恢复字面要求；
- 发布流程与检查清单见 `docs/dev/RELEASE-CHECKLIST.md`。

## Golden Samples 与发布门禁

真实 Provider 验收采用“校准集 + 保留集”结构：三组校准样本（`functional-dense`、`visual-hero`、`existing-continuation`）与两组未参与调参的保留样本（`jade-shop-zh` 简体中文 + Noto Sans SC、`frontier-campaign`）。阈值固定为 `underlay-metrics-v1`；执行日志记录 Model、Prompt Hash、Input Hash、Provider Task ID、Repair 父子链与 Output Hash；`index.json` 由执行日志与设计师签核派生。证据分层、运行命令与发布门禁见 `docs/baseline/pr8-golden-release.md`。日常 CI 通过 `pnpm test:fixture-e2e` 重放已发布证据链，不调用 Provider。正式发布门禁（设计师真人签核）已于 2026-08-18 关闭，版本提升为 `0.2.0`。

## 当前版本范围外

- 正式 Figma 生产
- 自动 Sprite Sheet、Atlas 与引擎 JSON（由 Game UI Forge 侧承接）
- Seedance 视频生成（接口边界已审阅，等动效探索进入范围后接入）
- 多租户服务器部署与任务恢复队列
