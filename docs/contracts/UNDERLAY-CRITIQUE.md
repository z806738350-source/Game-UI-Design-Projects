# UNDERLAY-CRITIQUE Contract

`screens/{screen_id}/underlay-critique.json` 是对一张 Underlay 的独立审查
证据：确定性像素指标 + 模型语义判断 + 全部输入哈希，三者共同决定 Underlay
能否进入合成。它是防止"模型自说自话"的关键证据 artifact。

## 1. 概述

`critiqueUnderlay` 流程：物化 underlay PNG（本地落盘 + 哈希）→ 计算确定性
指标（edge/contrast/color/highlight/hard-edge）→ 生成 review overlay 与组件
board → 调模型语义审查（raw response 全量落盘为 semantic-response 证据）→
合并为 critique artifact。修复（repair）产出的新 underlay 会重新走 critique。

## 2. Artifact 标识与存储

| 项 | 值 |
| --- | --- |
| kind | `underlay-critique` |
| 存储路径 | `screens/{screen_id}/underlay-critique.json` |
| schema_version | `2.0` |
| 证据文件 | `screens/{screen_id}/underlays/{id}.png`、`reviews/{id}-semantic-response.json`、`reviews/{id}-review-input.png`、`reviews/{id}-review-overlay.png` |
| 生成阶段 | `underlay_review` |

## 3. Schema 字段表

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `source` | object | 是 | `{ underlay, underlay_contract, prompt_hash, model }` |
| `global_scan` | object | 是 | `suspected_ui_regions`、`text_like_regions` |
| `slot_checks` | array | 是 | 语义 slot 检查明细 |
| `deterministic_metrics` | object | 是 | `threshold_version`、`thresholds`、`image_hash`、宽高、每 slot 指标 |
| `evidence` | object | 是 | underlay/overlay/annotated_overlay/component_board/semantic_raw 的路径+哈希+`prompt_hash`+`model` |
| `issues` | array | 是 | `{ issue_id, severity, type, slot_id, bbox, confidence, reason, action }` |
| `result` | string | 是 | `passed`/`failed`/`manual-review`/`passed-with-waiver` |
| `manual_review` | object | 是 | `{ required, approved }` |
| `manual_waivers` | array | 是 | `{ issue_id, reason(≥10字符), approved_by, approved_at }` |

## 4. 门禁规则（领域策略）

`buildUnderlayCritique` 问题生成规则（`underlayCritique.cjs`）：

- strict 缺少哈希证据（underlay/overlay/component_board）→ blocker
  `incomplete-review-inputs`；无语义证据 → major `missing-semantic-evidence`；
- 语义发现的置信度映射 severity：≥0.85 critical、≥0.7 major、否则 minor；
- 语义声称必须被确定性指标佐证才升级（busyness/contrast/hard-edge 各自有
  佐证阈值；未佐证降为 minor 的 `*-unconfirmed`）；
- 确定性指标超阈值（edge>0.22、contrast>0.32、color>0.42、highlight>0.18、
  perimeter-edge>0.2，默认阈值见 thresholds）直接生成 major/critical；
- 语义总置信度 <0.6 → major `low-critique-confidence`。

`reviewGate`：blocker/critical/major 且未被豁免（waiver reason ≥10 字符）
的 issue 全部计入 blocking；`manual_review.required && !approved` 也阻断。

## 5. 批准与信任模型

Critique 不通过"批准"生效，而是通过 gate：gate 通过时
`workflow.underlay_review = approved`，否则 `blocked`。豁免
（`waiveUnderlayIssue`）要求理由 ≥10 字符，写入 `manual_waivers` 并重算 gate。

## 6. 状态机

artifact `status` 恒为 `reviewed`；决策语义在 `result` 与 gate。修复后重新
critique 生成新 artifact（version 递增）。

## 7. Stale 传播

- 上游：underlay-contract、visual-results 变化 → underlay-critique stale。
- 下游：`composition-manifest`（合成前置 gate）。

