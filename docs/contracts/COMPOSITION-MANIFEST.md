# COMPOSITION-MANIFEST Contract

`screens/{screen_id}/composition-manifest.json` 是确定性合成器的渲染指令清单：
underlay + 组件图层 + 文字图层（+ preview 水印），以及渲染前的全部门禁结论。
Manifest 一经生成即为只读证据（`GENERATED_EVIDENCE_READ_ONLY`）。

## 1. 概述

`createCompositionManifest`（`compositor.cjs`）在渲染前执行四道门禁：
Underlay review gate、binding 语义校验、layout 约束校验、final 模式下的字体
strict 校验；任一失败抛 `COMPOSITION_GATE_FAILED`（`missing_requirements`
携带明细）。通过后按 z_index 与稳定 key 排序生成图层，保证渲染确定性。

## 2. Artifact 标识与存储

| 项 | 值 |
| --- | --- |
| kind | `composition-manifest` |
| 存储路径 | `screens/{screen_id}/composition-manifest.json` |
| schema_version | `2.0` |
| mode | `preview` / `final`（`{mode}-v{version}`） |
| 生成阶段 | `composition` |

## 3. Schema 字段表

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `mode` | string | 是 | preview/final |
| `canvas` | [number, number] | 是 | 画布尺寸 |
| `underlay` | object | 是 | `{ source, variation_id, path|image_url, provider_task_id, critique_id }` |
| `layers` | array | 是 | 图层列表，元素见下 |
| `coverage` | object | 是 | binding 覆盖事实 |
| `renderer` | object | 是 | `{ engine: 'sharp-libvips', deterministic_order: true, registry: ['exact','nine-slice','vector-token'], version }` |
| `output` | 渲染后写入 | 是 | `{ artifact_id, path, hash, width, height }` |
| `source` | object | 是 | 全部上游 artifact id 引用 |

`layers[]` 类型：

- `component`：`control_id`、`component_id`、`state`、`asset_path`、
  `asset_hash`、`intrinsic_size`、`scale_policy`、`rect[x,y,w,h]`（像素）、
  `anchor`、`resize_mode`、`renderer`、`slice`、`z_index`；
- `text`：`control_id`、`content`、`font_role`、`font_id/path/hash/family/
  postscript_name/format`、`font_license_*`、`exact_confirmation`、
  `fidelity_mode`、`typography`、`rect`、`z_index`、`composition_mode`；
- `watermark`：preview 模式且存在非 exact 文字时追加
  `TYPOGRAPHY PREVIEW · FONT FIDELITY UNRESOLVED`（z_index 10000）。

文字图层仅在 `family.text_policy === 'text-slot'` 且 binding 有文字内容时生成。

## 4. 领域策略（门禁）

生成门禁（顺序执行，全部通过才产出）：

1. `reviewGate(critique)` 通过；
2. `validateBindings({ strict })` 零错误；
3. `validateLayout({ strict })` 零错误；
4. `mode === 'final'` 时 `validateFontManifest({ strict })` 零错误。

批准门禁（`approveArtifact('composition-manifest')`，仅 final）：

- `verifyCompositionOutput(requireFinal: true)` 通过；
- Manifest `output.hash/path` 与当前 Composition Output 一致，否则
  `COMPOSITION_OUTPUT_INVALID`；
- Fidelity Report 的 source 指向当前 output（id/version/hash 全等），否则
  `FIDELITY_OUTPUT_STALE`；
- 实时 `inspectFidelityEvidence` 通过，否则 `FIDELITY_CURRENT_EVIDENCE_FAILED`；
- `finalApprovalGate` 通过，否则 `FIDELITY_GATE_FAILED`。

## 5. 批准与信任模型

Manifest 不可编辑（`GENERATED_EVIDENCE_READ_ONLY`）；`status` 由
`draft`/`generated`（合成时）到 `approved`（final 门禁通过后）。批准后
`workflow.fidelity_review = approved`。

## 6. 状态机

`generated`（composeVisual 落盘）→ `approved`（final 批准）；上游 stale 时
随依赖链降级为 `stale`。

## 7. Stale 传播

上游：font-manifest、visual-results、underlay-critique、composition 上游全部
artifact 的传递闭包。下游：`composition-output`。

## 8. 错误码

