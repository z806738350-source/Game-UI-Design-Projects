# Artifact 依赖图（ARTIFACT-DEPENDENCY-GRAPH）

本文档给出 `artifactDependencies.cjs` 中三套路线感知依赖图
（`COMMON_DEPENDENCIES` + `NON_STRICT_DEPENDENCIES` /
`STRICT_DEPENDENCIES`）的完整定义。它是 stale 传播（传递闭包）与
批准时依赖新鲜度检查的唯一事实来源。箭头方向：上游 → 下游
（上游变化使下游 stale）。

路线 Profile 由 `pipelineProfile.cjs` 的 `profileOf(project)` 判定：
`existing-strict` / `locked-continuation` → **strict**；
`existing-guided` → **guided**；其余（含新项目）→ **exploration**。
`downstreamArtifacts(kind, { profile })` 必须显式携带 profile，
禁止路线无关的旧签名。

## 1. 公共边（三路线一致）

| 上游 artifact | 直接下游 |
| --- | --- |
| `input-requirement` | screen-contract |
| `input-wireframe` | screen-contract |
| `input-references` | reference-inventory |
| `input-art-direction` | style-contract |
| `input-project-type` | style-contract、visual-task |
| `input-continuation-mode` | style-contract、visual-task（**不影响** screen-contract） |
| `reference-inventory` | reference-pack |
| `reference-pack` | style-contract |
| `layout-proposals` | approved-layout |
| `visual-task` | visual-results |
| `composition-manifest` | composition-output |
| `composition-output` | fidelity-report |

## 2. 布局先行路线（exploration / guided）

新项目与引导继承：布局先行，Style 建立在已批准布局之上；
Style 生成/变化**绝不回指 Layout**（否则形成 Layout—Style stale
死循环，即 0.2.2 用户复现的 P0 事故）。

| 上游 artifact | 直接下游 |
| --- | --- |
| `screen-contract` | layout-proposals |
| `approved-layout` | style-contract、visual-task |
| `style-contract` | visual-task |

```
input-* ─> screen-contract ─> layout-proposals ─> approved-layout ─┬─> style-contract ─┐
                                                                    └─> visual-task <───┘
input-art-direction / reference-pack ─────────────────────────────────> style-contract
visual-task ─> visual-results
```

## 3. 风格先行路线（strict）

严格继承生产链（字体/组件/绑定/底层/合成）全部挂在 Style 下游；
`approved-layout` 不得反向指向 style-contract。

| 上游 artifact | 直接下游 |
| --- | --- |
| `style-contract` | font-manifest、component-contract、layout-proposals、underlay-contract、visual-task |
| `font-manifest` | component-bindings、composition-manifest |
| `component-contract` | component-bindings |
| `screen-contract` | style-contract、component-bindings、layout-proposals |
| `component-bindings` | layout-proposals |
| `approved-layout` | underlay-contract、visual-task |
| `underlay-contract` | visual-task、underlay-critique |
| `visual-results` | underlay-critique、composition-manifest |
| `underlay-critique` | composition-manifest |

## 4. 关键性质

- **传递闭包**：`invalidateArtifacts(kind)` 按当前项目 profile 的图做
  scope-aware BFS，把所有直接 + 间接下游置 stale。
- **scope**：Global 变化（reference/art-direction/project-type/
  continuation-mode 及全局 artifact）fan-out 到所有未归档 Screen；
  Screen 级变化只影响本屏，并向 Global 传播一次；去重键为
  `global:<kind>` / `screen:<screenId>:<kind>`，`affected_screens`
  为被标 stale 的屏集合。
- **风格基线（style_basis）**：strict 恒为已批准 screen-contract；
  exploration/guided 恒为已批准 approved-layout。记录在
  style-contract 的 `source.style_basis`。因此 strict 下
  `screen-contract` 是 `style-contract` 的直接上游（AUD-01）：
  功能契约语义变化会使风格与全部严格下游 stale。
- **路线切换重置（AUD-02）**：continuation-mode 变化不走普通下游
  失效（此时模式已落盘，只会算出新图），改用旧∪新路线的固定重置
  集合 `ROUTE_SWITCH_RESET_KINDS`（style-contract 至 fidelity-report
  全部 13 类生产链资产）无条件置 stale（`route_profile_changed`），
  避免旧路线 approved 事实残留并在切回时复活；Screen Contract、
  输入与参考资产跨路线仍有效，不重置。
- **例外**：input-continuation-mode 变化不 stale screen-contract
  （控件语义与延续模式无关）。
- **环检测**：`artifactDependencies.test.cjs` 对三套图做 DFS 三色
  环检测；任何新边引入环会直接失败。
- **fidelity-report 无下游**：终端证据；但 stale 时 final 批准会被
  `FIDELITY_OUTPUT_STALE` / `STALE_DEPENDENCY` 拦截。

## 5. 常见变更的影响面（按路线）

| 变更点 | 路线 | stale 范围 |
| --- | --- | --- |
| 编辑 bindings（非 label） | strict | layout-proposals → approved-layout → underlay 全链 → composition → fidelity |
| 编辑 screen-contract（语义键） | strict | style-contract → 字体/组件/绑定/布局/底层/视觉/合成全链（AUD-01） |
| 重新导入字体 | strict | component-bindings → 布局链 → composition → fidelity |
| 重新生成 layout 提案 | 全部 | approved-layout →（布局先行：style-contract → visual 链；strict：underlay 全链 → composition → fidelity） |
| 批准/更换布局方案 | 布局先行 | style-contract → visual-task → visual-results |
| 重新解析风格 | 布局先行 | visual-task → visual-results（**布局不受影响**） |
| 重新解析风格 | strict | font/component/bindings/layout/underlay/visual 全链 |
| 修复 underlay（repair） | strict | underlay-critique → composition → fidelity |
| 切换延续模式 | 全部 | 旧∪新固定重置集合：两条路线的全部生产链资产（含已批准布局/底层/合成）置 stale（`route_profile_changed`）；Screen Contract 与输入保留（AUD-02） |
| 参考图无变化操作（no-op） | 全部 | 不产生失效：manageReference 检测无变化时不写盘、不升 revision、不触发失效（AUD-07） |

## 6. 源码指针

- `electron/services/pipelineProfile.cjs`（profileOf / PROFILE_FACTS）
- `electron/services/artifactDependencies.cjs`（三套依赖图与
  downstreamArtifacts）
- `electron/services/designPipeline.cjs`（scope-aware
  invalidateArtifacts / 批准时的依赖检查）
- `src/features/shared/pipelineRoute.ts`（前端 Profile 镜像，
  一致性测试见 pipelineRoute.test.ts）

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 2.1 | 2026-08-23 | PR-36/38：strict `screen-contract → style-contract` 依赖边（AUD-01）；路线切换改为旧∪新固定重置集合（AUD-02）；补充 reference no-op 行为（AUD-07） |
| 2.0 | 2026-08-21 | PR-26 路线感知依赖图：三路线分列、scope-aware BFS、style_basis（修复 Layout—Style 循环） |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
