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
- **screen-contract 批准即完整结构重验（AUD-06，设计师权威语义）**：
  批准边界不信任契约体内存储的 coverage——归一化全部字段、按当前
  source_inventory 重算 coverage（留痕写回）、重跑控件/角色/required
  结构校验；失败抛 `SCREEN_CONTRACT_APPROVAL_INVALID`。**覆盖差异
  不拦截批准**——「功能解读」阶段设计师的调整结果是准确答案，AI
  盘点清单的超集约束仅作用于生成期（kunpoClient 草稿修复循环，
  `coverageGateErrors`）；保存路径同样归一化 + 重算 + 结构重验，畸形
  编辑在失效下游之前被拒（失败原子性）；
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
  M4-J2：证据重算前经安全解析——路径必须严格落在克隆目标 Screen 目录
  内（resolve + realpath 双阶段 containment 防父路径穿越与 symlink 逃逸）、
  仅普通文件、不超过 64MB 上限，非法证据显式失败；Clone 是原子操作，
  失败删除部分复制的目标目录、不写 registry，重试前先清理未登记的残留
  目录（M4-I 复审 §8）；M4-K1：证据遍历受资源预算约束（递归深度 64、
  单 Artifact 容器节点 2048、单次 Clone 证据记录 512、唯一字节 256MB），
  相同真实路径只读取哈希一次、重复记录复用缓存——重复引用放大 I/O 的
  路线关闭，超限显式失败并触发整体回滚（M4-J 复审 SEC-MAJOR-01）；
  M4-K2：复制后的目标树不允许包含任何 symlink（迁移前全树 `lstat` 扫描，
  发现即失败，链接目标不被触碰）；Clone 是全事务——原始 `index.json` /
  `state.json` 字节先备份到 `workflow/transactions/clone-<id>/`，发布顺序
  为目录→Workflow→Registry（Registry 是最后发布点），任一写入失败自动
  还原备份并删除目标目录；回滚自身也失败时抛结构化错误
  `CLONE_ROLLBACK_INCOMPLETE`（事务/步骤/备份路径/人工恢复顺序，诊断
  记录 best-effort），不做启动期自动恢复（降为后续硬化项）；「有条目无
  stage」的 Clone 不一致状态在再复制/切换/管线操作时 Fail-Closed 阻断
  （M4-J 复审 SEC-P1-02 / TX-P1-01）；M4-L：项目级异步写锁把同项目全部
  `screens/index.json` / `workflow/state.json` 写者（创建/复制/切换/更新
  Screen、Workflow 更新）串行化——Web 多会话并发 Clone 不再基于旧快照
  丢失更新或交叉回滚；`fs.cp` 中途失败的部分目录在首次失败时即删除；
  证据累计字节预算改为读取前按 `stat.size` 预检（M4-K 复审 §6/§7/§3.3）；
  M4 收尾：源 Screen 有 `in_progress` 阶段时禁止复制（避免副本拿到不同
  时间点的 Artifact 组合，生成结束后复制可用）；写锁队列尾部完成且无后续
  排队时删除条目，避免锁 Map 无界增长（M4-L 复审 §8.2/§8.4）；
- **bindings 编辑**：自动剥离 `approved`/`approval` stamp，回到待批准；
- **screen-contract 编辑字段白名单（M4-I2，设计师权威的证据前提）**：
  通用 PATCH 仅接受设计师内容字段（`screen_name`/`purpose`/
  `primary_action`/`secondary_actions`/`required_controls`/
  `required_information`/`states`/`edge_cases`/`data_dependencies`/
  `design_constraints`/`review_metadata`）；系统身份与证据字段（`id`/
  `screen_id`/`source_inventory`/`coverage`/`status`/时间戳等）静默忽略，
  仅含系统字段的 PATCH 整体 no-op（判定在 Screen 上下文校验之后）；
  `source_inventory` 只能由重新解析更新，`coverage` 永远由后端重算；
- **screen-contract 变化四类分类（M4-J1，唯一权威来源）**：
  **semantic**（含 `secondary_actions`/`data_dependencies`/
  `design_constraints` 等全部语义键与控件 `{ id, role, required }` 签名
  变化）按路线依赖图完整传播失效、契约降级并清除旧批准印记；
  **label-only**（控件仅改 label）只失效 composition→output→fidelity 链；
  **review-only**（仅 `review_metadata`）不失效任何生产 Artifact；
  **noop**（规范化后无变化）不升版本、不写文件、不动 Workflow
  （M4-I 复审 §7/§9/§10）；
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

