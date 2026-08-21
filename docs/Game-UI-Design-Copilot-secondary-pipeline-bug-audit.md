# Game UI Design Copilot 二次深挖审计补充报告
## 其他循环、永久阻塞、状态绕过与使用逻辑 Bug

## 0. 审计信息

| 项目 | 内容 |
|---|---|
| 仓库 | `z806738350-source/Game-UI-Design-Projects` |
| 代码基线 | PR #25 Head `69ba508ac0eac0d9b588f19665c8d5a13a9a61b7` |
| 与上一份报告关系 | 本文为《路线衔接与布局—风格循环失效修复执行方案》的补充审计 |
| 审计范围 | 五阶段主流程、严格继承生产链、参考图、Artifact stale、批准、跨项目/多页面状态、版本与 UI 本地状态 |
| 结论 | 除已确认的 Layout—Style 循环外，另发现多项可形成永久阻塞、错误恢复循环、状态绕过或跨上下文污染的问题 |

---

# 1. 总体判断

当前仓库的问题不止一处。

新增发现可以分成四类：

1. **硬循环 / 永久阻塞**  
   用户重复点击当前唯一按钮也永远不能继续。

2. **证据链错配**  
   A 图的审查结果可以被拿去批准 B 图，或旧最终结果在新视觉已经变化后仍保持可导出。

3. **stale 保护可被绕过**  
   失效 Artifact 可通过编辑、重新批准或“无变化更新”重新变成 approved，而没有重新建立真实来源。

4. **UI 状态与后端状态脱节**  
   任务跨项目覆盖、Screen 状态串线、生成成功后界面仍显示旧草稿、输入无意中被取消确认。

以下问题均来自当前代码的确定逻辑，不是单纯的体验建议。

---

# 2. 新增 P0 / Release Blocker

# P0-01：严格继承 Underlay Contract stale 后进入永久重试循环

## 现象

严格继承项目已经完成：

```text
Underlay Contract approved
→ Layout Guide 已生成
```

之后只要 Style、Layout 或上游严格资产发生变化，依赖传播会把 Underlay Contract 标记为：

```text
status = stale
```

但 stale 操作只是展开旧对象并写入状态，不会删除旧的：

```text
layout_guide
```

布局页判断下一步时只检查：

```ts
project.artifacts.underlayContract?.layout_guide
```

不检查：

```ts
underlayContract.status === 'approved'
```

因此页面会显示：

```text
生成底层图
```

而不是：

```text
重新建立底层规范
```

后端视觉生成又明确要求：

```text
Underlay Contract.status === approved
且
layout_guide.path 存在
```

最终形成：

```text
点击“生成底层图”
→ UNDERLAY_SPEC_REQUIRED
→ 返回同一页面
→ 仍然只有“生成底层图”
→ 再次报错
```

## 修复

布局页必须按完整状态判断：

```text
无 Contract
→ 建立底层规范

Contract generated/reviewed
→ 批准 Contract

Contract stale
→ 根据当前 Layout 重新建立 Contract

Contract approved 但无 Guide
→ 生成 Guide

Contract approved 且有 Guide
→ 生成底层图
```

不得仅依据 `layout_guide` 是否存在。

## 必测

```text
完成严格 Underlay Guide
→ 修改 Style
→ 重做严格 Layout
→ 布局页必须显示“重新建立底层规范”
→ 完成后可继续生成 Underlay
```

---

# P0-02：视觉生成的参考图容量确认没有可达入口

## 现象

Style 分析阶段超过参考图上限时，StyleWorkspace 有“确认省略项并继续”的入口。

但视觉生成阶段也会重新构建：

```text
purpose = underlay-generation
```

的 Reference Pack。

严格模式还会把 Layout Guide 作为额外附件，所以更容易超过 Provider 上限。

视觉阶段超过上限后：

```text
保存 requires_omission_confirmation = true
→ 抛 REFERENCE_OMISSIONS_CONFIRMATION_REQUIRED
```

