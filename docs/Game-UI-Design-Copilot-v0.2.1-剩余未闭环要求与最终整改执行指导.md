# Game UI Design Copilot v0.2.1 剩余未闭环要求与最终整改执行指导

> 文档版本：1.0  
> 日期：2026-08-19  
> 适用仓库：`z806738350-source/Game-UI-Design-Projects`  
> 当前基线：`main@8772ece3ddda8d53e62556359d8d73a4ef0ca77e` / `v0.2.1`  
> 文档状态：最终收口执行基线  
> 目标版本：建议 `v0.2.2`

## 1. 适用范围与结论

本文件只记录截至 `v0.2.1` 仍未严格满足原《剩余整改任务与执行指导》的事项。以下能力已经完成，不再重复返工：真实 Final PNG、exact/nine-slice/vector-token 渲染、真实字体加载、Underlay Critique/Repair、像素 Fidelity、多 Screen、事务迁移、Golden fixture、Linux/macOS CI、UI 单元测试、Electron UI E2E 主链路、执行级文档框架和人工 UI 设计验收。

当前仍未完全闭环的事项只有四组：

1. Binding 的 State 与 Font Role 仍存在隐式默认和静默回退；通用 `action` 角色对新控件过宽。
2. 文档与错误码校验仍存在事实源例外，不能证明所有公开错误码、命令和目录说明都由代码事实驱动。
3. UI E2E 尚未完整覆盖原 UIE2E-01～07 的全部动作，且部分状态变更通过 Renderer API 直接触发。
4. 主分支虽已受保护且七项 CI 通过，但没有真实技术协作者的 GitHub Review；CODEOWNERS 仍全部指向仓库所有者本人。

因此，`v0.2.1` 的严格继承主流程已经达到主要生产预期，但尚不能宣称 REM-01～06 逐字、无例外全部完成。

## 2. 完成情况矩阵

| 编号 | 当前状态 | 结论 |
| --- | --- | --- |
| REM-01 Binding Semantic Gate | 部分完成 | 组件家族已显式选择，Role/Category 已强制兼容；State/Font Role 仍会自动带入，后端对缺失 Font Role 仍可能放行 |
| REM-02 Workbench Boundaries | 完成 | App 已收敛为 Shell，Binding/Layout 等工作台已拆出并有 UI 单测 |
| REM-03 执行级文档 | 部分完成 | 文档数量、模板和 docs-validate 已建立；错误码、命令和项目目录仍有事实源漏洞 |
| REM-04 UI E2E | 部分完成 | Electron 真启动、主链路和部分失败路径已进入 CI；多 Screen 生命周期、nine-slice、字体/组件文件故障等未完整覆盖 |
| REM-05 GitHub 门禁 | 部分完成 | main 已受保护、七项 CI 已运行；真实技术 Reviewer、Code Owner Review、stale approval 等未形成可验证闭环 |
| REM-06 版本与口径 | 完成 | 0.2.1、README、目录树和既有 tag 保护已完成 |

## 3. F-01：Binding State / Font Role 仍未真正显式化

### 3.1 当前问题

`BindingWorkbench` 在选择 Component Family 后，会自动把 `state` 设置为 `default` 或第一个状态，并把 `font_role` 设置为第一个允许角色；保存条件只检查 `component_id` 是否存在。后端对状态使用 `binding.state || 'default'`，只在 `binding.font_role` 已存在时检查 Font Role；Compositor 在 Font Role 缺失时还会回退到 `family.font_role` 或 `button-label`。

此外，`action` 角色被定义为兼容 button/navigation/tab/icon，且新建控件仍可能默认使用 `action`，这会让新控件绕过更精确的语义约束。

### 3.2 风险

- 设计师没有确认 State，却以 default 状态进入最终页面。
- 文本组件没有明确 Font Role，却静默使用 `button-label`。
- 新控件使用通用 `action` 后，可绑定多个不相干类别。
- API、迁移项目或异常前端数据可绕过 UI 的显式选择意图。

