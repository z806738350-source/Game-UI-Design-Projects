# Game UI Design Copilot M4（AUD-01～14）独立源码复审报告

## 0. 文档信息

| 项目 | 内容 |
|---|---|
| 仓库 | `z806738350-source/Game-UI-Design-Projects` |
| 本次复审基线 | `main@3342346886b45c79817d45b7ddeaf8f767b2ec44` |
| 对比起点 | `main@85192b6a4dc7e94e80f44e29466b7d39f9a21350` |
| 涉及 PR | #35、#36、#37、#38、#39 |
| 审核范围 | AUD-01～14、相关负向测试、CI、桌面端与仓库内 Web 端实现 |
| 不包含 | 主观美术质量、视觉审美和 UI 设计师人工签核 |
| 审核日期 | 2026-08-23 |
| 审核方式 | GitHub 最终源码逐项比对 + PR/CI 证据核验；未把执行者报告直接视为完成证明 |

---

# 1. 验收基线

第一份整改文档把完整关闭条件定义为：导航和生成分离、三条路线无环、路线感知依赖、Global/Screen stale 传播正确、三条路线均可一次走通、存量错误状态可恢复，并具有真实 Electron E2E。fileciteturn221file0L1421-L1442

第二份补充审计则明确规定：只要 stale Underlay 死路、参考图省略死路、人工复核无入口、Critique 证据不匹配、旧 Final 未失效、stale 可重批、跨项目任务覆盖、Reference no-op 仍 stale、契约批准不重验、旧文案、重复 V1、跨屏串线、Clone 身份残留等任意一项存在，就不能宣布可投入使用。fileciteturn221file1L1196-L1213

因此，本次复审采用以下判定标准：

```text
代码实际存在
+
后端边界真实阻断
+
前端存在可达恢复路径
+
负向测试能抓住回归
+
桌面端与仓库内 Web 端语义一致
```

仅有 PR 描述、注释、测试数量或 CI 绿色，不能单独证明条目已完整闭环。

---

# 2. Git、PR 与 CI 真实性

## 2.1 最终提交

GitHub 当前 `main` 的精确提交为：

```text
3342346886b45c79817d45b7ddeaf8f767b2ec44
```

PR #39 已合并，`merge_commit_sha` 与当前 `main` 一致；PR 描述确实声明新增 AUD-06/08/09/10/11/12 负向测试，并报告后端 203、UI Unit 122、E2E 36。fileciteturn278file0L1-L2

## 2.2 CI

PR #39 对应 GitHub Actions Run：

```text
32603751863
```

状态为：

```text
completed
conclusion: success
```

Head 为 `cd07dcc0c67b49e1560681f211a7d9b5f579a0c2`。fileciteturn262file0L1-L2

通过 GitHub Actions Job 结果核对，以下七项均为 success：

```text
validate
docs-validate
ui-unit
ui-e2e
fixture-e2e
macos-validate
secret-scan
```

## 2.3 复验边界说明

本次能够确认：

- PR 和合并提交真实存在；
- 最终源代码已进入 `main`；
- PR Head 的 GitHub CI 七项成功；
- 测试文件和关键断言真实存在；
- 关键生产代码不是仅靠测试伪造。

本环境未能独立执行一次新的本地 `pnpm install && pnpm test...` 全套复跑，因此本文把“运行通过”限定为 GitHub CI 证据，把“行为正确性”建立在源码和测试实现的独立审计上。

---

# 3. 总体结论

## 3.1 最终判定

> **有条件不通过。**

执行者完成了大量实质整改，M4 不是形式性提交；原始 Layout—Style 循环、路线依赖、证据链、Reference no-op 的桌面端逻辑、Contract 批准重验、文字事实源、版本递增、多 Screen 草稿隔离等均有真实代码落地。

但以下结论仍不成立：

```text
AUD-01～14 已全部完整闭环
当前版本可以直接归档为最终完成
```

原因是当前 `main` 仍存在：

- 1 项新发现的 **P0 Web 正式导出旁路**；
- 5 项 AUD 条目只完成了部分路径；
- 2 项实现基本完成但仍留有明确边界缺口；
- 部分负向测试使用了简化字段，没有覆盖生产 Artifact 的真实字段结构。

## 3.2 状态统计

