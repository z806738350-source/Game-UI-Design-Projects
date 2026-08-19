
## 排除“独立人工验收”后的最终执行清单

你已经明确确认：你本人就是签核记录中的“韩枫（UI设计师）”，并且确实完成了独立人工验收。因此，本清单**不再把 UI 设计师签核、人工评分或签核人身份列为缺口**。

本清单继续以项目进度报告所列的《已有项目风格继承改造任务计划 1.1》为改造依据，并结合整改审核基线和当前 `main` 分支代码重新整理。

---

# 一、修订后的总体结论

刨除人工验收后，当前项目的核心生产链路已经完成：

- 真实 Final PNG；
- exact、nine-slice、vector-token 渲染；
- 真实字体文件加载；
- Underlay 自动 Critique；
- Underlay Repair 与自动复审；
- 像素级 Fidelity；
- 多 Screen；
- 事务迁移；
- Golden fixture；
- Linux/macOS CI；
- 秘密扫描。

但仍有四类工作没有完整执行：

|编号|剩余工作|优先级|是否属于原文档硬要求|
|---|---|---|---|
|REM-01|修复 Binding 的隐式默认选择和语义错配问题|P0|属于严格组件继承目标的必要补强|
|REM-02|完成 F-14 前端工作台拆分和独立测试边界|P0|是|
|REM-03|将核心专项文档补成真正的执行级文档|P0|是|
|REM-04|增加真实 UI E2E，并纳入不可绕过的 CI|P0|是|
|REM-05|启用主分支保护、Required Checks 和技术 Code Review 门禁|P0|是既定门禁的强制化措施|
|REM-06|修正 README、目录结构和正式版本口径中的残余不一致|P1|属于文档一致性要求|

其中最值得立即处理的，不只是“文档不够详细”，而是 **Binding 当前存在真实功能风险**。

---

# 二、REM-01：修复 Binding 隐式默认与语义错配

## 2.1 当前存在的问题

当前 `StrictContinuationPanel.tsx` 在用户没有主动选择组件时，会自动使用组件家族列表中的第一个组件：

```
component_id:
  choices[control.id] ||
  String(families[0]?.id || '')
```

同时固定写入：

```
state: 'default'
font_role: 'button-label'
approved: true
```

下拉框本身也默认显示第一个组件家族，而不是空值。

后端 `validateBindings` 当前主要检查：

- Control 是否重复；
- Component 是否存在；
- State 是否存在；
- Slot ID 是否存在；
- `approved` 是否为 `true`；
- 必要控件是否全部被绑定。

它**没有检查 Screen Control 的语义角色是否和 Component Family 的 category 匹配**。

而 Component Contract 中实际上已经存在 `family.category`，例如：

```
button
navigation
tab
resource-bar
icon
page-specific
```

说明系统已经具备执行语义兼容校验所需的数据基础。

## 2.2 为什么必须修

这个问题可能产生以下结果：

```
主操作按钮 → 自动绑定第一个导航组件
资源栏 → 自动绑定普通按钮
列表行 → 自动绑定 Tab
图标操作 → 自动绑定带文字按钮
所有文本 → 固定使用 button-label 字体角色
```

系统仍然可能显示：

```
Binding Coverage = 100%
Binding Approved = true
```

但实际绑定的组件类别是错误的。

这会把原来的：

```
模型重新画组件导致部件漂
```

变成：

```
系统使用了真实组件，但使用了错误的组件家族
```

从最终视觉结果上看，两者都会表现为“部件不对”。

---

## 2.3 必须执行的改造

### A. 删除所有自动选择第一个组件的逻辑

修改：

```
src/features/strict-continuation/StrictContinuationPanel.tsx
```

必须删除：

```
choices[control.id] || families[0]?.id
```

改为：

```
choices[control.id] || ''
```

下拉框初始值必须为空：

```
<select value={choices[control.id] || ''}>
```

没有显式选择的必要控件不得保存，也不得批准。

### B. 不允许客户端直接写入 `approved: true`

当前前端在创建 Binding 时直接写：

```
approved: true
```

应改为：

```
approved: false
```

或者完全不接收客户端传入的 `approved`。

Binding 批准必须由后端 `approveArtifact` 执行：