### 3.3 必须修改的文件

- `src/features/binding/BindingWorkbench.tsx`
- `src/features/contracts/ContractWorkspace.tsx`
- `electron/services/controlRolePolicy.cjs`
- `electron/services/componentBindings.cjs`
- `electron/services/compositor.cjs`
- `electron/services/errorCodes.cjs`
- `electron/services/componentBindings.test.cjs`
- `src/features/binding/BindingWorkbench.test.tsx`
- `tests/ui-e2e/strict-continuation.spec.ts`
- `docs/contracts/COMPONENT-BINDINGS.md`

### 3.4 前端执行要求

1. 选择 Component Family 后，`state` 和 `font_role` 仍保持空值，不得自动视为已确认。
2. Family 可提供“推荐状态/推荐字体角色”，但推荐值只能显示为建议，不能直接进入保存 Payload。
3. 保存按钮必须同时满足：每个必要 Control 已选 Component；已选 State；当 `family.text_policy === 'text-slot'` 时已选 Font Role。
4. `text_policy` 为 `none` 或 `baked` 时，不显示 Font Role 必填。
5. 新建或编辑 Screen Control 时，Role 使用受控枚举；不得默认创建新的 `action` 控件。
6. 存量 `action` 控件必须显示“待语义解析”，strict 模式不得在未解析时批准 Binding。

建议保存条件：

```ts
const allExplicitlyResolved = controls.every((control) => {
  const choice = choiceOf(control);
  const family = familyById.get(choice.component_id);
  if (!choice.component_id || !choice.state) return false;
  if (family?.text_policy === 'text-slot' && !choice.font_role) return false;
  return true;
});
```

### 3.5 后端执行要求

新增并使用冻结校验码：

```js
BINDING_STATE_REQUIRED
BINDING_FONT_ROLE_REQUIRED
BINDING_GENERIC_ROLE_UNRESOLVED
```

严格规则：

```js
if (!binding.state) error(BINDING_STATE_REQUIRED);
if (!family.states?.[binding.state]) error(BINDING_COMPONENT_STATE_MISSING);

const needsText = family.text_policy === 'text-slot';
if (needsText && !binding.font_role) error(BINDING_FONT_ROLE_REQUIRED);

if (strict && control.role === 'action') {
  error(BINDING_GENERIC_ROLE_UNRESOLVED);
}
```

Compositor 在 strict 模式中不得继续回退：

```js
const roleId = binding.font_role;
if (strict && family.text_policy === 'text-slot' && !roleId) {
  throw codedError(BINDING_FONT_ROLE_REQUIRED);
}
```

### 3.6 测试要求

必须增加或修改以下用例：

- 只选 Component、未选 State：保存不可用；后端拒绝。
- 文本组件未选 Font Role：保存不可用；后端拒绝。
- `text_policy=none` 的 Icon：不要求 Font Role。
- strict 模式新控件 Role=`action`：拒绝批准。
- 旧项目迁移出的 `action`：进入待解析状态；设计师改为具体 Role 后可批准。
- API 直接提交空 State、空 Font Role：后端拒绝。
- Compositor 不再产生 `button-label` 静默回退。
- 修改 State、Font Role 或 Role 后，Composition/Fidelity 正确 stale。

### 3.7 完成门禁

- [ ] Component、State、Font Role 均由设计师显式确认。
- [ ] strict 模式不存在字体角色默认回退。
- [ ] 新控件不能使用宽泛 `action` 直接通过。
- [ ] 后端与 UI 均覆盖缺失值和语义不兼容。
- [ ] Node、UI Unit、UI E2E、Fixture E2E 全绿。

## 4. F-02：错误码和文档校验尚未形成完整单一事实源

### 4.1 当前问题

