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
| `coverage` | object | 是 | `covered_items`、`uncovered_items` 两个数组；uncovered 是审查期留痕差异，不作门禁 |

`required_controls[]` 元素（`screenControls.cjs:normalizeControls` 归一化）：
`id`（kebab-case 稳定 id，唯一）、`label`（非空）、`role`（非空，缺省归一为
`action`）、`required`（boolean，缺省 true）。字符串形式的旧数据会被迁移为
`{ id, label, role, required, migrated_from_label }`。

## 4. 覆盖校验（生成期门禁 + 审查期留痕）

覆盖超集约束分阶段生效（设计师权威语义：用户才是界面控件判定最准确的，
「功能解读」阶段的调整结果是准确答案）：

- **生成期门禁**（`coverageGateErrors`，仅 kunpoClient 草稿修复循环使用）：
  判定完全基于服务端重算（`recomputeCoverage`）——
  `source_inventory.requirement_functions + wireframe_controls` 的每一项必须被
  `required_controls` 标签或 `secondary_actions` 语义覆盖；
  `wireframe_information` 的每一项必须被 `required_information` 覆盖——保证
  「功能解读」的起点完整。**不读取模型自报的 `coverage`**（M4-I3）：
  模型不得通过自填 `covered_items` 自我声明已覆盖而不产出真实控件，
  伪造覆盖的草稿必须带着 `missing source items` 反馈进入修复轮；
- **审查期留痕**：保存/批准/快照按当前 `source_inventory` 用 `recomputeCoverage`
  重算覆盖差异并写回，工作台如实展示未保留项，但**不拦截批准**；
- 覆盖匹配采用中文语义词匹配（`semanticTerms`：去控件类后缀、长度≥2 的词必须全部出现）；
- `validateArtifact('screen-contract')` 仅做结构校验（coverage 形状与两个数组
  必须存在），不再以 `uncovered_items` 非空拦截。

## 5. 批准与信任模型

- 批准动作：`approveArtifact(kind='screen-contract')`。批准即完整确定性
  结构重验：不信任契约体内存储的 coverage——归一化全部字段、按当前
  `source_inventory` 重算 coverage（留痕写回）、重跑控件/角色/required
  结构校验；通过后写入 `status='approved'` 与 `approved_at`，失败抛
  `SCREEN_CONTRACT_APPROVAL_INVALID` 且不改变状态。**覆盖差异不拦截
  批准**——设计师在「功能解读」阶段的调整结果是准确答案，AI 盘点
  清单的超集约束仅作用于生成期。
- 编辑：`updateArtifact` 允许直接编辑；变化按四类显式分类（M4-J1，唯一
  权威来源 `SCREEN_CONTRACT_SEMANTIC_KEYS`/`SCREEN_CONTRACT_REVIEW_ONLY_KEYS`）：
  - **semantic**：`screen_name/purpose/primary_action/secondary_actions/required_information/states/edge_cases/data_dependencies/design_constraints`
    变化，或 `required_controls` 的 `{ id, role, required }` 语义签名变化——
    按路线依赖图完整传播失效，契约降级 `reviewed` 并清除旧
    `approved_at`/`approval` 印记；
  - **label-only**：`required_controls` 仅 label 变化——**不使绑定 stale**，
    但已产出的交付链（composition → output → fidelity）失效重建，且合成时
    最终文字的事实源是当前契约的 `label`，不是 Binding 里冻结的旧文本
    （AUD-09）；
  - **review-only**：仅 `review_metadata` 变化——只记录审查进度，**不失效
    任何生产 Artifact**（M4-J1，审核 §9）；
  - **noop**：允许字段经规范化后完全无变化——不升版本、不写文件、不动
    Workflow、不失效下游。
