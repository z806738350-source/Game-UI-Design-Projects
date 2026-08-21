# Game UI Design Copilot 路线衔接与布局—风格循环失效修复执行方案

## 0. 文档信息

| 项目 | 内容 |
|---|---|
| 仓库 | `z806738350-source/Game-UI-Design-Projects` |
| 审核基线 | PR #25 Head `69ba508ac0eac0d9b588f19665c8d5a13a9a61b7` |
| 问题级别 | **P0 / Release Blocker / 当前工具不可正常投入使用** |
| 主要影响路线 | **新项目（exploration）确定受影响；已有项目引导继承（existing-guided）确定受影响；严格继承存在额外衔接缺陷和潜在循环风险** |
| 文档用途 | 作为执行者修复、测试、验收和发布的唯一实施基线 |
| 人工美术验收 | 不在本文范围内 |

---

# 1. 结论摘要

本次问题不是单纯的按钮文案或前端显示错误，而是两个相互叠加的管线缺陷：

1. **“进入阶段”与“执行模型任务”被错误地绑定在同一个按钮上。**  
   `LayoutWorkspace` 中“进入风格锁定”按钮并不是单纯导航，而是直接调用 `runStage('style_resolution')`。由于 App 的 `run()` 会先切换当前阶段，再执行任务，用户看到的现象就是“一进入风格锁定，模型自动开始分析”。

2. **同一套静态 Artifact 依赖图被错误地用于三条顺序不同的路线。**  
   当前依赖图固定定义：

   ```text
   style-contract
   → layout-proposals
   → approved-layout
   ```

   这只适合“严格继承”中“先风格、后组件感知布局”的流程，却被同时应用到“新项目”和“引导继承”中。新项目和引导继承的实际顺序是：

   ```text
   layout
   → style
   → visual
   ```

   因此生成 Style Contract 时，后端把它刚刚读取并依赖的 Layout 标记为 stale，形成反向依赖和循环失效。

完整故障链如下：

```text
布局已批准
→ 点击“进入风格锁定”
→ 前端立即调用 style_resolution
→ 后端在请求模型前执行 invalidateArtifacts('style-contract')
→ 静态依赖图把 layout-proposals 和 approved-layout 标记为 stale
→ Style Contract 仍然生成并可批准
→ 点击“生成 3 个方向”
→ visual_exploration 强制检查 approved-layout.status === 'approved'
→ 报错“布局尚未批准”
→ 返回布局页
→ LayoutWorkbench 看到 layout-proposals.status === 'stale'
→ 阻止再次批准，并错误提示“画布或需求已变化”
→ 用户按正常按钮操作会再次回到风格解析
→ 无限循环
```

这与用户提供的三张截图完全一致。

**这不是本次 Darkroom UI 视觉整合新引入的问题。**  
相同的 `LayoutWorkspace` 跳转逻辑和 `style-contract → layout-proposals` 依赖关系在 `main@02477d4` 中已经存在；PR #25 只是让问题在新的完整界面中更容易被实际走出来。

---

# 2. 仓库代码事实与根因定位

## 2.1 问题一：导航按钮实际执行了模型任务

文件：

```text
src/features/layout/LayoutWorkspace.tsx
```

当前非严格路线在布局批准后显示“进入风格锁定”，但实际执行：

```ts
run(
  () => copilotApi.runStage(project.id, 'style_resolution'),
  {
    label: '解析视觉风格',
    stage: 'style_resolution'
  }
)
```

它不是导航。

同时：

```text
src/App.tsx
```

中的 `run()` 在任务开始前执行：

```ts
if (options.stage) setActiveStage(options.stage);
```

因此用户先看到界面切换到“风格锁定”，随后模型任务已经在后台开始。表面上像是“进入页面自动分析”，本质上是 CTA 把“导航”和“执行”混成了一个动作。

需要特别说明：

- 左侧阶段导航按钮本身只调用 `setActiveStage()`，不会执行模型；
- 问题不在某个 `useEffect` 自动触发；
- 不应错误删除 App 的 workflow/current_stage 同步逻辑；
- 真正需要修改的是阶段底部 CTA 的职责。

