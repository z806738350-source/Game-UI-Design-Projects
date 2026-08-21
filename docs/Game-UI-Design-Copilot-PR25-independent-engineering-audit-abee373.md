# Game UI Design Copilot PR #25 独立工程验收报告

## 0. 文档信息

| 项目 | 内容 |
|---|---|
| 仓库 | `z806738350-source/Game-UI-Design-Projects` |
| Pull Request | `#25` |
| 验收 Head | `abee373ad6451c7b7c9d1745139713982de80b45` |
| 目标 Base | `main@02477d46e0517ebe73b3857fe13bce070cdc629b` |
| 验收范围 | Git/PR、源码、前后端门禁、自动化测试、用户文档、CI、安全自动检查 |
| 排除范围 | UI 美术效果、视觉审美、设计师主观评分、屏幕阅读器人工实机体验 |
| 最终结论 | **有条件通过；需完成 1 项无障碍语义修复后再合并** |

---

# 1. 验收方法与证据等级

本次没有把执行者的完成报告直接当作结论，而是使用以下证据逐项交叉检查：

1. 直接读取 GitHub PR #25 当前 Head、Base、提交数和变更文件。
2. 对比 `main@02477d4` 与 `abee373` 的完整提交链和文件差异。
3. 直接读取最终 Head 中的前端、Electron 主进程、服务、测试和文档源码。
4. 读取 GitHub Actions 最终 Run `32336313082` 的实际状态和 Job 日志。
5. 对照上一轮终审整改要求，检查代码、测试、文档和运行证据是否同时存在。
6. 对 ARIA 结构与 WAI-ARIA 1.2 / APG select-only combobox 模式进行标准对照。

证据等级：

| 等级 | 定义 |
|---|---|
| A | 直接读取最终 Head 源码，并有最终 CI 运行证据 |
| B | 直接读取源码，但未在当前审计容器中重新运行 |
| C | 仅执行者本地声明，GitHub 无独立证据 |

本次审计容器无法解析 `github.com` / `raw.githubusercontent.com`，因此未在容器内重新 clone 和执行 `pnpm`；测试运行结论来自 GitHub Actions 对 PR Merge Ref 的独立执行，而不是执行者口头报告。

---

# 2. Git、PR 与提交真实性

## 2.1 已验证事实

PR #25 当前状态：

```text
state: open
merged: false
mergeable: true
head: abee373ad6451c7b7c9d1745139713982de80b45
base: main@02477d46e0517ebe73b3857fe13bce070cdc629b
commits: 6
changed files: 45
```

`30cfe5b...abee373` 的最终三次整改提交真实存在且连续：

```text
82c67a1  fix(a11y): align Dropdown with select-only combobox semantics
5cf4fad  fix(docs): close guided-mode and quick-start factual gaps
abee373  fix(ux): report guide-open failures instead of failing silently
```

完整 PR 相对 Base：

```text
ahead_by: 6
behind_by: 0
```

## 2.2 变更范围检查

最终 PR 修改 45 个文件，主要分为：

- 前端设计与 Dropdown：`src/*`、`src/styles.css`；
- 导出门禁：`electron/main.cjs`、`compositionRenderer.cjs`；
- 用户说明：`docs/user/quick-start-guide.html`；
- 示例素材：`docs/user/examples/*`；
- 文档事实检查：`scripts/check-docs.cjs`、`check-doc-commands.cjs`；
- 单元和 Electron UI E2E。

未发现 Artifact Schema、迁移器、核心 Critique/Repair/Fidelity 算法被无关改写。

## 2.3 结论

**通过，证据等级 A。**

---

# 3. Dropdown 代码验收

## 3.1 已完成的实现

最终实现已经由普通按钮触发器改为 select-only combobox：

```tsx
<div
  role="combobox"
  tabIndex={disabled ? -1 : 0}
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={menuId}
  aria-activedescendant={...}
  aria-disabled={disabled || undefined}
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledBy}
/>
```

已确认实现：

