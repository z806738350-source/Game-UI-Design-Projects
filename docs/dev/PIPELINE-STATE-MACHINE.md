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
  `{id, role, required}`，仅改 label 不触发绑定 stale；但已产出的
  文字层/合成/保真事实仍写着旧文案，会沿
  composition-manifest → output → fidelity 失效
  （`screen_contract_label_changed`），逼使交付链用新 label 重建；
  合成时最终文字的事实源是当前 Screen Contract 的 label，不是
  Binding 里冻结的旧文本（AUD-09）；
- **screen-contract 批准即完整重验（AUD-06）**：批准边界不信任契约
  体内存储的 coverage——归一化全部字段、按当前 source_inventory
  重算 coverage、重跑控件/角色/required 校验；失败抛
  `SCREEN_CONTRACT_COVERAGE_INCOMPLETE` / `SCREEN_CONTRACT_APPROVAL_INVALID`；
- **Reference 无变化操作是 no-op（AUD-07）**：`manageReference` 对
  move/role/details/approval 先做规范化比较，无变化时返回
  `{ project, changed: false }`：不写 project.json、不 bump
  `input_revisions`、不写 inventory，IPC 也不触发下游失效；前端
  ReferenceWorkbench blur 未改内容时不调用后端；
- **Art Direction 保存不重置意图确认（AUD-08）**：`saveProject`
  未携带 `requirementConfirmed` 时，仅在需求文本变化时重置确认；
  只改美术方向/项目类型保留已确认的设计意图；前端普通保存不传该
  字段，只有显式确认才传 `true`；
- **Artifact 版本单调递增（AUD-10）**：版本只能由存储层产生
  （nextVersion = previousVersion + 1），模型/调用方传入的 version
  一律忽略（含首次保存：首版固定 V1，即使调用方传入 version 99）；
  status-only 保存（如批准落盘）同样 bump；存储层同时盖
  `generation_id` / `content_hash` / `updated_at`，历史不出现重复
  V1，证据链版本识别不撞号；
- **Screen Clone 完整 lineage（AUD-13，schema 驱动）**：`duplicateScreen`
  用 `rewriteScreenClone` 统一改写副本的身份与引用；重写 key 集不再靠
  通用白名单猜测，而是由 `artifactRegistry.cjs` 的冻结 `CLONE_FIELD_SCHEMA`
  逐类声明（13 类 Screen Artifact 的生产真实引用字段，如 `task_id` /
  `visual_tasks` / `visual_results_id` / `underlay_id` / `parent_underlay_id` /
  `repair_task_id` / `critique` / `layout_version`），COMMON 集仅供无类型
  上下文的结构（workflow stage 条目、`inputs.json`）使用；硬守卫仍是
  “值以原 Screen id 为前缀”；`reviews/*-semantic-response.json` 证据文件
  同套 rewriter 重写 `source.underlay_id`；已批准事实不继承，降为
  `reviewed`（M4-I1 起 Fidelity `passed` 一并降级，不得显示为仍然新鲜）；
  M4-I1：带原 Screen 前缀的物理文件（底图/语义证据等）先重命名为目标
  前缀，映射表与 JSON 路径字符串同步；内容被改写的证据文件按实际字节
  重算 `hash`/`byte_length`，保证文件/路径/哈希/长度四向一致；原页产物
  不受影响；完整性由 `cloneSchemaIntegrity.test.cjs` 用真实 pipeline 生成
  完整 Strict 树后递归扫描验证（含文件名本身与证据四向一致断言）；
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
  `validateLayout` 的组件绑定门禁仅在严格继承路线执行，探索/引导
  路线没有 bindings 资产，布局批准与 route-cycle 修复不得被缺失
  绑定误拦截；
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

**路线切换重置（AUD-02）**：continuation-mode 变化不走普通下游
失效，改用旧∪新路线的固定重置集合（style-contract 至
fidelity-report 全部 13 类生产链资产）无条件置 stale
（`route_profile_changed`）并同步 workflow 阶段；Screen Contract、
输入与参考资产跨路线保留。详见 ARTIFACT-DEPENDENCY-GRAPH.md。

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

**Rail 状态作用域（P1-08 / AUD-12）**：前端 `statusOf` 聚合时，全局
阶段（reference/typography/component resolution）读
`workflow.global_stages`，Screen 阶段读 `screen_stages[当前屏]`；
Style Rail 的严格子阶段聚合读 `global_stages.typography_resolution` /
`component_resolution` 与 Screen 作用域的 `component_binding`，任一
stale/blocked 时不得继续显示已批准。Screen-scoped 工作台的本地草稿
（方案选择/备注/需求/方向）的重置依赖 `project.id + screen_id +
版本`（AUD-11），App shell 另以 `key={project.id}:{screen_id}` 在切换上下文时强制重建工作台。

## 7. 失败处理

`runStage` 捕获异常后 `updateWorkflow(stage, 'failed')` 再抛出，保证
前端看到一致状态；重试即重新触发同一 IPC。

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 2.7 | 2026-08-27 | M4-I1（PR-54，Clone 证据文件完整性）：副本中带原 Screen 前缀的物理文件重命名为目标前缀且 JSON 路径同步；内容被改写的证据文件重算 `hash`/`byte_length`（四向一致）；Fidelity `passed` 与 `approved` 一样降级 `reviewed`；完整性测试扩展文件名扫描与证据哈希复验（独立源码审核 §5/§6） |
| 2.6 | 2026-08-25 | PR-47~51（M4-H1~H4，基线 `main@0f8e9ce` 复审整改）：Clone schema 补齐 `underlay_critique`/`issue_id`/waiver/`artifact_id` 并以真实交付链重验（MAJOR-01）、Layout stale 恢复动作显式分派全部 5 种 action（MAJOR-02）、label-only Contract 编辑先校验后 invalidate 的失败原子性（MAJOR-03）、legacy Critique 缺 version 时 UI fail closed（P1-01）、Web 导出改 fetch 并回传 409、URL 携带冻结 screenId（P1-03）、job_id 并发硬化登记 Issue #50（P1-02） |
| 2.5 | 2026-08-24 | PR-40~45（M4-F1~F6）：Web/Desktop 统一最终交付门禁（WEB-DELIVERY-01，finalDeliveryGate，Web 阻断一律 409）、Job Identity 绑定与刷新错误隔离（AUD-03/04）、已批准 Contract label-only 编辑重验（AUD-06）、Web Reference no-op（AUD-07）、schema-aware Clone（AUD-13）、UI 证据守卫对齐/首版 V1/stale 恢复动作统一到 Footer（AUD-05/10/14） |
| 2.4 | 2026-08-23 | PR-35~38：批准即完整重验（AUD-06）、reference no-op（AUD-07）、art-direction 保存保留确认（AUD-08）、label 事实源与交付链失效（AUD-09）、版本单调递增（AUD-10）、草稿 Screen 隔离与 Rail 作用域（AUD-11/12）、clone lineage（AUD-13）、路线切换固定重置集合（AUD-02） |
| 2.3 | 2026-08-21 | PR-29 证据链匹配门禁、交付链绑定重验、来源修订重验、视觉取代型失效与布局校验绑定门禁限 strict 路线 |
| 2.2 | 2026-08-21 | PR-28 三条死路解除：严格底层规范状态机、视觉省略确认绑定 Pack hash、Underlay 人工复核入口 |
| 2.1 | 2026-08-21 | PR-27 批准新鲜度门禁、编辑保留 stale、事务安全与旧版循环一次性修复 |
| 2.0 | 2026-08-21 | PR-26 三路线顺序、scope-aware stale 传播、导航/执行分离 |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
