# Game UI Design Copilot 两份整改文档闭环情况独立源码审核报告

## 0. 文档信息

| 项目 | 内容 |
|---|---|
| 仓库 | `z806738350-source/Game-UI-Design-Projects` |
| 审核基线 | `main@85192b6a4dc7e94e80f44e29466b7d39f9a21350` |
| 原始问题基线 | `69ba508ac0eac0d9b588f19665c8d5a13a9a61b7` |
| 审核依据一 | `Game-UI-Design-Copilot-pipeline-flow-cycle-fix-plan(1).md` |
| 审核依据二 | `Game-UI-Design-Copilot-secondary-pipeline-bug-audit(1).md` |
| 审核范围 | 路线状态机、Artifact 依赖与 stale、严格继承生产链、证据链、参考图、跨项目任务、多 Screen、本地 UI 状态、前端频闪和布局调整、自动化测试与 CI |
| 不包含 | 主观美术质量、视觉审美签核、设计师人工操作验收 |
| 仓库治理前提 | 单人维护；本文不要求寻找 GitHub 协作者或第二审批人 |
| 最终结论 | **不通过：执行者“两个文档全部条目均已闭环”的声明不成立** |

---

# 1. 执行摘要

执行者这轮不是形式整改。相较旧基线，仓库已经发生了大规模、真实的架构和测试改造：

- `main` 比旧审核基线前进 13 个提交；
- 路线导航和模型调用已拆开；
- 新增 exploration / guided / strict 三套路线 Profile；
- Artifact 依赖改为按路线计算，并加入 Global / Screen 作用域传播；
- 新项目和引导继承的 Layout—Style 循环已从主路径消除；
- 严格路线顺序已调整为 Style → Assets / Binding → Layout；
- 增加旧项目路线循环修复器；
- 补充 Visual Reference Pack 省略确认；
- 补充 Underlay 人工复核；
- 增加 Visual Review → Composition / Fidelity 的失效与来源绑定；
- 增加 Binding / Visual 的部分 Screen 状态隔离；
- 修正 Screen 复制的部分身份；
- 将“组合所选”改为诚实的“记录组合建议”；
- 增加多组 Node、Vitest 和 Electron E2E；
- 前端增加 250ms Busy Bar 延迟、零高度通知层、disabled 延迟淡出以及底栏动作分组，确实减少了短任务造成的视觉频闪和按钮跳动。

GitHub 最新 CI Run 已成功，提交说明记录了：

```text
Node 195
Vitest 103
Electron E2E 36
TypeScript / Build / Docs / Fixture / Secret Scan / macOS Validate
```

但源码复核同时确认：**第二份审核文档中至少 6 项 P1 要求仍未实施，另有多个 P0 / Major 只完成了表面路径或部分门禁；第一份文档中的严格路线依赖、Route 切换、stale 恢复也没有完全闭环。**

因此最准确的判断是：

```text
核心 Layout—Style 死循环：已修复
大部分新增 P0 证据链门禁：已实现
前端频闪缓解：已实现
两个审核文档全部关闭：不成立
正式收口状态：仍有 Release Blocker / Major
```

当前版本不应以“两个文档全部闭环”归档，也不宜在未处理本文阻断项前再次宣布 Production Ready。

---

# 2. 审核方法与证据等级

本次不是根据执行者完成报告直接判定，而是执行以下核对：

1. 读取两份上传的原始审核文档；
2. 确认当前 `main` 的真实 SHA；
3. 对比旧基线 `69ba508...` 与当前 `85192b6...` 的 13 个提交和 70 余个修改文件；
4. 逐项阅读关键前端、Electron IPC、后端服务、Artifact 图、迁移和测试代码；
5. 查看最新 GitHub Actions Run 与 Job 结论；
6. 将“实现存在”“测试存在”“CI 运行成功”分别核对；
7. 跳过主观美术和设计师人工操作验收。

证据等级：

| 证据 | 状态 |
|---|---|
| 当前 `main` 源码逐项抽查 | 已完成 |
| 旧基线与当前主干 Diff | 已完成 |
| GitHub Actions 最终 Run | 已确认成功 |
| 关键测试文件内容 | 已抽查 |
| 在本环境重新 clone 并本地执行全部命令 | 未执行；不伪装为已执行 |
| 主观视觉与真实鼠标人工全流程 | 按用户要求排除 |

所以本文的“通过 / 不通过”是**源码级和 GitHub CI 级工程审核结论**。

---

# 3. 总体完成矩阵

## 3.1 第一份文档：路线衔接与 Layout—Style 循环

