# 项目目录结构（PROJECT-DIRECTORY）

每个项目是 workspace 下的一个独立目录（扁平 JSON 文件系统）。本文档
列出全部约定路径；`projectStore.cjs` 是唯一读写方，手工改文件会破坏
哈希/状态一致性。

## 1. 目录树

```
<project-dir>/
├── project.json                      # 项目元数据（name、continuation_mode、screen_id 等）
├── style/
│   ├── style-contract.json           # STYLE-CONTRACT-2.0
│   ├── font-manifest.json            # FONT-MANIFEST
│   ├── component-contract.json       # COMPONENT-CONTRACT
│   ├── reference-inventory.json      # 参考分析结果
│   ├── fonts/{font_id}.otf|ttf       # 字体物理文件（哈希入库）
│   └── components/{family-id}/{state}.png   # 组件切图
├── screens/
│   ├── index.json                    # 屏幕索引
│   └── {screen_id}/
│       ├── screen-contract.json      # SCREEN-CONTRACT
│       ├── component-bindings.json   # COMPONENT-BINDINGS
│       ├── layout-proposals.json     # 3 个布局提案
│       ├── approved-layout.json      # APPROVED-LAYOUT
│       ├── reference-pack.json       # REFERENCE-PACK
│       ├── underlay-contract.json    # UNDERLAY-CONTRACT
│       ├── underlay-layout-guide.png # Layout Guide 标注图
│       ├── underlay-critique.json    # UNDERLAY-CRITIQUE
│       ├── underlay-repair-task.json # UNDERLAY-REPAIR-TASK
│       ├── composition-manifest.json # COMPOSITION-MANIFEST
│       ├── composition-output.json   # COMPOSITION-OUTPUT
│       ├── fidelity-report.json      # FIDELITY-REPORT
│       ├── visual-task.json          # VISUAL-TASK（视觉任务参数）
│       ├── inputs.json               # 屏幕级输入（wireframe 等）
│       ├── inputs/requirement.md     # 需求原文（屏幕级）
│       ├── inputs/wireframe.png      # 线框图
│       ├── underlays/*.png           # underlay 图像（含修复产物）
│       ├── compositions/{mode}-v{version}.png  # 合成输出
│       ├── reviews/{id}-semantic-response.json # 语义审查原始响应
│       ├── reviews/{id}-review-input.png       # critique 输入图
│       ├── reviews/{id}-review-overlay.png     # critique overlay
│       └── explorations/results.json # 视觉探索结果
└── workflow/
    ├── state.json                    # 各阶段状态
    ├── artifact-history.json         # artifact 历史快照索引
    └── migration-log.json            # schema 迁移日志
```

## 2. 路径规则

- artifact kind → 固定路径的映射在 `projectStore.cjs` 中集中定义，
  `saveArtifact` 写当前文件并归档历史快照；
- 屏幕级 artifact 全部在 `screens/{screen_id}/` 下，复制屏幕 = 复制目录；
- 物理资产（字体/切图/PNG）与其 manifest 记录以 sha256 哈希绑定，任何
  校验（import 重哈希、bytes 读取、fidelity inspect）都实时比对；
- 图库索引 `<workspaceRoot>/.gallery/index.json` 是 **workspace 用户级
  文件**：不属于任何项目目录，也不是项目 Artifact（不进
  `artifactRegistry.cjs`，不受项目 schema 约束）。它是按可信永久 CDN URL
  去重的可重建查询视图，权威仍在各项目 `screens/{screen_id}/explorations/
  results.json` 与 `workflow/` 历史快照；丢失后可由打开图库时的回填/对账
  重建，损坏时报错而不静默清空，回滚代码也不删除该文件。
- 助手数据位于桌面端 `<userData>/assistant/`，Web 端位于
  `<dataRoot>/tenants/<tenantId>/assistant/`。它是应用用户或租户级数据，
  不属于项目目录、不进入 `artifactRegistry.cjs`，也不随项目备份、复制、
  归档或删除；每条对话在元数据中不可变绑定项目与 Screen，服务端仍以
  对应用户/租户根目录作为隔离边界。

## 3. 备份与迁移

- 备份：整目录复制即完整快照；
- 迁移：`migrations.cjs` 使用 backup/staging/rollback 三目录事务，日志
  写 `workflow/migration-log.json`（见 MIGRATION-ROLLBACK.md）。

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
| 1.1 | 2026-08-19 | PR-22 修正 per-screen inputs 位置；补 reference-pack / underlay-repair-task / visual-task |
| 1.2 | 2026-09-01 | 图库功能：说明 `.gallery/index.json` 为 workspace 用户级索引，不属项目目录与 Artifact Registry |
| 1.3 | 2026-09-05 | 内嵌助手：登记桌面用户级与 Web 租户级存储，不纳入项目/Artifact 生命周期 |
