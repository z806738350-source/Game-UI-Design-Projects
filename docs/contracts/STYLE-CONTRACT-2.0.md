# STYLE-CONTRACT-2.0 Contract

`style/style-contract.json` 是风格解析阶段（`style_resolution`）产出的可执行
风格契约。2.0 schema 的核心约束：**拒绝一切模糊自然语言风格值**，所有数值
必须是带单位边界的 JSON number。

## 1. 概述

Style Contract 由路线风格基线（style_basis）与已批准参考图集驱动生成：
strict 路线基线为已批准 Screen Contract，exploration/guided 路线基线为
已批准布局；基线记录在 `source.style_basis`。批准（锁定）前必须通过
`validateStyleContract` 的可执行值校验。它是字体、组件、视觉生成与
合成的共同风格基准。

## 2. Artifact 标识与存储

| 项 | 值 |
| --- | --- |
| kind | `style-contract` |
| 存储路径 | `style/style-contract.json`（全局，跨 Screen 共享） |
| schema_version | `2.0` |
| 作用域 | 项目全局（`GLOBAL_ARTIFACTS`） |
| 生成阶段 | `style_resolution` |

## 3. Schema 字段表

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `style_id` | string | 是 | 稳定风格 id |
| `visual_identity` | object | 是 | theme/fidelity/source 描述 |
| `colors` | object | 是 | 语义角色→hex；`primary`/`surface`/`text` 必填，hex 3/6/8 位 |
| `typography` | object | 是 | 角色→可执行排版定义；`display`/`body` 必填 |
| `geometry` | object | 是 | `corner_language`（sharp/beveled/beveled-soft/rounded/notched/mixed）、`corner_radius`（0–128 px 整数）、`density`（functional/balanced/sparse/hero） |
| `lighting` | object | 是 | `treatment`（非空具体描述）、`light_direction`（top/top-left/…/ambient 九选一）、可选 `intensity`（0–1） |
| `composition` | object | 是 | 非空；数值型权重必须 0–1 |
| `components` | object | 是 | 非空，family 与状态描述 |
| `materials` | string[] | 是 | 非空，具体材质描述 |
| `reference_ids` | string[] | 是 | 参考图引用 |
| `negative_style_constraints` | string[] | 否 | 禁止项；唯一豁免模糊词扫描的根级字段 |
| `quality_checks` | object | 管线写入 | `functional_load` 与密度矛盾警告 |

`typography` 角色定义（每个角色）：`size`（6–256 整数 px）、`weight`（100–900
整数）、`letter_spacing`（-8–64 px）、`line_height`（0.7–3 比值）、`fill`（hex），
可选 `numeric_style`（tabular/lining/oldstyle）、`stroke`（width 0–32 px + hex）、
`shadow`（blur 0–64、offset_x/y ±64 px + hex）。

## 4. 可执行值规则（领域策略）

`styleContractSchema.cjs`：

- 数字型字符串（如 `"24px"`）被拒绝，必须写 JSON number；
- 模糊词黑名单扫描全部字符串值（高级/轻奢、适当/大致、稍微/尽量、质感/氛围、
  大气/美观、premium/high-end、appropriate/somewhat、subtle/elegant、
  nice/beautiful），命中即失败；仅根级 `negative_style_constraints` 豁免；
- 所有颜色必须 hex。

## 5. 批准与信任模型

`approveArtifact('style-contract')` 会先 `validateArtifact`（含可执行值校验），
失败抛 `STYLE_CONTRACT_INVALID`；通过则写入 `status='approved'` 与 `locked_at`
（锁定语义：下游生成引用锁定版本）。

## 6. 状态机

`generated` → `reviewed`（编辑）→ `approved`（锁定）→ `stale`。

## 7. Stale 传播

上游触发：`input-art-direction`、`input-project-type`、`input-continuation-mode`、
`reference-inventory`、`reference-pack` 变化，或自身重新生成/编辑。
下游：`font-manifest`、`component-contract`、`layout-proposals`、
`underlay-contract`、`visual-task`（传递闭包至 composition/fidelity）。
作为全局 artifact，stale 作用于全部 Screen。

## 8. 错误码

| 错误码 | 场景 |
| --- | --- |
| `STYLE_CONTRACT_INVALID` | 批准时未通过可执行值校验 |
| `REFERENCE_OMISSIONS_CONFIRMATION_REQUIRED` | 生成时参考图超容量需确认省略项 |

## 9. strict 与 guided 模式（路线与风格基线）