然而：

- “生成 3 个方向”没有传 `confirmReferenceOmissions`；
- “补全缺失方向”没有传；
- “仅重试此方向”没有传；
- 全局错误条的“重试”只是重复原始参数；
- 视觉页面没有“确认省略项并继续”按钮。

结果：

```text
视觉生成失败
→ 点击重试
→ 仍未确认
→ 再次失败
→ 永久循环
```

返回 Style 页面也不能真正解决，因为 Style 按钮确认的是新一轮 Style Pack；下次 Visual 会重新建立 Underlay Pack，再次要求确认。

## 修复

增加与任务目的绑定的确认动作：

```ts
runStage('visual_exploration', {
  confirmReferenceOmissions: true,
  ...
})
```

确认 UI 必须展示：

- 视觉任务用途；
- 入选参考；
- 被省略参考；
- Layout Guide 是否占用一个附件位；
- Provider 容量。

确认事实必须绑定当前 Pack 的 hash/version，参考图变化后重新确认。

---

# P0-03：Underlay 的“人工复核”状态没有任何完成入口

## 现象

Critique 在以下情况会设置：

```json
{
  "manual_review": {
    "required": true,
    "approved": false
  }
}
```

典型条件包括：

- 缺少语义证据；
- Critique 置信度低；
- 严格审查输入证据不完整。

`reviewGate()` 会在 `manual_review.approved !== true` 时永久阻断。

当前应用只有：

- 自动审查；
- 修复并复审；
- issue waiver 后端能力；
- 只读 Underlay Workbench。

没有任何 API 或 UI 能把：

```text
manual_review.approved
```

设为 true。

而单条 issue waiver 也不会解除 `manualBlocked`。

因此文档中存在“人工复核”的概念，但产品里没有完成该动作的路径。

## 结果

用户只能：

```text
反复修复
→ 反复复审
→ 若模型持续低置信度则一直阻断
```

这是一条真实的人工恢复死路。

## 修复

新增独立动作：

```text
approveUnderlayManualReview
```

要求：

- 展示完整证据；
- 输入人工结论和理由；
- 记录 approved_by / approved_at；
- 不允许自动把 blocker 变为通过；
- 仅允许处理 manual-review-required 类状态。

或者重新定义 waiver，使特定完整 waiver 可同步完成 manual review，但必须有明确审计记录。

---

# P0-04：A Underlay 的 Critique 可以批准 B Underlay

## 现象

StrictProductionPanel 判断是否可合成时，只检查当前项目是否存在一个：

```text
result = passed / passed-with-waiver
```

的 Critique。

它没有验证：

```text
critique.source.underlay === 当前选中的 underlayId
```

后端 `composeVisual()` 会选择用户传入的 Variation；如果 id 不存在甚至会静默退回第一张。

随后 `createCompositionManifest()` 只执行：

```text
reviewGate(currentCritique)
```

仍然不验证 Critique 与 Variation 是否属于同一张图片。

## 可复现路径

```text
生成 V1、V2、V3
→ 审查 V1 并通过
→ 改选 V2
→ “合成预览/最终 PNG”仍可点击
→ V2 使用 V1 的审查结果进入合成
```

修复链更容易触发：

```text
原图 V1 审查失败
→ 生成 V1-repair 并复审通过
→ VisualWorkspace 因旧 review 仍选中 V1
→ 页面把 V1 与 V1-repair 的 Critique 混用
```

## 风险

这会使最终 Fidelity 和最终批准建立在错误证据链上，是比普通 UI Bug 更严重的可信度问题。

## 修复

所有入口必须校验：

```text
Critique.source.underlay
==
Variation.id
```

同时校验：

- Underlay 文件 hash；
- Critique evidence.underlay.hash；
- Composition Manifest 的 underlay hash；
- 当前 Visual Results 版本。

不匹配时按钮禁用，并提示“当前选中底图尚未审查”。

---

# P0-05：视觉结果变化不会使旧 Composition / Fidelity / Final Approval 失效