`errorCodes.cjs` 已管理 Pipeline 与 Fidelity 码，但 `BINDING_*` 仍以内联字符串存在；`check-error-docs.cjs` 明确跳过 `BINDING_`。因此“所有公开错误码与 ERROR-CATALOG 双向校验”并不完整。

`check-docs.cjs` 会检查文档、标题、JSON 围栏和源码路径，但不会：

- 将 README 的 Artifact 目录树与 Artifact Registry / Golden Workspace 比对；
- 校验 Markdown 中的 `pnpm` 命令是否真实存在；
- 检查同一事实是否在不同文档中使用过时文件路径。

当前 `RELEASE-CHECKLIST.md` 还存在 `pnpm run fixture-e2e` 这一错误命令，真实脚本应为 `pnpm test:fixture-e2e`。

### 4.2 必须执行的改造

#### A. 注册 Binding 校验码

在 `electron/services/errorCodes.cjs` 增加：

```js
const BINDING_VALIDATION_CODES = Object.freeze({
  BINDING_COMPONENT_NOT_SELECTED: 'BINDING_COMPONENT_NOT_SELECTED',
  BINDING_COMPONENT_NOT_APPROVED: 'BINDING_COMPONENT_NOT_APPROVED',
  BINDING_COMPONENT_STATE_MISSING: 'BINDING_COMPONENT_STATE_MISSING',
  BINDING_COMPONENT_CATEGORY_MISMATCH: 'BINDING_COMPONENT_CATEGORY_MISMATCH',
  BINDING_FONT_ROLE_MISMATCH: 'BINDING_FONT_ROLE_MISMATCH',
  BINDING_FONT_ROLE_MISSING: 'BINDING_FONT_ROLE_MISSING',
  BINDING_UNKNOWN_CONTROL_ROLE: 'BINDING_UNKNOWN_CONTROL_ROLE',
  BINDING_STATE_REQUIRED: 'BINDING_STATE_REQUIRED',
  BINDING_FONT_ROLE_REQUIRED: 'BINDING_FONT_ROLE_REQUIRED',
  BINDING_GENERIC_ROLE_UNRESOLVED: 'BINDING_GENERIC_ROLE_UNRESOLVED'
});
```

`componentBindings.cjs` 必须引用注册表，不再拼接公开码字符串。`check-error-docs.cjs` 删除对 `BINDING_` 的豁免，并对三个注册表执行双向校验。

#### B. 建立项目目录机器事实源

推荐在 `artifactRegistry.cjs` 导出文档可读的路径元数据，或新增：

```text
docs/schemas/project-directory.required.json
```

其中列出全局和每 Screen 的必需文件。README 目录树使用明确标记：

```html
<!-- PROJECT_TREE:BEGIN -->
<!-- PROJECT_TREE:END -->
```

新增 `scripts/check-project-tree.cjs`：

1. 读取机器事实源；
2. 检查 README 树包含全部关键路径；
3. 检查 Golden Fixture 的 Workspace 产物包含同一核心集合；
4. 检查 Artifact Registry 不存在未文档化的正式 Artifact。

#### C. 校验文档中的命令

新增 `scripts/check-doc-commands.cjs`：

- 提取 Markdown Bash 围栏中的 `pnpm <name>` 与 `pnpm run <name>`；
- 对照 `package.json.scripts`；
- 对 `install`、`exec`、`dlx`、`audit` 等 pnpm 内建命令使用白名单；
- 不存在的脚本使 `docs-validate` 失败。

立即修正：

```text
pnpm run fixture-e2e
```

为：

```text
pnpm test:fixture-e2e
```

#### D. 修正文档源码指针

`COMPONENT-BINDINGS.md` 的主要前端源码指针应指向：

```text
src/features/binding/BindingWorkbench.tsx
```

`StrictContinuationPanel.tsx` 只能作为装配入口，不应再被描述为 Binding Workbench 本体。

### 4.3 测试与门禁