| 条目 | 审核结论 | 说明 |
|---|---|---|
| P0-01 导航与模型执行分离 | **通过** | Layout / Contract 的“进入风格锁定”已只导航，Style 页面保留唯一显式分析按钮 |
| P0-02 统一路线 Profile | **通过** | 后端 `pipelineProfile.cjs` 与前端镜像已建立，并有一致性测试 |
| P0-03 Route-aware 依赖图 | **部分通过** | 非严格循环已消除；但 Strict 的 `screen-contract → style-contract` 边缺失，Route 切换也未按旧图∪新图全量失效 |
| P0-04 Global / Screen Scope BFS | **通过** | 已使用节点级作用域队列，支持 Screen→Global→全部 Screen fan-out |
| P0-05 Style Basis | **通过** | Strict 使用 Screen Contract；Exploration / Guided 使用 Approved Layout |
| P0-06 stale 原因与恢复动作 | **部分通过** | LayoutWorkbench 已按原因指导；但 LayoutWorkspace sticky footer 仍对所有 stale 统一显示“先更新功能契约” |
| P0-07 存量项目修复 | **通过** | 有资格检查、备份、确定性布局校验、幂等和修复台账 |
| P0-08 模型失败事务安全 | **基本通过** | Screen / Layout / Style 均改为模型成功后再失效下游；视觉严格链有意在新生成前失效旧证据 |
| 三路线 Electron E2E | **通过** | 新增 exploration、guided、strict-route-order 测试 |
| 文档同步 | **基本通过** | 依赖图、状态机、恢复文档均更新 |

## 3.2 第二份文档：其他循环、证据链和使用逻辑 Bug

| 条目 | 审核结论 | 说明 |
|---|---|---|
| P0-01 stale Underlay Contract 恢复 | **通过** | 已按 none / stale / review / guide / ready 分支 |
| P0-02 Visual 参考图省略确认 | **通过** | UI、Pack hash 和目的绑定均已实现 |
| P0-03 Underlay 人工复核入口 | **通过** | 前后端动作和审计字段已实现 |
| P0-04 Critique 与 Underlay 强绑定 | **部分通过** | 只比较 Variation ID，未比较像素 hash / 当前 Visual Results 版本，且 stale Critique 仍可被 `reviewGate` 当 passed |
| P0-05 Visual 变化失效生产链 | **通过** | 生成、修复和评审变化会 stale 严格生产链，并在 Manifest / Export 重验 |
| P0-06 防止 stale 洗回 approved | **基本通过** | 普通编辑保持 stale，审批有新鲜度门禁；但可重验资产与当前 Style 的适配校验仍有限 |
| P0-07 Job Context 隔离 | **部分通过** | 成功晚到覆盖已防护；Retry 仍未冻结原 project/screen 上下文，Job 也未记录 screen_id |
| P1-01 `run()` 失败语义 | **未完成** | `run()` 仍吞异常；多个调用方仍把失败当成功 |
| P1-02 Reference no-op 不应 stale | **未完成** | onBlur 无 dirty 判断，后端无 diff，IPC 仍无条件 invalidation |
| P1-03 Art Direction 保存不应取消意图确认 | **未完成** | 只改美术方向仍提交 `requirementConfirmed:false` |
| P1-04 Screen Contract 批准时重新校验 | **未完成** | 批准仍未调用完整 `validateArtifact` / coverage 重算 |
| P1-05 Label 修改同步最终文字 | **未完成** | Binding 仍复制 label/text，Compositor 仍读取旧副本 |
| P1-06 Artifact 版本单调递增 | **未完成** | 多类生成 Artifact 和 Approved Layout 仍固定 V1 / `-v1` |
| P1-07 Binding / Visual 本地状态隔离 | **部分通过** | Binding 和 Visual 已修；Layout / Input 新本地状态仍缺 `screen_id` 重置，且固定版本放大问题 |
| P1-08 Rail 按作用域显示 | **部分通过** | Screen stage 已改善；Style 聚合错误地从 `screen_stages` 读取全局 typography/component 状态 |
| P1-09 Screen Clone 身份重写 | **部分通过** | 基础 id/screen_id/path 已改；数组里的 selected IDs、`source_proposal`、workflow output 路径仍可能保留旧 Screen |
| P1-10 Duplicate Project Screen Context | **通过** | API wrapper 已调用 `rememberScreen()` |
| P1-11 Combine 语义 | **通过** | 已改名“记录组合建议”，不再暗示生成组合图 |
| P1-12 未批准参考图提示 | **通过** | 有明确 warning 和 ignored 列表 |
| P2-01 Underlay 字段显示 | **通过** | 改为 `reserved_regions` |
| P2-02 Strict 空状态文案 | **通过** | 改为先批准功能契约 |
| P2-03 重复批准幂等 | **通过** | Reference / Binding / Underlay / Visual 有 no-op 分支 |