## 现象

依赖图声明：

```text
visual-results
→ composition-manifest
→ composition-output
→ fidelity-report
```

但实际以下操作没有调用：

```text
invalidateArtifacts('visual-results')
```

包括：

- 重新生成一个视觉方向；
- 补全缺失方向；
- 重新生成全部方向；
- 改变批准的视觉方向；
- 从 selected 改为 combine；
- 修改组合选择。

视觉生成会直接覆盖/保存 `visual-results`；批准只写新的 review。

因此可能出现：

```text
旧视觉 A
→ 已合成 final
→ Fidelity passed
→ Composition Manifest approved
→ 重新生成或批准视觉 B
→ 旧 final 仍 approved
→ 导出按钮仍可用
```

## 风险

用户以为当前选择已经变成 B，但正式交付仍可能是 A。

现有最终导出只校验当前 Composition/Fidelity 相互一致，不校验它们是否来自当前 Visual Results review。

## 修复

在以下事件后使生产链 stale：

```text
visual-results 内容变化
visual-results review 变化
selected/combine 决策变化
```

Composition Manifest Source 必须增加：

```json
{
  "visual_results": "...",
  "visual_results_version": 4,
  "selected_variation_ids": ["..."],
  "review_hash": "..."
}
```

Final Approval 和 Export 再次校验这些字段。

---

# P0-06：stale Artifact 可被“洗回” approved

## 现象

`updateArtifact()` 对绝大多数 Artifact 的处理是：

```text
先失效下游
→ 合并 patch
→ status = reviewed
→ 保留旧 source
```

它没有检查当前 Artifact 是否 stale，也没有验证旧 source 是否仍对应当前输入。

之后多个批准动作只验证结构或资产：

- Style Contract：结构校验；
- Font Manifest：字体校验；
- Component Contract：结构与文件校验；
- Screen Contract：甚至没有再次调用完整 Contract 校验。

因此存在以下绕过：

### Style

```text
Style stale
→ 点击编辑
→ 保存一个无关字段
→ status 变 reviewed
→ 批准并锁定
```

旧 Style 的来源仍可能是旧 Layout / 旧参考图。

### Font

字体工作台只要 Manifest 存在就允许点击“批准”，可直接重新批准 stale Manifest。

### Component

组件“批准”操作会先把当前 families 原样提交一次 `updateArtifact()`，即使完全没有变化，也会把 stale 转为 reviewed，然后再批准。

### Screen Contract

stale Contract 只要进行一次语义编辑，就可以变 reviewed，再批准；没有重新读取已经变化的 UE/需求。

## 修复

批准门禁必须先执行通用新鲜度检查：

```text
status !== stale
source revisions == 当前 revisions
source artifact id/version/hash == 当前上游
```

stale Artifact 只能通过：

- 明确重新生成；
- 有证据的 deterministic revalidation；
- 专门的迁移/修复动作。

普通编辑不得清除 stale。

---

# P0-07：运行中切换项目会出现错误项目覆盖、错误取消和错误重试

## 现象

顶栏项目下拉框在 Busy 状态下没有禁用。

用户在项目 A 运行模型任务时切换到项目 B：

1. Busy 轮询 effect 会开始轮询 B；
2. A 的任务完成后，`run()` 会把 A 的返回值直接写入 `project`；
3. `preserveProjectPreviews()` 遇到不同项目 id 时直接返回 `next`；
4. 当前界面会突然从 B 跳回 A；
5. “停止剩余任务”使用当前 `project.id`，可能尝试取消 B，而真实任务在 A；
6. 失败后的 retryTask 也没有绑定当前 UI 上下文，切换项目后点击“重试”仍可能重跑 A 并覆盖 B。

代码注释只在失败后的 reload 分支做了项目 id 防护；成功分支没有防护。

## 修复

每个 Run Job 记录：

```text
job_id
project_id
screen_id
stage
started_at
```

任务完成时只有当前上下文仍匹配才更新界面。

