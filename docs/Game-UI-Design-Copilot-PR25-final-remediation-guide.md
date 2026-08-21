# Game UI Design Copilot PR #25 最终收口整改执行文档

## 0. 文档信息

| 项目 | 内容 |
|---|---|
| 目标仓库 | `z806738350-source/Game-UI-Design-Projects` |
| 目标 PR | `#25 feat(ui): Darkroom Precision 深色重制 + 自绘 Dropdown 替换全部原生 select` |
| 当前审核 Head | `30cfe5b19c790457eecde2a0396e8e6eaae8ae4d` |
| 基线分支 | `main@02477d46e0517ebe73b3857fe13bce070cdc629b` |
| 当前状态 | PR Open、Mergeable，最新七项 CI 已通过 |
| 文档用途 | PR #25 合并前最后一轮整改、实现、测试与复审基线 |
| 审核结论 | **整改主体通过，但仍有 3 项 P0 未完全闭环；完成本文件要求后方可合并** |

---

# 1. 执行摘要

PR #25 已经完成了大部分重要整改：

- Darkroom Precision 前端视觉语言已经统一；
- 状态语义色已经重新划分；
- 原生 `select` 已替换为共享 Dropdown；
- Dropdown 已具备鼠标、方向键、Home/End、Enter/Space、Escape、Tab 和 typeahead；
- 已补充 UI Unit 与真实 Electron UI E2E；
- 严格继承正式导出已经增加“最终批准后才能导出”的前后端双门禁；
- `quick-start-guide.html` 已经大幅订正并纳入 README、应用帮助入口和 docs 校验；
- 最新 GitHub Actions 七个 Job 已全部通过。

但是，当前仍不能写成“审核整改全部关闭”。剩余问题集中在三个方面：

1. **Dropdown 的 ARIA 角色模型仍不标准**：当前在原生 `button` 上使用 `aria-activedescendant`，键盘行为虽然可用，但辅助技术语义不完整。
2. **说明书对 `existing-guided` 的一处说明与真实 Prompt 相反**。
3. **说明书引用了一份仓库内不存在的新手练习线框稿**，Fresh Clone 用户无法按教程操作。

这三项全部处理完成，并重新通过本文件规定的测试与合并门禁后，PR #25 可以批准合并。

---

# 2. 当前已确认完成的内容

以下事项不需要推翻或重写，只需要在最后收口中保持不回退。

## 2.1 前端视觉统一

已完成：

- `approved` 使用绿色；
- `generated` 使用紫色；
- `warning` 与琥珀金交互色分离；
- strict 资产、绑定、底层、保真工作台视觉统一；
- 旧橙色派生值已经清理；
- 主要操作文案已经中文化；
- `FRONTEND-DESIGN-GUIDE.md` 已成为前端视觉事实源。

## 2.2 Dropdown 键盘操作

已实现：

- `ArrowDown` / `ArrowUp`；
- `Home` / `End`；
- `Enter` / `Space`；
- `Escape`；
- `Tab`；
- 600ms 前缀搜索；
- 禁用项跳过；
- 空列表提示；
- 活动项滚入视野；
- 菜单接近视口底部时向上翻转；
- 鼠标与键盘活动项同步。

现有行为测试必须保留。

## 2.3 最终批准与导出顺序

当前正确顺序已经建立：

```text
最终 PNG
→ 保真校验通过
→ 最终批准
→ 导出最终 PNG
```

现有双层保护必须保留：

- UI 层：未最终批准时禁用导出；
- 后端层：`FINAL_APPROVAL_REQUIRED`；
- 纵深保护：Fidelity 新鲜度、Output Hash 和文件可读性继续复核。

## 2.4 说明书主要订正

以下内容已经订正，不得回退：

