# Game UI Design Copilot M4-F1～F6 最终独立源码复审报告

## 0. 文档信息

| 项目 | 内容 |
|---|---|
| 仓库 | `z806738350-source/Game-UI-Design-Projects` |
| 最终复审基线 | `main@0f8e9ce02037b683a4215578ed6b9355d665eec0` |
| 前次审核基线 | `main@3342346886b45c79817d45b7ddeaf8f767b2ec44` |
| 涉及 PR | #40～#46 |
| 执行者验收文件 | `docs/baseline/m4-remediation-acceptance.md` |
| 审核范围 | M4-F1～F6 源码、负向测试、Web/Electron 边界、多 Screen、Clone、UI 恢复动作、版本、GitHub CI |
| 不包含 | 主观美术质量、视觉审美评价、UI 设计师人工操作签核 |
| 审核方式 | 直接读取最终 `main` 源码、测试与 PR/CI；不把执行者汇报或验收核对表直接视为事实 |
| 仓库治理 | 单人维护，不要求寻找外部 GitHub 协作者或第二审批人 |
| 最终判定 | **有条件不通过：M4 主体完成，但尚不能改判为“完整闭环”** |

---

# 1. 执行摘要

执行者本轮完成了真实且大规模的工程整改，并非只补文档或测试数量。

已经确认落地的关键成果包括：

- Web 与 Electron 严格模式导出共用同一份最终交付门禁；
- mutation 成功后的项目列表刷新失败不再反向改判 mutation 失败；
- Retry、Cancel 和晚到结果绑定发起时的 Project / Screen；
- 已批准 Screen Contract 的 label-only 编辑会执行确定性 coverage 重验；
- Web 与 Electron 的 Reference no-op 均不再使下游 stale；
- Critique 的 stale / Visual Results version 在 UI 与后端均有门禁；
- Artifact 首次保存固定为 V1，后续由存储层单调递增；
- Layout stale 的恢复操作已集中到 sticky Footer；
- Clone 已从通用白名单方案升级为按 Artifact 类型声明引用字段；
- GitHub CI 的七个 Job 全部成功，日志可确认后端 209、UI Unit 132、Electron E2E 36。

但源码复核发现，执行者验收表中的以下结论仍不成立：

```text
Clone 后所有真实 Artifact 引用均属于目标 Screen
原 Screen id 只存在于明确 provenance
Strict asset stale 时恢复动作会先引导补齐资产
```

另外发现一项不在验收表中的失败原子性问题：

```text
非法 label-only 编辑虽然被拒绝，
但拒绝前已经把 Composition / Output / Fidelity 标成 stale。
```

因此本轮最准确的状态是：

```text
M4-F1～F4：主体通过
M4-F5：部分通过
M4-F6：版本和 Critique UI 通过，Layout strict-assets 恢复动作未闭环
M4-G：文档与实际代码存在两处过度声明
```

---

# 2. 验收依据

执行者提交的验收核对文件把以下内容列为完成条件：

- Web Strict 导出必须受 Fidelity、Final Approval 和 Visual Binding Gate 保护；
- mutation 成功后辅助刷新失败不得导致重跑 mutation；
- Cancel / Retry / Result 必须绑定原 Project + Screen；
- Contract label-only 非法编辑必须拒绝；
- stale Critique 在 UI 和后端均不得视为通过；
- Electron 与 Web Reference no-op 都不得 stale；
- Clone 所有真实引用必须归属于目标 Screen；
- stale Layout 只能出现一个正确恢复动作；
- Strict asset stale 必须先引导补资产；
- 首次传入 `version:99` 仍必须落盘 V1；
- 全部负向回归与 CI 门禁通过。

本报告逐项核对上述声明，不因验收核对表标记为“✅”而自动判定通过。

---

# 3. Git、PR 与 CI 真实性

## 3.1 最终主干

GitHub 当前 `main` 精确指向：

```text
0f8e9ce02037b683a4215578ed6b9355d665eec0
```

该提交是 PR #46 的 squash merge，父提交为：

```text
8860bcbc223e0b9fec83d6df9187e53f60c1c8e8
```

仓库当前没有开放 PR。

## 3.2 PR 链

已确认以下 PR 全部合并：

| PR | 范围 | 结果 |
|---|---|---|
| #40 | Web / Desktop Final Delivery Gate | 已合并 |
| #41 | mutation refresh 隔离与 Job Context | 已合并 |
| #42 | Contract label-only Gate | 已合并 |
| #43 | Web Reference no-op | 已合并 |
| #44 | Schema-aware Screen Clone | 已合并 |
| #45 | Critique UI、V1、Layout stale 操作 | 已合并 |
| #46 | 文档、验收核对与归档 | 已合并 |

