# Artifact 依赖图（ARTIFACT-DEPENDENCY-GRAPH）

本文档给出 `artifactDependencies.cjs` 中 `DIRECT_DEPENDENCIES` 的完整
依赖图。它是 stale 传播（传递闭包）与批准时依赖新鲜度检查的唯一事实
来源。箭头方向：上游 → 下游（上游变化使下游 stale）。

## 1. 直接依赖表

| 上游 artifact | 直接下游 |
| --- | --- |
| `input-continuation-mode` | style-contract、visual-task（**不影响** screen-contract） |
| `style-contract` | font-manifest、component-contract、layout-proposals、underlay-contract、visual-task |
| `font-manifest` | component-bindings、composition-manifest |
| `component-contract` | component-bindings |
| `screen-contract` | component-bindings、layout-proposals |
| `component-bindings` | layout-proposals |
| `layout-proposals` | approved-layout |
| `approved-layout` | underlay-contract、visual-task |
| `underlay-contract` | visual-task、underlay-critique |
| `visual-task` | visual-results |
| `visual-results` | underlay-critique、composition-manifest |
| `underlay-critique` | composition-manifest |
| `composition-manifest` | composition-output |
| `composition-output` | fidelity-report |

## 2. 依赖图（文本）

```
input-continuation-mode ─┬─> style-contract ─┬─> font-manifest ─────┬─> component-bindings ─> layout-proposals ─> approved-layout ─┬─> underlay-contract ─┬─> underlay-critique ─┐
                         │                   ├─> component-contract ─┘                                                            │                        │                      │
                         │                   ├─> layout-proposals ────────────────────────────────────────────────────────────────┘                        │                      │
                         │                   ├─> underlay-contract ─────────────────────────────────────────────────────────────────────────────────────────┘                      │
                         │                   └─> visual-task ─> visual-results ─┬─> underlay-critique ────────────────────────────────────────────────────────────────────────────┤
                         └─────────────────────────────────────────────────────┘ │                                                                          │                      │
screen-contract ─┬─> component-bindings                                          └─> composition-manifest <────────────────────────────────────────────────┘                      │
                 └─> layout-proposals                                                    │                                                                    underlay-contract ───┘
                                                                                         v
                                                                              composition-output ─> fidelity-report
```

## 3. 关键性质

- **传递闭包**：`invalidateArtifacts(kind)` 会把所有直接 + 间接下游置
  stale。例如改 style-contract 最终会 stale 到 fidelity-report。
- **汇聚点**：composition-manifest 汇聚五条上游线（font-manifest、
  visual-results、underlay-critique、及经 layout/bindings 的传递链），
  是 stale 最频繁触发的节点。
- **例外**：input-continuation-mode 变化不 stale screen-contract
  （控件语义与延续模式无关）。
- **fidelity-report 无下游**：终端证据；但 stale 时 final 批准会被
  `FIDELITY_OUTPUT_STALE` / `STALE_DEPENDENCY` 拦截。

## 4. 常见变更的影响面

| 变更点 | stale 范围 |
| --- | --- |
| 编辑 bindings（非 label） | layout-proposals → approved-layout → underlay 全链 → composition → fidelity |
| 重新导入字体 | component-bindings → 布局链 → composition → fidelity |
| 重新生成 layout 提案 | approved-layout → underlay 全链 → composition → fidelity |
| 修复 underlay（repair） | underlay-critique → composition → fidelity |
| 切换延续模式 | style-contract、visual-task（及各自下游） |

## 5. 源码指针

- `electron/services/artifactDependencies.cjs`（DIRECT_DEPENDENCIES）
- `electron/services/designPipeline.cjs`（invalidateArtifacts /
  批准时的依赖检查）

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
