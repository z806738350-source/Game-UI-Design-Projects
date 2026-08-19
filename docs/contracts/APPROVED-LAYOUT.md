# APPROVED-LAYOUT Contract

`screens/{screen_id}/approved-layout.json` 是布局设计阶段（`layout_design`）
的人工决策产物：从 3 个布局提案（`layout-proposals`）中选择其一，固化为带
归一化 slots 的可执行布局。它是 Underlay、视觉生成与合成的空间基准。

## 1. 概述

布局提案由模型生成（必须恰好 3 个方案，regions 比例合计≈1.0）；设计师选择
提案并可附 `manual_adjustments`，批准时后端用 `validateLayout` 做确定性
约束校验。slots 与 Component Bindings 一一对应。

## 2. Artifact 标识与存储

| 项 | 值 |
| --- | --- |
| kind | `approved-layout`（提案为 `layout-proposals`） |
| 存储路径 | `screens/{screen_id}/approved-layout.json`、`screens/{screen_id}/layout-proposals.json` |
| schema_version | `1.0`（approved-layout）/ `2.0`（提案经 normalizeArtifact） |
| 作用域 | 每个 Screen 一份 |
| 生成阶段 | `layout_design` |

## 3. Schema 字段表

`approved-layout`：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `screen_id` | string | 是 | 所属 Screen |
| `source_proposal` | string | 是 | 选中的提案 id |
| `approved_by` / `approved_at` | string | 是 | 批准事实 |
| `label` | string | 是 | 展示名（提案 name） |
| `canvas_spec` | object | 是 | 画布规格快照 |
| `required_controls` | array | 是 | 契约控件快照 |
| `proposal` | object | 是 | 被选提案完整内容 |
| `slots` | array | 是 | slot 列表，元素见下 |
| `manual_adjustments` | string[] | 否 | 人工调整说明 |
| `input_revisions` | object | 是 | 输入版本快照 |

`slots[]`：`id`（唯一）、`rect`（归一化 `{x,y,width,height}`，位于 0–1 内）、
`anchor`、`resize_mode`、`z_index`、`underlay_policy`（strict 必须
`keep_clear === true`；含 `preferred_treatment`、`detail_level`、
`contrast_role`、`visual_noise_budget`）、可选 `keep_clear_margin`。

`layout-proposals`：`screen_id` + `proposals`（恰好 3 个；每个含
`id/name/strategy`、`visual_hierarchy/interaction_flow/tradeoffs/rationale`
数组、非空 `regions`（各 region 有 label 与 0–1 的 `recommended_ratio`，
合计 0.9–1.1））。

## 4. 确定性约束（领域策略）

`validateLayout`（`layoutValidator.cjs`）：

- slot id 不缺失/不重复；rect 四值有限且位于归一化画布内；
- 每个 slot 必须有对应 binding（`slot_id` 匹配）；每个 binding 必须有 slot；
- exact 组件：slot 缩放必须等比（|sx-sy| ≤ 0.02）且落在 family
  `scale_policy` 区间内；
- nine-slice：slot 尺寸不得小于固定 margin 之和；
- strict：每个 slot 必须 `underlay_policy.keep_clear === true`。

## 5. 批准与信任模型

`approveArtifact('approved-layout', { proposalId, manualAdjustments })`：

1. 提案必须存在于 `layout-proposals.proposals`；
2. 选择或调整变化时先 `invalidateArtifacts('approved-layout')`；
3. `validateLayout` 通过后写入批准 artifact，失败抛
   `LAYOUT_CONSTRAINT_VIOLATION`（消息含全部违规明细）。

strict 布局生成（`strict-layout-generate`）前置：Screen Contract 已批准，且
Font Manifest、Component Contract、Component Bindings 全部已批准
（`FONT_MANIFEST_REQUIRED`/`COMPONENT_CONTRACT_REQUIRED`/
`BINDING_COVERAGE_INCOMPLETE`）。

## 6. 状态机

提案：`generated` → `reviewed`；批准布局：创建即 `approved`；上游变化使其
`stale`。stale 的布局不能用于生成 Underlay/视觉。

## 7. Stale 传播