- `.command` 不会自动安装依赖；
- 首次运行必须 `pnpm install`；
- 增加 `pnpm quick-start:check`；
- 删除不存在的 Underlay waiver UI；
- 删除不存在的 Fidelity major 逐项批准 UI；
- 字体授权描述改为“确认有权在本项目中使用”；
- Reference Inventory / Pack 流程得到补充；
- 组件、状态、复用策略、nine-slice 等字段得到补充；
- 最终批准必须先于导出；
- guided 已标记为实验性；
- 应用内增加使用说明书入口；
- 说明书已纳入 README 与 docs 校验。

---

# 3. P0-01：修正 Dropdown 的 ARIA 角色模型

## 3.1 当前问题

当前 Dropdown 的触发元素是：

```tsx
<button
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={menuId}
  aria-activedescendant={...}
/>
```

键盘行为可以工作，但 `aria-activedescendant` 不应依赖普通 `button` 作为活动后代容器。

现有测试只证明：

- 属性存在；
- 键盘事件能运行；
- DOM 活动项会变化。

它没有证明屏幕阅读器会把这个控件理解为一个完整的单选列表型输入控件。

## 3.2 目标

将 Dropdown 调整为标准的 **select-only combobox + listbox** 模型，同时保持现有视觉和键盘行为。

不得为了修复 ARIA：

- 恢复原生 `select`；
- 删除现有键盘行为；
- 降级现有 UI E2E；
- 只删除 `aria-activedescendant` 而不建立替代焦点模型。

## 3.3 推荐实现

修改：

```text
src/features/shared/ui.tsx
```

将触发元素改为一个可聚焦的 combobox 容器，例如：

```tsx
<div
  ref={buttonRef}
  role="combobox"
  tabIndex={disabled ? -1 : 0}
  className="dropdown-button"
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={menuId}
  aria-activedescendant={
    open && activeIndex >= 0
      ? `${menuId}-option-${activeIndex}`
      : undefined
  }
  aria-disabled={disabled || undefined}
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledBy}
  onClick={...}
  onKeyDown={...}
>
```

注意：

- `buttonRef` 类型需要从 `HTMLButtonElement` 调整为 `HTMLDivElement` 或通用 `HTMLElement`；
- disabled 状态不能只靠 CSS，必须 `tabIndex=-1`、`aria-disabled=true`，事件处理也必须直接返回；
- 当前关闭、typeahead、focus restore、activeIndex、dropUp 逻辑可以继续复用；
- `.dropdown-button` 的视觉样式不需要改变。

### 3.3.1 新增 `ariaLabelledBy`

Dropdown Props 增加：

```ts
ariaLabelledBy?: string;
```

Accessible Name 优先级建议：

```text
aria-labelledby
> aria-label
> 明确的 fallback（仅开发警告，不可静默用于生产）
```

开发环境下若两者都没有，可以输出一次警告：

```ts
console.warn('Dropdown requires ariaLabel or ariaLabelledBy');
```

不得把视觉 placeholder 当作唯一 Accessible Name。

## 3.4 修正 Binding Workbench 的控件分组

当前一行 Binding 中有三个 Dropdown：

- 组件；
- 状态；
- 字体角色。

不能继续依赖一个外围 `<label>` 同时命名三个交互控件。

修改：

```text
src/features/binding/BindingWorkbench.tsx
```

推荐结构：

```tsx
<fieldset className="binding-row" key={control.id}>
  <legend>
    {control.label}（角色：{role}）
  </legend>

  <div className="binding-field">
    <span id={`${control.id}-component-label`}>组件</span>
    <Dropdown
      ariaLabelledBy={`${control.id}-component-label`}
      ...
    />
  </div>

  <div className="binding-field">
    <span id={`${control.id}-state-label`}>状态</span>
    <Dropdown
      ariaLabelledBy={`${control.id}-state-label`}
      ...
    />
  </div>

  <div className="binding-field">
    <span id={`${control.id}-font-label`}>字体角色</span>
    <Dropdown
      ariaLabelledBy={`${control.id}-font-label`}
      ...
    />
  </div>
</fieldset>
```

每个 Dropdown 必须有独立、明确、可读的名称。