## 3.3 CI 是否覆盖最终代码

PR #46 的测试 Head 为：

```text
a42d303d9f21ee90bfd0118c75f8dd3d69bd66b9
```

该 Head 的 tree SHA 与最终 `main@0f8e9ce` 相同：

```text
9e6de1b3838e47709e665969f9c95c86c9864822
```

所以 PR #46 CI 检查的是与最终主干内容一致的代码树，不存在“测试的是旧树、合并后内容不同”的问题。

## 3.4 CI 结果

GitHub Actions Run：

```text
32672074285
```

七项 Job 均为 success：

```text
validate
docs-validate
ui-unit
ui-e2e
fixture-e2e
macos-validate
secret-scan
```

日志确认：

```text
Node tests: 209 passed
UI Unit: 132 passed
Electron E2E: 36 passed
Production build: passed
Dependency audit: passed
```

CI 全绿是真实的。

但 CI 全绿只能证明现有测试表达的行为通过，不能证明生产字段没有遗漏；本次 Clone 问题正是“测试 Fixture 没有生成真实生产字段”造成的漏检。

---

# 4. 第 12 节验收清单逐项复核

验收清单共 17 项。

| # | 验收项 | 复核结论 | 说明 |
|---:|---|---|---|
| 1 | Web Strict 未 Fidelity 返回 409 | **通过** | 共用 `assertFinalDeliveryReady()` |
| 2 | Web Strict 未 Final Approval 返回 409 | **通过** | 服务端强制 `manifest.status === approved` |
| 3 | Visual Binding 漂移阻断 Web 导出 | **通过** | 导出前执行 Visual Binding 重验 |
| 4 | mutation 成功、刷新失败不重跑 mutation | **通过** | `refreshProjects()` 已移出 mutation 错误边界 |
| 5 | Cancel / Retry / Result 绑定原 Project + Screen | **通过（当前单任务模型）** | Project/Screen 冻结及返回结果身份检查已存在 |
| 6 | 非法 Contract label-only 编辑不能保持 approved | **通过** | 保存前 normalize + coverage + validate |
| 7 | stale Critique UI / 后端均不通过 | **通过** | UI 绿灯与合成按钮均已对齐 |
| 8 | Critique hash/version 与当前 Underlay 一致才可合成 | **通过** | 后端有 ID / hash / version 三重检查 |
| 9 | Electron / Web Reference no-op 均不 stale | **通过** | 两端都按 `changed` 决定是否失效 |
| 10 | Clone 所有真实 Artifact 引用归目标 Screen | **不通过** | `underlay_critique`、`issue_id` 等真实字段遗漏 |
| 11 | 原 Screen id 只存在明确 provenance | **不通过** | Clone 后仍可能存在非 provenance 旧 Critique / issue 引用 |
| 12 | stale Layout 只显示一个正确恢复动作 | **不通过** | 动作虽只有一个，但 strict-assets 场景分派错误 |
| 13 | update-contract 场景不显示错误 regenerate | **通过** | 正确导航功能契约 |
| 14 | Strict asset stale 先引导补资产 | **不通过** | 文案正确，按钮却直接运行 `layout_design` |
| 15 | caller `version:99` 首次仍存 V1 | **通过** | 存储层首版固定 V1 |
| 16 | 后续严格 `previous + 1` | **通过** | 存储层统一分配 |
| 17 | `generation_id` 不重复 | **通过** | 每次保存随机生成 |

统计：

```text
通过：13
不通过：4
```

其中第 10/11 属于同一个 Clone 根因，第 12/14 属于同一个 stale action 根因。

---

# 5. 已确认完成的工程工作

# 5.1 M4-F1：Web / Desktop 最终交付门禁

## 实现

新增：

```text
electron/services/finalDeliveryGate.cjs
```

`assertFinalDeliveryReady()` 依次验证：

```text
Fidelity Report = passed
Fidelity source 对应当前 Manifest / Output hash
Composition Manifest 已最终批准
Manifest 仍绑定当前 Visual Results review
Output 文件存在、为 final PNG、hash 和尺寸一致
```

Electron IPC 与 Web 下载 Route 均调用该共享函数。

## 测试

`server/webServer.delivery.test.cjs` 使用真实 HTTP Server 覆盖：

