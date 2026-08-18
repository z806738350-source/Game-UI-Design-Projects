# COMPONENT-BINDINGS Contract

`screens/{screen_id}/component-bindings.json` records, for every required control
of a Screen Contract, the explicitly selected Component family, state, layout
slot, text content, and font role. It is the only artifact allowed to connect a
control to a component, and every connection must pass the semantic gate defined
by `binding-policy-v1` before approval.

## 1. 概述

Component Bindings close the gap between "what a screen must contain" (Screen
Contract `required_controls`) and "which approved component renders it"
(Component Contract `families`). Implicit defaults are forbidden: there is no
`families[0]` fallback anywhere in the pipeline. A control without an explicit
component selection fails validation with `BINDING_COMPONENT_NOT_SELECTED`.

## 2. Artifact 标识与存储

| 项 | 值 |
| --- | --- |
| kind | `component-bindings` |
| 存储路径 | `screens/{screen_id}/component-bindings.json` |
| schema_version | `2.0` |
| 作用域 | 每个 Screen 一份 |
| 生成阶段 | `component_binding` |

## 3. Schema 字段表

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schema_version` | string | 是 | 固定 `2.0` |
| `id` | string | 是 | `{screen_id}-component-bindings` |
| `version` | number | 是 | 单调递增，由 `updateArtifact` 维护 |
| `status` | enum | 是 | `draft` / `generated` / `reviewed` / `approved` / `stale` / `rejected` |
| `source` | object | 是 | 来源记录；编辑时追加 `edited_by: 'ui-designer'` |
| `bindings` | array | 是 | 绑定数组，见下 |
| `coverage` | object | 是 | 由后端 `withCoverage` 计算，客户端传入值会被覆盖 |
| `approved_at` | string | 批准后 | ISO 时间戳，仅 `approveArtifact` 写入 |
| `approval` | object | 批准后 | `{ approved_at, approved_by: 'ui-designer', validation_version: 'binding-policy-v1' }`，仅后端写入 |

### 3.1 单条 Binding 字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `control_id` | string | 是 | 对应 Screen Contract 控件 id，唯一 |
| `component_id` | string | 是 | 显式选择的 family id；为空即 `BINDING_COMPONENT_NOT_SELECTED` |
| `state` | string | 是 | family 真实存在的状态名（如 `default`） |
| `slot_id` | string | 是 | Approved Layout slot id |
| `text` | string | 否 | 文本层内容 |
| `font_role` | string | 否 | 必须同时被角色策略允许且存在于 Font Manifest `roles` |
| `approved` | boolean | — | **后端事实**。客户端传入值在 `updateArtifact` 被强制剥离为 `false`；仅 `approveArtifact` 校验通过后置 `true` |

## 4. Control Role 策略（binding-policy-v1）

冻结于 `electron/services/controlRolePolicy.cjs`（`CONTROL_ROLE_POLICIES`，
`Object.freeze`）。每个角色定义 `allowed_categories`、`required_states`、
`allowed_font_roles`。修改策略必须升 `BINDING_POLICY_VERSION` 并同步本文档。

## 5. 语义兼容矩阵

| Control Role | allowed_categories | required_states | allowed_font_roles |
| --- | --- | --- | --- |
| `primary-action` | button | default, pressed, disabled | button-label |
| `secondary-action` | button | default, disabled | button-label |
| `navigation` | navigation | default, selected, disabled | navigation-label |
| `tab` | tab | default, selected, disabled | tab-label |
| `resource` | resource-bar | default | numeric, body |
| `icon-action` | icon | default | （不使用文字层） |
| `status-badge` | status-badge, page-specific | default | caption, numeric |
| `list-row` | list-row, page-specific | default | body |
| `content-panel` | content-panel, page-specific | default | （不使用文字层） |
| `action`（legacy） | button, navigation, tab, icon | default | button-label, navigation-label, tab-label, body, caption, numeric |

`action` 是 `normalizeControls` 对无 role 旧数据的默认值，被显式收编为宽松
角色，避免存量项目 fail-closed 误伤；新控件应声明具体角色。

## 6. 批准与信任模型

- `updateArtifact('component-bindings')`：剥离客户端 `approval` 字段，把每条
  binding 的 `approved` 强制为 `false`。客户端永远无法把绑定写为已批准。
- `approveArtifact('component-bindings')`：以
  `{ strict }`（strict = `existing-strict` / `locked-continuation`）执行
  `withCoverage` + `validateBindings` 全量校验；任何 error 抛出
  `BINDING_COVERAGE_INCOMPLETE` 并拒绝批准。全部通过后由后端 stamp：
  每条 binding `approved: true`，artifact 级
  `approval: { approved_at, approved_by: 'ui-designer', validation_version: 'binding-policy-v1' }`。

## 7. 状态机

```
draft/generated ──updateArtifact──▶ reviewed ──approveArtifact(校验通过)──▶ approved
      ▲                                │  ▲                                   │
      │                                │  └──approveArtifact(校验失败)────────┤
      └────────────── stale ◀──────────┴─────────── 上游变化 ◀───────────────┘