### 输入阶段 structured-v2 意图状态机（PR-I0~I5）

输入阶段的意图状态按 Screen 存放于 `screens/<id>/inputs.json`，由
`intentStateStore.cjs` 独占写入，包含五个字段：`intent_generation`（生成会话）、
`intent_analysis`（模型分析快照）、`intent_review`（设计师评审，权威输入）、
`intent_candidate`（待决候选）、`intent_history`（版本留档）。
`intent_mode === 'structured-v2'` 时需求文本由六段评审派生，只读展示；
旧版自由文本项目保持原样，不自动转换。

**生成状态机**（`intent_generation.status`）：

```
idle ──prefillIntent──> running ──首次且空白（无需求文本且无 review）──> 首稿直采（写 intent_review，confirmed=false）
                          │ ──已有输入──> 写 intent_candidate（status=ready，不动当前评审）
                          ├──纠正环耗尽/非法──> failed|validation-failed（error_code=INTENT_ANALYSIS_INVALID）
                          ├──超时/AbortError──> provider-timeout
                          └──其它异常──> failed；终态失败不改当前评审与 candidate，可重试。
```

- 每次开始生成记录 `requestId`，完成时 CAS 比对；被新请求抢先后旧结果静默丢弃，
  不落盘（并发请求只有一个胜出，§16 E）。
- 纠正环（kunpoClient 草稿修复）连续 3 次未返回有效内容才失败；失败前不失效现有链路。
- 崩溃自愈：启动读取时发现 `running` 遗留态，读取时自愈为 `interrupted`。

**评审与确认**：
- `intent_review` 含固定六段（页面目的 + 玩家任务/核心流程/可见控件/可见信息四列表）
  与 `uncertainties`；条目携带 `origin`（ai_visible/ai_inference/designer）与
  证据引用，设计师修改打 `designer_modified` 标记。
- 确认门禁（服务端权威，失败抛 `INTENT_REVIEW_INCOMPLETE`）：六段非空下限、
  无 `unreviewed` 待确认项、阻断级问题不允许 `deferred`、回答不得为空。
  确认后 `confirmed_at` 落盘，`requirement_confirmed=true`。
- 确认后编辑评审、恢复历史、Screen Clone、UE 替换都会取消确认（§16 F/H），
  必须重新确认才能进入下游。

**candidate 状态机**：
- 重新预填只在已有输入（需求文本或 review）时产生 candidate；candidate
  `ready` 时禁止再次生成，必须先采用或丢弃。
- 采用：整版替换评审（`confirmed=false`），旧版本以 `candidate-adopt` 原因留档历史；
  丢弃：删除 candidate，当前评审不受影响。
- candidate 记录 `base_current_revisions` 基线（requirement/intent_review/
  intent_context/wireframe），基线漂移后展示与采用均报过期（`INTENT_CANDIDATE_STALE`），
  只能丢弃后重新预填。
- 历史条目以 `review-save` / `candidate-adopt` / `restore-before` 原因留档；
  恢复需二次确认，恢复动作取消确认并再留档恢复前版本。

**stale 判定**：
- `intent_analysis.source_revision` 绑定生成时的线框修订与 Project Type；
  不一致即「基于旧 UE」（`INTENT_ANALYSIS_STALE` 语义），提示核对或重新预填。
- 下游交接：Screen Contract 生成时绑定当前评审的 `intent_context`
  revision/hash（`buildScreenContractIntentContext`）；确认后语义编辑使评审升版，
  旧契约沿既有语义/来源修订重验机制失效。
- UI 展示状态由 `deriveIntentStatus` 互斥推导（14 态：无 UE、首次生成中、
  candidate 生成中/待处理/过期、生成中断、生成失败、有 UE 无意图、旧版文本、
  基于旧 UE、已确认、草稿待审等）。