| 状态 | 数量 | 条目 |
|---|---:|---|
| 已验证完整闭环 | 6 | AUD-01、02、08、09、11、12 |
| 核心闭环但有残余 | 2 | AUD-05、10 |
| 仍为部分闭环 | 6 | AUD-03、04、06、07、13、14 |
| 新发现 P0 | 1 | WEB-DELIVERY-01 |

---

# 4. AUD-01～14 逐项复核矩阵

| AUD | 执行者声明 | 源码复核结果 | 判定 |
|---|---|---|---|
| AUD-01 Strict 契约依赖 Style | 已闭环 | Strict 图已加入 `screen-contract → style-contract`，并有完整下游断言 | ✅ 通过 |
| AUD-02 路线切换固定重置 | 已闭环 | 已新增固定 reset 集合并跨 Global/Screen 执行 | ✅ 通过 |
| AUD-03 错误结果语义 | 已闭环 | 三个已知调用点已防止失败后继续，但列表刷新失败仍会把成功 mutation 误判为失败并提供重复重试 | ⚠️ 部分 |
| AUD-04 Retry/Job Context | 已闭环 | 已冻结 project/screen 并限制 Retry，但 Cancel、Polling、返回对象身份校验仍不完整 | ⚠️ 部分 |
| AUD-05 Critique hash/version | 已闭环 | 后端已完整校验 stale、ID、Visual version、像素 hash；前端仍只按 result/ID 放行按钮 | ◐ 核心通过 |
| AUD-06 Contract 批准重验 | 已闭环 | 显式批准会重算 coverage；但已批准 Contract 的 label-only 编辑可保持 approved，绕开重验 | ⚠️ 部分 |
| AUD-07 Reference no-op | 已闭环 | Electron 路径已完成前后端 no-op；Web 路由仍无条件 stale | ⚠️ 部分 |
| AUD-08 Art Direction 保留确认 | 已闭环 | 前端不再传 false，后端只在需求变化时取消确认 | ✅ 通过 |
| AUD-09 Contract Label 事实源 | 已闭环 | Composition 从当前 Contract 读取 label，并使旧 Composition 下游失效 | ✅ 通过 |
| AUD-10 版本单调递增 | 已闭环 | 存储层已统一递增并生成 generation_id/hash；首次保存仍接受调用方给定版本 | ◐ 基本通过 |
| AUD-11 Screen 草稿隔离 | 已闭环 | Input/Layout 均按 project/screen/version 重建，App 也增加 key | ✅ 通过 |
| AUD-12 Rail 作用域 | 已闭环 | 全局字体/组件与 Screen Binding 已按正确作用域聚合 | ✅ 通过 |
| AUD-13 Clone 完整身份 | 已闭环 | 已补数组和部分引用，但仍以 key 白名单猜测；多个真实生产字段不在白名单 | ⚠️ 部分 |
| AUD-14 stale 恢复一致性 | 已闭环 | Footer 已按 guidance 分派；Workbench 仍对所有 stale 常驻“重新生成布局” | ⚠️ 部分 |

---

# 5. 已确认完整闭环的条目

## 5.1 AUD-01：Strict Screen Contract 正确位于 Style 上游

当前 Strict 依赖图已经包含：

```js
'screen-contract': [
  'style-contract',
  'component-bindings',
  'layout-proposals'
]
```

因此 Strict 功能契约变化会使 Style 以及其严格下游失效，而 `approved-layout` 不会反向使 Style stale。fileciteturn227file0L1-L2

测试还显式检查：

```text
screen-contract change
→ style-contract
→ font/component/binding/layout/underlay/composition/fidelity
```

并继续执行全图无环检测。fileciteturn287file0L1-L2

**判定：通过。**

---

## 5.2 AUD-02：路线切换使用固定重置集合

当前后端已经增加：

```text
ROUTE_SWITCH_RESET_KINDS
```

覆盖 Style、Font、Component、Binding、Layout、Underlay、Visual、Critique、Composition、Output 和 Fidelity，并对 Global 与所有活动 Screen 处理。fileciteturn229file0L1-L2

Electron IPC 也会把切换前模式传给失效逻辑。fileciteturn231file0L1-L2

Web 路径虽然没有传 `previousContinuationMode`，但当前固定 reset 的行为不依赖该值，仅影响审计元数据，不影响重置集合本身。