- 无 Fidelity；
- stale Fidelity；
- 无 Final Approval；
- Visual review 漂移；
- PNG hash 被篡改；
- 全部正确时返回 200。

## 判定

**完整通过。**

前次发现的 Web 正式导出 P0 旁路已经关闭。

---

# 5.2 M4-F2：mutation refresh 隔离

当前 `run()` 已将：

```text
业务 task
```

和：

```text
refreshProjects()
```

分成两个错误边界。

任务成功后即使项目列表刷新失败：

- 任务返回值仍作为成功应用；
- 不显示 mutation 重试；
- 不会重复创建项目或重复执行批准。

`App.test.tsx` 也覆盖了：

```text
createProject 成功
+
listProjects 失败
→ 创建只执行一次
→ Dialog 关闭
→ 不出现 Retry
```

## 判定

**通过。**

---

# 5.3 M4-F2：Project / Screen Job Context

## 已完成

任务开始时冻结：

```text
projectId
projectName
screenId
```

以下操作使用冻结上下文：

- Busy polling；
- 失败后 reload；
- Retry；
- Cancel；
- 晚到 Result。

`applyJobResult()` 会检查：

```text
current project/screen
next project/screen
job project/screen
```

不匹配时拒绝覆盖当前页面。

后端取消键也从：

```text
projectId
```

升级为：

```text
projectId:screenId
```

## 判定

**在当前“同一 Screen 同时仅一个任务”的 UI 模型下通过。**

见第 9.2 节的并发硬化建议。

---

# 5.4 M4-F3：Contract label-only Gate

已批准 Screen Contract 只修改 Label 时，后端会：

```text
normalizeArtifact
→ recomputeCoverage
→ validateArtifact
```

如果新 Label 不再覆盖 `source_inventory`，保存被拒绝，原 Contract 保持 approved 且内容不变。

合法 Label 修改会：

- 保持 approved；
- 重新计算 coverage；
- 生成新版本；
- 使旧 Composition / Output / Fidelity stale。

## 判定

**验收项本身通过。**

但拒绝失败的原子性仍有问题，见第 8.1 节。

---

# 5.5 M4-F4：Reference no-op

## Electron

- UI 对规范化后的新旧 details 做比较；
- ProjectStore 再进行一次服务层比较；
- 无变化时返回 `changed:false`；
- IPC 仅在 `changed:true` 时执行 stale 传播。

## Web

Web Server 也已改为：

```js
const { changed } = await manageReference(...);
if (changed) invalidate...
```

## 判定

**完整通过。**

---

# 5.6 M4-F6：Critique UI 对齐

StrictProductionPanel 已同时检查：

- Critique status 是否 stale；
- Critique 绑定的 Underlay ID；
- Critique 记录的 Visual Results version；
- 当前 Visual Results version。

stale 或 version mismatch 时：

- 不显示污染审查绿灯；
- 禁用 Preview / Final Composition；
- 显示明确警告。

后端仍保留像素 hash 重算作为最终硬门禁。

## 判定

**通过。**

---

# 5.7 M4-F6：Artifact 版本

`saveArtifact()` 现在明确执行：

```text
无 previous → version = 1
有 previous → version = previous + 1
```

并由存储层写入：

```text
generation_id
content_hash
updated_at
```

测试已注入：

```text
首版 caller version = 99
```

并验证落盘仍为 V1。

## 判定

**通过。**

---

# 6. 阻断“完整闭环”的问题

# MAJOR-01：Schema-aware Clone 仍遗漏真实生产字段

## 6.1 当前 Schema

当前 `CLONE_FIELD_SCHEMA` 已覆盖大量字段，但以下生产字段没有纳入：

### Composition Manifest

生产 Compositor 写入：

```json
{
  "source": {
    "underlay_critique": "main-underlay-critique-..."
  }
}
```

但 Clone Schema 的 `composition-manifest.references` 只有：

```text
visual_results
visual_results_id
selected_variation_ids
underlay
critique_id
approved_layout
style_contract
```

缺少：

```text
underlay_critique
```

### Fidelity Report

生产 Fidelity 写入：

```json
{
  "source": {
    "underlay_critique": "main-underlay-critique-..."
  }
}
```

但 Clone Schema 的 `fidelity-report.references` 只有：

```text
composition_manifest
composition_output
```

同样缺少：

```text
underlay_critique
```

### Critique Issue / Waiver

真实 Critique 会生成：

```text
issue_id = <underlayId>-issue-1
```