## 2.2 仓库已经存在正确的显式生成按钮

文件：

```text
src/features/style/StyleWorkspace.tsx
```

当前风格工作台底部已经有：

```text
data-testid="style-generate"
```

用户可在：

- 不提供参考图时直接生成；
- 先导入和批准参考图后再生成；
- 参考变化后主动重新解析。

因此 LayoutWorkspace 再直接调用 `style_resolution` 是重复且违背用户控制原则的。

正确交互应该是：

```text
进入风格锁定
→ 浏览/上传/批准参考图
→ 用户点击“生成风格规范”或“开始风格分析”
→ 才发生模型调用
```

## 2.3 问题二：依赖方向对新项目和引导继承是反的

文件：

```text
electron/services/artifactDependencies.cjs
```

当前静态依赖包含：

```js
'style-contract': [
  'font-manifest',
  'component-contract',
  'layout-proposals',
  'underlay-contract',
  'visual-task'
]
```

并且：

```js
'layout-proposals': ['approved-layout']
```

所以：

```text
downstreamArtifacts('style-contract')
```

必然包含：

```text
layout-proposals
approved-layout
```

文件：

```text
electron/services/designPipeline.cjs
```

在 `runStageUnsafe(..., 'style_resolution')` 中，请求模型前执行：

```js
await invalidateArtifacts(
  projectId,
  'style-contract',
  'style_contract_regenerated'
);
```

因此只要用户开始一次风格分析，布局就会被立即判定失效。

## 2.4 Visual 阶段正确地拒绝了失效布局

同一文件中：

```js
if (stage === 'visual_exploration') {
  const approved = project.artifacts.approvedLayout;

  if (!approved || approved.status !== 'approved') {
    throw new Error('布局尚未批准。');
  }
}
```

这项检查本身是正确的，不应删除或放宽。

错误发生在上游：Style 生成不应该在新项目/引导继承中把 Layout 置为 stale。

## 2.5 布局工作台又禁止重新批准 stale 提案

文件：

```text
src/features/layout/LayoutWorkbench.tsx
```

当前逻辑：

```ts
const stale = project.artifacts.layouts?.status === 'stale';
```

当 stale 时，只展示：

```text
画布或需求已变化，旧布局只能用于对照，不能再次批准。
```

而 `LayoutWorkspace` 对所有 stale 原因统一显示：

```text
先更新功能契约
```

实际 stale 原因却可能是：

```text
style_contract_regenerated
```

所以 UI 不仅阻止恢复，还给出了错误原因和错误恢复方向。

## 2.6 正常操作形成真正的循环

即使用户设法返回功能契约、重新生成并批准布局，当前 `LayoutWorkspace` 在非严格路线下仍会再次直接执行 Style Analysis，而不是单纯进入风格页面。

结果仍是：

```text
重新批准布局
→ 自动重新解析 Style
→ 布局再次 stale
```

因此这不是一次性状态异常，而是正常 CTA 路径中的确定性循环。

---

# 3. 三条路线的影响分析

## 3.1 新项目 / Exploration

正确顺序：

```text
Screen Contract
→ Layout
→ Style
→ Visual Exploration
```

当前实际：

```text
Layout
→ 自动生成 Style
→ Style 使 Layout stale
→ Visual 被阻断
```

结论：

> **确定受影响，属于当前用户已复现的 P0 故障。**

## 3.2 已有项目 / 引导继承 existing-guided

`existing-guided` 不属于 `strictContinuation`，在 StyleWorkspace 中与新项目一样要求先有 Approved Layout。

因此它的核心顺序同样是：

```text
Layout
→ Style
→ Underlay-only Visual
```

当前依赖图仍会执行：

```text
Style → Layout stale
```

另外：

- 如果布局完成时项目还没有参考图，当前 CTA 只导航到 Style 页面；
- 如果参考图已经存在，当前 CTA 会直接启动 Style Analysis；
- 无论是否自动启动，只要最终点击 Style Generate，布局仍会被错误置 stale。