**判定：通过。**

---

## 5.3 AUD-08：只改 Art Direction 不再取消设计意图确认

InputWorkspace 普通保存不再发送：

```text
requirementConfirmed: false
```

只有显式确认时才发送 true。fileciteturn254file0L1-L2

后端 `saveProject()` 的语义是：

```text
未显式传 confirmation
+
requirement 未变化
→ 保留原确认状态
```

并有独立负向测试验证 Art Direction 保存保持确认、需求文本变化才取消确认。fileciteturn274file0L1-L2

**判定：通过。**

---

## 5.4 AUD-09：最终文字以当前 Screen Contract 为事实源

Compositor 会从当前 Screen Contract 建立：

```text
control_id → current label
```

映射，在生成文字层时覆盖 Binding 中旧的 `text/label` 副本。fileciteturn255file0L1-L2

label-only 编辑也会使：

```text
composition-manifest
→ composition-output
→ fidelity-report
```

失效，要求重新合成。fileciteturn245file0L1-L2

负向测试已证明 Binding 保留旧文案时，Composition 仍使用当前 Contract label。fileciteturn275file0L1-L2

**判定：AUD-09 的文字事实源要求通过。**

需要注意：Contract label 编辑后的批准有效性仍存在 AUD-06 关联缺口，见第 7.3 节。

---

## 5.5 AUD-11：Input/Layout 草稿按 Screen 隔离

当前：

- InputWorkspace 的同步依赖包含 `project.screen_id`；
- LayoutWorkspace 的选择和批注重置包含 `project.screen_id`；
- App 对 Input/Layout 使用 `project.id:screen_id` 作为 key。fileciteturn254file0L1-L2 fileciteturn259file0L1-L2 fileciteturn234file0L1-L2

专项测试覆盖：

- A Screen 未保存布局选择不能进入 B；
- Layout 版本变化后旧选择重置；
- A Screen 未保存需求和美术方向不能进入 B。fileciteturn276file0L1-L2

**判定：通过。**

---

## 5.6 AUD-12：Rail 正确读取 Global/Screen 状态

Style Rail 现在会读取：

```text
global_stages.typography_resolution
global_stages.component_resolution
screen_stages[current].component_binding
```

任一为 stale/blocked 时，不再继续显示 Style 已批准。fileciteturn239file0L1-L2

**判定：通过。**

非阻断建议：后续可以把 `failed`、`rejected` 也纳入“未就绪”集合，避免异常状态仍沿用 Style approved 外观。

---

# 6. 核心安全已闭环、但 UI/边界仍不完整

## 6.1 AUD-05：后端证据绑定通过，前端仍是旧判断

### 已完成

Critique 现在记录：

```text
underlay id
underlay hash
visual_results_id
visual_results_version
```

`reviewGate()` 会直接拒绝 stale Critique。fileciteturn244file0L1-L2

Composition 前后端还会重新验证：

```text
Critique.status != stale
Critique underlay id == selected variation id
Critique visual_results_version == current version
Critique underlay_hash == current materialized pixels hash
```

fileciteturn246file0L1-L2 fileciteturn247file0L1-L2

因此，错误证据进入最终合成的核心安全边界已经建立。

### 未完成

StrictProductionPanel 仍然只用：

```ts
critique.result === 'passed' || 'passed-with-waiver'
```

判断绿灯，并只比较：

```text
critique.source.underlay == underlayId
```

它没有在 UI 层检查：

- `critique.status === stale`；
- `source.visual_results_version`；
- 当前 Visual Results version。

因此 stale Critique 仍可能显示绿色“污染审查”、合成按钮仍可点击，直到后端报错。fileciteturn271file0L1-L2

### 判定

```text
后端安全：通过
前端预防与状态表达：未完整
```

**级别：P1 / 非数据旁路，但影响使用逻辑和状态可信度。**

---

## 6.2 AUD-10：版本主逻辑完成，首次保存仍未完全由存储层接管

当前 `saveArtifact()` 已经统一生成：

- `previous.version + 1`；
- `generation_id`；
- `content_hash`；
- `updated_at`。fileciteturn251file0L1-L2

视觉 Task/Variation ID 也加入生成批次戳，不再固定 `-v1`。fileciteturn257file0L1-L2 fileciteturn258file0L1-L2