```

## 8. Stale 传播

- 上游：`screen-contract`（语义变化时）、`component-contract`、
  `font-manifest`、`approved-layout` 失效均会使 bindings stale
  （`artifactDependencies.cjs`）。
- 下游：bindings 失效会级联到 `composition-manifest` 等合成链。
- **Label-only 编辑不失效**：`updateArtifact('screen-contract')` 用
  `controlsSemanticSignature`（仅比较 `id`/`role`/`required`）判断
  `required_controls` 是否语义变化；仅改 `label` 不触发 stale，改
  `role`/`required`/`id` 触发。

## 9. 错误码

| 错误码 | 触发条件 |
| --- | --- |
| `BINDING_COMPONENT_NOT_SELECTED` | binding 未显式选择 component_id |
| `BINDING_COMPONENT_NOT_APPROVED` | 所选 family `status !== 'approved'` |
| `BINDING_COMPONENT_STATE_MISSING` | binding state 不存在，或 family 缺少角色 required_states |
| `BINDING_COMPONENT_CATEGORY_MISMATCH` | family.category 与控件角色不兼容 |
| `BINDING_FONT_ROLE_MISMATCH` | font_role 不在角色策略允许列表 |
| `BINDING_FONT_ROLE_MISSING` | font_role 不在 Font Manifest `roles` 中 |
| `BINDING_UNKNOWN_CONTROL_ROLE` | 未知角色；strict 模式报错，guided 模式仅 warning |
| `BINDING_COVERAGE_INCOMPLETE` | `approveArtifact` 时存在任一校验 error |

## 10. strict 与 guided 模式

- `existing-strict` / `locked-continuation`：未知 control role 报错
  （fail-closed），全部语义检查阻断保存后的批准。
- `existing-guided` / `exploration`：未知 role 仅产生 warning，语义兼容检查
  仍执行并在批准时阻断。

## 11. 前端交互要求

`src/features/strict-continuation/StrictContinuationPanel.tsx`：

- 组件下拉初始为空（"请选择组件（必选）"），不存在隐式首项回退；
- 未为全部必填控件选择组件时保存按钮禁用；
- 与控件角色语义不兼容的 family 禁用并展示原因；
- state 下拉来自所选 family 的真实 `states`；font_role 下拉为角色策略
  `allowed_font_roles` ∩ Font Manifest roles；`allowed_font_roles` 为空时提示
  该角色不使用文字层；
- 提交 payload 不携带 `approved`/`approval`。

## 12. 合法 JSON 示例

```json
{
  "schema_version": "2.0",
  "id": "main-component-bindings",
  "version": 3,
  "status": "approved",
  "source": {},
  "bindings": [
    {
      "control_id": "save",
      "component_id": "button.primary",
      "state": "default",
      "slot_id": "bottom",
      "text": "保存",
      "font_role": "button-label",
      "approved": true
    }
  ],
  "coverage": { "required_controls": 1, "bound_required_controls": 1, "unbound_required_controls": [] },
  "approved_at": "2026-08-19T00:00:00.000Z",
  "approval": { "approved_at": "2026-08-19T00:00:00.000Z", "approved_by": "ui-designer", "validation_version": "binding-policy-v1" }
}
```

## 13. 非法 JSON 示例（及拒绝原因）

```json
{
  "bindings": [
    { "control_id": "save", "component_id": "", "slot_id": "bottom", "approved": true },
    { "control_id": "nav", "component_id": "button.primary", "state": "default", "slot_id": "top" }
  ],
  "approval": { "approved_by": "client" }
}
```

- 第一条：`component_id` 为空 → `BINDING_COMPONENT_NOT_SELECTED`；客户端
  `approved: true` 被剥离，不产生任何批准效果。
- 第二条：控件角色 `navigation` 绑定 `button` category →
  `BINDING_COMPONENT_CATEGORY_MISMATCH`。
- artifact 级 `approval` 由客户端伪造 → `updateArtifact` 直接删除该字段。

## 14. 存量数据兼容

- 无 role 的旧控件经 `normalizeControls` 归一为 `action`，按第 5 节 legacy
  行宽松校验，不会被 `BINDING_UNKNOWN_CONTROL_ROLE` 误伤。
- 旧绑定的 `approved: true` 客户端写入值在下次 `updateArtifact` 时被重置为
  `false`；必须通过 `approveArtifact` 重新获得批准。

## 15. 与其他契约的关系

| 契约 | 关系 |
| --- | --- |
| SCREEN-CONTRACT | 提供 `required_controls`（id/role/required/label） |
| COMPONENT-CONTRACT | 提供可选 families（category/status/states） |
| FONT-MANIFEST | 提供 font roles；font-manifest 失效级联到 bindings |
| APPROVED-LAYOUT | 提供 slot_id |
| COMPOSITION-MANIFEST | 消费已批准 bindings 执行最终合成 |

## 16. 源码指针

- `electron/services/controlRolePolicy.cjs` — 冻结角色策略与版本
- `electron/services/componentBindings.cjs` — `validateBindings` / `withCoverage` / `controlRoles`
- `electron/services/designPipeline.cjs` — `updateArtifact`（approved 剥离）、`approveArtifact`（批准 stamp）、`controlsSemanticSignature`（label-only）
- `electron/services/artifactDependencies.cjs` — stale 依赖图（font-manifest → component-bindings）
- `electron/services/compositor.cjs` — 合成前 strict 门禁调用点
- `src/features/strict-continuation/StrictContinuationPanel.tsx` — 显式选择 UI

## 17. 测试指针

- `electron/services/componentBindings.test.cjs` — 审核者 11 项场景（隐式默认
  拒绝、语义错配、approved 忽略、font role 缺失/错配、未知 role strict vs
  warning、font-manifest 下游失效等）
- `electron/services/designPipeline.test.cjs` — 管线级 approved 不信任、批准
  stamp、语义错配阻断批准、label-only 不 stale / role 变化 stale
- `electron/services/bindingsLayout.test.cjs` — 覆盖率与 label-only 失效行为

## 18. 验收清单

- [ ] 任何代码路径不存在 `families[0]` 隐式回退
- [ ] 客户端 `approved`/`approval` 写入后保存的 artifact 中均为 `false`/不存在
- [ ] 语义错配时 `approveArtifact` 抛 `BINDING_COVERAGE_INCOMPLETE`
- [ ] label-only 修改不 stale；role/required/id 修改 stale
- [ ] strict 模式未知 role 报错，guided 模式仅 warning
- [ ] `binding-policy-v1` 冻结对象不可变（`Object.freeze`）

## 19. 版本与变更记录

| 策略版本 | 变更 |
| --- | --- |
| `binding-policy-v1` | 初版：REM-01 整改落地（显式选择、语义门禁、批准事实化、label-only 不失效、font-manifest 依赖边） |