项目切换可继续允许，但：

- Busy 面板必须明确显示任务属于哪个项目；
- Cancel/Retry 使用 Job Context，而不是当前 Project；
- 轮询原 Job Project；
- 不允许晚到响应覆盖新项目。

---

# 3. 新增 P1 / Major

# P1-01：全局 run() 吞掉异常，调用方把失败当成功

`run()` 捕获异常后只显示错误，不重新抛出，Promise 会正常 resolve 为 `undefined`。

已有调用把 `.then()` 或后续代码当成“任务成功”：

### 创建项目

```text
创建失败
→ run 返回 undefined
→ 仍关闭创建对话框
```

### Style JSON 保存

```text
保存失败
→ .then(() => setEditing(false))
→ 编辑器仍退出
```

### 全部否决并重探

```text
记录否决失败
→ 第一个 run 仍 resolve
→ 第二个 run 仍开始重新生成
```

## 修复

推荐二选一：

```ts
run(): Promise<DesignProject>  // 失败继续 throw
```

或：

```ts
{ ok: true, value } | { ok: false, error }
```

所有后续动作只在 `ok === true` 时执行。

---

# P1-02：参考图无变化的 blur 也会让整条流水线 stale

ReferenceWorkbench 的用途、内容、基线、备注均在 `onBlur` 时直接调用保存，没有 dirty 检查。

后端 `manageReference()` 无论值是否变化都会：

```text
references revision +1
→ 保存新 Reference Inventory
```

IPC 随后无条件执行：

```text
invalidateFromInputChange({ references: true })
```

结果：

```text
点击备注框
→ 什么也没改
→ 点击空白处
→ Style / Visual / 下游可能全部 stale
```

“批准参考图清单”也不是幂等的；即使已批准且内容未变化，重新点一次也会失效下游。

## 修复

前后端双重 diff：

- UI 仅 dirty 时提交；
- 后端深比较标准化数据；
- 没有变化返回 `changed:false`；
- revision 不增加；
- 不触发 invalidation；
- 批准已批准且内容未变时为 no-op。

---

# P1-03：只修改美术方向并点击保存，会取消已经确认的设计意图

InputWorkspace 顶部“保存补充说明”调用：

```ts
saveInput(false)
```

这会显式提交：

```text
requirementConfirmed = false
```

即使用户没有修改 Requirement，只修改 Art Direction，后端仍会接受该布尔值并把原本已确认的设计意图改为未确认。

结果：

```text
已确认意图
→ 只改美术方向
→ 保存
→ 意图被取消确认
→ 功能契约生成再次被阻断
```

## 修复

只有 Requirement 文本发生变化时才自动取消确认。

Art Direction 独立保存不得修改 Requirement Confirmation。

---

# P1-04：Screen Contract 人工编辑后可以未经完整校验直接批准

模型生成时会调用 `validateArtifact('screen-contract')`。

但人工编辑后的 `approveArtifact('screen-contract')` 只做：

```text
存在性检查
→ status = approved
```

不重新验证：

- 控件 id 唯一性；
- role；
- coverage；
- uncovered_items；
- source inventory 覆盖；
- 数组与字段结构。

因此用户可以删除一个 UE 必需控件、保留旧 coverage，然后仍批准。

UI 甚至会继续显示：

```text
UE 来源覆盖校验通过
0 项遗漏
```

因为 coverage 没有重新计算。

## 修复

Screen Contract 每次批准都必须：

1. normalize；
2. validateControls；
3. validateArtifact；
4. 重新计算 coverage；
5. 确认 `uncovered_items=[]`；
6. 再写 approved。

---

# P1-05：仅修改控件文案不会更新最终渲染文字

当前设计规定：

```text
Screen Contract 只改 label
→ 不 stale bindings
```

但 Binding 保存时把控件 label 复制为：

```json
{
  "label": "...",
  "text": "..."
}
```

Composition 又从 Binding 的 `text/label` 读取最终文字。