## 3.5 逐一补齐所有 Dropdown 的可访问名称

至少检查以下调用点：

```text
src/App.tsx
src/features/input/InputWorkspace.tsx
src/features/contracts/ContractWorkspace.tsx
src/features/binding/BindingWorkbench.tsx
src/features/workbenches/ScreenManager.tsx
src/features/workbenches/ReferenceWorkbench.tsx
src/features/workbenches/ComponentKitWorkbench.tsx
```

要求：

| 使用点 | 建议名称 |
|---|---|
| 项目切换 | `切换项目` |
| 创建项目继承强度 | `选择继承强度` |
| 输入阶段继承强度 | `切换继承强度` |
| Screen 切换 | `切换当前页面` |
| Screen 归档 | `选择要归档的页面` |
| Contract Role | `选择控件语义角色` |
| Reference Role | `选择参考图角色` |
| Component Category | `选择组件类别` |
| Component State | `选择组件状态` |
| Reuse Mode | `选择组件复用策略` |
| Text Policy | `选择文字策略` |
| Binding Component | `为 <control> 选择组件` |
| Binding State | `为 <control> 选择状态` |
| Binding Font Role | `为 <control> 选择字体角色` |

## 3.6 测试要求

### 组件单测

修改：

```text
src/features/shared/Dropdown.test.tsx
```

至少验证：

```text
□ getByRole('combobox') 可以找到控件
□ role=combobox
□ aria-haspopup=listbox
□ aria-expanded 正确变化
□ aria-controls 指向 listbox
□ aria-activedescendant 只出现在 combobox 上
□ disabled 时 tabIndex=-1 且 aria-disabled=true
□ ariaLabel 能成为 Accessible Name
□ ariaLabelledBy 能成为 Accessible Name
□ Binding 行三个 combobox 名称互不相同
□ 原有 18 个键盘与鼠标行为测试继续通过
```

### Electron UI E2E

修改：

```text
tests/ui-e2e/dropdown-keyboard.spec.ts
```

将：

```ts
locator('.dropdown-button')
```

保留为视觉定位可以，但语义断言必须增加：

```ts
getByRole('combobox', { name: '选择继承强度' })
```

至少验证：

```text
□ 真实 Electron 中 combobox 可被角色和名称定位
□ Arrow / Home / End / Enter / Space / Escape / Tab 不回退
□ aria-activedescendant 指向当前 option
□ disabled combobox 不进入 Tab 顺序
□ Binding 的组件、状态、字体角色可分别被名称定位
```

## 3.7 完成标准

```text
□ 不再在普通 button 上挂 aria-activedescendant
□ Dropdown 使用标准 combobox/listbox 语义
□ 所有 Dropdown 有稳定 Accessible Name
□ Binding 三个下拉的名称互不混淆
□ 原有键盘行为全部保留
□ UI Unit 与 UI E2E 全绿
```

---

# 4. P0-02：修正 guided 模式说明与真实 Prompt 的矛盾

## 4.1 当前错误

说明书当前存在类似表述：

> 引导继承生成底层图时不阻止共享组件与正式文字进入图片。

但真实 `visualTask()` 对以下三种模式统一执行 underlay-only：

```text
existing-strict
existing-guided
locked-continuation
```

并统一禁止：

```text
shared-buttons
shared-tabs
shared-navigation
shared-icons
formal-ui-text
numbers
labels
```

因此说明书当前这句话与真实代码相反。

## 4.2 必须修改

修改：

```text
docs/user/quick-start-guide.html
```

推荐替换为：

> 引导继承当前仍采用底层图（underlay-only）生成方式，同样禁止共享按钮、导航、图标和正式文字进入图片。它与严格继承的区别主要在于部分后端门禁更宽松，但当前同样没有共享组件与正式文字的最终合成入口，因此不能作为正式交付路线。

同时检查说明书中所有 guided 描述，确保不存在以下错误暗示：

```text
引导继承会生成完整页面
引导继承允许模型直接画共享按钮
引导继承可以不经组件与字体合成交付
引导继承只是 strict 的少量校验关闭版
```