---

# 4. 已确认完成且方向正确的工作

## 4.1 原始 Layout—Style 死循环的核心根因已处理

当前 Route 图已拆分：

```text
Exploration / Guided:
Screen Contract → Layout → Approved Layout → Style → Visual

Strict:
Style → Font / Component / Binding → Layout → Underlay → Composition
```

非严格图中已经不存在：

```text
style-contract → layout-proposals
```

Strict 图中也不存在：

```text
approved-layout → style-contract
```

并且 `downstreamArtifacts()` 必须显式传 profile，测试加入 DFS 环检测。这是本轮最重要的正确修复。

## 4.2 导航与生成已真正分离

当前：

```text
“进入风格锁定” → onNavigate('style_resolution')
“开始风格分析” → runStage('style_resolution')
```

新项目和引导继承 E2E 均检查：进入风格阶段后 Provider 请求数仍为 0；点击显式按钮后才变为 1。

## 4.3 Strict 顺序已修正

功能契约批准后：

```text
Strict → 进入风格锁定
Exploration / Guided → 生成布局提案
```

Strict E2E 还验证了 Font / Component / Binding 四项 Gate 完成前，组件感知布局按钮保持 disabled。

## 4.4 存量循环修复器符合安全方向

`flowStateRepair.cjs` 包含：

- 仅限 exploration / guided；
- 只接受 `style_contract_regenerated`；
- 验证 Screen Contract、Canvas、Input Revisions 和 Source Proposal；
- 重跑 `validateLayout()`；
- 修改前备份；
- 写入修复 ledger；
- 健康项目重复执行为 no-op；
- Strict 项目拒绝修复。

这部分达到原文档要求。

## 4.5 严格生产链的主要证据门禁已强化

已确认实现：

- 未知 Variation 不再静默回退第一张；
- Critique Variation ID 不匹配时 UI 禁用且后端拒绝；
- Visual review 变化会 stale Critique / Manifest / Output / Fidelity；
- Composition Manifest 记录 Visual Results version、选择和 review hash；
- Final Approval 与 Export 再次重验 Visual binding；
- Underlay manual review 有 UI、理由、批准人和时间；
- Reference Pack 省略确认与 Pack hash 绑定。

## 4.6 前端频闪与功能布局优化是真实改动

执行者完成了三类真实 UI 改造：

1. **短任务 Busy Bar 延迟 250ms 显示**；
2. **Busy / Error 放入零高度 sticky overlay**，避免出现和消失时推动内容；
3. **disabled 透明度延迟 0.28s**，短暂 busy 不再让全部按钮同步闪烁；
4. **Layout Footer 把“批准方案”和“下一步”置于同一动作组**；
5. **Layout 方案选中与批准备注提升至父级**，底栏始终可见批准动作；
6. **Underlay 下一步按 Contract 状态显示正确按钮**。

这些修改确实能降低视觉频闪，并改善布局阶段按钮分散、滚动后找不到批准动作的问题。

但必须注意：它们主要改善表现层。Reference no-op 仍会造成真实后端 revision 和 stale，只是 Busy Bar 可能不再闪出来，因此不能把“看不到闪烁”误判为“逻辑副作用消失”。

---

# 5. 尚未闭环的 Release Blocker / Major

# AUD-01：Strict 的 Screen Contract 变化不会使 Style Contract stale

## 代码事实

Strict Profile 当前定义：

```js
'screen-contract': ['component-bindings', 'layout-proposals']
```

没有：

```js
'screen-contract': ['style-contract', ...]
```

但 Strict 的 Style Basis 已明确是：

```text
Screen Contract
```

## 影响

严格项目中：

```text
Style 已批准
→ 修改或重新生成 Screen Contract
→ Binding / Layout stale
→ Style 仍可能显示 approved
```

旧 Style 仍建立在旧功能契约之上，却没有被失效。由于 Style Artifact id 和 version 还可能保持不变，后续来源校验也难以发现。

## 根因

路线图只处理了“Style 不应读 Layout”，却没有补齐“Strict Screen Contract 是 Style 的真实上游”。

## 必须修复

Strict 图至少应为：

```js
'screen-contract': ['style-contract', 'component-bindings', 'layout-proposals']
```

随后由 Style 继续传播到严格资产和生产链。

## 必测

```text
Strict Style approved
→ Screen Contract 语义修改 / 重新生成
→ Style, Font, Component, Binding, Layout, Underlay, Composition, Fidelity 全部 stale
```

当前图测试只检查 `style → layout` 和无反向边，没有检查 `screen-contract → style`。

