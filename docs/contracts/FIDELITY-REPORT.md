# FIDELITY-REPORT Contract

`screens/{screen_id}/fidelity-report.json` 是管线最后一道独立审查证据：
对已渲染的 Composition Output 做 13 项像素级与结构级检查，并把结论固化为
`passed`/`reviewed` 状态。它是 final 批准的直接门禁输入
（`finalApprovalGate`）。

## 1. 概述

`runFidelityChecks`（`fidelity.cjs`）读取当前全部上游 artifact 与磁盘像素
（`inspectFidelityEvidence` 实时解码），合并确定性检查与依赖新鲜度检查，
产出 report artifact。Report 一经落盘即为只读证据（编辑抛
`GENERATED_EVIDENCE_READ_ONLY`）；任何上游变化都会使其 stale，必须重跑。

## 2. Artifact 标识与存储

| 项 | 值 |
| --- | --- |
| kind | `fidelity-report` |
| 存储路径 | `screens/{screen_id}/fidelity-report.json` |
| schema_version | `2.0` |
| 生成阶段 | `fidelity_review` |

## 3. Schema 字段表

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | `{screen}-fidelity-report` |
| `status` | string | 是 | 有 blocking issue 时 `reviewed`，否则 `passed` |
| `source` | object | 是 | `{ composition_manifest(+version), composition_output(+version+hash), underlay_critique }` |
| `output` | object | 是 | `{ path, hash, width, height, renderer_version, verified }` |
| `coverage` | object | 是 | binding/控件覆盖事实（透传） |
| `underlay` | object | 是 | `{ critique_id, result, manual_waivers }` |
| `typography` | object | 是 | `{ identity_critical_roles, exact_roles, actual_verified_layers }` |
| `manifest_consistency` | object | 是 | manifest ↔ output 引用一致性事实 |
| `visual_fidelity` | object | 是 | 像素级检查结果汇总 |
| `evidence` | object | 是 | 实时检查的证据路径与哈希 |
| `evidence_digest` | string | 是 | 全部证据的摘要哈希（防事后篡改） |
| `checks` | array | 是 | 13 项检查名列表（见下） |
| `issues` | array | 是 | `{ severity, code, message, control_id? }` |
| `manual_review` | object | 是 | `{ required, approved }`；存在 major issue 时 required=true |

`checks` 固定 13 项：`composition-output`、`decoded-pixels`、`alpha`、
`asset-rehash`、`rendered-bbox`、`overlap`、`safe-area`、`text-overflow`、
`nine-slice-fixed-regions`、`control-coverage`、`underlay-gate`、
`font-render-evidence`、`dependency-freshness`。

## 4. 领域策略（检查规则）

issue 生成规则（`fidelity.cjs` + `fidelityInspector.cjs`）：

- binding 对应的控件未渲染 → blocker `MISSING_RENDERED_CONTROL`；
- Underlay reviewGate 的 blocking issue 透传 → `UNDERLAY_REVIEW_FAILED`；
- `validateFontManifest` 错误 → critical `TYPOGRAPHY_GATE_FAILED`；
- component 图层无合法 `sha256:` asset_hash → critical
  `COMPONENT_ASSET_UNIDENTIFIED`；
- text 图层 `fidelity_mode === 'unresolved'` → critical
  `UNRESOLVED_IDENTITY_FONT`；exact 模式未验证渲染 → critical
  `FONT_RENDER_NOT_VERIFIED`；渲染哈希/family 不符 → critical
  `FONT_RENDER_HASH_MISMATCH` / `FONT_RENDER_FAMILY_MISMATCH`；
- output 缺失 → blocker `COMPOSITION_OUTPUT_MISSING`；manifest 与 output
  引用不符 → blocker `COMPOSITION_OUTPUT_REFERENCE_MISMATCH` /
  `COMPOSITION_OUTPUT_MODE_MISMATCH`；
- 任一依赖 stale/缺失 → blocker `STALE_DEPENDENCY`；
- 像素级检查（bbox/overlap/safe-area/text-overflow/nine-slice 等）由
  `fidelityInspector.cjs` 产出，错误码见 ERROR-CATALOG 第二节。

`finalApprovalGate`：blocker/critical 全阻断；major 未被人工批准
（`issue.approved !== true`）也阻断；`evidence_digest` 与当前磁盘不一致
时追加 blocker `FIDELITY_EVIDENCE_STALE`。

## 5. 批准与信任模型

Report 不通过"批准"生效，而是作为 composition-manifest final 批准五重门禁
的最后两重：实时 `inspectFidelityEvidence` 通过（否则
`FIDELITY_CURRENT_EVIDENCE_FAILED`）+ `finalApprovalGate` 通过（否则
`FIDELITY_GATE_FAILED`）。manual_review 的 major 批准在 UI 中逐条确认
（写入 `issue.approved`）。

## 6. 状态机

artifact `status` 为 `passed` 或 `reviewed`（有 blocking 时）；
`workflow.fidelity_review` 相应为 `approved`/`blocked`。每次重跑
version+1、`checked_at` 更新。