## 4.3 建议增加代码事实校验

在：

```text
scripts/check-docs.cjs
```

加入一个最小事实检查，防止未来再次写反：

```text
quick-start-guide.html 必须包含：
“引导继承当前仍采用底层图”
“禁止共享按钮”
“没有最终合成入口”

并禁止出现：
“不阻止共享组件与正式文字进入图片”
```

也可以将 guided 能力边界写入一个机器可读文件：

```text
docs/schemas/continuation-modes.json
```

然后由代码与文档共同读取或校验。

## 4.4 完成标准

```text
□ guided 说明与 visualTask 真实 Prompt 一致
□ 不再暗示 guided 可生成完整交付页面
□ docs 校验可阻止旧错误文案回归
```

---

# 5. P0-03：补充真实存在的新手练习素材

## 5.1 当前问题

说明书的“10 分钟练习”引用：

```text
test-artifacts/portrait-party-formation-wireframe.png
```

当前仓库并不存在该路径和文件。

Fresh Clone 用户按教程操作会在第一步失败。

## 5.2 推荐方案

新增：

```text
docs/user/examples/
├── quick-start-wireframe.png
└── README.md
```

### 素材来源

可以从仓库已经拥有的合法测试资产中复制一份适合新手的线框稿，例如：

```text
release-evidence/golden-samples/functional-dense/inputs/wireframe.png
```

但复制后必须作为独立的新手示例维护，不应要求新用户进入 `release-evidence/` 审计目录寻找素材。

### examples README

至少说明：

```text
文件用途
推荐创建“新项目”还是“已有项目”
建议输入的设计意图
练习目标
素材授权或来源说明
不得把该示例当成真实商业项目资产
```

## 5.3 修改说明书

将练习素材路径改为：

```text
docs/user/examples/quick-start-wireframe.png
```

推荐增加：

```text
练习项目名称：快速上手示例
项目类型：新项目
建议设计意图：
“设计一个角色编队页面，玩家可以查看成员、调整上阵顺序并确认阵容。”
```

这样用户不需要自己猜输入内容。

## 5.4 扩展文档校验

修改：

```text
scripts/check-docs.cjs
```

增加本地路径检查：

```text
说明书中声明为仓库本地文件的路径必须存在
```

至少验证：

```text
docs/user/examples/quick-start-wireframe.png
docs/dev/PROVIDER-TROUBLESHOOTING.md
Start Game UI Design Copilot.command
```

建议使用明确标记，避免把普通文字误识别为路径：

```html
<code data-local-path>docs/user/examples/quick-start-wireframe.png</code>
```

校验脚本只检查带 `data-local-path` 的路径。

## 5.5 完成标准

```text
□ Fresh Clone 中练习图片真实存在
□ 说明书引用路径正确
□ 新手不需要进入发布证据目录找素材
□ docs 校验能检测缺失练习素材
```

---

# 6. P1：建议同一收口提交一并修正

以下问题不单独阻断核心链路，但既然 PR #25 的目标包含“新用户说明书”，建议在合并前一起修完。

## 6.1 补充 AI 连接方式说明

当前说明书主要写：

```env
KUNPO_GATEWAY_BASE_URL=http://127.0.0.1:9020/v1
```

还需要说明：

- 本地 Gateway 必须已经运行；
- `127.0.0.1:9020` 不是工具自动启动的服务；
- 没有 Gateway 时可以使用桌面直连配置；
- 连接故障应去哪里排查。

建议增加：

### 方式 A：本地 Gateway

```env
KUNPO_GATEWAY_BASE_URL=http://127.0.0.1:9020/v1
```

前提：本地 Gateway 已启动并能访问。

### 方式 B：桌面端直连

```env
KUNPO_API_BASE_URL=https://your-kunpo-host/v1
KUNPO_API_KEY=your-local-key
```

并提示：

```text
真实 Key 只能存放在本地 .env 或受控服务端，不得提交仓库。
```