但首次保存仍使用：

```js
previous
  ? previous.version + 1
  : Math.max(1, Number(artifact.version) || 1)
```

这意味着首次调用方传入 `version: 9` 时，仍会保存为 V9，与注释中“调用方传入版本一律忽略”不一致。

当前专项测试只重复传入 `version:1`，没有注入首版 `version:99`。fileciteturn256file0L1-L2

### 判定

```text
常规生成链：通过
存储层绝对拥有版本权：仍有 P2 缺口
```

建议改为：

```js
const version = previous
  ? Number(previous.version || 0) + 1
  : 1;
```

---

# 7. 仍未完整闭环的 AUD 条目

# 7.1 AUD-03：成功 Mutation 与列表刷新仍共用同一个失败边界

执行者已正确修复：

- 创建失败不关闭 Dialog；
- Style 保存失败不退出编辑；
- Reject 失败不启动 Regenerate。fileciteturn234file0L1-L2 fileciteturn235file0L1-L2 fileciteturn236file0L1-L2

但当前 `run()` 仍把：

```ts
const next = await task();
setProject(...);
await refreshProjects();
return next;
```

放在同一个 `try/catch` 内。fileciteturn281file0L1-L2

### 可复现逻辑

```text
createProject / approve / update 等真实 mutation 成功
→ setProject 已写入成功结果
→ listProjects 刷新因临时 I/O/网络失败
→ catch 把整个任务标为失败
→ run 返回 undefined
→ 错误条提供“重试”
→ 用户重试真实 mutation
```

创建项目场景中可能产生第二个重复项目；其他非幂等任务也可能重复执行。

当前 App 测试只覆盖“mutation 本身失败”，没有覆盖“mutation 成功、refreshProjects 失败”。fileciteturn280file0L1-L2

### 修复

把业务任务与辅助刷新拆开：

```ts
const next = await task();
setProject(...);
setRetryTask(null);

try {
  await refreshProjects();
} catch (refreshError) {
  // 仅记录非阻断刷新错误，不得把 mutation 改判为失败
}

return next;
```

### 判定

**AUD-03 部分闭环，级别 P0/P1 边界。**

---

# 7.2 AUD-04：Job Context 仍没有形成真正的 Job Identity

### 已完成

- retryTask 已保存 projectId/screenId；
- Retry 只在用户回到原项目和 Screen 时开放；
- `applyJobResult` 会检查当前 UI 是否仍处于任务项目/Screen；
- Busy Bar 会显示任务所属项目。fileciteturn234file0L1-L2 fileciteturn240file0L1-L2

### 缺口 A：不验证返回对象本身

`applyJobResult()` 检查的是：

```text
current.id / current.screen_id
```

但没有检查：

```text
next.id == jobId
next.screen_id == jobScreenId
```

如果 API 或晚到响应返回错误项目/Screen，而当前 UI 恰好仍在原上下文，错误 `next` 仍会被应用。

现有测试也只验证“current 已切换”的场景，没有注入“next 自身身份错误”。fileciteturn270file0L1-L2

### 缺口 B：Polling 和失败 reload 没有显式打开原 Screen

代码调用：

```ts
copilotApi.openProject(jobProjectId, {
  includePreviews: false
})
```

没有传 `jobScreenId`。fileciteturn281file0L1-L2

当前公开 `openProject()` 参数也没有 `screenId`。fileciteturn238file0L1-L2

因此它依赖项目当前 active screen，而不是任务冻结时的 Screen。

### 缺口 C：Cancel 没有传冻结 Screen

`cancelVisual()` 只传项目 id：

```ts
copilotApi.cancelStage(jobId, 'visual_exploration')
```

没有传 `busyJob.screenId`。fileciteturn234file0L1-L2

后端 cancellation 集合也仅按 `projectId` 建键，而不是 `projectId + screenId + jobId`。fileciteturn284file0L1-L2 fileciteturn285file0L1-L2

单客户端 UI 在 busy 时禁用了 Screen 切换，降低了触发概率；但 Web 多会话、直接 API 或未来并行任务仍存在串线风险。

### 修复

```ts
type JobContext = {
  jobId: string;
  projectId: string;
  screenId: string;
  stage?: StageId;
};
```

并要求：