结论：

> **确定受影响。第一项“自动分析”是否出现取决于当时是否已有参考图；第二项布局循环必然存在。**

## 3.3 已有项目 / 严格继承 existing-strict / locked-continuation

严格继承的正确顺序是：

```text
Screen Contract
→ Style
→ Font / Component / Binding
→ Component-aware Layout
→ Underlay / Composition / Fidelity
```

对这条路线，`Style → Layout` 的依赖方向本身合理。

但仓库另有两个问题：

### A. ContractWorkspace 的下一步 CTA 不区分路线

功能契约批准后，当前统一显示：

```text
生成布局提案
```

并直接调用 `layout_design`。

但严格模式后端明确要求：

- Font Manifest 已批准；
- Component Contract 已批准；
- Bindings 已批准且语义完整。

所以严格路线按 CTA 操作会立即失败。现有严格 E2E 是通过手动点击左侧 Style 阶段绕过了这个错误 CTA，因此没有发现。

### B. Strict Style 再解析时可能把 Approved Layout 当作 Style 输入

当前后端选择 Style 输入：

```js
strict
  ? approvedLayout 已批准
    ? approvedLayout
    : screenContract
  : approvedLayout
```

这意味着严格路线完成布局后再次解析 Style，会出现：

```text
Style 读取 Layout
同时 Style 又使 Layout stale
```

虽然严格路线通常还能重新走资产与布局，不一定立即死锁，但来源关系已经形成潜在循环，且 `source.approved_layout` 在实际传入 Screen Contract 时也可能记录错误类型。

结论：

> **严格路线没有与新项目完全相同的首轮死锁，但存在错误 CTA 和潜在循环来源，必须在同一轮修复中处理。**

---

# 4. 正确的产品原则

本轮修复必须遵守以下原则。

## 4.1 导航不执行副作用

任何写着以下语义的按钮：

```text
进入……
前往……
查看……
返回……
```

只能切换 UI 阶段，不得：

- 调用模型；
- 生成 Artifact；
- 修改 workflow 状态；
- 触发 stale；
- 消耗 API 配额。

模型任务必须由明确动词触发，例如：

```text
开始风格分析
生成风格规范
重新解析风格
生成布局提案
生成 3 个方向
```

## 4.2 不同路线必须使用不同依赖顺序

不能再用一份静态 `DIRECT_DEPENDENCIES` 同时代表三条顺序不同的流程。

## 4.3 不得通过弱化后端 Gate“修复”

禁止：

- 删除 Visual 对 Approved Layout 的检查；
- 允许 stale Layout 直接进入 Visual；
- 自动把 stale Layout 重新标记 approved；
- 只隐藏错误条；
- 只修改提示文案；
- 在进入 Style 页面时用 `useEffect` 延迟自动执行；
- 全局删除 `style-contract → layout`，从而破坏严格继承。

## 4.4 每一次模型调用都必须由用户明确触发

即使所有前置条件满足，进入工作台也只能显示“可执行”，不得自动执行。

---

# 5. 目标状态机

## 5.1 新项目

```text
00 输入
→ 01 功能契约生成与批准
→ 用户点击“生成布局提案”
→ 02 布局批准
→ 用户点击“进入风格锁定”（只导航）
→ 可选：上传/批准参考图
→ 用户点击“生成风格规范”
→ 03 风格批准
→ 用户点击“生成 3 个方向”
→ 04 评审与导出
```

## 5.2 引导继承

```text
00 输入
→ 01 功能契约
→ 02 布局批准
→ “进入风格锁定”（只导航）
→ 导入并批准参考图清单
→ 用户点击“生成风格规范”
→ 批准 Style
→ 用户点击生成 Underlay-only 方向
```

## 5.3 严格继承

```text
00 输入
→ 01 功能契约批准
→ “进入风格锁定”（只导航）
→ 参考图清单
→ 用户点击“生成风格规范”
→ Style 批准
→ Font / Component / Binding
→ 用户点击“生成组件感知布局”
→ 02 布局批准
→ Underlay Contract / Guide
→ Underlay / Critique / Repair
→ Composition / Fidelity / Final Approval / Export
```

