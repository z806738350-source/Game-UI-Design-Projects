# UNDERLAY-CONTRACT Contract

`screens/{screen_id}/underlay-contract.json` 把已批准布局的 slots 翻译为
Underlay（底图）生成规范：哪些区域必须留空、允许什么级别的细节、主体不得
侵入哪里。它是视觉生成 prompt 的结构约束来源，也是 Critique 的检查基准。

## 1. 概述

Underlay Contract 由 `generateUnderlayContract` 确定性生成（非模型产出）：
每个布局 slot 按 `keep_clear_margin` 外扩为一个 `reserved_region`。批准后
可生成 Layout Guide（带标注的 PNG），strict 视觉生成同时要求两者就绪。

## 2. Artifact 标识与存储

| 项 | 值 |
| --- | --- |
| kind | `underlay-contract` |
| 存储路径 | `screens/{screen_id}/underlay-contract.json` |
| schema_version | `2.0` |
| Layout Guide | `screens/{screen_id}/underlay-layout-guide.png` |
| 生成阶段 | `underlay_specification` |

## 3. Schema 字段表

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `canvas` | [number, number] | 是 | 画布尺寸 |
| `focal_regions` | array | 是 | 视觉焦点区域（来自布局） |
| `reserved_regions` | array | 是 | 保留区列表，元素见下 |
| `global_rules` | object | 是 | 三条布尔规则，见下 |
| `layout_guide` | object | 生成后 | `{ id, path, image_hash, width, height, source }` |

`reserved_regions[]`：`slot_id`、`binding_id`（对位控件）、`bbox`
（`[x,y,w,h]` 归一化，已含 margin 外扩并裁剪到画布）、`treatment`
（默认 low-detail）、`subject_overlap`/`hard_edge_overlap`/`text_like_shapes`/
`ui_like_shapes`（布尔）、`detail_level`、`contrast_role`、`visual_noise_budget`
（默认 0.25）。

`global_rules`：`do_not_render_shared_ui`、`do_not_render_formal_text`、
`do_not_place_main_subject_inside_reserved_regions`（生成器恒为 true）。

## 4. 领域策略

- 生成前置：Approved Layout 与 Component Bindings 均 `approved`，否则抛
  `Approved Layout is required.` / `Approved Component Bindings are required.`
- Layout Guide 生成前置：Underlay Contract 已批准
  （`Approve the Underlay Contract before generating its guide.`）。
- strict 视觉生成前置：`status === 'approved'` 且 `layout_guide.path` 存在，
  否则抛 `UNDERLAY_SPEC_REQUIRED`。

## 5. 批准与信任模型

`approveArtifact('underlay-contract')`：存在性检查 + 失效下游 + 写
`approved`/`approved_at`。内容确定性生成，无需人工改稿；如需调整，改布局
slots/margin 后重新生成。

## 6. 状态机

`generated` → `approved` → `stale`。`layout_guide` 附加后 version +1。

## 7. Stale 传播

- 上游：approved-layout、style-contract 变化 → underlay-contract stale。
- 自身重新生成触发 `invalidateArtifacts('underlay-contract')`。
- 下游：`visual-task`、`underlay-critique`。

## 8. 错误码

| 错误码 | 场景 |
| --- | --- |
| `UNDERLAY_SPEC_REQUIRED` | strict 视觉生成缺已批准契约或 Layout Guide |

## 9. strict 与 guided 模式

strict/locked：契约 + Layout Guide 是视觉生成的硬前置；guided：视觉探索不
强制契约（但 critique/composition 链仍使用已生成的契约）。

## 10. 前端交互要求

Underlay Workbench 的契约视图：`underlay-contract-generate`、
`underlay-contract-approve`、`underlay-guide-generate`；展示 reserved_regions
数量与 global_rules。

## 11. 合法 JSON 示例（最小可校验形态）

```json
{
  "schema_version": "2.0",
  "id": "main-underlay-contract",
  "version": 1,
  "status": "approved",
  "source": { "approved_layout": "main-approved-layout-v1", "component_bindings": "main-component-bindings" },
  "canvas": [1024, 1024],
  "focal_regions": [{ "id": "focal-center", "bbox": [0.3, 0.2, 0.4, 0.4] }],
  "reserved_regions": [
    {
      "slot_id": "slot-primary-action",
      "binding_id": "primary-action",
      "bbox": [0.33, 0.78, 0.34, 0.12],
      "treatment": "low-detail",
      "subject_overlap": false,
      "hard_edge_overlap": false,
      "text_like_shapes": false,
      "ui_like_shapes": false,
      "detail_level": "low",
      "contrast_role": "surface-behind-ui",
      "visual_noise_budget": 0.25
    }
  ],
  "global_rules": {
    "do_not_render_shared_ui": true,
    "do_not_render_formal_text": true,
    "do_not_place_main_subject_inside_reserved_regions": true
  }
}
```

## 12. 非法 JSON 示例

```json
{
  "schema_version": "2.0",
  "id": "main-underlay-contract",
  "version": 1,
  "status": "generated",
  "source": {},
  "canvas": [1024],
  "reserved_regions": [],
  "global_rules": { "do_not_render_shared_ui": false }
}
```

问题：canvas 非二元组；无 reserved_regions 意味着无保留区（布局 slot 未
翻译，契约无效用）；global_rules 允许渲染共享 UI，违反 strict 语义。
契约由生成器产出所以此类结构通常意味着布局未批准或 slots 为空。

## 13. 存量数据兼容

无契约的旧项目在 strict 流程中必须重新生成（`UNDERLAY_SPEC_REQUIRED` 前
不可生成视觉）。

## 14. 与其他契约的关系

上游：APPROVED-LAYOUT、COMPONENT-BINDINGS；下游：visual-task（prompt 约束）、
UNDERLAY-CRITIQUE（检查基准）、COMPOSITION-MANIFEST（critique 引用链）。

## 15. 源码指针

- `electron/services/underlayContract.cjs`（生成器）
- `electron/services/layoutGuideRenderer.cjs`（Layout Guide PNG）
- `designPipeline.cjs`（createUnderlayContract/createLayoutGuide）

## 16. 测试指针

- `electron/services/underlayReview.test.cjs`、`underlayRepairPipeline.test.cjs`
- `tests/ui-e2e/strict-continuation.spec.ts`

## 17. 验收清单

- [ ] golden underlay-contract 的 reserved_regions 与布局 slots 一一对应
- [ ] 未批准契约不能生成 Layout Guide
- [ ] strict 视觉生成在缺 Guide 时被 `UNDERLAY_SPEC_REQUIRED` 拦截

## 18. 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