因此：

```text
原按钮“确认”
→ 已绑定并批准
→ 在功能契约中改为“立即装备”
→ 因 label-only 不 stale
→ 最终 Composition 仍渲染“确认”
```

## 修复

建议 Binding 只保存：

```text
control_id
```

渲染时从当前 Screen Contract 解析最新 label。

如果业务允许 Binding 单独覆盖文案，则必须显式区分：

```text
text_source = screen-contract | override
```

Screen Contract label 变化时，至少要 stale 文字层/Composition。

---

# P1-06：生成 Artifact 的版本号长期固定为 V1，界面可能不刷新

Prompt 明确要求模型每次返回：

```json
{
  "version": 1
}
```

`requestArtifact()` 又会保留模型提供的合法整数，而不是根据旧 Artifact 递增。

同时：

- Approved Layout 每次创建也固定 `version:1`；
- Visual Task/Results 每次生成固定 `version:1`；
- ContractWorkspace 和 StyleWorkspace 依赖 `artifact.id + artifact.version` 重置本地草稿；
- VisualWorkspace 依赖 `project.id + artifact.version + variations.length` 重置选择。

因此重新生成相同 Artifact 时：

```text
id 不变
version 仍为 1
数量也可能不变
→ useEffect 不触发
→ UI 继续显示旧草稿、旧选择或旧批注
```

历史列表也可能出现多条难以区分的 V1。

## 修复

模型不应拥有版本号决定权。

后端保存前统一：

```text
newVersion = previousVersion + 1
```

模型只返回领域内容。

所有 UI 同步建议额外依赖：

```text
updated_at / content_hash / generation_id
```

---

# P1-07：Binding 和 Visual 本地状态会跨 Screen / 项目串线

## BindingWorkbench

`choices` 初始化为空，没有：

- 从现有 Binding Artifact hydrate；
- 在 `project.id` 变化时 reset；
- 在 `screen_id` 变化时 reset；
- 在 Binding version 变化时 reset。

结果：

- 打开已批准 Binding 时下拉框仍全部空白；
- 要修改一个绑定必须重新选择全部；
- 不同 Screen 如果控件 id 相同，旧选择可能直接带到新 Screen；
- 项目切换也可能携带上一项目选择。

## VisualWorkspace

选择状态 effect 没有依赖：

```text
project.screen_id
approvedIds 内容
```

批注 `notes` 也没有任何切换时 reset。

两个 Screen 都有三张图、version 都为 1 时，切换后很可能继续保留上一 Screen 的 variation id 与批注。

后端部分操作会报“选择无效”，`composeVisual` 甚至会在 id 不存在时静默退回第一张。

## 修复

工作台 key 至少包含：

```text
project.id + screen_id
```

并从当前 Artifact hydrate。

不允许 silently fallback 到第一张 Variation；无效 id 必须明确报错。

---

# P1-08：多 Screen 左侧阶段状态显示的是“最后操作页面”，不是当前页面

`updateWorkflow()` 对每个 Screen 操作都会同时写：

```text
workflow.stages[stage]
workflow.screen_stages[screenId][stage]
```

但左侧 Rail 的 `statusOf()` 只读取：

```text
workflow.stages[stage]
```

完全不读取当前 Screen 的 `screen_stages`。

因此：

```text
Screen A Layout approved
→ Screen B Layout stale
→ 最后一次操作 B
→ 切回 A
→ 左侧 Layout 仍显示 stale
```

反过来也可能把尚未完成的 Screen 显示为 approved。

严格子阶段 Font/Component/Binding 也没有汇总到 Style Rail，Style 可能仍显示 approved，而严格门禁早已 stale。

## 修复

Rail 状态必须按作用域聚合：

```text
Global Stage → workflow.global_stages
Screen Stage → workflow.screen_stages[activeScreenId]
Composite Stage → 根据子 Gate 推导
```

不要把顶层 `workflow.stages` 作为多 Screen 唯一事实源。

---