---

# 6. 详细改造任务

# P0-01：拆开“导航”与“执行”

## 修改文件

```text
src/features/layout/LayoutWorkspace.tsx
src/features/contracts/ContractWorkspace.tsx
src/App.tsx
src/features/shared/pipelineRoute.ts（建议新增）
```

## 6.1 LayoutWorkspace

所有进入 Style 的分支统一只执行：

```ts
onNavigate('style_resolution');
```

不得在 LayoutWorkspace 中继续存在：

```ts
copilotApi.runStage(project.id, 'style_resolution')
```

建议按钮：

```tsx
<button
  data-testid="style-enter"
  className="button button--primary"
  disabled={busy}
  onClick={() => onNavigate('style_resolution')}
>
  <LockKeyhole size={16} />
  进入风格锁定
</button>
```

已有项目无参考图时可以改文案为：

```text
进入风格锁定并添加参考
```

但行为仍然只能导航。

## 6.2 ContractWorkspace 按路线分支

为 `ContractWorkspace` 增加：

```ts
onNavigate: (stage: StageId) => void
```

功能契约批准后：

### Exploration / Guided

保留：

```text
生成布局提案
```

并显式调用 `layout_design`。

### Strict / Locked

改为：

```text
进入风格锁定
```

只调用：

```ts
onNavigate('style_resolution')
```

不得提前调用 layout。

## 6.3 App

传递：

```tsx
<ContractWorkspace
  project={project}
  busy={busy}
  run={run}
  onNavigate={setActiveStage}
/>
```

保留左侧阶段导航只切换 `activeStage` 的现有逻辑。

## 6.4 StyleWorkspace

StyleWorkspace 继续作为唯一 Style 模型调用入口。

建议把首轮按钮文案从：

```text
生成风格规范
```

优化为：

```text
开始风格分析
```

重新生成时显示：

```text
重新解析风格
```

按钮附近显示本次将使用：

- Layout / Screen Contract 版本；
- 参考图数量；
- 被省略数量；
- 模型名称。

这部分展示可作为 P1，但不得自动执行。

---

# P0-02：新增统一的路线 Profile

## 建议新增

```text
electron/services/pipelineProfile.cjs
src/features/shared/pipelineRoute.ts
```

后端为事实来源，至少提供：

```js
function profileOf(project) {
  if (
    project.continuation_mode === 'existing-strict' ||
    project.continuation_mode === 'locked-continuation'
  ) return 'strict';

  if (project.continuation_mode === 'existing-guided') {
    return 'guided';
  }

  return 'exploration';
}
```

前端不得继续在多个工作台中各自拼接不同的 if/else 规则。

建议提供：

```text
profile
nextStageAfterContract
styleBasisKind
requiresReferenceInventory
usesStrictAssets
```

如前端必须镜像规则，应增加“前后端 Profile 一致性测试”。

---

# P0-03：将 Artifact 依赖图改成路线感知

## 修改文件

```text
electron/services/artifactDependencies.cjs
electron/services/designPipeline.cjs
electron/services/artifactDependencies.test.cjs
docs/dev/ARTIFACT-DEPENDENCY-GRAPH.md
docs/dev/PIPELINE-STATE-MACHINE.md
```

## 6.3.1 公共依赖

保留所有路线共有的链路，例如：

```text
input-requirement → screen-contract
input-wireframe → screen-contract
reference-inventory → reference-pack
layout-proposals → approved-layout
visual-task → visual-results
composition-manifest → composition-output
composition-output → fidelity-report
```

## 6.3.2 Exploration / Guided Profile

推荐直接依赖：

```text
screen-contract → layout-proposals
layout-proposals → approved-layout
approved-layout → style-contract
style-contract → visual-task
approved-layout → visual-task
visual-task → visual-results
```

关键要求：

```text
style-contract 不得再指向 layout-proposals 或 approved-layout
```

因此 Style 生成/变化不会把其上游 Layout 置 stale。

## 6.3.3 Strict Profile

