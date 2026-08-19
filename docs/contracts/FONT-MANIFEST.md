# FONT-MANIFEST Contract

`style/font-manifest.json` 记录项目全部字体资产与语义角色映射，是排版保真
（typography fidelity）的唯一事实来源：**字体必须真实导入、授权必须显式确认、
exact 角色必须显式确认**，不允许任何模型"想象"的字体。

## 1. 概述

Font Manifest 通过专用动作维护：`copilot:fonts:import`（导入 OTF/TTF 并落盘
哈希）与 `copilot:fonts:confirm`（授权 + exact 双重确认）。`updateArtifact`
禁止直接修改 `fonts`/`roles`。

## 2. Artifact 标识与存储

| 项 | 值 |
| --- | --- |
| kind | `font-manifest` |
| 存储路径 | `style/font-manifest.json`（全局） |
| schema_version | `2.0` |
| 字体文件 | `style/fonts/{id}.otf|ttf` |
| 生成阶段 | `typography_resolution` |

## 3. Schema 字段表

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fonts` | array | 是 | 字体资产列表，元素见下，至少 1 个 |
| `roles` | object | 是 | roleId → 角色定义 |

`fonts[]` 元素：`id`、`family_name`、`postscript_name`（从字体 name 表解析，
二者必填）、`local_path`、`file_hash`（`sha256:` + 64 hex）、`byte_length`、
`format`（otf/ttf，WOFF 禁用）、`license_status`（unresolved/confirmed）、
`license_confirmation`（`{ confirmed, confirmed_by, confirmed_at }`）、
`coverage`（`zh_cn/latin/digits/symbols` 布尔，来自 cmap 解析）。

`roles[roleId]`：`font_id`（必须存在于 fonts）、`fidelity_mode`（exact/…）、
`identity_critical`（boolean）、`required_coverage`（coverage key 列表）、
`exact_confirmation`（`{ confirmed, confirmed_by, confirmed_at }`）。

## 4. 校验规则（领域策略）

`validateFontManifest(manifest, { strict })`（`typographyAssets.cjs`）：

- fonts 非空；每个字体具备 id/local_path/合法哈希/家族与 PostScript 身份/
  支持格式；`license_status` 必须 `confirmed` 且有确认证据；
- 每个 role 引用的 font 必须存在；`required_coverage` 必须被字体 cmap 覆盖；
- strict：`identity_critical` 角色必须 `fidelity_mode='exact'`；exact 角色必须
  有 `exact_confirmation.confirmed === true`。

批准时（`approveArtifact('font-manifest')`）以 `strict: true` 校验，失败抛
`FONT_MANIFEST_INVALID`（错误消息为校验明细）。

## 5. 批准与信任模型

- 导入：每次导入使 manifest 降级为 `reviewed` 并使下游 stale；
- 确认：`confirmFontUsage` 要求 `licenseConfirmed === true` 与
  `exactConfirmed === true`，否则分别抛
  `FONT_LICENSE_CONFIRMATION_REQUIRED` / `FONT_EXACT_CONFIRMATION_REQUIRED`；
- 批准：全量 strict 校验通过后写 `approved` + `approved_at`。

## 6. 状态机

`draft`（未导入）→ `reviewed`（导入/确认后）→ `approved` → `stale`。

## 7. Stale 传播

- 上游：style-contract stale → font-manifest stale（全局）。
- 自身：导入新字体、确认角色均触发 `invalidateArtifacts('font-manifest')`。
- 下游（PR-15 起）：`component-bindings`、`composition-manifest`。

## 8. 错误码

| 错误码 | 场景 |
| --- | --- |
| `FONT_LICENSE_CONFIRMATION_REQUIRED` | 确认时未勾选授权 |
| `FONT_EXACT_CONFIRMATION_REQUIRED` | 确认时未勾选精确使用 |
| `FONT_CONFIRMATION_ACTION_REQUIRED` | 用 updateArtifact 改 fonts/roles |
| `FONT_ASSET_HASH_MISMATCH` | 字体文件被改动（渲染/预览/检查时重哈希） |
| `FONT_ACTUAL_LOAD_FAILED` | 排版渲染加载字体失败 |
| `FONT_MANIFEST_REQUIRED` | strict 布局前置缺失 |

相关 Fidelity 检查码：`TYPOGRAPHY_GATE_FAILED`、`UNRESOLVED_IDENTITY_FONT`、
`FONT_RENDER_NOT_VERIFIED`、`FONT_RENDER_HASH_MISMATCH`、
`FONT_RENDER_FAMILY_MISMATCH`（见 ERROR-CATALOG）。

## 9. strict 与 guided 模式

strict/locked：strict 校验（identity-critical 必须 exact）；guided：非 strict
校验（授权仍必须确认）。strict 布局生成前置要求 manifest 已批准。

## 10. 前端交互要求

TypographyWorkbench（`data-testid="typography-workbench"`）：字体 id、
覆盖范围（`font-coverage`）、两个确认勾选、选择字体（系统文件对话框）、
按角色逐个 `font-confirm`、最后 `font-approve`。

## 11. 合法 JSON 示例（最小可校验形态）

```json
{
  "schema_version": "2.0",
  "id": "project-font-manifest",
  "version": 3,
  "status": "approved",
  "source": { "last_import": "oxanium", "last_confirmation": "oxanium:button-label" },
  "fonts": [
    {
      "id": "oxanium",
      "family_name": "Oxanium",
      "postscript_name": "Oxanium-Regular",
      "local_path": "style/fonts/oxanium.ttf",
      "file_hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      "byte_length": 100000,
      "format": "ttf",
      "license_status": "confirmed",
      "license_confirmation": { "confirmed": true, "confirmed_by": "ui-designer", "confirmed_at": "2026-08-19T00:00:00.000Z" },
      "coverage": { "zh_cn": false, "latin": true, "digits": true, "symbols": true }
    }
  ],
  "roles": {
    "button-label": {
      "font_id": "oxanium",
      "fidelity_mode": "exact",
      "identity_critical": true,
      "required_coverage": ["latin"],
      "exact_confirmation": { "confirmed": true, "confirmed_by": "ui-designer", "confirmed_at": "2026-08-19T00:00:00.000Z" }
    }
  }
}
```

## 12. 非法 JSON 示例

```json
{
  "schema_version": "2.0",
  "id": "project-font-manifest",
  "version": 1,
  "status": "approved",
  "source": {},
  "fonts": [
    { "id": "oxanium", "family_name": "Oxanium", "local_path": "style/fonts/oxanium.woff", "file_hash": "abc", "license_status": "unresolved" }
  ],
  "roles": {
    "button-label": { "font_id": "missing-font", "fidelity_mode": "exact", "identity_critical": true }
  }
}
```

失败原因：缺 postscript_name；woff 不支持；哈希格式非法；授权未确认；
role 引用不存在的字体且无 exact 确认。

## 13. 存量数据兼容

无 manifest 的旧项目在打开时视为 `null`；字体必须重新导入确认（哈希与
身份是批准门禁，无法跳过）。

## 14. 与其他契约的关系

上游：style-contract（typography 角色定义）；下游：COMPONENT-BINDINGS
（`font_role` 合法性）、COMPOSITION-MANIFEST（text 图层字体证据）、
FIDELITY-REPORT（排版门禁）。

## 15. 源码指针

- `electron/services/typographyAssets.cjs`（导入/确认/校验）
- `electron/services/typographyRenderer.cjs`（实际渲染与哈希验证）
- `electron/services/designPipeline.cjs`（addFontAsset/confirmFontUsage/approve）

## 16. 测试指针

- `electron/services/assetContracts.test.cjs`、`typographyRenderer.test.cjs`
- `tests/ui-e2e/strict-continuation.spec.ts`（导入→确认→批准全流程）

## 17. 验收清单

- [ ] golden font-manifest 通过 strict 校验
- [ ] 未确认授权/未确认 exact 均无法进入 approved
- [ ] 字体文件被改动后渲染/检查报哈希不匹配

## 18. 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
