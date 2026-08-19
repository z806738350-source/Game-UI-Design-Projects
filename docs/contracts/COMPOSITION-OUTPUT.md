# COMPOSITION-OUTPUT Contract

`screens/{screen_id}/composition-output.json` 是确定性合成器渲染结果的
像素级证据：输出 PNG 的路径、哈希、尺寸、渲染器版本与 render_log。它是
Fidelity Report 的检查对象，也是 final 批准的三重一致性锚点之一。

## 1. 概述

`renderComposition`（`compositionRenderer.cjs`）按 Manifest 的图层清单用
sharp/libvips 渲染 PNG，落盘到 `screens/{screen_id}/compositions/{mode}-v{version}.png`
并把输出元数据写入 composition-output artifact。输出只读（编辑抛
`GENERATED_EVIDENCE_READ_ONLY`）；导出前必须通过哈希比对。

## 2. Artifact 标识与存储

| 项 | 值 |
| --- | --- |
| kind | `composition-output` |
| 存储路径 | `screens/{screen_id}/composition-output.json` |
| schema_version | `1.0` |
| 输出 PNG | `screens/{screen_id}/compositions/{mode}-v{version}.png` |
| 生成阶段 | `composition`（与 composition-manifest 同阶段） |

## 3. Schema 字段表

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | `{screen}-composition-{mode}-output` |
| `mode` | string | 是 | `preview` / `final` |
| `path` | string | 是 | 输出 PNG 相对路径 |
| `hash` | string | 是 | `sha256:` 前缀的输出哈希 |
| `width` / `height` | number | 是 | 像素尺寸（必须等于 canvas） |
| `byte_length` | number | 是 | PNG 字节数 |
| `rendered_at` | string | 是 | 渲染时间戳 |
| `renderer_version` | string | 是 | 如 `composition-v1/sharp…` |
| `underlay_hash` | string | 是 | 渲染时使用的 underlay 哈希 |
| `render_log` | object | 是 | `{ deterministic_order: true, layers[] }` 渲染顺序证据 |
| `source` | object | 是 | `{ composition_manifest, composition_manifest_version }` |

## 4. 领域策略

`verifyCompositionOutput`（批准与导出前置）检查：

- 文件存在且可读，否则 `COMPOSITION_OUTPUT_UNREADABLE`；
- 磁盘哈希与 artifact `hash` 一致，否则 `COMPOSITION_OUTPUT_HASH_MISMATCH`；
- 实际尺寸与 artifact 记录一致，否则 `COMPOSITION_OUTPUT_DIMENSION_MISMATCH`；
- `requireFinal: true` 时输出必须是 final 模式，否则 `FINAL_OUTPUT_REQUIRED`。

`exportCompositionOutput`（visual:export）：再次读取磁盘哈希并与 artifact
比对，不一致抛 `FINAL_EXPORT_HASH_MISMATCH`；非 final 输出禁止导出
（`FINAL_EXPORT_BLOCKED`）。

## 5. 批准与信任模型

Composition Output 不可单独批准；它随 composition-manifest 的 final 批准
生效。批准五重门禁中的前三重全部围绕本 artifact：
`verifyCompositionOutput(requireFinal)` → manifest output 引用一致
（否则 `COMPOSITION_OUTPUT_INVALID`）→ Fidelity source 引用一致
（否则 `FIDELITY_OUTPUT_STALE`）。

## 6. 状态机

`generated`（渲染落盘即写入）→ 随 manifest 批准视为可信。上游 stale 时
output 随之 stale，必须重新合成。

## 7. Stale 传播

- 上游：`composition-manifest`（DIRECT_DEPENDENCIES：composition-output →
  fidelity-report 的源头）。
- 下游：`fidelity-report`。
- manifest/output 任何一层变化都会使 fidelity-report stale（
  `FIDELITY_OUTPUT_STALE` 在批准时实时再检）。

## 8. 错误码

| 错误码 | 场景 |
| --- | --- |
| `COMPOSITION_OUTPUT_UNREADABLE` | 输出文件缺失或不可读 |
| `COMPOSITION_OUTPUT_HASH_MISMATCH` | 磁盘哈希与记录不符（文件被改动） |
| `COMPOSITION_OUTPUT_DIMENSION_MISMATCH` | 尺寸与记录不符 |
| `FINAL_OUTPUT_REQUIRED` | requireFinal 校验遇到非 final 输出 |
| `FINAL_EXPORT_BLOCKED` | 导出非 final 输出 |
| `FINAL_EXPORT_HASH_MISMATCH` | 导出时哈希再检不一致 |
| `GENERATED_EVIDENCE_READ_ONLY` | 尝试编辑 composition-output |

## 9. strict 与 guided 模式

两种模式都产出 output；差别在 manifest 门禁的 strict 程度。导出仅允许
final（与模式无关）。

## 10. 前端交互要求

Composition Workbench 渲染后展示 output 哈希与路径；Export 面板
（`export-final`）调用导出并显示目标文件。哈希不一致时前端显示错误码
而非静默重试。

## 11. 合法 JSON 示例（最小可校验形态）

```json
{
  "schema_version": "1.0",
  "id": "main-composition-final-output",
  "version": 1,
  "status": "generated",
  "mode": "final",
  "path": "screens/main/compositions/final-v1.png",
  "hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "width": 1024,
  "height": 1024,
  "byte_length": 512345,
  "rendered_at": "2026-08-19T00:00:00.000Z",
  "renderer_version": "composition-v1/sharp",
  "underlay_hash": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  "render_log": { "deterministic_order": true, "layers": [] },
  "source": { "composition_manifest": "main-composition-final", "composition_manifest_version": 1 }
}
```

## 12. 非法 JSON 示例

```json
{
  "schema_version": "1.0",
  "id": "main-composition-final-output",
  "version": 1,
  "status": "generated",
  "mode": "final",
  "path": "screens/main/compositions/final-v1.png",
  "hash": "md5:abc123",
  "width": 512,
  "height": 1024
}
```

问题：哈希非 `sha256:` 前缀；宽高与 canvas 不一致（
`COMPOSITION_OUTPUT_DIMENSION_MISMATCH`）；缺 source/render_log 使
Fidelity 的 manifest_consistency 检查失败。

## 13. 存量数据兼容

输出是不可变证据；旧项目若 PNG 丢失或被替换，哈希再检会失败，唯一恢复
路径是重新合成（不允许手工补文件）。

## 14. 与其他契约的关系

上游：COMPOSITION-MANIFEST；下游：FIDELITY-REPORT（source 引用）、
导出（visual:export）。批准链见 COMPOSITION-MANIFEST 第 4 节。

## 15. 源码指针

- `electron/services/compositionRenderer.cjs`（renderComposition /
  verifyCompositionOutput / exportCompositionOutput）
- `electron/services/compositor.cjs`（图层与渲染指令）
- `designPipeline.cjs`（composeVisual 落盘路径与 artifact 写入）

## 16. 测试指针

- `electron/services/compositionRenderer.test.cjs`
- `electron/services/compositionFidelity.test.cjs`
- `tests/ui-e2e/strict-continuation.spec.ts`（final 渲染与导出）

## 17. 验收清单

- [ ] 篡改输出 PNG 后任何 verify/export 都抛哈希错误码
- [ ] preview 输出导出被 `FINAL_EXPORT_BLOCKED` 拦截
- [ ] render_log 图层顺序与 manifest 一致（确定性）

## 18. 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