保留严格路线方向：

```text
style-contract
→ font-manifest
→ component-bindings
→ layout-proposals
→ approved-layout
→ underlay-contract
→ visual-task
```

以及：

```text
style-contract → component-contract
style-contract → layout-proposals
```

关键要求：

```text
approved-layout 不得反向指向 style-contract
```

确保严格路线也不存在环。

## 6.3.4 API 形式

建议：

```js
downstreamArtifacts(kind, {
  profile
})
```

或：

```js
dependencyGraphFor(profile)
```

禁止继续只接受：

```js
downstreamArtifacts(kind)
```

而完全不知道项目路线。

---

# P0-04：修复 Global / Screen Scope 的 stale 传播

`style-contract` 是 Global Artifact，`approved-layout` 是 Screen Artifact。

当 Exploration / Guided 中：

```text
screen approved-layout → global style-contract
```

依赖图跨越了 Scope。

当前 `invalidateArtifacts()` 只根据“根节点是否 Global”决定是否遍历全部 Screen；如果传播过程中从 Screen 节点进入 Global 节点，再从 Global 节点进入 Screen 下游，现有实现不会正确 fan-out。

必须把传播改为“节点级 Scope 感知 BFS”。

## 推荐队列模型

```ts
type InvalidationNode = {
  kind: ArtifactKind;
  scope: 'global' | 'screen';
  screenId?: string;
}
```

传播规则：

| 当前节点 | 下游节点 | 目标 |
|---|---|---|
| Global | Global | 只处理一次 |
| Global | Screen | 所有未归档 Screen |
| Screen | Screen | 同一 Screen |
| Screen | Global | Global 只处理一次 |
| Screen → Global → Screen |  | 后续必须 fan-out 到所有未归档 Screen |

每个节点去重键：

```text
global:style-contract
screen:main:visual-task
screen:inventory:visual-task
```

这样才能保证：

- 一个 Screen 的种子 Layout 让全局 Style stale 时；
- 所有依赖该全局 Style 的 Screen Visual 也同步 stale；
- 不留下跨页面的假新鲜产物。

如果产品不接受“一个 Screen Layout 变化使 Global Style stale”，则不能偷偷跳过传播；必须另立架构任务，把 Style 拆成：

```text
Global Style Contract
+
Screen Composition Profile
```

本轮不要混合两种语义。

---

# P0-05：修正 Style Basis 与来源事实

## 修改文件

```text
electron/services/designPipeline.cjs
electron/services/prompts.cjs
docs/contracts/STYLE-CONTRACT-2.0.md
```

当前 Strict 路线会在已有 Approved Layout 时把 Layout 作为 Style 输入，形成潜在循环。

改为明确规则：

```js
const profile = profileOf(project);

const styleBasis =
  profile === 'strict'
    ? project.artifacts.screenContract
    : project.artifacts.approvedLayout;
```

### Strict

必须要求：

```text
screen-contract.status === approved
```

不再因为 Approved Layout 存在就改用 Layout 作为 Style 输入。

### Exploration / Guided

必须要求：

```text
approved-layout.status === approved
```

### Source 字段

不得再无论真实类型都写：

```json
{
  "approved_layout": "..."
}
```

建议：

```json
{
  "style_basis": {
    "kind": "approved-layout",
    "id": "main-approved-layout-v1",
    "screen_id": "main"
  }
}
```

或 Strict：

```json
{
  "style_basis": {
    "kind": "screen-contract",
    "id": "main-screen-contract",
    "screen_id": "main"
  }
}
```

Prompt 参数名也应从：

```text
approvedLayout
```

改为：

```text
styleBasis
```

避免执行者以后再次误读。

---

# P0-06：修复 stale 原因与恢复操作

## 修改文件

```text
src/features/layout/LayoutWorkspace.tsx
src/features/layout/LayoutWorkbench.tsx
src/features/shared/staleReason.ts（建议新增）
```

当前所有 stale 都显示：

```text
画布或需求已变化
```

这是错误的。

至少区分：

