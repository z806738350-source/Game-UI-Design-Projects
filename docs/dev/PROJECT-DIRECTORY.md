# 项目目录结构（PROJECT-DIRECTORY）

每个项目是 workspace 下的一个独立目录（扁平 JSON 文件系统）。本文档
列出全部约定路径；`projectStore.cjs` 是唯一读写方，手工改文件会破坏
哈希/状态一致性。

## 1. 目录树

```
<project-dir>/
├── project.json                      # 项目元数据（name、continuation_mode、screen_id 等）
├── inputs/
│   └── requirement.md                # 需求原文
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
│       ├── underlay-contract.json    # UNDERLAY-CONTRACT
│       ├── underlay-layout-guide.png # Layout Guide 标注图
│       ├── underlay-critique.json    # UNDERLAY-CRITIQUE
│       ├── composition-manifest.json # COMPOSITION-MANIFEST
│       ├── composition-output.json   # COMPOSITION-OUTPUT
│       ├── fidelity-report.json      # FIDELITY-REPORT
│       ├── inputs.json               # 屏幕级输入（wireframe 等）
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
  校验（import 重哈希、bytes 读取、fidelity inspect）都实时比对。

## 3. 备份与迁移

- 备份：整目录复制即完整快照；
- 迁移：`migrations.cjs` 使用 backup/staging/rollback 三目录事务，日志
  写 `workflow/migration-log.json`（见 MIGRATION-ROLLBACK.md）。

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