Manual Waiver 也通过 `issue_id` 引用该问题。

但 `underlay-critique.references` 没有：

```text
issue_id
```

因此复制 Screen 后：

```text
battle Critique
→ issue_id 仍可能是 main-...-issue-1
→ manual_waiver.issue_id 仍引用 main-...
```

## 6.2 为什么现有测试没有发现

`cloneSchemaIntegrity.test.cjs` 虽然真实生成了 Contract、Style、Layout、Visual、Critique 和 Repair，但：

1. Composition Manifest 是手工保存的简化对象；
2. 手工 Manifest 没有 `source.underlay_critique`；
3. 没有运行真实 `createCompositionManifest()`；
4. 没有生成 Fidelity Report；
5. 注入的 issue id 是 `bad-1`，不是 Screen 前缀；
6. Repair 后的最终 Critique 没有留下带 Screen 前缀的问题/waiver。

所以递归扫描能够通过，但没有覆盖生产 Compositor 和 Fidelity 实际写入的字段。

## 6.3 影响

复制 Screen 后可能出现：

```text
副本 Composition / Fidelity
→ source.underlay_critique 仍指向原 Screen

副本 Critique / Waiver
→ issue_id 仍属于原 Screen
```

这会破坏：

- Artifact Inspector lineage；
- Critique / Waiver 审计；
- Clone 后最终批准证据；
- 故障诊断；
- “原 Screen id 只允许出现在 provenance”的验收声明。

## 6.4 必须修复

在 Schema 中增加：

```js
'composition-manifest': {
  references: [
    ...,
    'underlay_critique'
  ]
}

'fidelity-report': {
  references: [
    ...,
    'underlay_critique',
    'critique_id'
  ]
}

'underlay-critique': {
  references: [
    ...,
    'issue_id'
  ]
}
```

若 manual waiver 未来使用独立 key，也应显式纳入。

## 6.5 测试要求

不要继续手工保存简化 Manifest。

测试必须：

1. 使用真实 `createCompositionManifest()` 或 `pipeline.composeVisual()`；
2. 使用真实 `pipeline.runFidelity()`；
3. 在 Critique 中保留一个 Screen 前缀 `issue_id`；
4. 增加对应 `manual_waiver.issue_id`；
5. Duplicate 后逐项断言：
   - Manifest `source.underlay_critique` 属于目标 Screen；
   - Fidelity `source.underlay_critique` 属于目标 Screen；
   - Issue / Waiver id 属于目标 Screen；
6. 再执行递归零残留扫描。

## 6.6 判定

**AUD-13 尚未完整闭环。**

---

# MAJOR-02：Strict asset stale 的唯一恢复按钮仍然执行错误动作

## 6.7 Guidance 已能识别正确意图

`layoutStaleGuidance()` 在 Strict 路线中识别：

```text
font
component
binding
```

并返回：

```text
action = update-strict-assets
message = 先返回严格继承面板补齐资产
```

## 6.8 Footer 分派没有实现该 action

`LayoutWorkspace` 的 `staleAction` 只显式处理：

```text
update-contract
legacy-repair
```

其他所有 action 都落到：

```text
重新生成布局
→ runStage('layout_design')
```

所以：

```text
font/component/binding 已 stale
→ 页面文案提示先补资产
→ 唯一按钮却直接重新生成布局
→ 后端严格资产 Gate 拒绝
```

当前 LayoutWorkbench 已删除冲突按钮，这意味着错误 Footer 按钮现在是用户唯一可达恢复操作，问题反而更明确。

## 6.9 测试缺口

`LayoutWorkspace.test.tsx` 当前覆盖：

- update-contract；
- legacy-repair；
- generic regenerate。

没有覆盖：

```text
update-strict-assets
regenerate-strict-layout
```

验收核对文件中“Strict asset stale 先引导补资产”的声明缺少真实点击路径证据。

## 6.10 修复

显式分派全部 action：

```ts
switch (staleGuidance.action) {
  case 'update-contract':
    return {
      label: '先更新功能契约',
      onClick: () => onNavigate('wireframe_interpretation')
    };

  case 'update-strict-assets':
    return {
      label: '先补齐字体、组件与绑定',
      onClick: () => onNavigate('style_resolution')
    };

  case 'legacy-repair':
    return {
      label: '执行一次性修复',
      onClick: repairRouteCycle
    };

  case 'regenerate-strict-layout':
  case 'regenerate':
    return {
      label: '重新生成布局',
      onClick: runLayout
    };
}
```