- ArrowUp / ArrowDown；
- Home / End；
- Enter / Space；
- Escape 关闭并恢复焦点；
- Tab 关闭但不截断正常焦点顺序；
- 600ms Typeahead；
- 禁用项自动跳过；
- `tabIndex=-1` + `aria-disabled`；
- 空列表提示；
- 长文本 `title`；
- 活动项滚入视图；
- 视口底部向上展开；
- 外部点击关闭；
- 开发态缺失 Accessible Name 时警告。

## 3.2 Accessible Name 调用点

已抽查并确认：

- 新建项目继承强度；
- 项目切换；
- Screen 切换与归档；
- Input 继承模式；
- Contract 控件角色；
- Reference Role；
- Component Category / State / Reuse / Text Policy；
- Binding Component / State / Font Role。

Binding 已使用 `fieldset/legend` 分组，并为一行三个 Combobox 提供不同名称：

```text
组件 + 控件图例
状态 + 控件图例
字体角色 + 控件图例
```

## 3.3 测试真实性

组件测试不是只检查属性存在，而是覆盖：

- ARIA 角色和关联；
- 多 ID `aria-labelledby`；
- 缺名警告；
- 禁用项；
- 全部键盘操作；
- 焦点恢复；
- Typeahead；
- 空列表；
- 长文本。

Electron E2E 启动真实 Electron Renderer，验证：

- Combobox Accessible Name；
- Listbox 与 Option；
- `aria-activedescendant`；
- 键盘与鼠标交互；
- Binding 三个独立名称。

## 3.4 发现的剩余问题：弹出 Listbox 未继承 `ariaLabelledBy`

当前 Popup 为：

```tsx
<ul
  role="listbox"
  aria-label={ariaLabel}
>
```

但没有：

```tsx
aria-labelledby={ariaLabelledBy}
```

这会导致：

- 使用 `ariaLabel` 的 Dropdown，Combobox 和 Listbox 都有预期名称；
- 使用 `ariaLabelledBy` 的 Binding Dropdown，Combobox 有正确名称，但 Listbox 没有继承同一字段/控件标签；
- Listbox 可能只能从 Option 内容推导名称，无法表达它属于“组件 / 状态 / 字体角色”的哪一个字段。

WAI-ARIA 1.2 将 `listbox` 标记为需要 Accessible Name；W3C APG select-only combobox 示例也在 Combobox 和 Popup Listbox 上同时引用同一 Label。

### 必须修改

```tsx
<ul
  className={`dropdown-menu${dropUp ? ' is-up' : ''}`}
  id={menuId}
  role="listbox"
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledBy}
>
```

`aria-labelledby` 和 `aria-label` 同时存在时，标准 Accessible Name 计算会优先使用 `aria-labelledby`，与 Combobox 现有行为一致。

### 必须新增测试

组件测试：

```tsx
expect(
  screen.getByRole('listbox', {
    name: '组件 确认按钮（角色：primary-action）'
  })
).toBeTruthy();
```

Electron E2E：

```ts
await expect(
  page.getByRole('listbox', {
    name: /^组件 .+（角色：primary-action）$/
  })
).toBeVisible();
```

## 3.5 结论

**主体通过，但 ARIA 完整性尚有 1 项可验证缺口。**

建议严重度：`major / merge-blocking for this accessibility closure PR`。

---

# 4. Binding 链路验收

## 4.1 前端显式性

已确认：

- 初始值为空；
- 选择 Family 后 State 和 Font Role 被重置为空；
- 推荐值只显示提示，不写入 Payload；
- 所有必要 Component + State 必须显式选择；
- `text-slot` Family 必须显式选择 Font Role；
- 保存 Payload 不携带客户端 `approved`。

## 4.2 后端 Fail-Closed

`validateBindings()` 会拒绝：

- 未选择组件；
- 未批准组件家族；
- 缺失 State；
- State 不存在；
- `text-slot` 缺失 Font Role；
- Role 与 Component Category 不兼容；
- 必需状态不完整；
- Font Role 不兼容或不在 Font Manifest；
- strict 中遗留通用 `action` Role；
- strict 中未知 Role；
- 必需控件未绑定。

