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
  `workflow.fidelity_review = approved`；
- **编辑不是洗回路径**：stale Artifact 被 `updateArtifact` 编辑后
  仍保持 stale（保留 `stale_at`/`stale_reason`），只能通过重新生成
  （或允许确定性重验的资产重批）恢复；
- **批准新鲜度门禁**：批准时若 Artifact 为 stale，除字体/组件/绑定
  （批准即重跑完整确定性校验）外一律抛 `STALE_REAPPROVAL_BLOCKED`；
  style-contract 额外校验风格基线新鲜（basis 必须仍是当前已批准的
  路线基线）；approved-layout 批准拦截 stale 布局提案；
- **旧版风格循环一次性修复**：布局先行路线上被旧版缺陷错误标为
  stale（`stale_reason = style_contract_regenerated`）且输入未变的
  布局链路，可由 `flowStateRepair` 在备份后恢复：重跑
  `validateLayout` → 恢复 approved → 写修复台账
  `workflow/repairs/route-cycle-v1.json`；幂等，strict/locked 与
  其他失效原因一律拒绝（`ROUTE_CYCLE_REPAIR_INELIGIBLE`）；
- **Underlay 人工复核**：Critique `manual_review.required = true` 时
  `reviewGate` 阻断，直到独立动作 `approveUnderlayManualReview`
  记录结论、理由与 approved_by/approved_at；人工复核只解除
  manual-review 阻断，不豁免未豁免的阻断问题，也不适用于未要求
  人工复核的 Critique（`UNDERLAY_MANUAL_REVIEW_NOT_REQUIRED`）；
- **视觉省略确认绑定 Pack hash**：视觉阶段 underlay-generation Pack
  超出容量时落盘待确认 Pack 并抛
  `REFERENCE_OMISSIONS_CONFIRMATION_REQUIRED`；确认必须携带当前
  `pack_hash`，参考图或容量变化后旧确认自动失效；风格阶段的
  style-resolution Pack 确认由风格页独立负责，两者互不代替；
- **严格底层规范状态机**：布局页下一步按 Underlay Contract 完整状态
  判断（无→建立、generated/reviewed→批准、stale→按当前布局重建、
  approved 无 Guide→生成 Guide、approved 有 Guide→生成底层图），
  不得只看 `layout_guide` 是否存在；
- **证据链匹配门禁**：合成必须显式指定 variationId，未知/缺失抛
  `VISUAL_VARIATION_NOT_FOUND`（不再静默回退第一张）；strict 路线
  额外要求 `critique.source.underlay === variation.id`，否则抛
  `UNDERLAY_EVIDENCE_MISMATCH`。校验在失效旧证据之前：失败的合成
  尝试不得把仍然有效的链路变 stale；
- **交付链绑定重验**：Manifest 合成时记录当前 Visual Results 的
  版本/选择/评审 hash（`source.visual_results_version` 等）；最终
  批准与导出边界重验绑定，漂移抛 `VISUAL_RESULTS_BINDING_STALE`；
  未记录绑定字段的旧格式 Manifest 由 stale 机制保底；
- **来源修订重验**：screen-contract / style-contract 批准时比对
  `source.input_revisions` 与当前输入修订，不一致抛
  `STALE_REAPPROVAL_BLOCKED`，对着旧输入生成的契约不得批准为新事实。

## 5. Stale 传播机制

`invalidateArtifacts(kind)` 按项目路线 Profile（`profileOf(project)`）
选择依赖图（见 ARTIFACT-DEPENDENCY-GRAPH.md），做 scope-aware BFS：
Global 变化 fan-out 到所有未归档 Screen，Screen 变化只影响本屏并向
Global 传播一次；把所有下游置为 stale 并同步 workflow 阶段，返回
`{ changed_kind, profile, affected_screens, stale_artifacts }`。
传播只发生在阶段成功之后（事务安全：先调模型、校验通过后才失效
下游并写入新 Artifact）；失败的模型尝试不会破坏现有可用链路。
例外：视觉证据的“取代型”事件（重新生成、评审决策变化、修复新增
variation）在动作开始时即失效旧链（`visual_results_regenerated` /
`visual_review_changed` / `visual_results_repaired`），因为旧证据已
不再可信，即使后续生图失败也不得回滚失效。

## 6. 路线顺序与导航/执行分离

阶段推进顺序由路线决定（事实来源 `pipelineProfile.cjs` /
前端镜像 `pipelineRoute.ts`）：

| Profile | 顺序 |
| --- | --- |
| exploration（新项目） | Contract → Layout → Style → Visual |
| guided（引导继承） | Contract → Layout → Style → Visual（underlay-only 方向） |
| strict（严格继承 / locked） | Contract → Style → Font/Component/Binding → Layout → Underlay → Composition |

风格基线（style_basis）：strict 恒为已批准 screen-contract；
exploration/guided 恒为已批准 approved-layout，记录于 style-contract
的 `source.style_basis`。

**导航与执行分离**：阶段切换按钮（如「进入风格锁定」）只调用
`onNavigate(stage)`，绝不触发模型；每个阶段的模型执行只能由该阶段
页面内的显式按钮（如 `style-generate`）发起。进入风格锁定页面不会
自动开始风格分析。

## 7. 失败处理

`runStage` 捕获异常后 `updateWorkflow(stage, 'failed')` 再抛出，保证
前端看到一致状态；重试即重新触发同一 IPC。

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 2.3 | 2026-08-21 | PR-29 证据链匹配门禁、交付链绑定重验、来源修订重验与视觉取代型失效 |
| 2.2 | 2026-08-21 | PR-28 三条死路解除：严格底层规范状态机、视觉省略确认绑定 Pack hash、Underlay 人工复核入口 |
| 2.1 | 2026-08-21 | PR-27 批准新鲜度门禁、编辑保留 stale、事务安全与旧版循环一次性修复 |
| 2.0 | 2026-08-21 | PR-26 三路线顺序、scope-aware stale 传播、导航/执行分离 |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