如 `regenerate-strict-layout` 时严格资产仍不完整，也应先进入 Style 面板，而不是发送必然失败的请求。

## 6.11 必测

新增 UI Unit：

```text
font stale
→ button = 先补齐字体、组件与绑定
→ click navigates style_resolution
→ runStage(layout_design) 未调用

component stale
→ 同上

binding stale
→ 同上

style stale + assets ready
→ button = 重新生成组件感知布局
→ runStage(layout_design) 调用
```

## 6.12 判定

**AUD-14 和验收清单 UI 第 1/3 项未完整闭环。**

---

# 7. 新发现的失败原子性问题

# MAJOR-03：非法 label-only 编辑在被拒绝前已经破坏交付链

## 7.1 当前执行顺序

`updateArtifact()` 对 label-only Screen Contract 编辑执行：

```text
先 invalidate composition-manifest
→ composition-output / fidelity-report 连锁 stale
→ 再构造候选 Contract
→ 再 recomputeCoverage / validateArtifact
→ 非法时抛错
```

因此：

```text
用户输入非法 Label
→ 保存失败
→ Screen Contract 没有改变
→ 但原本有效的 Final / Fidelity 已被置 stale
```

## 7.2 为什么现有测试没发现

`contractLabelGate.test.cjs` 只断言：

- Contract status 仍 approved；
- Contract version 未变化；
- Contract label 未变化。

测试没有预置并检查：

```text
composition-manifest
composition-output
fidelity-report
```

所以副作用没有被捕获。

## 7.3 影响

这是违反失败原子性的行为：

```text
失败的编辑不应破坏当前有效交付事实
```

用户只是输入了一次不合法文案，即使保存被正确拒绝，也必须重新合成、重跑 Fidelity、重新批准。

## 7.4 修复

改为：

```text
构造 candidate
→ normalize
→ recomputeCoverage
→ validate
→ 校验通过后才 invalidate
→ 保存 candidate
```

任何校验失败：

```text
Contract 不变
Composition 不变
Output 不变
Fidelity 不变
Workflow 不变
```

## 7.5 必测

扩展 `contractLabelGate.test.cjs`：

1. 预置 approved Contract；
2. 预置 approved Final Manifest；
3. 预置 final Output；
4. 预置 passed Fidelity；
5. 提交非法 label-only 编辑；
6. 断言编辑失败；
7. 断言四个 Artifact 的 status/version/content hash 全部不变；
8. 合法编辑才使交付链 stale。

## 7.6 判定

该问题未直接否定“非法 Label 不得保持 approved”这一单项，但否定“整改全部闭环”和失败安全完整性。

---

# 8. 非阻断但应进入收口的尾项

# P1-01：Legacy Critique 缺少 version 时 UI 可能显示假绿灯

当前 UI 的 version mismatch 逻辑依赖：

```text
critique.source.visual_results_version
```

如果升级前的 Critique 没有该字段：

```text
Number(undefined) = NaN
```

通常不会命中 mismatch 条件。

结果可能是：

- UI 显示通过；
- 合成按钮可点击；
- 后端最终仍会拒绝。

后端安全没有旁路，但旧项目体验不一致。

建议：

```text
Strict Critique 缺少 visual_results_version
→ 直接视为 evidence incomplete
→ 显示“旧版证据需重新审查”
→ 禁用合成
```

---

# P1-02：Job Context 仍没有独立 job_id

当前取消键为：

```text
projectId:screenId
```

这足以隔离不同 Screen，但不能隔离同一 Screen 的两个并行任务。

桌面单窗口 UI 用全局 busy 限制了并行，当前正常用户路径风险较低；但：

- Web 多标签页；
- 多会话；
- 直接 API；
- 未来并行任务；

都可能出现同 Screen 任务互相取消。

建议后续引入：

```text
job_id
project_id
screen_id
stage
```

取消键使用 `job_id`。

这不是本轮“Project + Screen”验收条目的直接失败，但属于并发硬化项。

---

# P1-03：Web 下载错误不会回传到应用错误条

Web `exportVisual()` 通过临时 `<a>` 下载：

```text
发起 GET
→ 立即返回 { ok:true }
```

若服务器返回 409：

- 文件不会下载；
- 但 React 的 `run()` 不会收到 rejected Promise；
- 用户可能看不到明确的 Gate 错误。

安全门禁是有效的，但用户反馈不完整。

建议改为：

```text
fetch 下载
→ 非 2xx 读取 JSON 错误并 throw
→ 2xx 转 Blob 再下载
```