- `pnpm test:docs` 必须执行 `check-docs`、`check-error-docs`、`check-doc-commands`、`check-project-tree`。
- CI `docs-validate` 必须执行同一聚合脚本，不得只执行其中两项。
- 新增负向 Fixture：错误命令、缺失错误码、README 缺关键 Artifact 时，脚本必须失败。

### 4.4 完成门禁

- [ ] 所有公开 Binding 码进入冻结注册表。
- [ ] `check-error-docs` 不再存在 `BINDING_` 例外。
- [ ] README Artifact 树与机器事实源、Fixture 一致。
- [ ] 文档中的 pnpm 命令全部可执行。
- [ ] 文档源码指针与当前目录结构一致。
- [ ] docs-validate 负向用例可稳定阻断 PR。

## 5. F-03：UI E2E 尚未完整覆盖原 UIE2E-01～07

### 5.1 已完成部分

当前测试已真实启动 Electron，使用 Fixture Provider 替代外部网络，并覆盖 strict 默认值、资产导入、Binding、Layout、Critique、Repair、Final、Fidelity、导出及若干失败路径。该基础必须保留。

### 5.2 尚缺场景

1. Multi-screen 测试未给 Screen B 导入独立 Wireframe，也未覆盖重命名、复制和归档。
2. Component UI E2E 未通过界面配置任何 nine-slice 组件及 margins。
3. 失败路径未覆盖删除字体文件、删除组件文件、Component Contract 修改导致 Composition/Fidelity stale。
4. `saveProject`、`updateArtifact`、`exportVisual` 等部分动作通过 `callRendererApi` 直接触发，不能证明对应 UI 可操作性。

### 5.3 测试边界规则

允许：

- Fixture Provider 替代外部网络；
- 测试进程删除或篡改本地文件，作为故障注入；
- 通过只读 API 获取项目快照用于断言。

禁止：

- 直接调用 Renderer API 修改 Artifact、切换模式、批准、生成或导出；
- 在 Fixture 中直接写 `approved`、`passed` 或跳过后端门禁；
- 用服务层测试代替 UI 操作路径。

### 5.4 必须新增的 E2E

#### UIE2E-02B：完整 Screen 生命周期

```text
创建 Screen B
→ 导入与 Screen A 不同的 Wireframe B
→ 填写不同需求并生成 Contract
→ 切换 A/B 验证输入、Artifact、Workflow 隔离
→ 通过 UI 重命名 B
→ 通过 UI 复制 B
→ 归档副本
→ 验证原 B 与副本的身份、数据和归档状态
```

#### UIE2E-03B：nine-slice UI 配置

```text
在 Component Workbench 选择 nine-slice
→ 填写左/右/上/下 margins
→ 导入 default/pressed/disabled
→ 批准 Component Contract
→ 完成 Binding 与 Layout
→ Final Composition
→ 断言 render_log.renderer = nine-slice
→ 断言固定角区未变形
```

#### UIE2E-07B：字体文件故障

```text
完成 strict Final 前置条件
→ 测试进程删除字体文件
→ 通过 UI 点击 Final Composition
→ UI 显示 FONT_ASSET_HASH_MISMATCH / FONT_ACTUAL_LOAD_FAILED
→ Final Approval 保持不可用
```

#### UIE2E-07C：组件文件故障

```text
完成 Final
→ 测试进程删除或篡改组件资产
→ 通过 UI 点击 Fidelity
→ UI 显示 COMPONENT_ASSET_UNREADABLE / COMPONENT_ASSET_HASH_MISMATCH
→ Final Approval 与导出被阻断
```

#### UIE2E-07D：组件变更触发 stale

```text
完成 Final + Fidelity
→ 通过 Component Workbench 重新导入或修改组件
→ 断言 Bindings/Layout/Composition/Fidelity 按依赖图 stale
→ Final Export 不可用
```

#### UIE2E-07E：模式切换必须通过 UI