```text
applyJobResult 同时校验 current 和 next
Polling 显式 open 原 Screen
Cancel 显式传原 Screen / Job ID
后端取消键至少为 projectId:screenId:jobId
runStage 失败状态写回 input.screenId
```

### 判定

**AUD-04 部分闭环，级别 Major。**

---

# 7.3 AUD-06：批准动作重验完成，但 label-only 编辑可绕过批准边界

### 已完成

`approveArtifact('screen-contract')` 现在会：

1. normalize；
2. recomputeCoverage；
3. validateArtifact；
4. 根据缺陷类型返回覆盖或结构错误码；
5. 通过后才写 approved。fileciteturn249file0L1-L2

`contracts.cjs` 也新增了真实 coverage 重算。fileciteturn250file0L1-L2

### 仍存在的旁路

`updateArtifact()` 判断 required_controls 是否“语义变化”时只比较：

```text
id
role
required
```

忽略 label。

当一个已批准 Contract 只修改 label 时：

```text
screenContractContentChanged = false
nextStatus = 原 status
```

所以它可以保持 `approved`，不会重新调用 coverage 重算和 Contract 校验，只使 Composition 下游 stale。fileciteturn245file0L1-L2

### 可复现示例

```text
source_inventory 要求：保存阵容
已批准控件：id=save, label=保存阵容

人工把 label 改为：删除角色
id / role / required 均不变
→ Contract 仍 approved
→ 旧 coverage 仍可声称“保存阵容已覆盖”
→ 无需再次点击批准
```

新增的 AUD-06 测试只覆盖“删除 required control”这种会改变语义签名并降级状态的场景，没有覆盖“只改 label、但使 source coverage 失真”。fileciteturn272file0L1-L2

### 修复

label-only candidate 在写入前也必须：

```text
normalize
→ recomputeCoverage
→ validateArtifact
```

策略二选一：

1. 校验通过时允许保持 approved，失败则拒绝保存；
2. label-only 编辑一律降级 reviewed，要求重新批准。

推荐方案 1，兼顾效率与真实性。

### 判定

**AUD-06 部分闭环，级别 Major。**

---

# 7.4 AUD-07：Electron 完成，Web 路径仍无条件 stale

### Electron 路径

ProjectStore 会先规范化比较，未变化时返回：

```json
{
  "changed": false
}
```

且不写 project、不增加 revision、不写 Inventory。fileciteturn252file0L1-L2

ReferenceWorkbench 也在 UI 层跳过等价 blur。fileciteturn253file0L1-L2

Electron IPC 会根据 `changed` 决定是否执行 Reference invalidation。fileciteturn230file0L1-L2

### Web 路径

`server/webServer.cjs` 仍然：

```js
await projectStore.manageReference(projectId, body);
await designPipeline.invalidateFromInputChange(
  projectId,
  { references: true }
);
```

它完全忽略 `changed:false`。fileciteturn283file0L1-L2

因此在线/飞书 Web 版本中：

```text
Reference blur 无变化
→ ProjectStore 不写 revision
→ Web route 仍使 Style/Visual 下游 stale
```

虽然 revision 不再增加，但用户仍然会丢失批准链。

### 修复

```js
const result = await projectStore.manageReference(projectId, body);
if (result.changed) {
  await designPipeline.invalidateFromInputChange(
    projectId,
    { references: true }
  );
}
value = result.project;
```

并增加 Web Server 集成测试。

### 判定

**AUD-07 只在 Electron 闭环；全仓库判定为部分闭环，级别 Major。**

---

# 7.5 AUD-13：Clone 仍使用字段白名单猜测，真实生产字段有漏网

### 已完成

当前 Clone 已补：

- `selected_variation_ids` 数组；
- `source_proposal`；
- workflow output 路径；
- approved 降级 reviewed；
- 部分嵌套 source。fileciteturn266file0L1-L2

测试也验证了这些字段。fileciteturn279file0L1-L2

### 仍未覆盖的真实字段

当前 `CLONE_SOURCE_REF_KEYS` 中没有：

```text
task_id
visual_tasks
visual_results_id
underlay_id
parent_underlay_id
repair_task_id
critique
layout_version
```

而真实生产代码确实会写入：