**级别：P0。**

---

# AUD-02：继承模式切换仍未按“旧路线 ∪ 新路线”清理

## 代码事实

项目模式先被保存，再调用：

```text
invalidateFromInputChange(continuationMode=true)
```

失效规划因此只使用**新模式**的 Profile。

公共根目前只是：

```js
'input-continuation-mode': ['style-contract', 'visual-task']
```

例如从 Strict 切换到 Guided 时，新 Guided 图不会包含：

```text
font-manifest
component-contract
component-bindings
underlay-contract
composition-manifest
composition-output
fidelity-report
```

其中一部分会因 Style 的新图下游消失而保留旧状态。

## 影响

模式切换后可能残留旧严格路线的 approved 资产和交付证据；切回 Strict 时这些旧事实可能重新出现在 UI 中。

## 必须修复

选择一种：

### 方案 A：旧 Profile 与新 Profile 的 downstream 并集

```text
old graph downstream
∪
new graph downstream
```

### 方案 B：固定 Route Switch Reset 集合

模式变化时无条件 stale：

```text
style/font/component/bindings/layout/underlay/visual/critique/composition/output/fidelity
```

并记录 `route_profile_changed`。

## 必测

```text
Strict 完整生产链 approved
→ 切 Guided
→ 所有 Strict 专属资产和交付链 stale
→ 再切 Strict
→ 不能复活旧 approved 状态
```

**级别：P0 / Major。**

---

# AUD-03：全局 `run()` 仍吞掉异常，失败仍被调用方当作成功

## 代码事实

当前 `run()`：

```ts
try {
  const next = await task();
  ...
  return next;
} catch (cause) {
  setError(...);
  setRetryTask(...);
  // 没有 throw
}
```

所以失败会 resolve 为 `undefined`。

仍存在的错误调用方式：

### 创建项目

```ts
await run(createProject)
setCreateOpen(false)
```

创建失败时对话框仍关闭。

### Style 保存

```ts
run(updateStyle).then(() => setEditing(false))
```

保存失败后仍退出编辑模式。

### 全部否决并重探

```ts
run(reject).then(() => run(regenerate))
```

第一步失败后第二步仍可开始。

## 修复

推荐直接让失败继续抛出：

```ts
catch (cause) {
  setError(...);
  setRetryTask(...);
  throw cause;
}
```

调用方使用：

```ts
const result = await run(...);
if (result) {
  // 成功后的 UI 动作
}
```

或者把 RunTask 改为判别联合：

```ts
{ ok: true, value } | { ok: false, error }
```

## 必测

- Create 失败时 Dialog 保持打开；
- Style 保存失败时编辑器保持打开；
- Reject 失败时不会启动 regenerate；
- Retry 失败不会重复执行后续链。

**级别：P0。**

---

# AUD-04：Retry Job Context 仍会跨项目 / Screen 串线

## 已完成部分

- Job 启动时冻结 `projectId`；
- 轮询任务所属项目；
- 晚到成功结果不会覆盖另一个当前项目；
- Cancel 使用任务所属 project id。

## 未完成部分

`retryTask` 仍只保存：

```ts
{ task, options }
```

没有：

```text
job_id
original_project_id
original_screen_id
```

### 可复现逻辑

```text
项目 A / Screen A1 任务失败
→ 切换到项目 B 或 Screen A2
→ 点击错误条“重试”
→ run() 以当前 B / A2 作为 jobProjectId
→ 但 task closure 实际仍调用旧 A / A1
```

此时 `applyJobResult()` 会把“当前项目 id”当成任务来源；跨项目时有机会错误应用，跨 Screen 时项目级 guard 完全无法区分。

另外 `applyJobResult()` 只比较：

```text
current.id 与 jobId
```

没有验证：

```text
next.id === jobId
next.screen_id === jobScreenId
```

## 修复

Retry Context 必须保存：

```ts
type JobContext = {
  jobId: string;
  projectId: string;
  screenId: string;
  stage?: StageId;
  task: () => Promise<DesignProject>;
  options: RunOptions;
};
```

Retry 使用原 Context，不重新从当前 UI 捕获上下文。

`applyJobResult` 至少验证：

```text
next.id == context.projectId
next.screen_id == context.screenId（Screen-scoped 任务）
current 上下文仍匹配时才写回
```

切换项目或 Screen 时，错误条应标明任务来源，并提供“回到任务上下文再重试”。

**级别：P0。**

---

# AUD-05：Critique 与 Underlay 只按 ID 绑定，未完成 hash / version 绑定

## 已完成部分