## 8. 错误码

| 错误码 | 场景 |
| --- | --- |
| `UNDERLAY_REPAIR_LIMIT` / `INPAINT_NOT_AVAILABLE` / `REPAIR_OUTPUT_MISSING` / `REPAIR_EVIDENCE_INCOMPLETE` | 修复链路失败 |
| Fidelity 检查码 `UNDERLAY_REVIEW_FAILED` | gate 未过进入 Fidelity 时 |

## 9. strict 与 guided 模式

两种模式的 critique 均 `strict: true`（哈希证据强制）。差别在上游：strict 的
underlay 必须来自带 Layout Guide 约束的生成。

## 10. 前端交互要求

UnderlayWorkbench：`underlay-critique` 运行、证据查看
（`underlay-evidence-critique`）、`underlay-repair` 修复、
`underlay-evidence-repair`、waiver 输入。gate blocking 数量可见。

## 11. 合法 JSON 示例（最小可校验形态）

```json
{
  "schema_version": "2.0",
  "id": "main-underlay-critique-current",
  "version": 1,
  "status": "reviewed",
  "source": {
    "underlay": "current",
    "underlay_contract": "main-underlay-contract",
    "prompt_hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    "model": "vision-model"
  },
  "global_scan": { "suspected_ui_regions": [], "text_like_regions": [] },
  "slot_checks": [],
  "deterministic_metrics": {
    "threshold_version": "underlay-metrics-v1",
    "thresholds": { "edge_density": 0.22, "local_contrast": 0.32, "color_complexity": 0.42, "highlight_density": 0.18, "hard_edge_crossing": 0.2 },
    "image_hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    "width": 1024, "height": 1024, "slots": {}
  },
  "evidence": {
    "underlay": { "path": "screens/main/underlays/current.png", "hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000" }
  },
  "issues": [],
  "result": "passed",
  "manual_review": { "required": false, "approved": false },
  "manual_waivers": []
}
```

## 12. 非法 JSON 示例

```json
{
  "schema_version": "2.0",
  "id": "main-underlay-critique-current",
  "version": 1,
  "status": "reviewed",
  "source": { "underlay": "current" },
  "issues": [
    { "issue_id": "issue-1", "severity": "critical", "type": "text-like", "confidence": 0.9 }
  ],
  "result": "passed",
  "manual_waivers": [{ "issue_id": "issue-1", "reason": "ok" }]
}
```

问题：critical issue 未修复时 `result` 不能是 passed（gate 会拦截）；waiver
reason 不足 10 字符无效；缺 evidence 哈希在 strict 下本身就是 blocker。

## 13. 存量数据兼容

旧 critique（无 evidence 哈希）在 strict 门禁下视为不完整，需要重跑 critique。

## 14. 与其他契约的关系

上游：UNDERLAY-CONTRACT、visual-results；下游：COMPOSITION-MANIFEST（gate）、
FIDELITY-REPORT（`UNDERLAY_REVIEW_FAILED` 透传）。

## 15. 源码指针

- `electron/services/underlayCritique.cjs`（build/gate）
- `electron/services/underlayReview.cjs`（确定性指标/overlay/mask/哈希）
- `electron/services/underlayRepair.cjs`、`designPipeline.cjs`
  （critiqueUnderlay/repairUnderlay/waiveUnderlayIssue）

## 16. 测试指针

- `electron/services/underlayReview.test.cjs`、`underlayRepairPipeline.test.cjs`、
  `underlayWorkflow.test.cjs`
- `tests/ui-e2e/failure-paths.spec.ts`（污染 underlay → repair → gate 通过）

## 17. 验收清单

- [ ] 污染 underlay 被检出（text-like/ui-like），修复后 gate 通过
- [ ] waiver 理由 <10 字符无效
- [ ] semantic-response 原文与 prompt_hash 落盘可追溯

## 18. 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