- Visual Task 的 `task_id`；
- Visual Results source 的 `visual_tasks`；
- Variation 的 `layout_version`；
- Repair Variation 的 `parent_underlay_id`、`repair_task_id`；
- Critique source 的 `visual_results_id`。fileciteturn257file0L1-L2 fileciteturn258file0L1-L2 fileciteturn244file0L1-L2 fileciteturn246file0L1-L2

现有 Clone 深度测试使用的是：

```text
source.visual_task
```

但生产保存的是：

```text
source.visual_tasks
```

所以测试通过并不能证明真实 Visual Results source 已正确重写。

### 风险

复制页面后可能形成：

```text
副本 Artifact 根 id 属于新 Screen
但 task/source/repair lineage 仍指向原 Screen
```

这会影响：

- Inspector；
- Evidence lineage；
- Repair；
- Critique；
- 后续诊断；
- 版本追溯。

### 修复

不要继续扩大通用 key 白名单。

推荐为每类 Artifact 建立专用 rewriter，或至少使用 Registry Schema 逐类列出：

```text
identity fields
reference fields
path fields
provenance fields
```

测试应先通过真实 pipeline 生成完整 Strict Screen Artifact 树，再执行 Duplicate Screen，并递归验证除明确 provenance 外不存在原 Screen 身份。

### 判定

**AUD-13 部分闭环，级别 Major。**

---

# 7.6 AUD-14：Footer 已修复，但 Workbench 仍暴露冲突动作

LayoutWorkspace Footer 已使用 `layoutStaleGuidance()`，按 action 显示：

- 更新功能契约；
- 一次性修复；
- 重新生成布局。fileciteturn259file0L1-L2

但 LayoutWorkbench 在任何 stale 状态下仍固定显示：

```text
重新生成布局
```

仅在 legacy 场景额外增加修复按钮。fileciteturn260file0L1-L2

### 冲突示例

```text
stale_reason = screen_contract_changed
Footer：先更新功能契约
Workbench：重新生成布局
```

此时 Workbench 按钮很可能直接被后端 Contract Gate 拒绝。

Strict 资产 stale 时也会出现：

```text
提示：先补字体/组件/绑定
按钮：重新生成布局
```

### 修复

只保留一套恢复动作。推荐：

- Workbench 只显示原因和证据；
- 所有恢复操作集中到 sticky Footer；

或者给 Workbench 传入与 Footer 完全相同的 action handler，不再无条件渲染 regenerate。

### 判定

**AUD-14 部分闭环，级别 P1 / 使用逻辑。**

---

# 8. 新发现的 P0：Web 严格导出绕过 Final Approval 与 Fidelity Gate

这是本次复审中最严重的新发现，未出现在执行者 M4 汇报中。

## 8.1 Electron 桌面端是正确的

桌面端 Strict 导出会依次检查：

```text
Fidelity passed 且绑定当前 Manifest/Output
→ Final Composition Manifest 已批准
→ Visual Results 绑定仍新鲜
→ Output 文件、hash、尺寸有效
→ 才允许保存
```

fileciteturn273file0L1-L2

## 8.2 Web 端没有使用同一 Gate

Web 路由：

```text
GET /api/projects/:id/visual/:variation
```

在 Strict 模式下只执行：

```text
verifyCompositionOutput(requireFinal: true)
→ 读取 PNG
→ 返回下载
```

没有检查：

- `compositionManifest.status === approved`；
- `fidelityReport.status === passed`；
- Fidelity 是否绑定当前 Output；
- Manifest 是否仍绑定当前 Visual Results；
- `assertFinalApprovalForExport()`。fileciteturn282file0L1-L2

`server/webServer.cjs` 甚至没有导入 `assertFinalApprovalForExport`。fileciteturn264file0L1-L2

Web 前端的导出实现就是直接创建该 GET 链接，因此后端路由是正式交付边界，不是内部不可达代码。fileciteturn238file0L1-L2

## 8.3 可复现链

```text
生成 Final Composition PNG
→ 尚未运行 Fidelity，或 Fidelity 失败
→ 尚未 Final Approval
→ 直接访问 Web 下载 URL
→ PNG 仍可被下载
```

## 8.4 影响

这会绕过此前建立的正式交付制度：

```text
Final Fidelity
→ Human Final Approval
→ Export
```

属于服务端授权/业务 Gate 旁路。

## 8.5 修复