- 不存在或未知 Variation ID 会报错；
- Strict 合成要求 `critique.source.underlay === variation.id`；
- UI 会自动对齐已审查 Variation；
- ID 不匹配时禁用合成。

## 未完成部分

原审核要求还包括：

```text
Underlay 文件 hash
Critique evidence.underlay.hash
当前 Visual Results 版本
```

当前后端只比较 Variation ID。

而 Visual Task ID 仍是确定性的：

```text
{screen}-{strategy}-underlay-v1
```

同一策略重新生成新像素时可能继续使用同一个 id。

### 风险场景

```text
V1 id = main-conservative-underlay-v1
→ Critique passed
→ 同策略重新生成，像素已经变了，但 id 仍相同
→ 旧 Critique status 可能已 stale，但 result 仍为 passed
→ UI 的 critiquePassed 只看 result
→ 后端 reviewGate 也不先拒绝 critique.status === stale
→ ID 匹配，合成仍可开始
```

Fidelity 最终可能通过 stale dependency 阻断批准，但错误合成已经发生，证据门禁本身仍不可信。

## 修复

Critique source 应记录：

```json
{
  "underlay_id": "...",
  "underlay_hash": "sha256:...",
  "visual_results_id": "...",
  "visual_results_version": 4
}
```

Composition 前检查：

```text
critique.status != stale
critique source id == variation id
critique source hash == 当前 variation 文件 hash
critique visual version == 当前 Visual Results version
```

`reviewGate()` 对 stale Critique 必须直接失败。

**级别：P0 / Major。**

---

# AUD-06：Screen Contract 人工编辑后批准仍未重新执行完整校验

## 代码事实

当前批准逻辑只有：

```text
assert not stale
assert input revisions fresh
write status = approved
```

没有重新调用：

```text
normalizeArtifact('screen-contract')
validateArtifact('screen-contract')
coverage 重算
```

而 Contract UI 允许：

- 删除必需控件；
- 修改角色；
- 删除必要信息；
- 修改摘要；
- 保留原来的 `coverage`。

## 影响

用户可以把 UE 中的必需控件删除，然后仍批准；界面旧的“UE 来源覆盖校验通过 / 0 项遗漏”也会继续显示。

## 修复

批准前必须：

1. 归一化所有字段；
2. 重新计算 source inventory coverage；
3. 校验控件 id、角色、required；
4. 校验 `uncovered_items`；
5. 校验来源修订；
6. 通过后才写 approved。

建议错误码：

```text
SCREEN_CONTRACT_APPROVAL_INVALID
SCREEN_CONTRACT_COVERAGE_INCOMPLETE
```

**级别：P0。**

---

# 6. 未完成的 Major 使用逻辑问题

# AUD-07：Reference 无变化的 blur 仍会让全链 stale

## 当前链路

前端：

```text
页面类型 / 包含内容 / 基线 / 备注 onBlur
→ 无条件 manageReference
```

后端：

```text
无条件 references revision + 1
→ 无条件写 Reference Inventory
```

IPC：

```text
无条件 invalidateFromInputChange({ references: true })
```

所以用户只是聚焦后离开输入框，完全没有改内容，也会让 Style / Visual / 下游 stale。

250ms Busy Bar 延迟只让它“不闪”，没有消除错误副作用。

## 修复

- 前端对规范化后的旧值 / 新值做比较；
- 后端 `manageReference()` 返回 `{ changed:false }`；
- revision 仅在真实变化时增加；
- IPC 仅在 `changed:true` 时 invalidation；
- 移动到原位置、重复设置同角色、重复批准相同状态均为 no-op。

**级别：Major。**

---

# AUD-08：只改美术方向仍会取消已确认的设计意图

当前顶部保存按钮在任何 dirty 状态下都调用：

```ts
saveInput(false)
```

从而显式提交：

```text
requirementConfirmed = false
```

所以：

```text
设计意图已确认
→ 只改 Art Direction
→ 保存项目输入
→ requirement_confirmed 变 false
→ 功能契约再次被阻断
```

## 修复

提交时区分：

```ts
const requirementChanged = requirement !== project.requirement;
requirementConfirmed:
  requirementChanged
    ? false
    : project.requirement_confirmed
```

或不在普通保存中传该字段。

**级别：Major。**

---

# AUD-09：控件 Label 修改后最终文字仍可能是旧值

Binding 仍保存：

```json
{
  "label": "确认",
  "text": "确认"
}
```

Compositor 仍从：

```text
binding.text || binding.label
```

读取最终文字。

但 Screen Contract 的 label-only 修改不会 stale Binding。

结果：

```text
“确认”改成“立即装备”
→ Binding 仍 approved
→ Final 仍渲染“确认”
```

