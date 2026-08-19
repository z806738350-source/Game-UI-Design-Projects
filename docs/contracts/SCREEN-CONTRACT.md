# SCREEN-CONTRACT Contract

`screens/{screen_id}/screen-contract.json` 是线框解释阶段
（`wireframe_interpretation`）产出的功能契约：它把一个 Screen 必须承载的
控件、信息、状态与边界情形固定为结构化事实，是后续绑定与布局的覆盖基准。

## 1. 概述

Screen Contract 回答"这个界面必须有什么"。模型基于需求文本 + UE 线框图
生成，必须把 `source_inventory` 中列出的全部来源项覆盖进
`required_controls`/`required_information`，否则校验失败。

## 2. Artifact 标识与存储

| 项 | 值 |
| --- | --- |
| kind | `screen-contract` |
| 存储路径 | `screens/{screen_id}/screen-contract.json` |
| schema_version | `2.0` |
| 作用域 | 每个 Screen 一份 |
| 生成阶段 | `wireframe_interpretation` |

## 3. Schema 字段表

通用字段（全部 artifact 共有，见第 15 节源码指针 `contracts.cjs:commonErrors`）：
`schema_version`（非空字符串）、`id`（非空字符串）、`version`（正整数）、
`status`（合法状态，见第 7 节）、`source`（对象）。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `screen_id` | string | 是 | Screen 稳定 id |
| `screen_name` | string | 是 | 展示名 |
| `purpose` | string | 是 | 页面目标 |
| `primary_action` | string | 是 | 首要操作 |
| `secondary_actions` | string[] | 是 | 次要操作清单 |
| `required_information` | string[] | 是 | 必须展示的信息清单 |
| `required_controls` | object[] | 是 | 控件清单，元素见下 |
| `states` | string[] | 是 | 页面状态清单 |
| `edge_cases` | string[] | 是 | 边界情形清单 |
| `data_dependencies` | string[] | 是 | 数据依赖清单 |
| `design_constraints` | object | 是 | 画布/密度等约束 |
| `source_inventory` | object | 是 | 含 `requirement_functions`、`wireframe_controls`、`wireframe_information` 三个数组 |
| `coverage` | object | 是 | `covered_items` 数组；`uncovered_items` 必须为空数组 |

`required_controls[]` 元素（`screenControls.cjs:normalizeControls` 归一化）：
`id`（kebab-case 稳定 id，唯一）、`label`（非空）、`role`（非空，缺省归一为
`action`）、`required`（boolean，缺省 true）。字符串形式的旧数据会被迁移为
`{ id, label, role, required, migrated_from_label }`。

## 4. 覆盖校验（领域策略）

`validateArtifact('screen-contract')` 除结构校验外还做语义覆盖检查：

- `source_inventory.requirement_functions + wireframe_controls` 的每一项必须被
  `required_controls` 标签、`secondary_actions` 或 `coverage.covered_items` 语义覆盖；
- `source_inventory.wireframe_information` 的每一项必须被
  `required_information` 或 `covered_items` 覆盖；
- 覆盖采用中文语义词匹配（`semanticTerms`：去控件类后缀、长度≥2 的词必须全部出现）；
- `coverage.uncovered_items` 非空直接失败。

## 5. 批准与信任模型

- 批准动作：`approveArtifact(kind='screen-contract')`，仅写入
  `status='approved'` 与 `approved_at`，无附加门禁（内容校验在生成时完成）。
- 编辑：`updateArtifact` 允许直接编辑；只有语义键
  （`screen_name/purpose/primary_action/required_controls/required_information/states/edge_cases`）
  变化才触发失效传播。`required_controls` 的语义签名只比较
  `{ id, role, required }`——**仅改 label 不会使绑定 stale**。

## 6. 状态机

`generated`（模型产出落盘）→ `reviewed`（人工编辑后）→ `approved`（批准）→
`stale`（上游输入或自身语义编辑触发）。`rejected` 由显式编辑设置。

## 7. Stale 传播

- 上游：`input-requirement`、`input-wireframe` 变化 → screen-contract stale。
- 自身重新生成：`runStage('wireframe_interpretation')` 先
  `invalidateArtifacts('screen-contract')`，下游全部 stale。
- 下游（`artifactDependencies.cjs`）：`component-bindings`、`layout-proposals`，
  并传递至 approved-layout → underlay → composition → fidelity 全链。