不要在 Electron 和 Web 中各写一套导出门禁。

新增共享服务，例如：

```text
electron/services/finalDeliveryGate.cjs
```

提供：

```js
async function assertFinalDeliveryReady({
  project,
  projectPath
}) {
  // fidelity freshness
  // final approval
  // visual binding
  // output verification
}
```

Electron IPC 和 Web Route 都调用同一函数。

## 8.6 必测

Web Server 集成测试：

1. Final PNG 已生成但未 Fidelity → HTTP 409；
2. Fidelity failed/stale → HTTP 409；
3. Fidelity passed 但未 Final Approval → HTTP 409；
4. Visual review 变化后旧批准 → HTTP 409；
5. Output hash 被篡改 → HTTP 409；
6. 全部新鲜并批准 → HTTP 200，响应 hash 与 Output 一致。

### 判定

**P0 / Release Blocker。**

---

# 9. 前端频闪和布局优化复核

M4 之前的前端优化仍然真实存在：

- Busy Bar 延迟 250ms；
- Overlay 不占文档流；
- disabled 透明度延迟；
- Layout Footer 动作成组；
- Input/Layout 通过 Screen key 重建。

这些改动能够减少：

```text
顶部进度条闪现
全页按钮透明度同步跳变
通知条推挤主体内容
切屏后旧草稿闪回
```

但需要如实区分：

```text
视觉频闪缓解：已完成
业务无效写入全部消除：未完成（Web Reference 路径）
任务上下文完整隔离：未完成
stale 恢复动作完全统一：未完成
```

---

# 10. 自动化测试评价

## 10.1 已确认的新增覆盖

M4 新增或强化了：

- Strict Contract → Style 依赖；
- Route Switch 固定 reset；
- 创建失败不关闭；
- Retry 当前上下文检查；
- Critique ID/hash/version 后端 Gate；
- Screen Contract 批准重算 Coverage；
- Art Direction 保留确认；
- Contract Label 渲染事实源；
- Storage version 单调递增；
- Input/Layout Screen 草稿隔离；
- Rail global/screen 作用域；
- Clone 的数组/source_proposal/workflow 路径；
- Footer stale guidance。

## 10.2 仍缺少的负向回归

必须增加：

```text
mutation 成功 + refreshProjects 失败，不得重试 mutation
applyJobResult 拒绝 next.id 错误
applyJobResult 拒绝 next.screen_id 错误
Cancel 使用原 job screen
Web Reference no-op 不 stale
Web Strict export 未批准/未 Fidelity 必须 409
已批准 Contract label-only 破坏 coverage 时不得保持 approved
Critique stale/version mismatch 时 UI 禁用合成
首次保存 caller version=99 仍存 V1
Clone 真实 visual_tasks/task_id/visual_results_id/repair lineage
update-contract stale 时 Workbench 不显示可失败的“重新生成布局”
```

## 10.3 E2E 数量不等于新问题已覆盖

M4-E 的 Electron E2E 数量仍为 36。新增大量 M4 行为主要依赖 Node/Vitest 负向测试；这本身不是错误，但以下边界必须增加集成级测试：

- Web Server delivery gate；
- Web Reference no-op；
- refresh failure 与 mutation 分离；
- Cancel/Retry 原 Screen；
- Clone 完整生产 Artifact 树。

---

# 11. 下一轮整改执行方案

建议建立单人维护专项里程碑：

```text
M4-F：Final Closure Verification
```

不要求寻找外部 GitHub 协作者。

## M4-F1：统一 Web/Desktop Delivery Gate（P0）

修改：

```text
electron/services/finalDeliveryGate.cjs（新增）
electron/main.cjs
server/webServer.cjs
server/webServer.test.cjs
```

完成：

- Web/桌面共用同一最终导出 Gate；
- 补 Web 直接 URL 负向测试；
- 禁止任何未经 Fidelity + Final Approval 的严格成图外流。

## M4-F2：完成 Job Context 与任务失败原子性（P0/Major）

修改：

```text
src/App.tsx
src/api.ts
src/features/shared/ui.tsx
electron/services/designPipeline.cjs
相关 UI Unit / E2E
```

完成：