## 修复

推荐：

```text
Binding 只保存 control_id 和组件语义
Composition 根据当前 Screen Contract.control_id 读取 label
```

如允许文案覆盖，则显式保存：

```text
text_source = screen-contract | override
```

任何 label 变化至少要失效文字层、Composition 和 Fidelity。

**级别：Major。**

---

# AUD-10：Artifact 版本仍不是单调递增

当前仍存在：

```text
Approved Layout version = 1
Approved Layout id = ...-v1
Visual Task version = 1
Visual Task task_id = ...-v1
模型 Prompt 要求 version = 1
projectStore.saveArtifact() 原样写入 incoming version
```

## 影响

- 历史里重复出现多个 V1；
- React effect 依赖 `id + version` 时不刷新；
- 相同策略再生成继续使用同一 Variation ID；
- Critique / Visual / Composition 的来源识别容易撞号；
- 跨 Screen 切换时相同版本和相同 Proposal ID 更容易残留本地状态。

## 修复

版本只能由后端存储层产生：

```text
nextVersion = previousVersion + 1
```

模型返回的 version 应被忽略。

生成实体还需要：

```text
generation_id / content_hash / updated_at
```

Variation / Task ID 应包含实际版本或随机稳定 generation id。

**级别：Major。**

---

# AUD-11：Layout 和 Input 工作台仍可能跨 Screen 保留本地草稿

Binding 和 Visual 已增加 `project.id + screen_id + artifact.version` 重置，这是正确的。

但新的 LayoutWorkspace 本地状态 effect 依赖：

```text
project.id
layouts.version
preferredProposalId
approvedNotes
```

没有：

```text
project.screen_id
```

而版本仍常为 V1、不同 Screen 的 Proposal ID 也可能相同，所以切换 Screen 后：

- 未保存方案选择可能残留；
- 手工批准备注可能残留；
- 用户可能在另一个 Screen 批准错误方案或备注。

InputWorkspace 的 draft reset 同样没有 `screen_id`；两个 Screen 当前持久化文本相同时，切换后未保存内容也可能继续存在。

## 修复

所有 Screen-scoped 工作台 effect / key 必须包含：

```text
project.id + project.screen_id + artifact version/content hash
```

建议 App 渲染时：

```tsx
<LayoutWorkspace key={`${project.id}:${project.screen_id}`} ... />
<InputWorkspace key={`${project.id}:${project.screen_id}`} ... />
```

并配合版本单调递增。

**级别：Major。**

---

# AUD-12：Rail 的 Strict Style 聚合仍读取了错误 Scope

`statusOf()` 已开始区分 global / screen，这是正确方向。

但 Style 组合状态中：

```ts
const screen = workflow.screen_stages[screenId]
const strictStale = [
  screen.typography_resolution,
  screen.component_resolution,
  screen.component_binding
]
```

问题是 `updateWorkflow()` 把：

```text
typography_resolution
component_resolution
```

写入 `global_stages`，而不是 `screen_stages`。

所以 Font / Component stale 时，Style Rail 仍可能显示 approved。现有测试只构造了 `component_binding` stale，未覆盖 global Font / Component stale。

## 修复

Strict Style composite status 应读取：

```text
workflow.global_stages.style_resolution
workflow.global_stages.typography_resolution
workflow.global_stages.component_resolution
workflow.screen_stages[current].component_binding
```

任一 blocking / stale 时，Style Rail 不得显示 approved。

**级别：Major / 状态可信度。**

---

# AUD-13：Screen Clone 身份重写仍不完整

当前 clone migration 已正确处理不少基础字段，但递归函数只有在“当前对象 key”属于白名单时才重写字符串。

仍有高风险字段：

1. `selected_variation_ids` 是字符串数组；进入数组后 key 上下文丢失，元素不会重写；
2. `source_proposal` 未列入引用 key；Proposal 对象 id 可能被改成新前缀，但 Approved Layout 仍引用旧 Proposal ID；
3. workflow stage 的 `output` 路径直接从原 Screen 复制，没有统一改写；
4. 某些嵌套 source 数组和 review 引用可能保留旧 Screen ID。

当前 E2E 只验证：

```text
Screen Contract.status == reviewed
Screen Contract.screen_id == new id
```

没有遍历所有 Screen Artifact 的 id、source、路径和内部引用。

## 修复

不要使用“通用递归 + key 猜测”。应按 Artifact Schema 建立专用 clone rewriter，逐类验证。

新增完整断言：

- 所有 Screen Artifact `screen_id == target`；
- 所有 id 使用 target 前缀；
- `source_proposal` 指向副本 Proposal；
- selected IDs 指向副本 Variation；
- 所有 `screens/source/` 路径已替换；
- workflow output 路径已替换；
- 不存在任何原 Screen id 的非 provenance 引用。

