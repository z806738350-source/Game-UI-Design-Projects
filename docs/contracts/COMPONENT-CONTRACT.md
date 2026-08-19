# COMPONENT-CONTRACT Contract

`style/component-contract.json` 记录项目组件库（families）：每个组件族的复用
模式、状态资产、缩放策略与文字策略。组件资产必须真实导入并落盘哈希，是
确定性合成器（compositor）的唯一组件来源。

## 1. 概述

Component Contract 通过 `copilot:components:import`（逐状态导入 PNG/JPG/WebP/
SVG）或 `copilot:components:forge-import`（Game UI Forge manifest 批量导入）
维护。合成器只渲染契约内组件；Fidelity 会对每个图层资产重新哈希验证。

## 2. Artifact 标识与存储

| 项 | 值 |
| --- | --- |
| kind | `component-contract` |
| 存储路径 | `style/component-contract.json`（全局） |
| schema_version | `2.0` |
| 资产文件 | `style/components/{family-id}/{state}.png|…` |
| 生成阶段 | `component_resolution` |

## 3. Schema 字段表

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `families` | array | 是 | 组件族列表，至少 1 个 |

`families[]`：`id`（唯一，点/划线稳定 id）、`name`、`category`、`status`、
`source`、`reuse_mode`（`exact`/`nine-slice`/`vector-token`/`reference-locked`/
`local-generated`）、`text_policy`（`none`/`text-slot`）、`intrinsic_size`
（`[w,h]` 正数）、`scale_policy`（`{ uniform_only, min_scale, max_scale }`）、
可选 `slice`（9-slice `margins: [left,right,top,bottom]` 整数）、
`locked_properties`、`states`（stateId → 状态资产）。

`states[stateId]`：`asset_path`、`asset_hash`（sha256 前缀）、`source_bbox`
（4 元组）、`alpha_channel`、`intrinsic_size`、`mime`。

## 4. 校验规则（领域策略）

`validateComponentContract`（`componentKit.cjs`）：

- families 非空、id 不重复；reuse_mode 在枚举内；
- 每个 family 必须有已识别的 `default` 资产（path + hash）；
- `intrinsic_size` 为正数二元组；nine-slice 需要 4 个非负整数 margin 且保留
  可缩放中心；
- strict：`button/navigation/tab` 必须含 `disabled` 与 `pressed|selected`
  状态；`button/navigation/tab/resource-bar/icon` 不允许 `local-generated`；
  每个 family `status` 必须 `approved`。

批准时额外执行 `validateComponentAssets`：逐状态重哈希、比对 mime/尺寸/alpha
元数据、校验路径不逃逸工作区，任何不一致即失败（`COMPONENT_CONTRACT_INVALID`
消息明细）。

## 5. 批准与信任模型

`approveArtifact('component-contract')`：strict 校验 + 资产物理校验通过后写
`approved` + `approved_at`。导入动作总是把 family 置为 `reviewed` 并使下游
stale；批准是对当前文件的事实确认。

## 6. 状态机

family 级：`reviewed`（导入后）→ `approved`；artifact 级：
`draft` → `reviewed` → `approved` → `stale`。

## 7. Stale 传播

- 上游：style-contract stale → component-contract stale。
- 自身：导入组件/Forge manifest 触发 `invalidateArtifacts('component-contract')`。
- 下游：`component-bindings`（PR-15 起含该边）→ layout → composition → fidelity。

## 8. 错误码

| 错误码 | 场景 |
| --- | --- |
| `COMPONENT_CONTRACT_REQUIRED` | strict 布局前置缺失 |
| `COMPONENT_ASSET_HASH_MISMATCH` | 合成/检查时资产哈希与记录不符 |
| `COMPONENT_RENDERER_MISSING` | 图层 renderer 不在注册表 |
| `EXACT_NON_UNIFORM_SCALE` / `EXACT_SCALE_OUT_OF_POLICY` | exact 组件缩放违规 |

## 9. strict 与 guided 模式

strict：状态完整性、禁用 local-generated、family approved 全部强制；
guided：仅结构校验（默认 reuse/scale 策略仍保证可合成）。

## 10. 前端交互要求

ComponentKitWorkbench（`data-testid="component-kit-workbench"`）：组件 ID、
类别、状态、文字策略（`none`/`text-slot`）、最大缩放、选择资产、
`component-import`、`component-approve`。**文字策略必须与旧作组件事实一致**
（如图标/导航 `none`），否则合成器会渲染多余文字层触发 TEXT_OVERFLOW。

## 11. 合法 JSON 示例（最小可校验形态）

```json
{
  "schema_version": "2.0",
  "id": "project-component-contract",
  "version": 4,
  "status": "approved",
  "source": { "last_import": "primary-button:disabled" },
  "families": [
    {
      "id": "primary-button",
      "name": "主按钮",
      "category": "button",
      "status": "approved",
      "source": { "type": "exact-asset" },
      "reuse_mode": "exact",
      "text_policy": "text-slot",
      "intrinsic_size": [220, 64],
      "scale_policy": { "uniform_only": true, "min_scale": 1, "max_scale": 1 },
      "locked_properties": ["corner"],
      "states": {
        "default": {
          "state": "default",
          "asset_path": "style/components/primary-button/default.png",
          "asset_hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          "source_bbox": [0, 0, 220, 64],
          "alpha_channel": true,
          "intrinsic_size": [220, 64],
          "mime": "image/png"
        }
      }
    }
  ]
}
```

## 12. 非法 JSON 示例

```json
{
  "schema_version": "2.0",
  "id": "project-component-contract",
  "version": 1,
  "status": "approved",
  "source": {},
  "families": [
    {
      "id": "primary-button",
      "category": "button",
      "status": "reviewed",
      "reuse_mode": "stretch",
      "intrinsic_size": [0, 64],
      "states": { "default": { "asset_path": "style/components/primary-button/default.png" } }
    }
  ]
}
```

失败原因：`reuse_mode` 不在枚举；`intrinsic_size` 非正；default 状态缺
`asset_hash`；strict 下 button 缺 disabled/pressed 且 family 未 approved。

## 13. 存量数据兼容

Forge manifest 导入按 `component_id` 合并；已存在 family 不被覆盖
（`addForgeManifest` 过滤同 id）。逐状态导入可补状态。

## 14. 与其他契约的关系

上游：style-contract；下游：COMPONENT-BINDINGS（语义门禁的 category/状态
依据）、APPROVED-LAYOUT（slot 缩放校验）、COMPOSITION-MANIFEST（组件图层）。

## 15. 源码指针

- `electron/services/componentKit.cjs`（导入/校验/资产校验/Forge）
- `electron/services/compositor.cjs`（图层生成）、`compositionRenderer.cjs`（渲染）

## 16. 测试指针

- `electron/services/assetContracts.test.cjs`、`compositionRenderer.test.cjs`
- `tests/ui-e2e/strict-continuation.spec.ts`（含文字策略与最大缩放）

## 17. 验收清单

- [ ] golden component-contract（8 families）通过 strict 校验与资产校验
- [ ] 资产哈希改动即被合成/Fidelity 拦截
- [ ] 导入后 family 回到 reviewed 且下游 stale

## 18. 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