新增或完善项目设置中的 Continuation Mode 控件，使用 UI 完成 guided ↔ strict 切换；不得再调用 `saveProject` API 直接修改。

### 5.5 CI 证据要求

- Playwright 配置启用 `trace: retain-on-failure`、失败截图和主进程日志。
- `ui-e2e` Job 失败时上传 `test-results/`、Trace、截图、Electron 主进程日志和临时 Artifact 摘要。
- 只读快照 API 可保留；所有变更动作必须可在测试日志中对应到 UI Locator 与点击/输入。

### 5.6 完成门禁

- [ ] 原 UIE2E-01～07 的全部动作有对应测试。
- [ ] 多 Screen 生命周期完整覆盖。
- [ ] nine-slice 通过 UI 配置并验证真实渲染。
- [ ] 字体、组件、Final PNG 三类文件故障均被 UI 路径阻断。
- [ ] Component Contract 变化的 stale 链被 UI E2E 验证。
- [ ] 测试不再通过 Renderer API 修改业务状态。
- [ ] CI 失败证据可下载并可复现。

## 6. F-04：技术 Code Review 与 Ruleset Review 门禁未闭环

### 6.1 当前问题

main 已受保护，七个 CI Job 已运行并通过；但 CODEOWNERS 中所有路径仍指向仓库所有者本人。PR #16～#19 没有 GitHub Review Submission。PR 描述中的“CodeReview 子代理”属于有价值的自动审查，但不等于真实技术协作者的 GitHub APPROVE。

因此目前能够证明“CI 门禁”，不能证明“至少一名技术 Reviewer、Code Owner Review、stale approval 和对话解决门禁”。

### 6.2 必须执行的治理动作

1. 邀请至少一名真实技术协作者加入仓库。
2. 更新 `.github/CODEOWNERS`，将核心目录分配给真实协作者账号。
3. Ruleset 对 main 启用：
   - Require a pull request before merging；
   - Require at least 1 approving review；
   - Dismiss stale approvals when new commits are pushed；
   - Require review from Code Owners；
   - Require conversation resolution；
   - Require branch to be up to date；
   - Required Checks 七项全部启用；
   - Block force pushes / branch deletion；
   - Do not allow bypassing。
4. 创建一个治理验证 PR：
   - CI 全绿但无 Review 时，Merge 必须不可用；
   - Reviewer Approve 后允许合并；
   - 再 Push 新提交，旧 Approval 必须失效；
   - 创建未解决 Review Thread，Merge 必须继续阻断；
   - 解决 Thread 并重新 Approve 后才允许合并。
5. 保存证据：Ruleset 导出 JSON、CODEOWNERS、验证 PR Review 记录、失败/成功截图或 API 响应。

### 6.3 单人仓库例外

如果项目明确决定永久保持单人维护，则必须新增 ADR：

```text
docs/decisions/ADR-007-single-maintainer-review-governance.md
```

ADR 必须说明无法满足真实独立技术 Review，并定义替代门禁。该方案只能被标记为“批准的例外”，不能再声称逐字完成 REM-05。

### 6.4 完成门禁

- [ ] CODEOWNERS 至少包含一名非仓库所有者技术协作者。
- [ ] Ruleset 要求一名 Approving Review。
- [ ] 新提交会撤销旧 Approval。
- [ ] 未解决 Review Thread 会阻止合并。
- [ ] 七项 CI 均为 Required Checks。
- [ ] 验证 PR 的 GitHub Review Submission 可审计。

## 7. 建议执行顺序与 PR 划分

### G-02：先建立真实技术 Reviewer 门禁

在开展代码整改前邀请协作者并启用 Review 规则，避免后续 PR 继续由单人自审合并。

### PR-20：Binding Explicitness Hardening

范围：

- State / Font Role 真正显式选择；
- strict 模式删除字体角色静默回退；
- `action` 角色改为待解析或迁移专用；
- 新增校验码和测试；
- 更新 COMPONENT-BINDINGS 文档。