```
保存草稿
→ 后端校验
→ 用户点击批准
→ 后端生成 approval 事实
```

后端在批准时写入：

```
{
  "status": "approved",
  "approval": {
    "approved_at": "...",
    "approved_by": "...",
    "validation_version": "binding-policy-v1"
  }
}
```

任何来自普通 `updateArtifact` 请求中的：

```
{
  "approved": true
}
```

均不得被直接信任。

### C. 建立 Control Role 与 Component Category 映射

新增：

```
electron/services/controlRolePolicy.cjs
```

建议结构：

```
const CONTROL_ROLE_POLICIES = Object.freeze({
  'primary-action': {
    allowed_categories: ['button'],
    required_states: ['default', 'pressed', 'disabled'],
    allowed_font_roles: ['button-label']
  },

  'secondary-action': {
    allowed_categories: ['button'],
    required_states: ['default', 'disabled'],
    allowed_font_roles: ['button-label']
  },

  navigation: {
    allowed_categories: ['navigation'],
    required_states: ['default', 'selected', 'disabled'],
    allowed_font_roles: ['navigation-label']
  },

  tab: {
    allowed_categories: ['tab'],
    required_states: ['default', 'selected', 'disabled'],
    allowed_font_roles: ['tab-label']
  },

  resource: {
    allowed_categories: ['resource-bar'],
    required_states: ['default'],
    allowed_font_roles: ['numeric', 'body']
  },

  'icon-action': {
    allowed_categories: ['icon'],
    required_states: ['default'],
    allowed_font_roles: []
  },

  'status-badge': {
    allowed_categories: ['status-badge', 'page-specific'],
    required_states: ['default'],
    allowed_font_roles: ['caption', 'numeric']
  },

  'list-row': {
    allowed_categories: ['list-row', 'page-specific'],
    required_states: ['default'],
    allowed_font_roles: ['body']
  },

  'content-panel': {
    allowed_categories: ['content-panel', 'page-specific'],
    required_states: ['default'],
    allowed_font_roles: []
  }
});
```

具体角色名称可以依据当前 Screen Contract 中已经使用的 `role` 词表调整，但必须遵守：

```
严格模式中未知 role 不得静默放行
```

严格模式遇到未知角色时，应返回：

```
UNKNOWN_CONTROL_ROLE
```

而不是允许绑定任意组件。

### D. 扩展后端 Binding 校验

修改：

```
electron/services/componentBindings.cjs
```

建议将签名扩展为：

```
validateBindings(
  bindingsArtifact,
  screenContract,
  componentContract,
  fontManifest,
  { strict = false }
)
```

每个 Binding 至少检查：

```
control_id 存在
control_id 唯一
component_id 存在
component family 已批准
component category 与 control role 兼容
state 在 family 中存在
required state 完整
slot_id 存在
font_role 在 Font Manifest 中存在
font_role 与 control role 兼容
strict 模式不允许 local-generated 共享组件
Binding 是显式用户选择而不是隐式默认
```

推荐错误码：

```
BINDING_COMPONENT_NOT_SELECTED
BINDING_COMPONENT_CATEGORY_MISMATCH
BINDING_COMPONENT_STATE_MISSING
BINDING_FONT_ROLE_MISSING
BINDING_FONT_ROLE_MISMATCH
BINDING_UNKNOWN_CONTROL_ROLE
BINDING_IMPLICIT_DEFAULT_FORBIDDEN
BINDING_COMPONENT_NOT_APPROVED
```

### E. Binding UI 必须支持 State 和 Font Role

新增独立：

```
src/features/bindings/BindingWorkbench.tsx
```

每个必要控件显示：

```
控件 ID
控件名称
语义角色
组件家族
组件 Category
组件状态
字体角色
Slot ID
兼容性结果
```

组件选择列表只显示兼容组件，或者将不兼容组件禁用并显示原因：

```
不可选择：该控件角色为 navigation，
当前组件 category 为 button
```

State 不得固定为 `default`，而应从所选 family 的真实 states 中选择。

Font Role 不得统一固定为 `button-label`。

### F. 上游变化必须正确触发 stale

下列变化必须使 Binding 失效：