| stale_reason | 文案 | 操作 |
|---|---|---|
| `screen_contract_changed` / requirement / wireframe | 功能或画布变化 | 返回功能契约，重新生成布局 |
| `style_contract_changed`（Strict） | 风格规范变化 | 重新生成组件感知布局 |
| font/component/binding 变化 | 严格继承资产变化 | 返回严格继承面板补齐后重新生成布局 |
| `style_contract_regenerated`（旧版 Non-strict 错误） | 检测到旧版错误失效 | 执行旧项目修复，不要求重做需求 |

不要再对任意 stale 状态统一显示“先更新功能契约”。

---

# P0-07：修复已经卡死的存量项目

仅修代码不能恢复用户当前已经被错误标 stale 的项目。

必须提供一次性安全修复。

## 建议新增

```text
electron/services/flowStateRepair.cjs
electron/services/flowStateRepair.test.cjs
```

并接入：

```text
electron/services/migrations.cjs
```

或提供显式 IPC：

```text
copilot:pipeline:repair-route-cycle
```

## 识别条件

只允许修复同时满足以下条件的项目：

```text
profile 为 exploration 或 guided
layout-proposals.status === stale
approved-layout.status === stale
layout-proposals.stale_reason === style_contract_regenerated
approved-layout.stale_reason === style_contract_regenerated
style-contract 存在
screen-contract 仍为 approved
approved-layout 引用的 source_proposal 仍存在于 layout-proposals
canvas_spec 与 input_revisions 未发生真实变化
```

## 恢复动作

1. 先创建完整项目备份；
2. 恢复 `layout-proposals` 到最近历史快照的原状态；
3. 重新运行 `validateLayout()`；
4. 通过后恢复 `approved-layout.status = approved`；
5. 删除：
   - `stale_at`
   - `stale_reason`
6. 将 `workflow.layout_design` 恢复为 `approved`；
7. 写入：

```text
workflow/repairs/route-cycle-v1.json
```

内容包括：

- 修复时间；
- 原状态；
- 恢复状态；
- 校验结果；
- 备份位置；
- 修复版本。

## 禁止

不得修复：

- Strict / Locked 项目；
- stale 原因为 requirement/wireframe/screen-contract 变化的项目；
- 找不到 source proposal 的项目；
- Layout 校验失败的项目。

修复必须幂等：

```text
重复执行不会再次改写或损坏项目
```

---

# P0-08：模型任务失败时的事务安全

当前 Style 任务在调用外部模型之前就先 stale 下游。

建议改为：

```text
前置条件检查
→ 调用模型
→ 校验返回 Artifact
→ 准备失效清单
→ 在事务中写入新 Style + stale 下游 + workflow
```

如果模型请求失败：

```text
旧 Style
旧 Layout
旧 Visual
```

应保持原状态，不应因为一次失败的尝试丢失当前可用链路。

如果本轮时间不足，可先把它列为 P1，但必须创建独立 Issue，不得在完成报告里写成已解决。

---

# 7. 测试任务

当前 E2E 主要覆盖严格继承，缺少“新项目完整路线”和“引导继承完整路线”，这是本问题能长期存在的直接原因。

# 7.1 Artifact 依赖单元测试

文件：

```text
electron/services/artifactDependencies.test.cjs
```

新增：

### Exploration

```text
style-contract 的下游不包含 layout-proposals
style-contract 的下游不包含 approved-layout
style-contract 的下游包含 visual-task / visual-results
approved-layout 的下游包含 style-contract
```

### Guided

与 Exploration 相同。

### Strict

```text
style-contract 的下游包含 layout-proposals / approved-layout
approved-layout 的下游不包含 style-contract
```

### 所有 Profile

```text
无重复节点
无循环
终端节点正确
```

建议增加图的 DFS cycle detector，任何 Profile 出现环时测试直接失败。

# 7.2 Pipeline 集成测试

建议新增：

```text
electron/services/routeFlowRegression.test.cjs
```

## Case A：新项目完整成功链