- 上游：screen-contract、component-bindings、layout-proposals 变化 →
  approved-layout stale；自身换提案/改调整也触发。
- 下游：`underlay-contract`、`visual-task`（传递至合成与 Fidelity）。

## 8. 错误码

| 错误码 | 场景 |
| --- | --- |
| `LAYOUT_CONSTRAINT_VIOLATION` | slot/缩放/9-slice/binding 对位校验失败 |
| `FONT_MANIFEST_REQUIRED` / `COMPONENT_CONTRACT_REQUIRED` / `BINDING_COVERAGE_INCOMPLETE` | strict 布局生成前置缺失 |

## 9. strict 与 guided 模式

- strict：先做字体/组件/绑定批准，再生成 strict 布局提案（提案 prompt 携带
  绑定事实）；slot 必须 keep_clear。
- guided：无绑定前置；但 `validateLayout` 无条件要求 slot↔binding 对位，
  因此 guided 项目若未建立绑定，布局批准不可达——这是产品现状，guided 工作流
  以视觉探索为主。

## 10. 前端交互要求

LayoutWorkspace/提案面板：`.proposal-tabs` 展示 3 提案；`layout-approve`
批准；strict 下 `strict-layout-generate` 触发布局生成。

## 11. 合法 JSON 示例（最小可校验形态）

```json
{
  "schema_version": "1.0",
  "id": "main-approved-layout-v1",
  "version": 1,
  "status": "approved",
  "source": { "layout_proposals": "main-layout-proposals", "source_proposal": "layout-a" },
  "screen_id": "main",
  "source_proposal": "layout-a",
  "approved_by": "ui-designer",
  "approved_at": "2026-08-19T00:00:00.000Z",
  "label": "方案 A",
  "canvas_spec": { "width": 1024, "height": 1024, "generation_size": "1024x1024" },
  "required_controls": [],
  "proposal": { "id": "layout-a", "name": "方案 A", "strategy": "wireframe-locked", "regions": {} },
  "slots": [
    {
      "id": "slot-primary-action",
      "rect": { "x": 0.35, "y": 0.8, "width": 0.3, "height": 0.08 },
      "anchor": "top-left",
      "resize_mode": "exact",
      "z_index": 10,
      "underlay_policy": { "keep_clear": true, "preferred_treatment": "low-detail", "detail_level": "low", "contrast_role": "surface-behind-ui", "visual_noise_budget": 0.25 }
    }
  ],
  "manual_adjustments": [],
  "input_revisions": { "requirement": 1, "wireframe": 1 }
}
```

## 12. 非法 JSON 示例

```json
{
  "schema_version": "1.0",
  "id": "main-approved-layout-v1",
  "version": 1,
  "status": "approved",
  "source": {},
  "screen_id": "main",
  "slots": [
    { "id": "slot-a", "rect": { "x": -0.1, "y": 0.9, "width": 0.5, "height": 0.2 } },
    { "id": "slot-a", "rect": { "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1 } }
  ]
}
```

失败原因：rect 越界（x<0 且 y+height>1）；slot id 重复；两个 slot 均无
binding；strict 下缺 keep_clear。

## 13. 存量数据兼容

0.2.0 前单屏项目的布局在 v2 迁移中归入 `screens/main/`（见
docs/dev/MIGRATION-ROLLBACK.md）。

## 14. 与其他契约的关系

上游：SCREEN-CONTRACT、COMPONENT-BINDINGS、layout-proposals；下游：
UNDERLAY-CONTRACT（reserved_regions）、visual-task、COMPOSITION-MANIFEST。

## 15. 源码指针

- `electron/services/layoutValidator.cjs`、`designPipeline.cjs`
  （`runStageUnsafe('layout_design')`、`approveArtifact('approved-layout')`）
- 提案校验：`contracts.cjs`（`layout-proposals` 分支）

## 16. 测试指针

- `electron/services/bindingsLayout.test.cjs`
- `tests/ui-e2e/strict-continuation.spec.ts`、`failure-paths.spec.ts`

## 17. 验收清单

- [ ] golden approved-layout 通过 validateLayout（strict）
- [ ] 提案必须恰好 3 个且 regions 合计≈1
- [ ] 换提案/改调整触发下游 stale

## 18. 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