## 4.3 E2E

E2E 实际验证：

- 未选择时保存不可用；
- 不兼容组件灰显；
- 只选 Family 不会自动补 State/Font Role；
- 只选 State 仍不可保存；
- 保存后的 Artifact 包含设计师显式选择；
- 后端批准后状态为 approved。

## 4.4 结论

**通过，证据等级 A。**

---

# 5. Final Approval 与 Export Gate 验收

## 5.1 前端门禁

`final-export` 仅在：

```text
Composition Output mode = final
Composition Manifest status = approved
```

时开放。

## 5.2 主进程门禁

严格模式导出依次检查：

1. Fidelity Report 为 `passed`；
2. Fidelity 引用当前 Manifest Version 和 Output Hash；
3. Composition Manifest 已最终批准；
4. Final PNG 可读取；
5. PNG Hash 与 Artifact 一致；
6. PNG 格式和尺寸一致；
7. 导出后文件 Hash 与 Output Hash 一致。

未批准时抛出：

```text
FINAL_APPROVAL_REQUIRED
```

## 5.3 测试

已确认：

- `assertFinalApprovalForExport` 覆盖 approved 与多种非 approved 状态；
- Electron E2E 在批准前验证导出按钮禁用；
- 批准后实际执行 Save Dialog、生成文件并比较 SHA-256。

## 5.4 结论

**通过，证据等级 A。**

---

# 6. Guided 模式事实一致性

## 6.1 源码事实

`visualTask()` 对以下模式均进入 Underlay-only 分支：

```text
existing-strict
existing-guided
locked-continuation
```

均明确：

```text
generate:
- background
- character
- scene
- page-specific-decoration

must_not_generate:
- shared-buttons
- shared-tabs
- shared-navigation
- shared-icons
- formal-ui-text
```

## 6.2 用户说明

说明书现在明确写明：

- Guided 仍是 Underlay-only；
- 同样禁止共享按钮、页签、导航、图标和正式文字；
- 当前没有共享组件与正式文字的最终合成入口；
- 不能作为正式交付路线；
- 正式生产使用 strict。

## 6.3 自动事实门禁

`check-docs.cjs`：

- 要求 Guided 段落包含三个关键事实；
- 禁止旧错误句“不会阻止共享组件与正式文字进入图片”；
- 说明书中的 `data-local-path` 必须真实存在。

## 6.4 测试边界

当前 CI 对上述门禁执行正向检查并通过。

执行者称已做故障注入；仓库内现有 `docsFactSources.test.cjs` 没有为这两个新增门禁加入专门的负向 Unit Test。因此：

- 门禁源码真实存在：已验证；
- 当前文档通过门禁：已验证；
- 执行者本地故障注入过程：无法从仓库独立验证。

建议后续补两个追踪测试，但不作为功能合并阻断：

```text
- 恢复旧 Guided 错句时 check-docs 必须失败
- 把 data-local-path 指向缺失文件时 check-docs 必须失败
```

## 6.5 结论

**功能与当前文档通过；负向门禁自动测试建议补强。**

---

# 7. 新用户说明书验收

## 7.1 已核实内容

说明书已经正确覆盖：

- 首次安装 Node / pnpm；
- `pnpm install`；
- `.command` 不自动安装依赖；
- `pnpm quick-start`；
- `pnpm quick-start:check`；
- Gateway 必须由用户自行启动；
- Gateway 与桌面直连两种方式；
- Key 不提交仓库；
- 新项目探索路线；
- Strict 完整路线；
- Guided 实验性边界；
- Reference Inventory / Pack；
- Font Manifest；
- Component Contract；
- Binding；
- Underlay Critique / Repair；
- Final Composition / Fidelity / Approval / Export；
- 多 Screen；
- Stale 与只读证据；
- 常见错误和恢复方式。

## 7.2 示例素材

