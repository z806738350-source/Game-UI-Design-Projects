# Game UI Design Copilot

面向游戏 UI 设计师的 Artifact-driven AI 设计流水线。0.2.0 覆盖：

1. 策划需求 + UE Wireframe 输入
2. Functional Screen Contract 生成与人工批准
3. 三套 Layout Proposal 生成、比较与人工批准
4. 新项目风格探索 / 已有项目风格重建
5. Style Contract 批准与 Style Lock
6. 已有项目默认 `existing-strict`，新项目保留探索模式
7. Font Manifest、Component Contract 与必要控件 100% Binding
8. 多 Screen、Schema 2.0 安全迁移与细粒度 stale 传播
9. Underlay Contract、结构 Guide、自动 Critique 与有限修复
10. Canvas 2D 确定性组件/文字合成与 Final Fidelity Gate

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

不要提交真实 Key。2026-08-09 已完成真实验收：多模态 Screen Contract 请求通过，Image-GPT2 异步提交、任务轮询和永久 Kunpo CDN 结果返回均通过。

## 项目 Artifact

默认项目目录为 `~/Game UI Design Projects`：

```text
project/
├── project.json
├── inputs/
│   ├── requirement.md
│   └── wireframe.png
├── screens/index.json
├── screens/main/
│   ├── screen-contract.json
│   ├── layout-proposals.json
│   ├── approved-layout.json
│   ├── component-bindings.json
│   ├── underlay-contract.json
│   ├── underlay-layout-guide.png
│   ├── underlay-critique.json
│   ├── composition-manifest.json
│   ├── fidelity-report.json
│   └── explorations/results.json
├── style/
│   ├── style-contract.json
│   ├── font-manifest.json
│   ├── component-contract.json
│   ├── references/
│   ├── fonts/
│   └── components/
└── workflow/state.json
```

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

## 暂未纳入 0.2.0

- 正式 Figma 生产
- 自动 Sprite Sheet、Atlas 与引擎 JSON（由 Game UI Forge 侧承接）
- Seedance 视频生成（接口边界已审阅，等动效探索进入范围后接入）
- 多租户服务器部署与任务恢复队列