- 编辑字段边界（M4-I2，设计师权威语义的证据前提）：设计师可编辑字段为
  `screen_name/purpose/primary_action/secondary_actions/required_controls/required_information/states/edge_cases/data_dependencies/design_constraints/review_metadata`；
  系统身份与证据字段（`id`、`screen_id`、`schema_version`、`version`、
  `generation_id`、`content_hash`、`source`、`source_inventory`、`coverage`、
  `status`、`approved_at`、`stale_at`、`stale_reason`）由系统控制，通用
  PATCH 携带时**静默忽略**（UI 全量保存携带的值不变系统字段不受影响）；
  仅含系统字段的 PATCH 是整体 no-op——但判定发生在 Screen 上下文校验
  （存在性与 Active）之后（M4-J1，审核 §10），不改变任何 Artifact 与
  Workflow。
  `source_inventory` 只能由 Wireframe/Requirement 重新解析更新；`coverage`
  永远由后端重算——原始盘点不可被编辑覆盖，留痕差异才可信。
- 保存与快照同一事实来源：`updateArtifact` 保存 screen-contract 时一律
  归一化 + 重算 coverage（留痕，非门禁）+ 结构重验，畸形编辑在失效
  下游之前被拒（失败原子性）；快照（`projectStore.open`）打开时同样
  重算，工作台覆盖条如实以留痕态列出「本轮契约未保留」的来源条目，
  但不禁用批准——历史项目残留的草稿期“全覆盖” coverage 不得透传成
  假绿灯，也不得反过来拦截设计师的正当调整。

## 6. 状态机

`generated`（模型产出落盘）→ `reviewed`（人工编辑后）→ `approved`（批准）→
`stale`（上游输入或自身语义编辑触发）。`rejected` 由显式编辑设置。

## 7. Stale 传播

- 上游：`input-requirement`、`input-wireframe` 变化 → screen-contract stale。
- 自身重新生成：`runStage('wireframe_interpretation')` 先
  `invalidateArtifacts('screen-contract')`，下游全部 stale。
- 下游（`artifactDependencies.cjs`）：`component-bindings`、`layout-proposals`；
  strict 路线额外包括 `style-contract`（风格基线是已批准契约，AUD-01），
  并传递至 approved-layout → underlay → composition → fidelity 全链。
- 模式切换（guided↔strict）**不影响** screen-contract（路线切换只重置
  生产链资产）。

## 8. 错误码

| 错误码 | 场景 |
| --- | --- |
| `SCREEN_ID_REQUIRED` / `SCREEN_NOT_FOUND` / `SCREEN_CONTEXT_MISMATCH` | Screen 上下文校验失败 |
| `SCREEN_CONTRACT_COVERAGE_INCOMPLETE` | 历史码（AUD-06 时期批准时重算 coverage 发现未覆盖项即抛出）；设计师权威语义后覆盖差异不再拦截批准，保留以兼容历史执行日志 |
| `SCREEN_CONTRACT_APPROVAL_INVALID` | 批准/保存时结构重验失败（归一化、控件/角色/required 校验） |
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
- `electron/services/screen-contract-approval.test.cjs`（AUD-06 批准重算
  coverage 负向回归）
- `electron/services/label-render-source.test.cjs`（AUD-09 最终文字事实源）
- `electron/services/migrations.test.cjs`（AUD-13 Screen Clone 完整 lineage）
- `tests/ui-e2e/failure-paths.spec.ts`（契约编辑 → stale 传播）

## 17. 验收清单

- [ ] `validateArtifact` 对 golden `screen-contract.json` 零错误
- [ ] label-only 编辑不触发绑定 stale；role/required 编辑触发
- [ ] 批准时重算 coverage：删掉必需控件后批准被拒绝（AUD-06）
- [ ] 批准后 `approved_at` 落盘

## 18. 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.1 | 2026-08-23 | PR-36~38：批准即完整重验（AUD-06）、label 事实源与交付链失效（AUD-09）、strict 下游补 style-contract（AUD-01）、clone lineage 测试指针（AUD-13） |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