```
Control role 变化
Control required 状态变化
Component family category 变化
Component state 删除
Component approval 撤销
Font role 删除
Font Manifest 变化
Continuation Mode 变化
```

只修改 Control Label 时，不应使 Binding 失效。

---

## 2.4 必须增加的测试

新增：

```
electron/services/componentBindings.test.cjs
src/features/bindings/BindingWorkbench.test.tsx
```

至少覆盖：

|测试|预期|
|---|---|
|未主动选择组件|保存失败|
|主操作绑定 resource-bar|失败|
|navigation 绑定普通 button|失败|
|字体角色不存在|失败|
|固定写 `approved:true`|后端忽略或拒绝|
|修改 label|Binding 保持有效|
|修改 role|Binding stale|
|删除组件状态|Binding 失败|
|组件从 approved 改为 reviewed|Binding stale|
|100% 覆盖但存在语义错配|不得批准|
|100% 覆盖且全部兼容|通过|

### REM-01 完成门禁

只有全部满足才算关闭：

```
□ UI 中不存在自动选择第一个 family
□ 未显式选择时不能保存
□ 后端不信任客户端 approved=true
□ Control Role 与 Component Category 有版本化策略
□ 严格模式未知 role fail-closed
□ State 与 Font Role 可显式选择
□ 语义不匹配时 Binding Approval 失败
□ 相关单元、集成和 Golden fixture 全绿
```

---

# 三、REM-02：完成 F-14 前端模块拆分

原进度报告已经明确记录：

- `App.tsx` 仍包含较多 Contract、Style、Visual 领域编排；
- Bindings 和 Layout 没有独立 Workbench；
- 每个工作台尚未形成完整独立状态、API 边界和测试；
- 没有进入 CI 的 UI E2E。

当前仓库仍只有三类 Feature 目录：

```
src/features/production
src/features/strict-continuation
src/features/workbenches
```

`App.tsx` 仍直接持有 Contract 草稿编辑、Review 状态、保存逻辑和大量领域 UI。

同时，顶层 `App` 仍直接选择：

```
ContractWorkspace
LayoutWorkspace
StyleWorkspace
VisualWorkspace
```

并管理大量领域状态和运行逻辑。

---

## 3.1 目标目录结构

建议改成：

```
src/
├── app/
│   ├── AppShell.tsx
│   ├── StageRouter.tsx
│   ├── useProjectSession.ts
│   ├── usePipelineRunner.ts
│   └── appErrors.ts
│
├── features/
│   ├── input/
│   │   ├── InputWorkbench.tsx
│   │   ├── inputModel.ts
│   │   └── InputWorkbench.test.tsx
│   │
│   ├── contracts/
│   │   ├── ContractWorkbench.tsx
│   │   ├── ContractEditor.tsx
│   │   ├── contractModel.ts
│   │   ├── contractApi.ts
│   │   └── ContractWorkbench.test.tsx
│   │
│   ├── reference/
│   │   ├── ReferenceWorkbench.tsx
│   │   ├── referenceModel.ts
│   │   └── ReferenceWorkbench.test.tsx
│   │
│   ├── typography/
│   │   ├── TypographyWorkbench.tsx
│   │   ├── typographyModel.ts
│   │   └── TypographyWorkbench.test.tsx
│   │
│   ├── component-kit/
│   │   ├── ComponentKitWorkbench.tsx
│   │   ├── componentModel.ts
│   │   └── ComponentKitWorkbench.test.tsx
│   │
│   ├── bindings/
│   │   ├── BindingWorkbench.tsx
│   │   ├── bindingModel.ts
│   │   ├── bindingApi.ts
│   │   └── BindingWorkbench.test.tsx
│   │
│   ├── layout/
│   │   ├── LayoutWorkbench.tsx
│   │   ├── LayoutProposalCard.tsx
│   │   ├── layoutModel.ts
│   │   └── LayoutWorkbench.test.tsx
│   │
│   ├── screens/
│   │   ├── ScreenManager.tsx
│   │   ├── screenModel.ts
│   │   └── ScreenManager.test.tsx
│   │
│   ├── underlay/
│   │   ├── UnderlayWorkbench.tsx
│   │   ├── CritiquePanel.tsx
│   │   ├── RepairPanel.tsx
│   │   └── UnderlayWorkbench.test.tsx
│   │
│   ├── production/
│   │   ├── ProductionWorkbench.tsx
│   │   ├── CompositionViewer.tsx
│   │   └── ProductionWorkbench.test.tsx
│   │
│   └── fidelity/
│       ├── FidelityWorkbench.tsx
│       ├── FidelityIssues.tsx
│       └── FidelityWorkbench.test.tsx
```