```text
生成/批准 Contract
→ 生成/批准 Layout
→ 生成 Style
→ 断言 Layout Proposals 仍非 stale
→ 断言 Approved Layout 仍 approved
→ 批准 Style
→ run visual_exploration 成功
```

## Case B：引导继承完整成功链

加入：

- 参考图导入；
- Reference Inventory 批准；
- Style 生成；
- Layout 仍 approved；
- Underlay-only Visual 成功。

## Case C：严格继承顺序

```text
Contract approved
→ Style
→ Font/Component/Binding
→ Layout
```

并断言：

```text
Style 改变会 stale Strict Layout
但不会产生 Layout → Style 回边
```

## Case D：Style Provider 失败

新项目中 Style 请求失败后：

```text
approved-layout 仍 approved
layout-proposals 不变
旧 style/downstream 状态符合事务规则
```

## Case E：存量项目修复

覆盖：

- 精确 false-stale 可恢复；
- requirement 变化不可恢复；
- strict 不可恢复；
- source proposal 缺失不可恢复；
- 重复运行幂等。

# 7.3 UI Unit Tests

建议新增：

```text
src/features/layout/LayoutWorkspace.test.tsx
src/features/style/StyleWorkspace.test.tsx
src/features/contracts/ContractWorkspace.test.tsx
```

必须验证：

1. 点击“进入风格锁定”只调用 `onNavigate`；
2. 不调用 `copilotApi.runStage('style_resolution')`；
3. StyleWorkspace 初次渲染不调用任何模型接口；
4. 只有点击 `style-generate` 才调用模型；
5. Strict Contract CTA 去 Style；
6. Exploration / Guided Contract CTA 生成 Layout；
7. stale_reason 映射到正确恢复文案。

# 7.4 Electron UI E2E

建议新增：

```text
tests/ui-e2e/exploration-flow.spec.ts
tests/ui-e2e/guided-flow.spec.ts
tests/ui-e2e/strict-route-order.spec.ts
```

## UIE2E-10：新项目无自动分析

```text
批准 Layout
→ 点击“进入风格锁定”
→ 断言无 busy-bar
→ 断言没有 style-contract
→ 断言 Fixture Provider 的 Style 请求次数仍为 0
→ 点击“生成风格规范”
→ 请求次数变为 1
```

## UIE2E-11：新项目完整路线

```text
Layout approved
→ Style generated/approved
→ Layout status 仍 approved
→ 点击“生成 3 个方向”
→ 不出现“布局尚未批准”
→ 三个方向生成
```

## UIE2E-12：引导继承

同上，但先导入并批准参考图。

## UIE2E-13：严格路线顺序

```text
Contract approved
→ CTA 显示“进入风格锁定”
→ 不调用 layout_design
→ 完成 Style/Font/Component/Binding 后
→ 才出现“生成组件感知布局”
```

## 测试边界

- 所有用户动作通过 UI；
- Fixture Provider 只替代外部网络；
- 不得直接通过 `window.designCopilot.updateArtifact()` 伪造成功；
- 状态读取可使用只读快照；
- 失败时上传 Trace、截图、主进程日志和项目快照。

---

# 8. 文档同步

必须更新：

```text
docs/dev/PIPELINE-STATE-MACHINE.md
docs/dev/ARTIFACT-DEPENDENCY-GRAPH.md
docs/user/quick-start-guide.html
docs/user/WORKBENCH-GUIDE.md
docs/user/FAILURE-RECOVERY.md
```

文档必须分别展示三条路线，不得再只写一张通用依赖图。

`ARTIFACT-DEPENDENCY-GRAPH.md` 至少包含：

```text
Profile: exploration
Profile: guided
Profile: strict
```

`check-docs` 增加事实门禁：

```text
“进入风格锁定”不得描述为自动分析
Exploration/Guided 中 Style 不得使 Layout stale
Strict 中 Contract 后不得直接生成 Layout
```

---

# 9. 推荐提交拆分

在 PR #25 合并前完成。建议追加以下提交：

## Commit A

```text
fix(flow): separate stage navigation from model execution
```

范围：

- ContractWorkspace
- LayoutWorkspace
- App
- UI Unit