# P1-09：复制 Screen 后，所有 Artifact 身份仍属于原 Screen

`duplicateScreen()` 直接递归复制整个 Screen 目录，只改写：

```text
inputs.json.screen_id
```

但不会改写：

- screen-contract.screen_id；
- Artifact id；
- source 引用；
- approved-layout.screen_id；
- visual task/results id；
- composition/fidelity source；
- workflow output path 中的身份。

现有 E2E 甚至明确断言：

```text
battle-copy 的 Screen Contract.screen_id 仍是 battle
```

这与 Screen Contract 文档中“screen_id 是所属 Screen 稳定 id”相冲突。

## 风险

- 原页和副本 Artifact id 冲突；
- 全局 Artifact History 混在一起；
- Source lineage 指向原 Screen；
- 后续重生成会出现一半旧身份、一半新身份；
- 审批、Inspector 和诊断难以判断产物真实归属。

## 修复

复制 Screen 必须执行专用 clone migration：

- 生成新 Artifact id；
- 重写 screen_id；
- 重写内部 source；
- 保留 `duplicated_from_screen_id`；
- 已批准事实是否继承需要明确产品策略；
- 推荐复制后把需要重新确认的 Artifact 降级为 reviewed。

---

# P1-10：复制项目后立即操作可能缺少 Screen Context

API 包装层对：

```text
createProject
openProject
setActiveScreen
runStage
```

会维护 `activeScreenIds`。

但：

```ts
duplicateProject()
```

没有调用 `rememberScreen()`。

ProjectManager 的 `run()` 会直接把 Duplicate 返回的新项目设为当前项目；如果用户立刻执行 Screen-scoped 操作，wrapper 可能传入空 `screenId`，后端抛：

```text
SCREEN_ID_REQUIRED
```

直到项目被重新 open/switch 后才恢复。

## 修复

```ts
duplicateProject: async (...) =>
  rememberScreen(await api().duplicateProject(...))
```

---

# P1-11：“组合所选”并没有真正组合任何视觉方向

UI 文案承诺：

```text
组合所选
```

后端实际只保存：

```json
{
  "review": {
    "mode": "combine",
    "selected_variation_ids": ["V1", "V2"]
  }
}
```

没有：

- 组合 Prompt；
- 新的组合 Variation；
- 组合 Manifest；
- 合成规则；
- 合并结果。

严格生产面板最终只使用：

```text
selected[0]
```

即所谓“组合”实际退化成第一张。

## 修复

二选一：

1. 真正生成组合任务和新 Variation；
2. 将按钮改名为“记录组合建议”，明确它只是评审批注，不是成图。

---

# P1-12：上传的新项目参考图如果未批准，会被静默忽略

新项目 `canGenerate` 不要求 Reference Inventory approved。

但 `buildReferencePack()` 会过滤：

```text
asset.approved === false
```

新上传图片默认正是 `approved:false`。

因此：

```text
用户上传参考图
→ 未注意逐张批准
→ “生成风格规范”仍可点
→ 模型完全没收到这些图片
```

界面没有强提示“已上传但不会使用”。

## 修复

只要存在未批准上传图：

- 明确提示“这些参考不会进入本次分析”；
- 或要求用户确认“忽略未批准参考并继续”；
- Reference Pack 预览必须展示 selected/ignored。

---

# 4. P2 / 一致性问题

## P2-01：Underlay Workbench 展示了错误字段

Underlay Contract 使用：

```text
reserved_regions
```

但 UnderlayWorkbench JSON 摘要读取：

```text
artifact.slots
```

所以结构契约面板可能显示空 slots，用户无法在可视面板确认真实保留区。

## P2-02：Strict Style 空状态文案仍提示“先批准布局”

Strict 路线实际以 Screen Contract 为 Style 前置，但 StyleWorkspace 的通用空状态仍可能显示：

```text
先批准布局，再生成风格规范
```

这会把用户再次引向错误顺序。

## P2-03：多处“批准”按钮不是幂等操作