链接：

```text
docs/dev/PROVIDER-TROUBLESHOOTING.md
```

## 6.2 修复错字

将：

```text
导出按钮不可用 / 导出错错？
```

改为：

```text
导出按钮不可用 / 导出报错？
```

## 6.3 修正跨平台文件管理器文案

不要只写：

```text
在 Finder 中显示项目（仅 macOS）
```

推荐统一为：

```text
在系统文件管理器中显示项目
（macOS 为 Finder）
```

## 6.4 帮助入口失败时必须反馈

当前顶栏直接调用：

```ts
copilotApi.openUserGuide()
```

若文件缺失或系统无法打开，用户看不到错误。

建议改为：

```ts
const openGuide = async () => {
  try {
    const result = await copilotApi.openUserGuide();
    if (!result.ok) {
      setError('无法打开使用说明书，请直接打开 docs/user/quick-start-guide.html。');
    }
  } catch (cause) {
    setError(friendlyError(cause));
  }
};
```

然后帮助按钮调用 `openGuide`。

还应增加一个 UI Unit 或 Electron E2E，模拟 `{ok:false}` 并验证错误条可见。

## 6.5 补齐说明书 Tab 的 ARIA 关系

为每个 Tab 和 Tabpanel 增加双向关系：

```html
<button
  id="tab-start"
  role="tab"
  aria-controls="panel-start"
  aria-selected="true"
>

<section
  id="panel-start"
  role="tabpanel"
  aria-labelledby="tab-start"
>
```

六个 Tab 均应如此。

现有 ArrowLeft / ArrowRight / Home / End 和 roving tabindex 逻辑应保留。

## 6.6 更新 PR #25 描述

当前 PR 描述仍反映旧状态。

合并前更新为真实数据：

```text
Head: 30cfe5b...
3 commits
42 changed files
UI Unit: 40 passed
UI E2E: 29 passed
七项 CI全绿
新增 FINAL_APPROVAL_REQUIRED
新增 Dropdown 键盘与 ARIA整改
说明书迁移至 docs/user/
应用顶栏增加帮助入口
```

PR 描述是单人维护项目的重要审计证据，不能长期保留旧数字。

## 6.7 区分可验证安全证据

完成报告中应分别写：

```text
GitHub 可独立验证：secret-scan passed
本地执行证据：L3 审查零发现
```

若希望 L3 成为可归档证据，应保存：

```text
审查 Commit SHA
审查时间
审查范围
发现数量
未处理项
```

---

# 7. 推荐提交拆分

建议不要再形成一个超大混合提交。

## Commit A：Dropdown ARIA 语义收口

```text
fix(a11y): align Dropdown with select-only combobox semantics
```

范围：

```text
src/features/shared/ui.tsx
src/features/binding/BindingWorkbench.tsx
其他 Dropdown 调用点
src/features/shared/Dropdown.test.tsx
tests/ui-e2e/dropdown-keyboard.spec.ts
docs/dev/FRONTEND-DESIGN-GUIDE.md
```

## Commit B：说明书事实与练习素材收口

```text
fix(docs): close guided-mode and quick-start factual gaps
```

范围：

```text
docs/user/quick-start-guide.html
docs/user/examples/quick-start-wireframe.png
docs/user/examples/README.md
scripts/check-docs.cjs
README.md（如需索引示例）
```

## Commit C：帮助入口和 PR 审计收口

```text
fix(ux): report guide-open failures and finalize PR25 audit metadata
```

范围：

```text
src/App.tsx
相关测试
PR 描述更新
```

---

# 8. 必须运行的验证

合并前必须运行：

```bash
pnpm lint
pnpm test
pnpm test:fixture-e2e
pnpm test:ui-unit
pnpm test:ui-e2e
pnpm test:docs
pnpm build
```

若仓库脚本包含独立文档检查，也应分别运行：

```bash
node scripts/check-docs.cjs
node scripts/check-error-docs.cjs
node scripts/check-doc-commands.cjs
node scripts/check-project-tree.cjs
```