## Commit B

```text
fix(pipeline): introduce route-aware artifact dependencies
```

范围：

- pipelineProfile
- artifactDependencies
- scope-aware invalidation
- style basis/source

## Commit C

```text
fix(migration): repair legacy non-strict style-layout false stale
```

范围：

- flowStateRepair
- migrations
- 备份/修复台账

## Commit D

```text
test(flow): cover exploration guided and strict route transitions
```

范围：

- Node integration
- UI Unit
- Electron E2E
- failure cases

## Commit E

```text
docs(flow): document route-specific state machines and recovery
```

范围：

- 状态机
- 依赖图
- Quick Start
- Failure Recovery

不要把所有修改压成一个不可审查的大提交。

---

# 10. 验收门禁

以下全部满足后才允许宣布修复完成。

## 用户控制

- [ ] 进入 Style 页面不会发生模型请求；
- [ ] 左侧阶段导航永远无生成副作用；
- [ ] 只有显式点击“生成/重新解析风格”才执行；
- [ ] UI 显示将使用的参考图和输入版本。

## 新项目

- [ ] Style 生成后 `layout-proposals` 不 stale；
- [ ] Style 生成后 `approved-layout` 仍 approved；
- [ ] Style 批准后可直接生成 3 个方向；
- [ ] 不再出现“布局尚未批准”循环。

## 引导继承

- [ ] 参考图上传和批准发生在显式 Style 生成之前；
- [ ] Style 不反向失效 Layout；
- [ ] Underlay-only Visual 可正常推进。

## 严格继承

- [ ] Contract 后 CTA 去 Style，不提前执行 Layout；
- [ ] Style/Font/Component/Binding 完成后才允许 Layout；
- [ ] Style Basis 不再读取已批准 Layout；
- [ ] Style 变化按严格 Profile 正确使组件感知布局 stale。

## 存量项目

- [ ] 当前已卡死项目无需重建；
- [ ] false-stale 被安全恢复；
- [ ] 真实上游变化导致的 stale 不会被误修；
- [ ] 修复有备份、日志且幂等。

## 自动化

- [ ] Node tests 全绿；
- [ ] UI Unit 全绿；
- [ ] Exploration E2E 全绿；
- [ ] Guided E2E 全绿；
- [ ] Strict route order E2E 全绿；
- [ ] Fixture E2E 全绿；
- [ ] docs-validate 全绿；
- [ ] macos-validate 全绿；
- [ ] secret-scan 全绿。

---

# 11. 禁止性捷径

执行者不得采用以下方式“让测试通过”：

```text
删除 visual_exploration 的 approved-layout Gate
允许 stale Layout 继续生成
将 stale 状态直接改为 approved
隐藏错误横幅
在 Style 页面 useEffect 自动补跑任务
只修新项目，不测试 Guided / Strict
只改前端，不改 Artifact 图
只改 Artifact 图，不恢复已卡死项目
用 API 直接写 Artifact 代替 UI E2E
```

---

# 12. 最终 Definition of Done

本次故障只有在以下结果真实成立时才算关闭：

```text
导航与生成完全分离
+
三条路线拥有明确且无环的状态机
+
Artifact 依赖按路线计算
+
Global/Screen stale 传播正确
+
新项目可以 Layout → Style → Visual 一次走通
+
引导继承可以 Layout → Style → Underlay 一次走通
+
严格继承可以 Style → Assets → Layout → Production 一次走通
+
当前被错误 stale 的项目可安全恢复
+
三条路线都有真实 Electron E2E
```

---

# 13. 最终审核判断

当前问题已经通过代码定位，结论明确：

> **根因是“导航与执行耦合”加上“严格路线依赖图被错误复用于非严格路线”。**

这两个问题相互叠加，导致新项目和引导继承在正常操作路径中形成确定性的 Layout—Style stale 循环。

当前版本不应继续被标记为可正常投入使用，也不应在未修复前合并 PR #25。

执行者应优先完成本文 P0-01 至 P0-08，并以三条路线真实 Electron E2E 作为最终关闭证据。
