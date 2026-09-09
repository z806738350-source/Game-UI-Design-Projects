# Game UI Design Copilot

面向游戏 UI 设计师的 AI 设计工具：从需求与 UE 线框出发，经过功能解读、布局比较、风格锁定，生成可审核、可追溯的视觉结果。支持 Electron 桌面端与需要飞书登录的 Web 端。

## 版本与功能状态

以下状态核对于 **2026-09-09**。GitHub Release、默认分支和在线部署分别演进，不能仅凭应用内的版本号判断是否包含 AI 助手。

| 版本入口 | 当前情况 |
| --- | --- |
| [正式 Release v0.2.2](https://github.com/z806738350-source/Game-UI-Design-Projects/releases/tag/v0.2.2) | 发布于 2026-08-19；是此前的合规与治理收口版本，不包含后续全部功能。当前源码的 `package.json` 仍使用 `0.2.2`，尚未为助手功能创建新的正式 Release。 |
| [默认分支 main](https://github.com/z806738350-source/Game-UI-Design-Projects/tree/main) | 包含主设计流程、意图预填与评审、图库、Web 用户隔离和版本路由；**尚未合入内嵌 AI 助手**。 |
| [助手分支 codex/embedded-ai-assistant](https://github.com/z806738350-source/Game-UI-Design-Projects/tree/codex/embedded-ai-assistant) | 包含截图问答、项目上下文、确认或拒绝写操作及紧凑聊天面板；已推送源码提交 `153746d`。[PR #81](https://github.com/z806738350-source/Game-UI-Design-Projects/pull/81) 保持 Draft、未合并。 |
| 公司在线新版 | 已部署助手分支的 `153746d`，release 为 `20260907-001500-153746d`，助手已启用。正式入口默认仍进入经典版，需要主动选择新版。 |

普通克隆或下载 `main` 不会获得助手功能；需要助手时，请使用上表中的助手分支，或进入在线新版。

## 主要能力

- **项目输入**：导入 UE 线框与需求，AI 预读并生成可编辑的设计意图；支持结构化评审、确认与历史版本留存。
- **功能解读**：生成 Functional Screen Contract，由设计师补充或修改并批准。
- **布局设计**：生成三套 Layout Proposal，比较、调整并批准选定布局。
- **风格锁定**：支持新项目风格探索和已有项目风格重建，管理 Style Contract、字体、组件与绑定；已有项目默认采用 `existing-strict`。
- **视觉探索与输出**：支持底图生成、结构引导、审核指标、自动 Critique 与有限次数 Repair，以及组件/字体合成、最终 PNG 导出和初步 Fidelity Gate。
- **项目管理与图库**：支持多个页面（Screen）、项目归档、生成图片集中浏览，以及阶段产物和历史版本查看。
- **可追溯的工作流**：记录生成、修改和批准；上游变化使相关下游结果失效（`stale`），防止继续使用旧批准结果。绑定校验和各工作台的操作边界仍生效。
- **桌面与 Web**：桌面端使用本地项目空间；Web 端提供飞书登录，以及按登录身份隔离的项目、配置和持久化数据。

### 内嵌 AI 助手（助手分支 / 在线新版）

助手帮助用户理解操作、查找当前项目缺漏并整理设计意图。它尤其适合在“项目输入”和“功能解读”阶段辅助补充需求，也可以解释后续阶段的状态；**它不是能够任意修改整个项目的自动执行器**。

- 可结合当前项目、页面、所处阶段和聊天记录回答问题。对话绑定具体目标，切换目标后可为当前目标新建对话。
- 支持选择、粘贴或拖入 PNG、JPEG、WebP 截图；图片像素会发送给助手模型。每条消息最多 4 张，单张最多 5 MiB、合计最多 12 MiB。
- 统一聊天入口，不再区分“问答 / 执行”菜单。助手提出写操作后，显示待保存草稿供用户检查，并提供**确认执行 / 拒绝执行**；拒绝会记录到对话上下文且不保存草稿。
- 当前允许的写操作只有**保存设计意图评审草稿**（`save_intent_review_draft`）。保存仍需确认，并检查目标及输入版本，防止重复执行和覆盖过期内容；不会代替用户批准功能契约、布局或风格，也不会直接发起出图。
- 支持对话持久化与恢复，聊天区域优先展示消息；顶部整合对话选择、新建和关闭，重命名与删除位于对话下拉列表内。
- 截图随对话保存：桌面端保存在本地助手数据目录，Web 端保存在服务端对应用户空间。模型每次接收的历史文本与图片数量有限，最多携带 4 张近期图片；这不等同于无限上下文或长期记忆。

助手默认关闭。**仅在包含助手代码的版本中**，桌面端可在项目根目录 `.env` 添加以下变量后重启应用；Web 部署需将变量注入服务端进程环境后重启对应服务：

```env
GAME_UI_ASSISTANT_ENABLED=true
```

启用后，从右上角机器人按钮打开面板。仅给 `main` 配置此变量不会增加尚未合并的助手代码。

## 本地运行

建议使用 **Node.js 22**；仓库锁定的包管理器为 **pnpm（11.19.0）**。需要可用的 Kunpo Gateway 或本地直连配置。版本依据见 [package.json](package.json) 与 [CI 配置](.github/workflows/ci.yml)。

首次获取源码：

```bash
git clone https://github.com/z806738350-source/Game-UI-Design-Projects.git
cd Game-UI-Design-Projects
```

如需内嵌 AI 助手，在安装依赖前选择助手分支：

```bash
git switch codex/embedded-ai-assistant
```

安装依赖并启动桌面开发环境：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

macOS 也可以双击根目录的 `Start Game UI Design Copilot.command`，或使用快速启动：

```bash
pnpm quick-start:check
pnpm quick-start
```

新用户请阅读 [快速上手说明书](docs/user/quick-start-guide.html)（下载到本地后可直接用浏览器打开）。

### 模型与连接配置

推荐通过受控 Gateway 调用模型，桌面端配置示例：

```env
KUNPO_GATEWAY_BASE_URL=http://127.0.0.1:9020/v1
```

此地址是示例，需要有实际运行的 Gateway。也支持本地直连；真实 Key 只由后端读取，不进入浏览器或 Electron renderer：

```env
KUNPO_API_BASE_URL=https://your-kunpo-host/v1
KUNPO_API_KEY=your-local-key
```

桌面端配置文件的查找顺序为：`DESIGN_COPILOT_ENV_FILE` 指定文件 → 当前项目 `.env` → 同级 `Game UI Forge/.env`（仅用于本地迁移兼容）。Web 进程的配置需由部署环境提供，不能假设它会按桌面端规则自动加载本地 `.env`。

在设置中选择实际接入服务支持的模型：**助手模型**用于聊天、截图理解和动作计划，**视觉理解模型**用于主流程的 UE、需求及参考图理解，两者可使用不同模型；截图问答要求助手模型本身支持图片输入，不会自动转交给视觉理解模型。**图像生成模型**用于出图。助手模型设置仅出现在包含助手功能的版本中。

变量模板见 [.env.example](.env.example)。不要提交真实 Key、飞书密钥、会话密钥或个人项目数据。

## 在线运行

生产环境先执行 `pnpm build`，再启动 `pnpm start:web`（对应 `node server/webServer.cjs`），由同一后端提供静态页面、API、飞书认证和用户数据持久化。启动前必须由服务管理器或进程环境配置 Gateway、飞书回调、会话密钥及持久化数据根等变量，名称见 [.env.example](.env.example)。

- 飞书登录使用 OAuth v3 token 接口，通过基础用户信息中的 `tenant_key + open_id` 映射内部用户空间；不申请通讯录、邮箱、手机号或离线访问权限。
- 浏览器不持有 Kunpo Key；模型请求由服务端发送。真实 `FEISHU_APP_SECRET` 与 `SESSION_SECRET` 只能放在服务器受限环境文件中。
- 桌面端默认项目目录为 `~/Game UI Design Projects`；Web 使用 `DESIGN_COPILOT_DATA_ROOT` 下按用户分隔的空间，不使用访问者电脑上的该目录。
- 仓库也提供 `pnpm start:version-router`，可将经典版与新版作为两个独立后端运行，使用独立数据空间。版本路由不代替业务后端，也不自动执行数据迁移。
- 当前按单实例、文件持久化方式运行；同一数据目录不支持多个业务进程同时写入。分布式任务队列与跨实例恢复尚未实现。

现有公司部署入口为 [在线工具](http://10.8.0.176:9030)，需能访问公司部署网络；[进入新版](http://10.8.0.176:9030/__versions/select/current)。默认经典版保留，新版已启用助手。部署状态可从 [`/__versions/status`](http://10.8.0.176:9030/__versions/status) 查看；版本切换不会把经典版数据自动复制到新版。

## 构建与验证

```bash
pnpm lint              # TypeScript 检查
pnpm build             # 类型检查与前端生产构建
pnpm test              # 后端、服务端与脚本测试
pnpm test:docs         # 文档结构、错误码、命令、项目树四项校验
pnpm test:fixture-e2e  # 已发布证据链重放，不调用真实 Provider
pnpm test:ui-unit      # 前端组件单测
pnpm test:ui-e2e       # Playwright Electron E2E，需先 pnpm build
```

测试数量随提交变化，以对应提交的 [CI 结果](https://github.com/z806738350-source/Game-UI-Design-Projects/actions) 为准。助手源码 `153746d` 已通过 422 项后端测试、202 项前端单测、58 项桌面 UI E2E 和 7 项 CI；38 项 fixture E2E 也是后端测试中的一部分，不应重复相加。

**当前检查限制（2026-09-09）**：以上测试通过数量是对应提交此前的验证记录。本次 [README 修订 PR #82](https://github.com/z806738350-source/Game-UI-Design-Projects/pull/82) 的依赖审计发现现有 `sharp` 版本命中 [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)，导致 `validate` 未通过；需要处理依赖风险并重新验证后才能满足合并检查。本文档修订没有升级依赖或增加审计豁免。

2026-09-07 的在线更新还完成了真实模型截图像素问答、对话重载和合成身份隔离检查。真实飞书账号的完整界面操作及双账号隔离仍待人工验收；服务健康或自动测试通过不等于已完成这部分验收。

## 项目 Artifact

下面是**单个项目**的产物结构，不是整个部署数据根，也不包含独立存储的登录信息、用户设置和助手对话。此树由 [项目目录事实源](docs/schemas/project-directory.required.json) 校验；修改目录结构时需同步文档与事实源。

<!-- PROJECT_TREE:BEGIN -->
```text
project/
├── project.json
├── screens/
│   ├── index.json
│   └── main/
│       ├── inputs.json # 需求/意图权威输入：structured-v2 时含 intent_generation/analysis/review/candidate
│       ├── inputs/
│       │   ├── requirement.md
│       │   ├── wireframe.png
│       │   └── intent-review-history/ # 意图评审版本留档（index.json + 快照）
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

模型产物使用版本、状态与来源信息追踪生成过程；上游变化时，受影响的下游结果会标记为 `stale`，避免旧批准结果被误用。详细约束见 [契约文档](docs/contracts/) 和 [产物依赖图](docs/dev/ARTIFACT-DEPENDENCY-GRAPH.md)。

## 文档索引

- 入门与操作：[快速上手](docs/user/quick-start-guide.html)、[工作台指南](docs/user/WORKBENCH-GUIDE.md)、[已有项目 SOP](docs/user/EXISTING-PROJECT-SOP.md)、[严格续作](docs/user/STRICT-CONTINUATION-GUIDE.md)、[失败恢复](docs/user/FAILURE-RECOVERY.md)。
- 产品与设计：[已有项目工作流](docs/EXISTING-PROJECT-WORKFLOW.md)、[前端设计指南](docs/dev/FRONTEND-DESIGN-GUIDE.md)。
- 开发与维护：[状态机](docs/dev/PIPELINE-STATE-MACHINE.md)、[API / IPC](docs/dev/API-IPC-REFERENCE.md)、[项目目录](docs/dev/PROJECT-DIRECTORY.md)、[错误码](docs/dev/ERROR-CATALOG.md)、[Provider 排查](docs/dev/PROVIDER-TROUBLESHOOTING.md)、[迁移与回滚](docs/dev/MIGRATION-ROLLBACK.md)。
- 契约规范：[STYLE-CONTRACT-2.0.md](docs/contracts/STYLE-CONTRACT-2.0.md)、[FONT-MANIFEST.md](docs/contracts/FONT-MANIFEST.md)、[COMPONENT-CONTRACT.md](docs/contracts/COMPONENT-CONTRACT.md)、[SCREEN-CONTRACT.md](docs/contracts/SCREEN-CONTRACT.md)、[COMPONENT-BINDINGS.md](docs/contracts/COMPONENT-BINDINGS.md)、[APPROVED-LAYOUT.md](docs/contracts/APPROVED-LAYOUT.md)、[UNDERLAY-CONTRACT.md](docs/contracts/UNDERLAY-CONTRACT.md)、[UNDERLAY-CRITIQUE.md](docs/contracts/UNDERLAY-CRITIQUE.md)、[COMPOSITION-MANIFEST.md](docs/contracts/COMPOSITION-MANIFEST.md)、[COMPOSITION-OUTPUT.md](docs/contracts/COMPOSITION-OUTPUT.md)、[FIDELITY-REPORT.md](docs/contracts/FIDELITY-REPORT.md)。
- 发布治理：[发布检查清单](docs/dev/RELEASE-CHECKLIST.md)、[单人维护审查规则 ADR-007](docs/decisions/ADR-007-single-maintainer-review-governance.md)、[Golden Samples 基线](docs/baseline/pr8-golden-release.md)。

`pnpm test:docs` 与 CI `docs-validate` 检查文档结构、错误码注册表一致性、命令有效性和项目树一致性。版本化契约及错误码细节以源码注册表和对应文档为准。

## 分支与发布治理

`main` 受 GitHub Ruleset 保护，变更通过 PR 合并，必须满足全部 7 项 Required Checks：`validate`、`fixture-e2e`、`ui-unit`、`ui-e2e`、`docs-validate`、`secret-scan`、`macos-validate`。不得绕过保护或强推。

安全扫描、独立审查和单人维护例外按 [发布检查清单](docs/dev/RELEASE-CHECKLIST.md) 与 [ADR-007](docs/decisions/ADR-007-single-maintainer-review-governance.md) 执行。部署某个分支提交，不代表该分支已经合入 `main` 或发布为新 GitHub Release。

历史 Golden Samples 的五组真实 Provider 样本于 2026-08-18 完成设计师签核，属于当时的发布证据；日常 fixture E2E 重放这些证据，不会重新运行真实模型。历史结果不能替代后续版本的真实用户验收。

## 当前边界

- 本工具负责需求 / UE → 功能契约 → 布局批准 → 风格锁定 → 视觉探索与合成输出；素材提取、切图、Sprite Sheet、Atlas 和引擎交付不属于本仓库已实现的自动流程。
- 暂不支持正式 Figma 生产和 Seedance 视频生成。
- AI 助手目前只可在确认后保存意图评审草稿，不支持任意项目写入、任意命令执行或自动批准后续阶段。
- 已有 Web 登录与用户隔离；尚未提供分布式任务队列、多实例共享写入和通用跨实例任务恢复。