## 必须达到的结果

```text
□ TypeScript 通过
□ Node 测试全部通过
□ Fixture E2E 全部通过
□ UI Unit 全部通过
□ UI E2E 全部通过
□ docs-validate 全部通过
□ Build 通过
□ secret-scan 通过
□ macOS validate 通过
```

---

# 9. 复审检查清单

## Dropdown

```text
□ 使用 role=combobox，而不是普通 button 承载 aria-activedescendant
□ listbox / option 语义正确
□ 每个 Dropdown 有 Accessible Name
□ Binding 三个 Dropdown 的名字互不相同
□ 键盘、鼠标、typeahead 不回退
□ disabled 不进入 Tab 顺序
□ 空列表、长文本、禁用项继续正常
```

## guided 文档

```text
□ 明确 guided 仍是 underlay-only
□ 明确 guided 同样禁止共享 UI 和正式文字进入图片
□ 明确 guided 当前没有最终合成入口
□ 不再出现与真实 Prompt 相反的描述
```

## Quick Start

```text
□ 练习素材真实存在
□ Fresh Clone 可直接找到
□ 有示例设计意图
□ 安装与启动步骤真实
□ AI 连接方式可执行
□ 不存在界面中没有的操作
□ 版本标识不误导
```

## 导出

```text
□ Final PNG
□ Fidelity passed
□ Final Approval
□ Export
□ 前后端都能阻止未批准导出
```

## 文档体系

```text
□ README 有说明书入口
□ 应用有说明书入口
□ 帮助打开失败有错误反馈
□ docs 校验覆盖 HTML 命令和本地素材路径
□ 说明书 Tab 有 aria-controls / aria-labelledby
```

---

# 10. 最终 Definition of Done

只有以下全部完成，PR #25 才能从“有条件通过”改为“通过”：

```text
□ P0-01 Dropdown ARIA 角色模型修复
□ P0-02 guided 说明与真实代码一致
□ P0-03 新手练习素材真实存在
□ P1 帮助入口失败反馈完成
□ P1 说明书 Tab ARIA 关系完成
□ P1 AI 连接说明足以让新用户配置
□ PR 描述更新为当前真实状态
□ 七项 Required Checks 全绿
□ L3/安全审查无未处理 Critical 或 Major
□ PR 仍可干净合并到最新 main
```

---

# 11. 最终验收结论模板

执行者完成后，应提交以下格式的结果：

```text
PR：#25
最终 Head：
目标 Base：
提交列表：

一、Dropdown ARIA
- 使用模式：
- Accessible Name 覆盖：
- Unit Tests：
- Electron E2E：

二、说明书真实性
- guided 文案：
- 练习素材路径：
- Gateway / 直连说明：
- 帮助入口失败反馈：

三、自动化
- lint：
- node test：
- fixture-e2e：
- ui-unit：
- ui-e2e：
- docs-validate：
- build：
- secret-scan：
- macos-validate：

四、安全审查
- 审查 Commit：
- Critical：
- Major：
- Minor/Nit：
- 未处理项：

五、最终结论
- Ready to merge / Not ready
```

---

# 12. 审核结论

PR #25 的主体整改已经完成，现有业务主链路和鼠标/键盘操作没有出现明显回归，最新自动化结果也较强。

但当前仍有三个明确事实缺口：

1. Dropdown 键盘行为已经实现，但 ARIA 角色模型尚未真正标准化；
2. guided 说明仍有一句与真实 Prompt 相反；
3. Quick Start 引用了不存在的练习素材。

因此，本轮不要求推翻 Darkroom Precision，也不要求回退自绘 Dropdown。

正确动作是：

```text
修正 ARIA 模型
→ 修正 guided 文案
→ 加入真实练习素材
→ 补齐少量说明与错误反馈
→ 全量 CI
→ 再批准合并
```

完成本文件全部 P0 与合并门禁后，PR #25 可以正式通过。