不得混入：E2E 总重构、文档体系总调整、Golden evidence 重跑。

### PR-21：UI E2E Completion

范围：

- Multi-screen 完整生命周期；
- nine-slice UI；
- 字体/组件/Final 文件故障；
- Component Contract stale；
- 模式切换 UI；
- 删除业务变更类 `callRendererApi`。

### PR-22：Documentation Fact Integrity

范围：

- Binding 校验码注册表；
- command validator；
- project tree validator；
- 修正文档命令和源码指针；
- docs-validate 负向测试。

### PR-23：v0.2.2 Release Closure

前置条件：PR-20～22 合并、真实技术 Reviewer 审核、七项 CI 全绿、治理验证 PR 通过。

发布动作：

- `package.json` 升级至 0.2.2；
- 更新 CHANGELOG 与 README；
- 不移动 v0.2.0 / v0.2.1；
- 从通过全部门禁的 main 提交创建 `v0.2.2`；
- 发布后复核 tag、Release 和 Ruleset 未被弱化。

## 8. 禁止性捷径

- 禁止继续自动确认 State 或 Font Role。
- 禁止 strict Compositor 回退到 `button-label`。
- 禁止让新控件以通用 `action` 绕过语义门禁。
- 禁止将 Binding 校验码排除在错误码注册表外。
- 禁止以“docs-validate 通过”掩盖错误命令或过时路径。
- 禁止以现有 15 个 E2E 数量替代原场景逐项覆盖。
- 禁止通过 Renderer API 直接修改业务状态来冒充 UI E2E。
- 禁止用 AI 子代理 Review 冒充真实技术协作者 APPROVE。
- 禁止移动、覆盖或删除 v0.2.0 / v0.2.1 Tag。
- 禁止为通过测试而削弱后端门禁、Fidelity 或 stale 传播。

## 9. 最终 Definition of Done

只有以下全部满足，才能把本轮剩余整改标记为真正关闭：

- [ ] Binding 的 Component、State、Font Role 全部显式确认。
- [ ] strict 模式没有 Font Role 静默回退。
- [ ] 新控件不能使用未解析的通用 `action` 通过。
- [ ] Binding 所有公开码进入冻结注册表并受双向文档校验。
- [ ] README Artifact 树、Artifact Registry 与 Golden Fixture 一致。
- [ ] 文档中的所有 pnpm 命令经自动校验。
- [ ] UI E2E 完整覆盖 Screen 生命周期、nine-slice、字体/组件/Final 故障和 stale。
- [ ] UI E2E 不通过直接业务 API 修改状态。
- [ ] main Ruleset 要求真实技术 Reviewer Approve。
- [ ] 新提交撤销旧 Review，未解决线程阻断合并。
- [ ] PR-20～22 均由真实技术 Reviewer 审核且七项 CI 全绿。
- [ ] v0.2.2 从通过全部门禁的 main 提交发布。

## 10. 交付证据清单

执行者最终必须提交：

1. PR-20～23 链接、Head SHA、Merge SHA。
2. 七项 CI 的成功 Run URL。
3. UI Unit 与 UI E2E 测试清单及数量。
4. 新增错误码注册表与 ERROR-CATALOG 双向校验结果。
5. `check-doc-commands` 和 `check-project-tree` 的正向/负向测试结果。
6. Ruleset 配置导出、CODEOWNERS、真实 Reviewer APPROVE 记录。
7. `v0.2.2` Tag 与 Release 指向的精确提交。
8. Fresh clone 下的 install / lint / test / fixture / ui-unit / ui-e2e / docs / build 结果。

最终结论：当前 v0.2.1 已具备成熟的严格继承主链路，但上述四组尾项未全部关闭。应以 v0.2.2 作为最终合规与治理收口版本，不需要推翻现有架构。