- 模式切换（guided↔strict）**不影响** screen-contract。

## 8. 错误码

| 错误码 | 场景 |
| --- | --- |
| `SCREEN_ID_REQUIRED` / `SCREEN_NOT_FOUND` / `SCREEN_CONTEXT_MISMATCH` | Screen 上下文校验失败 |
| `BINDING_COVERAGE_INCOMPLETE` | 契约控件变化后绑定未重新批准即做 strict 布局 |

## 9. strict 与 guided 模式

两种模式都要求 Screen Contract 生成与批准；strict 布局额外要求字体、组件、
绑定先行批准（见 APPROVED-LAYOUT 契约）。模式切换不使契约失效。

## 10. 前端交互要求

- ContractWorkspace（`src/features/contracts/`）展示全部字段并允许编辑；
- 编辑后必须重新批准；`data-testid="contract-workspace"`。

## 11. 合法 JSON 示例（最小可校验形态）

```json
{
  "schema_version": "2.0",
  "id": "main-screen-contract",
  "version": 1,
  "status": "approved",
  "source": { "wireframe": "inputs/wireframe.png" },
  "screen_id": "main",
  "screen_name": "主页面",
  "purpose": "完成核心操作",
  "primary_action": "primary",
  "secondary_actions": ["返回"],
  "required_information": ["资源数量"],
  "required_controls": [
    { "id": "primary-action", "label": "主操作按钮", "role": "primary-action", "required": true }
  ],
  "states": ["default"],
  "edge_cases": ["长文本"],
  "data_dependencies": ["player-resources"],
  "design_constraints": { "canvas": [1024, 1024] },
  "source_inventory": {
    "requirement_functions": ["主操作按钮"],
    "wireframe_controls": ["主操作按钮"],
    "wireframe_information": ["资源数量"]
  },
  "coverage": { "covered_items": ["主操作按钮", "资源数量"], "uncovered_items": [] }
}
```

## 12. 非法 JSON 示例

```json
{
  "schema_version": "2.0",
  "id": "main-screen-contract",
  "version": 1,
  "status": "approved",
  "source": {},
  "screen_id": "main",
  "screen_name": "主页面",
  "purpose": "x",
  "primary_action": "x",
  "secondary_actions": [],
  "required_information": [],
  "required_controls": [
    { "id": "Primary_Action", "label": "", "role": "", "required": "yes" }
  ],
  "states": [],
  "edge_cases": [],
  "data_dependencies": [],
  "design_constraints": {},
  "source_inventory": {
    "requirement_functions": ["能量护盾开关"],
    "wireframe_controls": [],
    "wireframe_information": []
  },
  "coverage": { "covered_items": [], "uncovered_items": ["能量护盾开关"] }
}
```

失败原因：控件 id 非 kebab-case；label/role 为空；required 非 boolean；
`uncovered_items` 非空；`能量护盾开关` 未被任何控件覆盖。

## 13. 存量数据兼容

0.2.0 前的 `required_controls` 可能是字符串数组；`normalizeControls` 将其迁移
为对象（`migrated_from_label`），默认 role `action` 在 `binding-policy-v1`
中被显式收编，不会 fail-closed。

## 14. 与其他契约的关系

- 下游：COMPONENT-BINDINGS（覆盖 `required_controls`）、APPROVED-LAYOUT
  （slots 对位控件）、UNDERLAY-CONTRACT（reserved_regions 来自布局 slots）。
- 上游：inputs（requirement/wireframe）。

## 15. 源码指针

- 校验：`electron/services/contracts.cjs`（`validateArtifact`）、
  `electron/services/screenControls.cjs`
- 生成：`electron/services/designPipeline.cjs`（`runStageUnsafe('wireframe_interpretation')`）
- 失效：`electron/services/artifactDependencies.cjs`

## 16. 测试指针

- `electron/services/contracts.test.cjs`、`electron/services/screenControls.test.cjs`
- `electron/services/continuationGuardrails.test.cjs`（label-only 不 stale）
- `tests/ui-e2e/failure-paths.spec.ts`（契约编辑 → stale 传播）

## 17. 验收清单

- [ ] `validateArtifact` 对 golden `screen-contract.json` 零错误
- [ ] label-only 编辑不触发下游 stale；role/required 编辑触发
- [ ] 批准后 `approved_at` 落盘

## 18. 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