**级别：Major。**

---

# AUD-14：Layout stale 外层 Footer 仍给出错误统一恢复动作

`LayoutWorkbench` 已能按 `stale_reason` 显示：

- 更新功能契约；
- 重做严格布局；
- 补严格资产；
- 旧循环修复；
- 普通重新生成。

但是外层 `LayoutWorkspace` sticky footer 仍然写死：

```text
layouts stale
→ 按钮“先更新功能契约”
→ 导航 wireframe_interpretation
```

这会和工作台内部正确指导冲突。

例如：

```text
Strict Style 变化导致 Layout stale
→ 正确动作应是回 Style / 资产面板并重新生成组件感知布局
→ Footer 却把用户送去功能契约
```

## 修复

外层 Footer 必须使用同一个 `layoutStaleGuidance()`，并根据 action 显示正确按钮；最好只保留一套恢复动作，避免两个区域互相矛盾。

**级别：Major。**

---

# 7. 对前端频闪和功能布局调整的专项评价

## 7.1 已确认有效

### Busy Bar 延迟

```text
短于 250ms 的任务不显示 Busy Bar
```

可以显著减少：

- 参考图字段保存；
- Dropdown 切换；
- 快速本地写入；

造成的顶部条闪一下即消失。

### Overlay 不占文档流

`.overlay-bar` 使用：

```css
position: sticky;
height: 0;
```

Busy / Error 出现不会把主内容整体向下推，然后再弹回。

### disabled 延迟透明度

短暂 busy 时按钮虽立即不可点击，但透明度延迟变化，减少全屏按钮同步闪烁。

### Layout Footer 重组

批准和下一步按钮并排，方案选择、备注和 Footer 共用同一状态，交互位置更合理。

## 7.2 尚未达到根因闭环

- Reference blur 的真实无效写入仍存在；
- `busy` 仍为 App 级全局布尔，某个项目任务运行时会禁用当前另一个项目的多个控件；
- Retry 上下文不完整；
- Layout / Input 本地状态可能跨 Screen；
- 通过 CSS 延迟隐藏短状态变化，不等于后端没有发生 revision/stale。

因此前端调整结论应写为：

```text
视觉频闪：明显改善
短任务布局抖动：基本改善
导致频闪的部分无效业务写入：未解决
多项目/多 Screen 状态完整性：未完全解决
```

---

# 8. 自动化测试与 CI 审核

## 8.1 已确认

最新 GitHub Actions Run 成功，7 类 Required Checks 均为 success。当前测试规模已增长到：

```text
Node 195
Vitest 103
Electron E2E 36
```

新增测试覆盖：

- Exploration 路线不自动分析；
- Guided 路线不回退 Layout；
- Strict 路线顺序；
- 依赖图环检测；
- Screen→Global→Screen fan-out；
- 旧循环修复；
- stale 保持；
- Visual review 失效生产链；
- Underlay manual review；
- Binding / Visual Screen state；
- Screen Clone 基础身份；
- Rail Screen state。

## 8.2 CI 全绿仍未覆盖的缺口

当前缺少以下直接回归用例：

```text
run failure does not close/create/continue chain
retry preserves original project + screen context
reference no-op does not increment revision or stale anything
art-direction-only save preserves requirement confirmation
screen-contract approval revalidates coverage
label-only edit changes final rendered text
artifact versions increase monotonically
strict screen-contract change stales style
route switch clears old + new route artifacts
critique hash/version must match current underlay
layout/input draft resets on screen switch
strict global font/component stale changes Style rail
screen clone rewrites every schema reference and workflow path
```

因此 CI 绿色只能证明现有 195 / 103 / 36 项所描述的行为成立，不能证明两份文档的全部要求均已被测试表达。

---

# 9. 建议的最终整改批次

## M4-A：失败语义与 Job Context（P0）

修改：

```text
src/App.tsx
src/features/shared/ui.tsx
相关工作台调用点
```

完成：

- `run()` 失败必须 throw 或返回明确失败结果；
- Retry 固定 original project/screen/job；
- Apply Result 同时验证 next project/screen；
- 创建、Style 保存、Reject→Regenerate 只在成功后执行后续动作。

## M4-B：Strict 上游与 Route Switch（P0）

修改：

```text
electron/services/artifactDependencies.cjs
electron/services/designPipeline.cjs
electron/main.cjs
```

完成：

- Strict `screen-contract → style-contract`；
- 模式切换使用 old∪new 或固定 reset 集合；
- 补完整 route transition tests。