Reference Inventory、Bindings、Underlay Contract 等重新批准相同内容时仍会 stale 下游。

批准相同版本应当：

```text
no-op
```

只有内容、来源或批准策略版本变化时才传播 stale。

---

# 5. 推荐修复顺序

## 第一批：立即阻断错误交付

```text
P0-04 Critique/Underlay 强绑定
P0-05 Visual 变化 stale Production
P0-06 禁止 stale 洗回 approved
P0-07 Job Context 隔离
```

## 第二批：解除永久死路

```text
P0-01 stale Underlay Contract 恢复
P0-02 Visual Reference Pack 确认
P0-03 Manual Review 完成入口
```

## 第三批：修复常规使用逻辑

```text
P1-01 run 错误语义
P1-02 no-op Reference invalidation
P1-03 Input 确认状态
P1-04 Screen Contract 批准校验
P1-05 Label 来源
P1-06 Artifact 版本
```

## 第四批：多页面与工作台状态

```text
P1-07 本地状态隔离
P1-08 Screen 状态聚合
P1-09 Screen Clone 重写
P1-10 Duplicate Project Context
P1-11 Combine 语义
P1-12 Reference 使用提示
```

---

# 6. 必须新增的回归测试

## 循环与恢复

```text
strict-underlay-stale-recovery.spec.ts
visual-reference-omission-confirmation.spec.ts
underlay-manual-review.spec.ts
```

## 证据链

```text
underlay-critique-variation-binding.test.cjs
visual-results-production-invalidation.test.cjs
stale-artifact-approval-guard.test.cjs
```

## 并发上下文

```text
project-switch-during-job.spec.ts
retry-job-context.spec.ts
cancel-job-context.spec.ts
```

## 使用逻辑

```text
reference-noop-does-not-invalidate.spec.ts
art-direction-save-preserves-intent.spec.ts
screen-contract-revalidate-on-approve.test.cjs
label-change-render-source.test.cjs
artifact-version-monotonic.test.cjs
```

## 多 Screen

```text
screen-workbench-state-isolation.spec.ts
screen-stage-status-isolation.spec.ts
duplicate-screen-lineage.spec.ts
duplicate-project-screen-context.spec.ts
```

## 视觉评审

```text
combine-semantics.spec.ts
visual-selection-reset-on-screen-switch.spec.ts
```

---

# 7. 修复验收红线

以下任意一项存在，仍不得宣布可投入使用：

- [ ] stale Underlay Contract 仍只显示“生成底层图”；
- [ ] Reference Pack 超限只能重复点击重试；
- [ ] manual_review.required 没有完成入口；
- [ ] Critique 不校验当前 Variation；
- [ ] Visual Results 变化后旧 Final 仍 approved；
- [ ] stale Style/Font/Component 可直接重新批准；
- [ ] 运行中切换项目会被晚到任务覆盖；
- [ ] 无变化 Reference blur 会 stale 流水线；
- [ ] Screen Contract 编辑后批准不重新校验；
- [ ] Label 修改后最终文字仍旧；
- [ ] 新一轮 Artifact 版本仍固定 V1；
- [ ] Screen 切换后 Binding/Visual 本地选择串线；
- [ ] 复制 Screen 后 Artifact.screen_id 仍属于原页面；
- [ ] “组合所选”仍只使用第一张。

---

# 8. 最终结论

除上一份报告中的：

```text
进入 Style 即自动分析
+
Style 反向使 Layout stale
```

之外，当前代码还存在多项独立的管线级问题。

其中最危险的不是普通 UI 显示，而是：

```text
错误证据可以批准另一张图
旧最终结果不会随新视觉失效
stale Artifact 可以被重新洗成 approved
跨项目任务可以覆盖当前项目
```

因此本次整改不应只修 Layout—Style 一条链。

建议把本文列出的 P0 项合并进同一个 Release Blocker Milestone，完成后再重新进行三路线、严格生产链和多 Screen 的端到端验收。