同时把 `screenId` 放进下载 URL，避免多会话修改 Active Screen 时下载错误 Screen 的结果。

---

# 9. 对执行者验收核对文档的评价

`m4-remediation-acceptance.md` 的大多数条目与最终代码一致，包括：

- Web Final Gate；
- mutation refresh；
- Job Project/Screen；
- label Gate；
- Critique stale/version；
- Web Reference no-op；
- Version；
- GitHub CI。

但以下声明过度：

```text
Clone 后所有真实 Artifact 引用均属于目标 Screen
原 Screen id 只允许存在于 provenance
stale Layout 只显示一个正确恢复动作
Strict asset stale 场景先引导补资产
```

建议在整改完成前把这些状态从：

```text
✅
```

改为：

```text
⚠ 待修复 / 待复验
```

并补充本报告的三项发现。

---

# 10. 推荐最终整改批次

建议新增单人维护批次：

```text
M4-H：Final Evidence Closure
```

不要求外部 Reviewer。

## M4-H1：Clone 真实生产字段补齐

修改：

```text
electron/services/artifactRegistry.cjs
electron/services/projectStore.cjs
electron/services/cloneSchemaIntegrity.test.cjs
```

必须解决：

```text
composition-manifest.source.underlay_critique
fidelity-report.source.underlay_critique
underlay-critique issue_id
manual_waivers issue_id
```

## M4-H2：Strict stale 恢复 action

修改：

```text
src/features/layout/LayoutWorkspace.tsx
src/features/layout/LayoutWorkspace.test.tsx
```

必须实现 `update-strict-assets` 和 `regenerate-strict-layout` 独立分支。

## M4-H3：Contract 编辑失败原子性

修改：

```text
electron/services/designPipeline.cjs
electron/services/contractLabelGate.test.cjs
```

必须先校验，再 stale 下游。

## M4-H4：建议尾项

```text
Strict legacy Critique 缺 version → UI fail closed
Web export 使用 fetch 并显示 409
引入 job_id 或登记后续并发 Issue
```

---

# 11. M4-H Definition of Done

以下全部满足后，可以将 M4 改判为完整闭环。

## Clone

- [ ] 真实 Composition Manifest 的 `underlay_critique` 已重写；
- [ ] 真实 Fidelity Report 的 `underlay_critique` 已重写；
- [ ] Critique issue / waiver id 已重写；
- [ ] 测试使用真实 Compositor 和 Fidelity；
- [ ] 除 `duplicated_from_screen_id` 外递归零残留。

## Layout Recovery

- [ ] `update-contract` 导航 Contract；
- [ ] `update-strict-assets` 导航 Style / Strict Assets；
- [ ] `regenerate-strict-layout` 仅在资产 Ready 时执行 Layout；
- [ ] Workbench 不再出现第二套冲突操作；
- [ ] 三种 strict stale 原因均有点击级 Unit Test。

## Failure Atomicity

- [ ] 非法 label 编辑不改变任何 Artifact；
- [ ] 不改变 Workflow；
- [ ] 合法 label 编辑才 stale Composition/Fidelity；
- [ ] 有完整负向回归。

## 自动化

- [ ] Node 全绿；
- [ ] UI Unit 全绿；
- [ ] Electron E2E 全绿；
- [ ] Web Server 集成测试全绿；
- [ ] docs-validate 全绿；
- [ ] fixture-e2e 全绿；
- [ ] macos-validate 全绿；
- [ ] secret-scan 全绿。

---

# 12. 最终审核结论

执行者本轮已经关闭了前次审核中的大多数核心缺陷，尤其是：

```text
Web 正式交付旁路
Reference no-op Web 差异
Critique UI/后端状态不一致
首版版本号受调用方控制
mutation 成功后辅助刷新误判失败
```

这些改造具有真实源码、负向测试和 CI 证据，应予以认可。

但最终源码仍证明：

```text
Clone Schema 未覆盖全部生产引用
Strict asset stale 的唯一按钮执行错误动作
非法 Contract 编辑会在拒绝前破坏交付链
```

所以当前不能批准以下归档声明：

```text
M4-F1～F6 全部完整闭环
M4 可以最终关闭
```

## 当前状态

```text
工程主体：通过
P0 Web 导出旁路：已关闭
AUD 清单：13/17 通过
剩余 Major：3
非阻断硬化项：3
最终判定：有条件不通过
建议：完成 M4-H1～H3 后再做一次最终复审
```