不要求机械照搬目录名称，但必须实现相同边界。

---

## 3.2 `App.tsx` 最终只保留什么

`App.tsx` 或 `AppShell.tsx` 只应负责：

```
应用初始化
当前项目
当前 Screen
当前 Stage
顶层导航
全局错误提示
全局任务进度
工作台装配
```

不应继续包含：

```
Contract 条目编辑
Style Token 展示规则
Binding 生成
Layout 提案编辑
Underlay Critique 展示规则
Composition 业务逻辑
Fidelity 业务逻辑
```

验收时可直接搜索：

```
grep -n "function ContractWorkspace" src/App.tsx
grep -n "function LayoutWorkspace" src/App.tsx
grep -n "function StyleWorkspace" src/App.tsx
grep -n "function VisualWorkspace" src/App.tsx
```

四项均应没有结果。

---

## 3.3 每个 Workbench 的独立边界

每个 Workbench 必须具备：

|边界|要求|
|---|---|
|输入|明确的 typed props|
|状态|自己管理 Draft、筛选、编辑状态|
|API|通过 feature API 或明确回调调用|
|校验|前端提示，但不替代后端门禁|
|错误|有本领域错误展示|
|测试|至少一个正常路径和一个失败路径|
|文档|说明输入、状态、API、失败与验收|

禁止只把 JSX 从 `App.tsx` 剪切到另一个大文件，然后仍把所有状态留在 `App.tsx`。

---

## 3.4 前端测试建议

可以使用适合当前 React/Vite 项目的组件测试方案，例如：

```
Vitest
React Testing Library
user-event
jsdom
```

新增脚本：

```
{
  "scripts": {
    "test:ui-unit": "vitest run"
  }
}
```

必须覆盖：

```
Reference 容量与 omitted 展示
字体授权确认
组件家族与状态导入
Binding 显式选择
Layout 批准
Screen 切换隔离
Underlay Repair 状态
Fidelity 错误展示
```

### REM-02 完成门禁

```
□ Binding 和 Layout 有独立 Workbench
□ Contract、Style、Production 不再堆在 App.tsx
□ App 只负责 Shell 和装配
□ 每个核心 Workbench 有自己的状态与 API 边界
□ 每个核心 Workbench 有组件测试
□ 原有 Node 测试、构建和 Golden fixture 不回退
```

---

# 四、REM-03：完成真正的执行级文档

原执行计划明确要求补齐：

- 字段级 Artifact/Schema；
- 用户完整 SOP；
- Pipeline、状态机、API/IPC；
- 错误码；
- Provider 故障与排障；
- Migration 与回滚；
- 各 Workbench 的状态/API/测试边界；
- Golden 运行和发布清单。

同时还要求拆出 Bindings、Layout，并继续减少 `App.tsx` 领域逻辑。

当前多份核心文档仍只有一段摘要，例如：

- `FONT-MANIFEST.md`；
- `UNDERLAY-CRITIQUE.md`；
- `FIDELITY-REVIEW.md`；
- `EXISTING-PROJECT-WORKFLOW.md`；
- `COMPONENT-CONTRACT.md`；
- `GAME-UI-FORGE-INTEGRATION.md`。

这些文件描述的原则大体正确，但不足以指导新执行者完成操作。

---

## 4.1 必须补齐的文档集合

### 用户侧

```
docs/user/EXISTING-PROJECT-SOP.md
docs/user/STRICT-CONTINUATION-GUIDE.md
docs/user/WORKBENCH-GUIDE.md
docs/user/FAILURE-RECOVERY.md
```

### Artifact 与契约