- 业务 task 与 refreshProjects 独立错误边界；
- Result 同时校验 current 与 next；
- Poll/Reload 显式携带原 Screen；
- Cancel 携带 jobId/projectId/screenId；
- 后端取消状态按 Job Identity 建键。

## M4-F3：关闭 Contract label-only 批准旁路（Major）

修改：

```text
electron/services/designPipeline.cjs
electron/services/contracts.cjs
electron/services/screen-contract-approval.test.cjs
```

完成：

- label-only candidate 写入前重算 coverage；
- 失真编辑拒绝或降级 reviewed；
- 合法 label 编辑可按确定性重验保留 approved。

## M4-F4：完成 Web Reference no-op（Major）

修改：

```text
server/webServer.cjs
server/webServer.test.cjs
```

完成：

```text
changed:false
→ 不 invalidate
→ 不改变任何 Artifact status
```

## M4-F5：Schema-aware Screen Clone（Major）

修改：

```text
electron/services/projectStore.cjs
electron/services/migrations.test.cjs
```

至少覆盖真实字段：

```text
task_id
visual_tasks
visual_results_id
layout_version
underlay_id
parent_underlay_id
repair_task_id
critique
```

推荐用真实 Strict Pipeline Fixture 生成 Artifact 树后复制，不再手工造简化 Artifact。

## M4-F6：UI 状态和版本尾项（P1/P2）

修改：

```text
src/features/strict-continuation/StrictProductionPanel.tsx
src/features/layout/LayoutWorkbench.tsx
src/features/layout/LayoutWorkspace.tsx
electron/services/projectStore.cjs
```

完成：

- stale/version mismatch Critique 在 UI 层不显示通过；
- Layout 只保留一套恢复动作；
- 首次 Artifact 永远存 V1，不接受调用方版本。

---

# 12. 最终验收清单

以下全部通过后，才可以把 M4 改判为“完整闭环”。

## P0

- [ ] Web Strict 导出在未 Fidelity 时返回 409；
- [ ] Web Strict 导出在未 Final Approval 时返回 409；
- [ ] Web Strict 导出在 Visual Binding 漂移时返回 409；
- [ ] mutation 成功、列表刷新失败时不会重跑 mutation；
- [ ] Cancel/Retry/Result 均绑定原 Job Project + Screen。

## Contract / Evidence

- [ ] Approved Contract 的非法 label-only 编辑不能继续保持 approved；
- [ ] stale Critique 在 UI 和后端都不构成 passed；
- [ ] Critique hash/version 与当前 Underlay 一致才可合成。

## Reference / Clone

- [ ] Electron 与 Web 的 Reference no-op 均不 stale；
- [ ] Clone 后所有真实 Artifact 引用均属于目标 Screen；
- [ ] 原 Screen id 只允许出现在明确的 provenance 字段。

## UI

- [ ] stale Layout 只显示一个正确恢复动作；
- [ ] update-contract 场景不再出现可失败的“重新生成布局”；
- [ ] Strict asset stale 场景先引导补资产。

## Version

- [ ] 首次保存传入 `version:99` 仍落盘 V1；
- [ ] 后续每次落盘严格 `previous + 1`；
- [ ] generation_id 不重复。

## 自动化

- [ ] Node tests 全绿；
- [ ] UI Unit 全绿；
- [ ] Electron E2E 全绿；
- [ ] Web Server 集成测试全绿；
- [ ] docs-validate 全绿；
- [ ] fixture-e2e 全绿；
- [ ] macos-validate 全绿；
- [ ] secret-scan 全绿。

---

# 13. 最终审核意见

执行者的 M4 工作质量相较上一轮有明显提升，主要问题不是“没有做”，而是：

```text
桌面路径完成后，没有同步审查 Web 路径
单个函数修复后，没有把辅助步骤纳入事务边界
测试使用简化字段，没有完全复刻生产 Artifact
后端 Gate 已正确，但前端状态表达仍停留在旧逻辑
```

当前可如实写成：

```text
M4 主体整改已完成
AUD-01～14 大部分核心机制已落地
仍有若干部分闭环项
并发现 1 项 Web 正式导出 P0 旁路
```

当前不可写成：

```text
AUD-01～14 全部完整闭环
项目已达到最终归档条件
```

## 最终状态

```text
结论：有条件不通过
归档：暂缓
发布：暂缓
下一步：执行 M4-F1～F6 后复审
```
