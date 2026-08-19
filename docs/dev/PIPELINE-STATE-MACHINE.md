# 管线状态机（PIPELINE-STATE-MACHINE）

本文档定义管线中两级状态体系：**workflow 阶段状态**（
`workflow/state.json`）与 **artifact 状态**（每个 JSON artifact 的
`status` 字段），以及二者的推进规则。

## 1. Workflow 阶段

`designPipeline.cjs` 的阶段与 `artifactStages` 映射：

| 阶段 | 产出 artifact |
| --- | --- |
| `reference_analysis` | reference-inventory、reference-pack |
| `style_resolution` | style-contract |
| `typography_resolution` | font-manifest |
| `component_resolution` | component-contract |
| `wireframe_interpretation` | screen-contract |
| `component_binding` | component-bindings |
| `layout_design` | layout-proposals、approved-layout |
| `underlay_specification` | underlay-contract |
| `visual_exploration` | visual-task、visual-results |
| `underlay_review` | underlay-critique |
| `composition` | composition-manifest、composition-output |
| `fidelity_review` | fidelity-report |

阶段状态取值：`pending` / `in_progress` / `reviewed` / `approved` /
`failed` / `stale` / `blocked`。推进入口统一为
`updateWorkflow(stage, status, output, details)`。

## 2. Artifact 状态枚举

| status | 含义 |
| --- | --- |
| `draft` | 用户草拟（如 inputs.json、未确认的 bindings 编辑） |
| `generated` | 管线/模型产出，未批准 |
| `reviewed` | 已审查（critique/fidelity 类证据 artifact 的终态） |
| `approved` | 人工批准（带 `approved_at` / approval stamp） |
| `rejected` | 人工拒绝 |
| `stale` | 上游变化导致失效，需重新生成 |
| `passed` | 检查通过（fidelity-report 无 blocking issue 时） |

## 3. 典型转移

### 批准型 artifact（style-contract / bindings / layout / underlay-contract / manifest）

```
generated ──approveArtifact──> approved ──上游变化──> stale
    │                                              │
    └──reject──> rejected                        重新生成 ──> generated
```

批准时执行该 artifact 的专属门禁（见 contracts/ 各文档第 4/5 节）；
门禁失败抛对应错误码且不改变状态。

### 证据型 artifact（underlay-critique / fidelity-report）

```
（不存在）──critique/fidelity 运行──> reviewed/passed（或 reviewed+blocking）
    └──上游变化后重跑──> version+1 新报告
```

不走"批准"，通过 gate 影响 workflow：gate 过 → workflow 阶段
`approved`，否则 `blocked`。

### 只读约束

composition-manifest、composition-output、fidelity-report 的
`updateArtifact` 抛 `GENERATED_EVIDENCE_READ_ONLY`。

## 4. 特殊转移规则

- **screen-contract label-only 编辑**：语义签名只比较
  `{id, role, required}`，仅改 label 不触发 stale；
- **bindings 编辑**：自动剥离 `approved`/`approval` stamp，回到待批准；
- **font-manifest roles/fonts 编辑**：拒绝，抛
  `FONT_CONFIRMATION_ACTION_REQUIRED`（必须走导入+确认动作）；
- **composition-manifest final 批准**：五重门禁，通过后
  `workflow.fidelity_review = approved`。

## 5. Stale 传播机制

`invalidateArtifacts(kind)` 沿 `DIRECT_DEPENDENCIES`（见
ARTIFACT-DEPENDENCY-GRAPH.md）做传递闭包，把所有下游置为 stale 并
同步 workflow 阶段。批准时发现依赖 stale 抛 `STALE_DEPENDENCY`。

## 6. 失败处理

`runStage` 捕获异常后 `updateWorkflow(stage, 'failed')` 再抛出，保证
前端看到一致状态；重试即重新触发同一 IPC。

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