| 错误码 | 场景 |
| --- | --- |
| `COMPOSITION_GATE_FAILED` | 生成门禁失败 |
| `COMPOSITION_OUTPUT_INVALID` / `FIDELITY_OUTPUT_STALE` / `FIDELITY_CURRENT_EVIDENCE_FAILED` / `FIDELITY_GATE_FAILED` | final 批准门禁失败 |
| `GENERATED_EVIDENCE_READ_ONLY` | 尝试编辑 |

## 9. strict 与 guided 模式

strict 决定 binding/layout/font 校验是否 strict；guided 合成使用非 strict
校验（字体 strict 仅 final 模式追加）。

## 10. 前端交互要求

Composition Workbench：`composition-preview`、`composition-final`、
`composition-approve`；展示图层数、mode、output 哈希。

## 11. 合法 JSON 示例（最小可校验形态）

```json
{
  "schema_version": "2.0",
  "id": "main-composition-final",
  "version": 1,
  "status": "approved",
  "source": {
    "screen_contract": "main-screen-contract",
    "approved_layout": "main-approved-layout-v1",
    "component_bindings": "main-component-bindings",
    "component_contract": "project-component-contract",
    "font_manifest": "project-font-manifest",
    "style_contract": "project-style-contract",
    "underlay_critique": "main-underlay-critique-current"
  },
  "mode": "final",
  "canvas": [1024, 1024],
  "underlay": { "source": "provider-result", "variation_id": "current", "path": "screens/main/underlays/current.png", "critique_id": "main-underlay-critique-current" },
  "layers": [
    {
      "type": "component",
      "control_id": "primary-action",
      "component_id": "primary-button",
      "state": "default",
      "asset_path": "style/components/primary-button/default.png",
      "asset_hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      "intrinsic_size": [220, 64],
      "scale_policy": { "uniform_only": true, "min_scale": 1, "max_scale": 1 },
      "rect": [358, 819, 220, 64],
      "anchor": "top-left",
      "resize_mode": "exact",
      "renderer": "exact",
      "z_index": 10
    }
  ],
  "coverage": { "required_controls": 1, "bound_required_controls": 1, "unbound_required_controls": [] },
  "renderer": { "engine": "sharp-libvips", "deterministic_order": true, "registry": ["exact", "nine-slice", "vector-token"], "version": "composition-v1/sharp" },
  "output": { "artifact_id": "main-composition-final-output", "path": "screens/main/compositions/final-v1.png", "hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000", "width": 1024, "height": 1024 }
}
```

## 12. 非法 JSON 示例

```json
{
  "schema_version": "2.0",
  "id": "main-composition-final",
  "version": 1,
  "status": "generated",
  "source": {},
  "mode": "final",
  "layers": [
    { "type": "component", "control_id": "primary-action", "asset_path": "style/components/primary-button/default.png" }
  ]
}
```

问题：图层缺 `asset_hash`（Fidelity 报 `COMPONENT_ASSET_UNIDENTIFIED`）；
无 output 引用（批准报 `COMPOSITION_OUTPUT_INVALID`）；source 引用缺失使
依赖检查报 `STALE_DEPENDENCY`。

## 13. 存量数据兼容

Manifest 总是可重新合成；旧 manifest 在上游 stale 后不应再批准
（FIDELITY_OUTPUT_STALE/STALE_DEPENDENCY 拦截）。

## 14. 与其他契约的关系

上游：全部设计与资产契约 + UNDERLAY-CRITIQUE；下游：COMPOSITION-OUTPUT →
FIDELITY-REPORT。

## 15. 源码指针

- `electron/services/compositor.cjs`（门禁与图层生成）
- `electron/services/compositionRenderer.cjs`（渲染与输出校验）
- `designPipeline.cjs`（composeVisual、approveArtifact）

## 16. 测试指针

- `electron/services/compositionRenderer.test.cjs`、`compositionFidelity.test.cjs`
- `tests/ui-e2e/strict-continuation.spec.ts`（preview → final → 批准）

## 17. 验收清单

- [ ] 四道生成门禁任一失败即 `COMPOSITION_GATE_FAILED`
- [ ] preview 非 exact 文字携带水印图层
- [ ] final 批准需要 output/fidelity/实时像素三重一致

## 18. 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