- 错误码：`INTENT_ANALYSIS_INVALID` / `INTENT_ANALYSIS_STALE` /
  `INTENT_REVIEW_INCOMPLETE` / `INTENT_CANDIDATE_STALE`（见 errorCodes.cjs）。

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
| 2.17 | 2026-08-30 | 输入阶段 structured-v2 意图状态机成文（PR-I5，v1.4 §16）：生成/评审确认/candidate/历史/stale 五段状态机与错误码；首稿直采与 candidate 分叉、CAS 并发、读取时自愈、确认后编辑与 Clone 取消确认、下游 intent_context 绑定 |
| 2.16 | 2026-08-28 | M4 归档收尾（PR-64，M4-L 复审 §8 非阻断项）：源 Screen 有 `in_progress` 阶段时禁止复制（竞态守卫，生成结束后恢复可用，含正/负向测试）；写锁队列尾部清理防无界增长（§8.2）；部署模型边界写入 `RELEASE-CHECKLIST.md`（单进程前提、扩容需跨进程协调、legacy 迁移边界，§8.1/§8.3）；验收文档按审核者 §12 口径归档 |
| 2.15 | 2026-08-28 | M4-L（PR-63，Clone 并发事务隔离，M4-K 复审 §6/§7/§3.3）：项目级异步写锁（`withProjectWriteLock`，按项目隔离、单进程部署覆盖全部会话）串行化全部 Registry/Workflow 写者，关闭并发 Clone 丢失更新与交叉回滚；并发四必测（不同 ID 全保留/同 ID 一胜/败者不回滚胜者/Create+Duplicate 不丢条目）；`fs.cp` 中途失败即时清理部分目录（存在性清理替代布尔标志）+ 重试成功测试；证据累计字节预算 `stat.size` 预检前置，最坏读取量精确等于预算 |
| 2.14 | 2026-08-28 | M4-K3（PR-62，验收文档归档与债务台账）：`m4-remediation-acceptance.md` 追加 M4-J/M4-K 整改补录；技术债台账并列披露 Issue #50 与 #57（修正「仅剩 Issue #57」表述）；说明 L3 证据位置（本地审查输出引用在 PR 描述/提交说明，CI 暂无独立 L3 Job）；结论改为按 M4-K 口径的准确归档表述 |
| 2.13 | 2026-08-28 | M4-K2（PR-61，Clone 全树 symlink 策略 + 全事务回滚，M4-J 复审 SEC-P1-02 / TX-P1-01，审核者 §8.4 终稿口径）：迁移前全树拒绝任何 symlink（链接目标不被触碰）；原始 `index.json`/`state.json` 字节备份到 `workflow/transactions/clone-<id>/`；发布顺序目录→Workflow→Registry（发布点最后）；任一写入失败自动还原备份并删除目标目录；回滚自身失败抛结构化 `CLONE_ROLLBACK_INCOMPLETE`（含事务/步骤/备份路径/人工恢复顺序，诊断记录 best-effort，不做启动期自动恢复）；「有条目无 stage」不一致状态在再复制/切换/管线操作时 Fail-Closed 阻断；故障注入测试覆盖 Workflow/Registry 失败、双重故障、干净重试与一致性检测 |
| 2.12 | 2026-08-28 | M4-K1（PR-60，Clone 遍历资源预算，M4-J 复审 SEC-MAJOR-01）：`recomputeClonedEvidence` 引入 Clone 遍历上下文——递归深度 64、单 Artifact 容器节点 2048、单次 Clone 证据记录 512、唯一字节 256MB 预算；相同真实路径只读取哈希一次（`fileCache` 去重），重复记录复用缓存；超限显式失败并入既有 Clone 回滚；4 个预算负向测试（去重/记录数/累计字节/深度） |
| 2.11 | 2026-08-27 | M4-J2（PR-59，Clone 证据安全解析与失败回滚，M4-I 复审 §8）：`recomputeClonedEvidence` 读取前经 `resolveClonedEvidencePath` 安全解析（克隆目标 Screen 目录 resolve+realpath 双阶段 containment、仅普通文件、64MB 上限），非法证据显式失败；`duplicateScreen` 原子化——失败删除部分复制目录、不写 registry，重试前清理未登记残留目录；负向测试覆盖父路径穿越、symlink 逃逸、超大文件、回滚与干净重试 |
| 2.10 | 2026-08-27 | M4-J1（PR-58，Screen Contract 变更四类分类器，M4-I 复审 §7/§9/§10）：`updateArtifact` 显式分类 semantic/label-only/review-only/noop，补齐 `secondary_actions`/`data_dependencies`/`design_constraints` 的完整失效传播并清除旧批准印记；`review_metadata`-only 不再失效生产链；完全相同保存整体 no-op；系统字段 no-op 移到 Screen 上下文校验之后；生成期门禁反馈拆分控件/信息两类（§6.3） |
| 2.9 | 2026-08-26 | 设计师权威语义裁定（PR-53）：AI 盘点清单超集约束收至生成期（`coverageGateErrors` 仅 kunpoClient 草稿修复循环使用）；批准/保存不再以覆盖差异拦截，重算写回降级为留痕信息并如实展示；保存升级统一归一化 + 重算 + 结构重验，畸形编辑拒于失效下游之前（失败原子性保留）；`SCREEN_CONTRACT_COVERAGE_INCOMPLETE` 降级为历史兼容码（注册表冻结保留）。M4-I3：生成期门禁改用服务端重算判定，不信任模型自报 `coverage.covered_items`，伪造覆盖的草稿必须进入修复轮（独立源码审核 §8.2） |
| 2.8 | 2026-08-27 | M4-I2（PR-55，Screen Contract 不可变字段边界）：`updateArtifact` 对 screen-contract 实施设计师可编辑字段白名单，系统身份/证据字段（`id`/`screen_id`/`source_inventory`/`coverage`/`status`/时间戳等）静默忽略，仅含系统字段的 PATCH 整体 no-op；API 级负向测试按审核 §7.4 形态验证（独立源码审核 §7/§8.3） |
| 2.7 | 2026-08-27 | M4-I1（PR-54，Clone 证据文件完整性）：副本中带原 Screen 前缀的物理文件重命名为目标前缀且 JSON 路径同步；内容被改写的证据文件重算 `hash`/`byte_length`（四向一致）；Fidelity `passed` 与 `approved` 一样降级 `reviewed`；完整性测试扩展文件名扫描与证据哈希复验（独立源码审核 §5/§6） |
| 2.6 | 2026-08-25 | PR-47~51（M4-H1~H4，基线 `main@0f8e9ce` 复审整改）：Clone schema 补齐 `underlay_critique`/`issue_id`/waiver/`artifact_id` 并以真实交付链重验（MAJOR-01）、Layout stale 恢复动作显式分派全部 5 种 action（MAJOR-02）、label-only Contract 编辑先校验后 invalidate 的失败原子性（MAJOR-03）、legacy Critique 缺 version 时 UI fail closed（P1-01）、Web 导出改 fetch 并回传 409、URL 携带冻结 screenId（P1-03）、job_id 并发硬化登记 Issue #50（P1-02） |
| 2.5 | 2026-08-24 | PR-40~45（M4-F1~F6）：Web/Desktop 统一最终交付门禁（WEB-DELIVERY-01，finalDeliveryGate，Web 阻断一律 409）、Job Identity 绑定与刷新错误隔离（AUD-03/04）、已批准 Contract label-only 编辑重验（AUD-06）、Web Reference no-op（AUD-07）、schema-aware Clone（AUD-13）、UI 证据守卫对齐/首版 V1/stale 恢复动作统一到 Footer（AUD-05/10/14） |
| 2.4 | 2026-08-23 | PR-35~38：批准即完整重验（AUD-06）、reference no-op（AUD-07）、art-direction 保存保留确认（AUD-08）、label 事实源与交付链失效（AUD-09）、版本单调递增（AUD-10）、草稿 Screen 隔离与 Rail 作用域（AUD-11/12）、clone lineage（AUD-13）、路线切换固定重置集合（AUD-02） |
| 2.3 | 2026-08-21 | PR-29 证据链匹配门禁、交付链绑定重验、来源修订重验、视觉取代型失效与布局校验绑定门禁限 strict 路线 |
| 2.2 | 2026-08-21 | PR-28 三条死路解除：严格底层规范状态机、视觉省略确认绑定 Pack hash、Underlay 人工复核入口 |
| 2.1 | 2026-08-21 | PR-27 批准新鲜度门禁、编辑保留 stale、事务安全与旧版循环一次性修复 |
| 2.0 | 2026-08-21 | PR-26 三路线顺序、scope-aware stale 传播、导航/执行分离 |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