```
docs/contracts/STYLE-CONTRACT-2.0.md
docs/contracts/FONT-MANIFEST.md
docs/contracts/COMPONENT-CONTRACT.md
docs/contracts/COMPONENT-BINDINGS.md
docs/contracts/SCREEN-CONTRACT.md
docs/contracts/APPROVED-LAYOUT.md
docs/contracts/UNDERLAY-CONTRACT.md
docs/contracts/UNDERLAY-CRITIQUE.md
docs/contracts/COMPOSITION-MANIFEST.md
docs/contracts/COMPOSITION-OUTPUT.md
docs/contracts/FIDELITY-REPORT.md
```

### 开发与运维

```
docs/development/PIPELINE-STATE-MACHINE.md
docs/development/ARTIFACT-DEPENDENCY-GRAPH.md
docs/development/API-IPC-REFERENCE.md
docs/development/PROJECT-DIRECTORY.md
docs/operations/ERROR-CATALOG.md
docs/operations/PROVIDER-TROUBLESHOOTING.md
docs/operations/MIGRATION-ROLLBACK.md
docs/operations/RELEASE-CHECKLIST.md
```

不要求一定新建全部文件，也可以扩写现有文件；但内容覆盖必须完整。

---

## 4.2 每份契约文档的统一模板

每个 Artifact 文档必须至少包含：

```
1. 目的
2. 唯一事实来源
3. 文件路径
4. 生产者
5. 消费者
6. Schema Version
7. 字段表
8. 必填字段
9. 枚举与数值范围
10. 状态机
11. Approval 规则
12. Stale 触发条件
13. 错误码
14. 合法 JSON 示例
15. 非法 JSON 示例
16. 修复方式
17. 对应源码
18. 对应测试
19. 验收清单
```

字段表格式建议统一为：

|字段|类型|必填|合法值|默认值|谁写入|谁读取|变化后影响|
|---|---|---|---|---|---|---|---|

---

## 4.3 `COMPONENT-BINDINGS.md` 必须重点说明

至少包括：

```
control_id
component_id
component category
state
slot_id
font_role
reuse_policy
selection_source
approval
coverage
role compatibility
stale 规则
```

同时记录 REM-01 中新增的兼容性矩阵。

---

## 4.4 错误码文档必须由代码事实生成

建议建立：

```
electron/services/errorCodes.cjs
```

统一导出：

```
const ERROR_CODES = Object.freeze({
  BINDING_COMPONENT_NOT_SELECTED: '...',
  BINDING_COMPONENT_CATEGORY_MISMATCH: '...',
  FONT_ASSET_HASH_MISMATCH: '...',
  UNDERLAY_REPAIR_LIMIT_REACHED: '...',
  COMPOSITION_OUTPUT_MISSING: '...',
  FIDELITY_EVIDENCE_STALE: '...'
});
```

文档不得手工维护另一套名称。

增加：

```
scripts/check-error-docs.cjs
```

检查：

```
代码中出现的公开错误码必须出现在 ERROR-CATALOG.md
文档中的错误码必须在代码中存在
```

---

## 4.5 修正 README 中的当前不一致

README 已声明：

```
0.2.0 正式版本
```

但后面仍使用：

```
当前 Alpha 已覆盖的控制面
当前 Alpha 范围外
```

这会使正式发布口径自相矛盾。

应改为：

```
当前版本已覆盖的能力
当前版本范围外
```

同时更新 README 中的项目目录树。当前树没有完整列出：

```
composition-output.json
compositions/preview-vN.png
compositions/final-vN.png
review overlay
component board
repair mask
semantic response
evidence digest
```

目录树必须以真实运行结果为准，不得依据旧设计手工猜测。

---

## 4.6 增加文档自动校验

新增：

```
scripts/check-docs.cjs
```

至少检查：

```
必需文档存在
必需章节存在
JSON 示例可解析
文档引用的源码路径存在
文档引用的测试文件存在
公开错误码一致
README Artifact 目录与 fixture 核心路径一致
```

增加脚本：

```
{
  "scripts": {
    "test:docs": "node scripts/check-docs.cjs"
  }
}
```

加入 CI。

### REM-03 完成门禁

```
□ 核心契约文档不再只有一段摘要
□ 用户能仅凭 SOP 完成已有项目严格继承
□ 开发者能根据文档追踪 Artifact 和状态机
□ 错误码与源码一致
□ JSON 示例可自动解析
□ README 不再使用错误的 Alpha 口径
□ test:docs 在 CI 中通过
```