- strict/locked：基线恒为已批准 Screen Contract（布局可后补，Style
  变化不会反向使布局 stale）；旧项目（`project_type='existing'`）
  至少需要一张已批准参考页。
- exploration/guided：基线恒为已批准布局；风格分析只能由风格页面
  的显式按钮触发，进入阶段不会自动分析。
- `source.style_basis` 形如 `{ kind, id, screen_id }`，kind 为
  `screen-contract` 或 `approved-layout`。
- 模式切换使 style-contract stale（`input-continuation-mode` 是其上游）。

## 10. 前端交互要求

StyleWorkspace（`src/features/style/`）：生成（`style-generate`）、批准
（`style-approve`，stale 状态下不渲染批准按钮，须重新生成）、编辑
（`style-edit-save`）。stale 提示展示 `stale_reason`。

## 11. 合法 JSON 示例（最小可校验形态）

```json
{
  "schema_version": "2.0",
  "id": "project-style-contract",
  "version": 1,
  "status": "approved",
  "source": { "style_basis": { "kind": "approved-layout", "id": "main-approved-layout-v1", "screen_id": "main" } },
  "style_id": "locked-style",
  "visual_identity": { "theme": "dark-gold", "fidelity": "strict-continuation", "source": "approved-reference-pages" },
  "colors": { "primary": "#d6b05f", "surface": "#173b46", "text": "#fff7d6" },
  "typography": {
    "display": { "size": 42, "weight": 700, "letter_spacing": 0, "line_height": 1.2, "fill": "#fff7d6" },
    "body": { "size": 16, "weight": 400, "letter_spacing": 0, "line_height": 1.5, "fill": "#fff7d6" }
  },
  "geometry": { "corner_language": "beveled-soft", "corner_radius": 8, "density": "functional" },
  "lighting": { "treatment": "顶部定向主光叠加边缘金色高光", "light_direction": "top", "intensity": 0.7 },
  "composition": { "hierarchy": "wireframe-locked", "focal_weight": 0.8 },
  "components": { "families": ["primary-button"], "states": ["default", "pressed", "disabled"] },
  "materials": ["磨砂金属面板", "半透明深色玻璃底"],
  "reference_ids": ["ref-1"],
  "negative_style_constraints": ["不使用霓虹渐变"]
}
```

## 12. 非法 JSON 示例

```json
{
  "schema_version": "2.0",
  "id": "project-style-contract",
  "version": 1,
  "status": "generated",
  "source": {},
  "style_id": "bad-style",
  "visual_identity": { "theme": "高级感金色" },
  "colors": { "primary": "gold", "surface": "#173b46", "text": "#fff7d6" },
  "typography": {
    "display": { "size": "42px", "weight": 700, "letter_spacing": 0, "line_height": 1.2, "fill": "#fff7d6" }
  },
  "geometry": { "corner_language": "随意", "corner_radius": 8, "density": "balanced" },
  "lighting": { "treatment": "", "light_direction": "center" },
  "composition": {},
  "components": {},
  "materials": [],
  "reference_ids": []
}
```

失败原因：`theme` 含模糊词"高级感"；`colors.primary` 非 hex；`typography` 缺
`body` 且 `size` 是字符串；`corner_language`/`light_direction` 不在枚举；
`composition`/`components`/`materials` 为空。

## 13. 存量数据兼容

1.0 风格文档中的模糊描述在升级到 2.0 后无法通过批准校验；整改路径是重新
生成或人工改写为可执行值（见 docs/dev/MIGRATION-ROLLBACK.md）。

## 14. 与其他契约的关系

上游：reference-pack、style_basis（strict 为 screen-contract，
exploration/guided 为 approved-layout）；下游：strict 为 FONT-MANIFEST、
COMPONENT-CONTRACT、layout-proposals、UNDERLAY-CONTRACT、visual-task 与
合成提示词；exploration/guided 仅 visual-task（不回指布局）。

## 15. 源码指针

- 校验：`electron/services/styleContractSchema.cjs`、`contracts.cjs`
- 生成：`designPipeline.cjs`（`runStageUnsafe('style_resolution')`）

## 16. 测试指针

- `electron/services/assetContracts.test.cjs`、`contracts.test.cjs`
- `tests/ui-e2e/failure-paths.spec.ts`（语义编辑 → stale → 重批链路）

## 17. 验收清单

- [ ] golden `style-contract.json` 通过 `validateStyleContract`
- [ ] 模糊词/数字字符串/非法枚举全部被拒绝
- [ ] stale 后无批准按钮，须重新生成

## 18. 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