## 7. Stale 传播

- 上游：composition-output（DIRECT_DEPENDENCIES 直接上游），并经传递闭包
  覆盖全部设计与资产 artifact。
- 下游：无（终端证据）；但 stale 的 report 会阻断 manifest final 批准
  （`FIDELITY_OUTPUT_STALE`）。

## 8. 错误码

| 错误码 | 场景 |
| --- | --- |
| `GENERATED_EVIDENCE_READ_ONLY` | 尝试编辑 fidelity-report |
| `FIDELITY_EVIDENCE_STALE` | evidence_digest 与当前磁盘不符 |
| `FIDELITY_CURRENT_EVIDENCE_FAILED` | 批准时实时证据检查失败 |
| `FIDELITY_GATE_FAILED` | finalApprovalGate 未通过 |
| `FIDELITY_OUTPUT_STALE` | report source 不指向当前 output |

issue 明细码（26 个 FIDELITY_ISSUE_CODES）完整列表见
`docs/dev/ERROR-CATALOG.md` 第二节。

## 9. strict 与 guided 模式

strict（existing-strict/locked-continuation）下 `validateFontManifest`
按 strict 校验；guided 按宽松规则。像素级检查两种模式一致。

## 10. 前端交互要求

Fidelity 面板（`fidelity-run`）：展示 13 项 checks、issues 列表与 severity、
manual_review 逐条批准入口；blocking 数量实时可见。批准后导出入口
（`export-final`）才可用。

## 11. 合法 JSON 示例（最小可校验形态）

```json
{
  "schema_version": "2.0",
  "id": "main-fidelity-report",
  "version": 2,
  "status": "passed",
  "source": {
    "composition_manifest": "main-composition-final",
    "composition_manifest_version": 1,
    "composition_output": "main-composition-final-output",
    "composition_output_version": 1,
    "composition_output_hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    "underlay_critique": "main-underlay-critique-current"
  },
  "output": { "path": "screens/main/compositions/final-v1.png", "hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000", "width": 1024, "height": 1024, "renderer_version": "composition-v1/sharp", "verified": true },
  "coverage": { "required_controls": 1, "bound_required_controls": 1, "unbound_required_controls": [] },
  "underlay": { "critique_id": "main-underlay-critique-current", "result": "passed", "manual_waivers": [] },
  "typography": { "identity_critical_roles": ["display"], "exact_roles": ["display"], "actual_verified_layers": 1 },
  "manifest_consistency": { "matches": true },
  "visual_fidelity": { "passed": true },
  "evidence": {},
  "evidence_digest": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  "checks": ["composition-output", "decoded-pixels", "alpha", "asset-rehash", "rendered-bbox", "overlap", "safe-area", "text-overflow", "nine-slice-fixed-regions", "control-coverage", "underlay-gate", "font-render-evidence", "dependency-freshness"],
  "issues": [],
  "manual_review": { "required": false, "approved": false }
}
```

## 12. 非法 JSON 示例

```json
{
  "schema_version": "2.0",
  "id": "main-fidelity-report",
  "version": 1,
  "status": "passed",
  "source": { "composition_output": "main-composition-preview-output" },
  "checks": ["composition-output"],
  "issues": [{ "severity": "blocker", "code": "COMPOSITION_OUTPUT_MISSING", "message": "Composition Output is missing." }]
}
```

问题：存在 blocker 时 `status` 不能是 `passed`；checks 不足 13 项说明检查
未完整执行；source 引用 preview output 使 final 批准报
`FIDELITY_OUTPUT_STALE`。

## 13. 存量数据兼容

旧 report（schema 1.0 或缺 evidence_digest）无法通过 final 批准门禁，
必须重跑 `fidelity:run` 生成 2.0 report。

## 14. 与其他契约的关系

上游：COMPOSITION-MANIFEST/COMPOSITION-OUTPUT/UNDERLAY-CRITIQUE/FONT-MANIFEST
/COMPONENT-BINDINGS 全链；下游：无（终端），但它是 composition-manifest
final 批准的门禁输入。

## 15. 源码指针

- `electron/services/fidelity.cjs`（runFidelityChecks / finalApprovalGate）
- `electron/services/fidelityInspector.cjs`（像素级检查与 evidence_digest）
- `designPipeline.cjs`（runFidelity IPC 入口与 workflow 状态写入）

## 16. 测试指针

- `electron/services/compositionFidelity.test.cjs`
- `electron/services/fidelityInspector.test.cjs`
- `tests/ui-e2e/strict-continuation.spec.ts`（fidelity → 批准 → 导出）

## 17. 验收清单

- [ ] 篡改输出/资产后重跑 fidelity 必产生对应 issue 码
- [ ] blocker/critical issue 存在时 final 批准被 `FIDELITY_GATE_FAILED` 拦截
- [ ] evidence_digest 不一致时追加 `FIDELITY_EVIDENCE_STALE`

## 18. 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