---

# 五、REM-04：增加真实 UI E2E 并进入 CI

当前 CI 已包含：

```
validate
fixture-e2e
secret-scan
macos-validate
```

但没有真正驱动 Electron 界面的 UI E2E。

Golden fixture E2E 可以证明证据链和文件一致性，但不能证明设计师通过真实界面能够完成操作。

---

## 5.1 推荐技术方案

建议使用 Playwright 的 Electron 自动化能力，通过 `_electron.launch()` 启动应用、获取首个窗口并操作真实界面。Playwright 官方文档同时说明，Electron 原生文件选择或保存对话框需要在主进程中进行受控替换，才能实现稳定自动化。[Playwright](https://playwright.dev/docs/api/class-electron?utm_source=chatgpt.com)

建议新增：

```
playwright.config.ts
tests/ui-e2e/electronApp.ts
tests/ui-e2e/strict-continuation.spec.ts
tests/ui-e2e/multi-screen.spec.ts
tests/ui-e2e/failure-paths.spec.ts
tests/ui-e2e/fixtures/
```

---

## 5.2 测试环境设计

UI E2E 不应每次调用真实付费 Provider。

正确方式是：

```
真实 Provider 已捕获响应
→ 去敏
→ 本地 Fixture Provider
→ UI 仍走正式 API Client
→ 后端仍执行全部生产校验
```

不得在测试模式中直接：

```
跳过 Critique
强制 Fidelity passed
直接写 approved
跳过字体检查
跳过组件检查
```

Fixture Provider 只替代外部网络结果，不得替代本地业务门禁。

建议环境变量：

```
COPILOT_E2E=1
DESIGN_COPILOT_WORKSPACE=<临时目录>
KUNPO_GATEWAY_BASE_URL=http://127.0.0.1:<fixture-port>/v1
```

每个测试使用独立临时 Workspace，并在结束时清理。

---

## 5.3 UI 必须增加稳定选择器

不能依赖中文按钮文字作为唯一选择器。

增加：

```
data-testid="create-project"
data-testid="project-type-existing"
data-testid="screen-create"
data-testid="reference-import"
data-testid="font-import"
data-testid="font-license-confirm"
data-testid="component-import"
data-testid="binding-component-select-<control-id>"
data-testid="binding-approve"
data-testid="layout-approve"
data-testid="underlay-critique"
data-testid="underlay-repair"
data-testid="composition-final"
data-testid="fidelity-run"
data-testid="final-export"
```

---

## 5.4 必须实现的 UI E2E 场景

### UIE2E-01：已有项目严格模式默认值

```
创建项目
→ 选择已有项目
→ 验证 continuation mode = existing-strict
→ 验证严格模式提示可见
```

### UIE2E-02：多 Screen 隔离

```
创建 Screen A
→ 导入 Wireframe A
→ 创建 Screen B
→ 导入 Wireframe B
→ 切换 A/B
→ 验证输入和 Artifact 不串页
→ 重命名 B
→ 复制 B
→ 归档副本
```

### UIE2E-03：字体与组件

```
导入字体
→ 验证默认 unresolved
→ 显式确认授权
→ 显式确认 exact 角色
→ 导入 Component Family
→ 导入 default/pressed/disabled 状态
→ 配置 nine-slice
→ 批准 Component Contract
```

### UIE2E-04：Binding 正确性

```
不选择组件
→ 保存按钮不可用或后端失败

选择语义不兼容组件
→ 显示错误

选择兼容组件和状态
→ 保存成功

批准 Binding
→ Coverage 100%
```

### UIE2E-05：Underlay 与 Repair

```
批准 Layout
→ 生成 Underlay Contract
→ 导入/返回已知污染 Underlay
→ Critique 阻断
→ 执行 Repair
→ 自动 Re-critique
→ 最终无 Blocking Issue
```

### UIE2E-06：Final 与 Fidelity

```
生成 Final Composition
→ final PNG 存在
→ 运行 Fidelity
→ Final Approval
→ 导出 PNG
→ 导出文件哈希与 Composition Output 一致
```

### UIE2E-07：失败路径

至少验证：

```
删除字体文件后 Final 失败
删除组件文件后 Fidelity 失败
删除 final PNG 后 Final Approval 失败
修改 Component Contract 后 Composition stale
切换 guided → strict 后旧结果 stale
```

---

## 5.5 CI 配置

增加：

```
ui-e2e:
  runs-on: ubuntu-latest

  steps:
    - checkout
    - install pnpm
    - setup node
    - install dependencies
    - start fixture provider
    - run Electron UI E2E under a virtual display
    - upload traces/screenshots/results
```

建议脚本：

```
{
  "scripts": {
    "test:ui-e2e": "playwright test tests/ui-e2e"
  }
}
```

Linux Runner 可使用虚拟显示环境运行 Electron，例如：

```
xvfb-run -a pnpm test:ui-e2e
```

失败时至少保存：

```
Playwright trace
失败截图
Electron console
主进程日志
临时项目状态
最终 Artifact 摘要
```

Playwright 官方建议在 CI 失败时使用 Trace Viewer 定位问题；可设置失败保留 Trace，而不是所有测试始终录制。[Playwright](https://playwright.dev/docs/next/trace-viewer-intro?utm_source=chatgpt.com)

### REM-04 完成门禁

```
□ Electron 真实启动
□ UI 测试不直接调用内部 service 绕过界面
□ 文件对话框受控处理
□ 多 Screen UI 路径通过
□ Binding 显式选择路径通过
□ Critique/Repair/Final/Fidelity UI 路径通过
□ 失败路径至少覆盖字体、组件和 final PNG
□ CI 自动运行
□ 失败 Trace 可下载
```

---

# 六、REM-05：启用不可绕过的 GitHub 门禁

当前 `main` 分支仍显示：

```
protected: false
required status checks: off
```

这意味着当前虽然已经有 CI，但具有权限的账号仍可能：

```
直接 push main
在检查失败时合并
不经过 Review 合并
绕过对话解决要求
```

这不符合“PR 未通过任一门禁不得合并”的最终目标。

GitHub 官方支持通过受保护分支或 Ruleset 强制要求 PR Review、Required Status Checks、对话解决、禁止 Force Push 和限制绕过。[GitHub Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches?ref=pantsbuild-open-source-community-blog&utm_source=chatgpt.com)

---

## 6.1 立即建立 main Ruleset

对 `main` 配置：

```
Require a pull request before merging
Require at least 1 approving review
Dismiss stale approvals when new commits are pushed
Require conversation resolution
Require status checks
Require branch to be up to date
Block force pushes
Block branch deletion
Do not allow bypassing
```

Required Checks 设置为：

```
validate
fixture-e2e
secret-scan
macos-validate
ui-unit
ui-e2e
docs-validate
```

启用严格 Required Checks 后，PR 必须在最新目标分支基础上通过检查才能合并。[GitHub Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches?ref=pantsbuild-open-source-community-blog&utm_source=chatgpt.com)

---

## 6.2 增加 CODEOWNERS

新增：

```
.github/CODEOWNERS
```

示例：

```
/electron/services/        @技术审核账号
/src/features/             @前端审核账号
/docs/                     @文档审核账号
/.github/workflows/        @技术审核账号
/release-evidence/         @证据审核账号
```

实际账号必须替换为真实协作者。

---

## 6.3 增加 PR 模板

新增：

```
.github/pull_request_template.md
```

模板至少要求：

```
关联 Requirement ID
变更范围
不包含范围
代码影响
Artifact Schema 影响
Stale 影响
测试命令
失败路径
UI 截图或 Trace
文档更新
安全扫描
Review 人
```

---

## 6.4 验证门禁真的生效

不能只在设置页面打开选项。

必须创建一个测试 PR：

```
故意让 ui-e2e 失败
```

确认：

```
Merge 按钮不可用
管理员不能绕过
修复后检查通过
Review 完成后才允许合并
```

### REM-05 完成门禁

```
□ main protected=true
□ 所有关键 Job 是 Required Check
□ 至少一名技术 Reviewer
□ 新提交会使旧 Review 失效
□ 未解决对话阻止合并
□ Force Push 与删除被禁止
□ 失败测试 PR 无法合并
```

这里的技术 Code Review 属于工程治理，不是已经完成的 UI 设计师人工验收。

---

# 七、REM-06：文档与正式版本口径收口

这部分可以与 REM-03 一起执行。

必须修正：

```
README 中“正式版本”与“当前 Alpha”并存
README Artifact 目录树落后
短专项文档未达到执行级
工作台名称和实际目录不一致
Binding 语义规则没有文档
UI E2E 没有运行手册
Branch Ruleset 没有记录
```

建议在全部剩余整改完成后发布：

```
0.2.1
```

不要移动或覆盖既有：

```
v0.2.0
```

`0.2.1` 发布说明应明确：

```
Binding semantic compatibility
No implicit first-family binding
Workbench boundary completion
UI E2E in CI
Execution-grade documentation
Protected main branch
```

---

# 八、推荐执行顺序

## 配置任务 G-01：先保护 main

先启用当前已有的四项 Required Check：

```
validate
fixture-e2e
secret-scan
macos-validate
```

后续新 Job 合并后再追加。

---

## PR-15：Binding Semantic Gate

范围：

```
删除首组件默认值
增加 role/category policy
增加 state/font role 选择
后端 Approval 事实化
增加 Binding 测试
新增 COMPONENT-BINDINGS.md
```

禁止混入：

```
大面积 UI 改版
文档总重构
UI E2E
无关格式化
```

---

## PR-16：Frontend Workbench Boundaries

范围：

```
BindingWorkbench
LayoutWorkbench
Contract/Style/Production 拆出 App
feature API/model
UI unit tests
App Shell 收敛
```

要求：

```
不得改变生产 Artifact Schema
不得弱化后端 Gate
```

---

## PR-17：UI E2E 与 CI

范围：

```
Playwright Electron
Fixture Provider
data-testid
UI E2E 场景
CI ui-e2e
Trace Artifact
```

要求：

```
Fixture 只替代外部网络
不得绕过正式后端 Gate
```

---

## PR-18：执行级文档、Ruleset 与 0.2.1

范围：

```
契约字段文档
用户 SOP
开发文档
错误码
排障
Migration
Workbench 文档
README 修正
docs-validate
Ruleset 证据
0.2.1 发布
```

---

# 九、执行者必须遵守的禁止事项

```
禁止继续默认选择 families[0]
禁止由前端直接写 approved=true 作为事实
禁止只校验 Binding Coverage 而不校验语义兼容
禁止用新增空目录或空 Markdown 认定 F-14 完成
禁止只把 JSX 从 App.tsx 搬到另一个巨型文件
禁止以 fixture E2E 代替 UI E2E
禁止在 UI E2E 中绕过后端 Gate
禁止让 CI 存在但不设置为 Required Check
禁止直接 push main
禁止覆盖或移动既有 v0.2.0 Tag
```

---

# 十、最终完成定义

排除人工验收后，本轮剩余整改只有在以下全部完成时才可关闭：

```
□ Binding 不存在任何隐式组件选择
□ Control Role 与 Component Category 强制兼容
□ State 和 Font Role 显式选择
□ Binding Approval 由后端生成
□ Binding/Layout 有独立 Workbench
□ App.tsx 只保留 Shell 与装配
□ 核心 Workbench 有组件级测试
□ Electron UI E2E 已进入 CI
□ UI E2E 覆盖多 Screen、字体、组件、Binding、Repair、Final、Fidelity
□ 核心专项文档达到字段/SOP/错误/恢复/示例级
□ README 正式版本口径一致
□ 文档有自动一致性检查
□ main 分支受保护
□ 所有关键 CI 为 Required Check
□ 剩余整改 PR 有真实技术 Review
□ 0.2.1 从通过全部门禁的 main 提交发布
```

## 最终判定

执行者已经完成了困难度最高的生产链路改造，但仍不能说“任务文档全部无遗漏完成”。

排除你已经确认完成的人工验收后，当前真正剩余的核心是：

> **Binding 正确性、F-14 模块化、执行级文档、真实 UI E2E，以及不可绕过的仓库门禁。**

其中 Binding 的隐式首组件选择应优先于文档和模块整理处理，因为它直接可能影响已有项目风格延续的组件准确性。