以下文件真实存在于最终 Head：

```text
docs/user/examples/quick-start-wireframe.png
docs/user/examples/README.md
```

GitHub Contents API 返回：

```text
quick-start-wireframe.png
size: 298180 bytes
type: file
```

README 说明了用途、推荐设计意图、教学目标和授权边界。

## 7.3 帮助入口

Electron 主进程检查说明书存在后调用系统默认程序打开；前端对：

- `{ok:false}`；
- IPC rejection；

均显示错误条和手动路径。三条 App Unit Test 分别覆盖成功、false 和 throw。

## 7.4 仍需说明的证据边界

- 当前审计通过 GitHub 确认示例 PNG 被真实追踪；因审计容器无法解析 GitHub 域名，没有在本地重新下载解码该 PNG。
- CI 文档门禁证明文件存在，但不检查 PNG 像素尺寸；README 声称的 `2160 × 3840` 没有独立于执行者重新测量。
- 文档宣称 Windows / Linux 功能一致，但当前 CI 没有 Windows Job；Linux Electron E2E 和 macOS Build/Test 已通过，Windows 属于未单独验证的平台声明。

以上均不影响 macOS/Linux 当前主路径验收，但应在正式跨平台发布时补 Windows CI 或收敛文案。

## 7.5 结论

**说明书事实主体通过，证据等级 A/B。**

---

# 8. UI E2E 真实性验收

## 8.1 真实 Electron

E2E 使用 Playwright `_electron.launch()` 启动真实 Electron，并要求生产 `dist/index.html` 已存在。

## 8.2 外部服务替代边界

Fixture Provider 只替代外部 Kunpo 网络响应；本地 Project Store、Pipeline、文件门禁、合成器、Fidelity 和 IPC 仍走正式代码。

## 8.3 文件操作

Native Open/Save Dialog 被测试队列替换，但导入和导出仍由用户界面按钮触发；这是稳定自动化所需的边界替换，不是直接写 Artifact 绕过界面。

## 8.4 API 旁路

`getProject()` 通过 Preload API 读取快照用于断言；当前 Helper 明确不再提供 `callRendererApi` Mutation Helper。业务状态变更通过 UI 操作完成。

测试进程仅在故障场景中直接删除/篡改本地文件，以验证系统能否发现外部破坏；这是故障注入，不是成功路径旁路。

## 8.5 覆盖范围

最终 29 项 Electron E2E 覆盖：

- Strict 默认模式；
- Wireframe / Intent / Contract；
- Reference / Font / Component；
- Explicit Binding；
- Component-aware Layout；
- Underlay Critique / Repair；
- Final / Fidelity / Approval / Export Hash；
- 字体缺失；
- 组件篡改；
- Stale 传播；
- Provider 失败；
- 多 Screen 生命周期；
- Nine-slice；
- Dropdown Keyboard / ARIA。

## 8.6 结论

**通过，证据等级 A。**

---

# 9. CI、构建与安全验收

## 9.1 最终 Run

GitHub Actions Run：

```text
32336313082
head_sha: abee373ad6451c7b7c9d1745139713982de80b45
status: completed
conclusion: success
```

七个 Job 全部成功：

```text
validate
fixture-e2e
ui-unit
ui-e2e
docs-validate
secret-scan
macos-validate
```

## 9.2 实际日志

直接读取 Job 日志确认：

```text
Node tests: 166 passed
UI Unit: 47 passed
Electron UI E2E: 29 passed
Production build: passed
Fixture evidence replay: passed
Docs four gates: passed
Gitleaks: passed
macOS type/test/build: passed
pnpm audit --prod --audit-level high: passed
```

## 9.3 安全证据分级

### 已独立验证

- GitHub Gitleaks Job 成功；
- PR 变更列表没有 `.env`、Key 文件或用户工作区；
- 文档使用的是 `your-local-key` 占位符；
- Production Dependency Audit 成功。

### 仅执行者声明

```text
qodersec review --layer=l3
Critical/Major/Minor/Nit = 0
```

