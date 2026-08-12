# Game UI Design Copilot

面向游戏 UI 设计师的 Artifact-driven AI 设计流水线。第一版覆盖：

1. 策划需求 + UE Wireframe 输入
2. Functional Screen Contract 生成与人工批准
3. 三套 Layout Proposal 生成、比较与人工批准
4. 新项目风格探索 / 已有项目风格重建
5. Style Contract 批准与 Style Lock
6. 2–4 个视觉探索方向生成与版本溯源

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
├── screens/main/
│   ├── screen-contract.json
│   ├── layout-proposals.json
│   ├── approved-layout.json
│   ├── visual-task.json
│   └── explorations/results.json
├── style/
│   ├── style-contract.json
│   └── references/
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

## 暂未纳入第一版

- 正式 Figma 生产
- 自动组件拆解、Sprite Sheet、9-slice、Atlas、引擎 JSON（由 Game UI Forge 侧承接）
- Seedance 视频生成（接口边界已审阅，等动效探索进入范围后接入）
- 多租户服务器部署与任务恢复队列