## M4-C：Contract、文字和版本事实源（P0 / Major）

完成：

- Screen Contract approval 重算 coverage；
- Binding 文本改为当前 Contract 来源；
- Artifact version 由 Store 单调递增；
- Variation / Task generation id 唯一；
- Critique 绑定 Underlay hash 和 Visual version。

## M4-D：无效写入与 Screen 状态（Major）

完成：

- Reference 前后端 no-op diff；
- Art Direction 保存保留 intent confirmation；
- Layout / Input local state 加 Screen key；
- Rail 正确读取 global Font / Component；
- stale Footer 与 Workbench 共用恢复映射；
- Screen clone 用 Schema-specific rewriter。

## M4-E：回归与文档

增加：

```text
error-result-semantics.spec.ts
retry-job-context.spec.ts
reference-noop.spec.ts
input-confirmation.spec.ts
screen-contract-approval.test.cjs
label-render-source.test.cjs
artifact-version-monotonic.test.cjs
strict-contract-style-stale.test.cjs
route-switch-reset.test.cjs
underlay-evidence-hash.test.cjs
screen-draft-isolation.spec.ts
screen-clone-full-lineage.test.cjs
```

文档同步：

```text
PIPELINE-STATE-MACHINE
ARTIFACT-DEPENDENCY-GRAPH
FAILURE-RECOVERY
SCREEN-CONTRACT
COMPONENT-BINDINGS
COMPOSITION-MANIFEST
```

---

# 10. 最终验收门禁

执行者只有在以下全部满足后，才能再次声明两个文档全部闭环：

## 路线与依赖

- [ ] Strict Screen Contract 变化使 Style 与全部严格下游 stale；
- [ ] Guided↔Strict 切换不会遗留旧路线 approved Artifact；
- [ ] 三张 Profile 图无环；
- [ ] Global / Screen fan-out 正确。

## 错误与并发

- [ ] 失败的 `run()` 不会触发成功后的 UI 动作；
- [ ] Retry 使用原项目和原 Screen；
- [ ] 晚到响应不覆盖当前上下文；
- [ ] Cancel 绑定真实 Job。

## Artifact 可信度

- [ ] stale Artifact 不可普通编辑洗回；
- [ ] Screen Contract 批准重新计算 coverage；
- [ ] Critique id/hash/version 与 Underlay 完全一致；
- [ ] Visual 变化使生产链 stale；
- [ ] 所有生成 Artifact version 单调递增；
- [ ] Final 文本来自当前 Screen Contract 或显式 override。

## 使用逻辑

- [ ] Reference no-op 不写盘、不升 revision、不 stale；
- [ ] 只改 Art Direction 不取消 Intent Confirmation；
- [ ] Layout stale 只显示一个正确恢复动作；
- [ ] Layout / Input / Binding / Visual 切 Screen 不串草稿；
- [ ] Screen Clone 所有 Artifact lineage 完整改写；
- [ ] Rail 状态与当前 Screen / Global Gate 一致。

## 自动化

- [ ] Node / Vitest / Fixture / Electron E2E 全绿；
- [ ] 新增上述负向测试；
- [ ] Docs Validate 全绿；
- [ ] Secret Scan / macOS Validate 全绿；
- [ ] L3 台账更新；
- [ ] 不要求外部 GitHub 协作者。

---

# 11. 最终审核结论

## 对执行者工作的评价

执行者完成了大量真实工作，尤其是：

```text
原始 Layout—Style 循环
路线 Profile
Scope-aware stale
旧项目修复
Underlay 死路
Visual 证据链
多 Screen 基础隔离
前端频闪和 Layout Footer
三路线 E2E
```

这些成果应当保留，不应推翻。

但“两个审核文档全部条目均已闭环”这一结论，与当前 `main@85192b6...` 源码不一致。至少以下项目仍明确未完成：

```text
run() 错误语义
Reference no-op
Art Direction / Intent Confirmation
Screen Contract 批准重验
Label → Final Text
Artifact 单调版本
完整 Job Retry Context
Strict Contract → Style 依赖
Route Switch Reset
Critique hash/version 绑定
Layout stale Footer
Strict Rail global 状态
Screen Clone 完整 lineage
Layout / Input Screen 草稿隔离
```

因此本轮正式判定为：

```text
源码整改完成度：较高，但未完全闭环
原始主循环：通过
两份文档全部关闭：不通过
前端频闪优化：通过（逻辑根因仅部分解决）
当前归档建议：暂缓“全部完成”归档
当前发布建议：完成 M4 P0 后再重新验收
```

**最终结论：有实质进展，但执行者的“全部条目均已闭环”声明不成立。**