仓库未保存该本地扫描的机器可读报告，因此只能记录为等级 C，不能描述为 GitHub 独立验证。

## 9.4 结论

**CI 与公开安全门禁通过；本地 L3 声明接受归档但不计入独立证据。**

---

# 10. 发现清单

## Major-01：Binding Popup Listbox 未继承 `ariaLabelledBy`

**状态：未关闭，建议合并前修复。**

影响：Binding 三个 Combobox 本身名称正确，但 Popup Listbox 缺少对应字段/控件的显式标签，不完全符合本 PR 声称的完整 select-only combobox 语义。

修复成本：极低，一行属性 + 两个测试断言。

## Minor-01：新增文档事实门禁缺少仓库内负向测试

**状态：非阻断。**

门禁源码和当前 CI 正向运行有效，但“故障注入可抓”仅是执行者本地声明。建议将两种故障作为 `docsFactSources.test.cjs` 正式用例。

## Evidence-01：本地 L3 报告未入库

**状态：非阻断。**

GitHub Secret Scan 已通过。若未来需要审计 L3，应保存 Commit SHA、工具版本、规则版本和摘要，不必保存敏感原始内容。

## Evidence-02：Windows 未单独验证

**状态：非阻断。**

Linux Electron E2E 和 macOS Build/Test 已通过；文档的“Windows 功能一致”尚无 Windows CI 支撑。

---

# 11. 最终验收矩阵

| 验收项 | 结果 |
|---|---|
| PR Head / Base / 提交链 | 通过 |
| 变更范围 | 通过 |
| Dropdown Combobox 角色 | 通过 |
| Dropdown 键盘与焦点 | 通过 |
| Combobox Accessible Name | 通过 |
| Popup Listbox Accessible Name | **未完全通过** |
| Binding 显式选择 | 通过 |
| Binding 后端门禁 | 通过 |
| Guided 源码与说明书 | 通过 |
| 示例素材路径 | 通过 |
| 安装和 AI 接入说明 | 通过 |
| 帮助入口失败反馈 | 通过 |
| Final Approval 导出门禁 | 通过 |
| Final Hash 校验 | 通过 |
| UI Unit | 通过 |
| Electron UI E2E | 通过 |
| Node / Fixture / Docs / Build | 通过 |
| Gitleaks / Dependency Audit | 通过 |
| 本地 L3 | 未独立验证 |
| 人工美术验收 | 按用户要求排除 |

---

# 12. 最终结论

## 12.1 对执行者完成报告的判断

执行者提交的核心事实大部分属实：

- 最终 Head 和三次提交属实；
- Combobox 架构与键盘实现属实；
- 12+ 调用点的 Combobox 名称整改主体属实；
- Guided 文档、示例素材、Gateway/直连、帮助错误反馈属实；
- 47 Unit、29 UI E2E、166 Node 和七项 CI 成功属实；
- Final Approval 导出门禁属实。

但“终审整改全部闭环”仍略有过度：Popup Listbox 没有继承 `ariaLabelledBy`，因此 Binding Dropdown 的完整 Popup 语义尚差最后一步。

## 12.2 合并建议

```text
当前结论：有条件通过
当前建议：暂缓立即合并
```

完成以下一个小型提交后即可批准：

```text
1. Listbox 增加 aria-labelledby={ariaLabelledBy}
2. 增加 Binding Listbox Accessible Name Unit Test
3. 增加 1 条 Electron E2E 断言
4. 重跑七项 Required Checks
```

如果该修复完成且最终 Run 全绿，本次工程验收可以改为：

```text
APPROVE / READY TO MERGE
```

---

# 13. 建议修复提交模板

```text
fix(a11y): label combobox popup listboxes from their field context

- propagate ariaLabelledBy from Dropdown to the popup listbox
- assert Binding component/state/font popup names in unit tests
- assert popup accessible name in Electron UI E2E
- retain all existing keyboard, focus, typeahead and disabled behavior
```
