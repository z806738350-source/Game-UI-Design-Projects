审核结论已经整理完成。

当前 PR Head `85c29a1` 的正式 CI Run 已成功结束，七个 Job 全部通过。因此，在现有自动化覆盖的鼠标操作路径中，没有发现本次视觉整合破坏严格继承、Critique、Repair、Final Composition、Fidelity 或导出链路。

但**不建议按当前 Head 直接合并**，主要有两个原因：

1. 自绘 `Dropdown` 只实现了鼠标点击、外部点击关闭和 Escape，没有原生 `select` 的方向键、Enter/Space 选择、Home/End、焦点恢复、typeahead、`aria-disabled` 等行为。这是本 PR 新引入的真实键盘与无障碍回退。
2. `quick-start-guide.html` 覆盖面广，但包含多处与真实产品不一致的操作：启动脚本不会自动安装依赖、guided 路线没有完整最终生产入口、界面中没有说明书所写的 waiver 和逐条批准 Fidelity major、导出也并非必须先执行最终批准。

Game-UI-Design-Copilot-PR25-frontend-and-quick-start-audit.mdMD

# Game UI Design Copilot PR #25 前端整合与新用户说明书审核结论

## 一、审核信息

|项目|内容|
|---|---|
|审核对象|`z806738350-source/Game-UI-Design-Projects` PR #25|
|PR 标题|`feat(ui): Darkroom Precision 深色重制 + 自绘 Dropdown 替换全部原生 select`|
|基线|`main@02477d46e0517ebe73b3857fe13bce070cdc629b`（v0.2.2）|
|审核 Head|`85c29a149d4cee6d5fbe47e0bfaa77d2cdd43dbd`|
|当前状态|Open、Mergeable、尚未合并|
|审核范围|前端视觉统一、自绘 Dropdown、主链路回归、`quick-start-guide.html` 的真实性与新手可用性|
|审核结论|**有条件不通过，暂缓按当前 Head 合并**|

当前 PR 实际规模已经不是最初摘要中的“19 个文件、一次提交”，而是：

- 2 个提交；
    
- 29 个文件；
    
- 新增 1777 行；
    
- 删除 142 行。
    

后续 PR 描述和合并记录应以 GitHub 当前统计为准。

---

# 二、总体结论

本次前端视觉整合方向正确，主要优点包括：

- 状态色语义比之前清楚；
    
- `approved` 使用绿色；
    
- `generated` 使用紫色；
    
- 警示橙与琥珀金已经分离；
    
- strict 工作台从旧的浅色样式统一到 Darkroom Precision；
    
- 文案中文化程度提高；
    
- 下拉框视觉风格统一；
    
- UI 测试和 E2E 选择器已经随新组件调整。
    

当前 Head 对应的 GitHub Actions 已全部成功，说明以下路径在现有自动化覆盖下仍能运行：

```
创建项目
→ Wireframe
→ 功能契约
→ 参考图
→ 字体
→ 组件
→ Binding
→ 布局
→ Underlay
→ 污染审查
→ Repair
→ Final Composition
→ Fidelity
→ 导出
```

因此：

> **没有证据表明本次视觉调整破坏了鼠标用户的核心生产链路。**

但当前 PR 仍不能直接合并，因为：

1. 自绘 Dropdown 没有达到原生 `select` 的键盘和可访问性能力；
    
2. 新用户说明书存在会让用户实际卡住的错误指引；
    
3. 说明书尚未进入 README 索引和文档自动校验；
    
4. 说明书描述的部分产品能力在界面中并不存在；
    
5. guided 路线的真实产品状态与说明书严重不一致。
    

---

# 三、前端链路审核结果

## 3.1 已通过的部分

本 PR 没有修改：

- Artifact Schema；
    
- 后端设计管线；
    
- Component Renderer；
    
- Typography Renderer；
    
- Critique；
    
- Repair；
    
- Fidelity；
    
- Migration；
    
- Final PNG 文件格式。
    

主要变更集中于：

- `src/styles.css`；
    
- 前端工作台文案；
    
- 自绘 Dropdown；
    
- UI 测试；
    
- 用户说明书和设计规范。
    

当前 CI 证明现有鼠标主路径仍然工作，因此本次前端整合没有出现明显的业务链路破坏。

## 3.2 尚未通过的部分

原生 `select` 被全部替换为自绘 Dropdown 后，新的共享控件只支持：

- 鼠标打开；
    
- 鼠标点击选项；
    
- 点击外部关闭；
    
- Escape 关闭。
    

它尚不支持：

- ArrowUp / ArrowDown；
    
- Home / End；
    
- Enter / Space 选择；
    
- 输入字符搜索；
    
- Tab 离开时关闭；
    
- Escape 后恢复焦点；
    
- 活动项焦点；
    
- disabled option 的完整 ARIA；
    
- `aria-controls`；
    
- `aria-activedescendant`；
    
- 下拉菜单视口翻转。
    

这会影响：

- 项目切换；
    
- Screen 切换；
    
- 继承模式；
    
- Contract Role；
    
- Reference Role；
    
- Component Category；
    
- Component State；
    
- Reuse Mode；
    
- Binding Component；
    
- Binding State；
    
- Binding Font Role。
    

因此，自绘 Dropdown 当前只能视为“鼠标可用的视觉版本”，还不能视为原生 select 的完整替代。

---

# 四、P0：合并前必须完成的事项

## P0-01 完成 Dropdown 键盘、焦点和 ARIA

修改文件：

```
src/features/shared/ui.tsx
src/styles.css
src/features/shared/Dropdown.test.tsx
tests/ui-e2e/dropdown-keyboard.spec.ts
docs/dev/FRONTEND-DESIGN-GUIDE.md
```

共享 Dropdown 至少需要：

```
open
activeIndex
typedPrefix
buttonRef
optionRefs
menuId
```

键盘规则：

|   |   |
|---|---|
|按键|必须行为|
|ArrowDown|打开菜单，并定位当前值或第一个可用项|
|ArrowUp|打开菜单，并定位当前值或最后一个可用项|
|Enter / Space|打开或选择活动项|
|Home / End|跳到第一个或最后一个可用项|
|字母数字|按前缀搜索|
|Escape|关闭并恢复按钮焦点|
|Tab|关闭并正常离开|

ARIA 至少包括：

```
<button
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={menuId}
  aria-activedescendant={activeOptionId}
/>

<ul id={menuId} role="listbox">
  <li
    role="option"
    aria-selected={selected}
    aria-disabled={disabled || undefined}
  />
</ul>
```

所有使用点必须具有稳定的可访问名称，不能依赖不确定的外围 `<label>` 激活行为。

### 必测场景

- 上下方向键；
    
- 跳过禁用项；
    
- Enter 选择；
    
- Space 选择；
    
- Home / End；
    
- Escape 恢复焦点；
    
- Tab 关闭；
    
- typeahead；
    
- disabled option；
    
- 空列表；
    
- 当前 value 不存在；
    
- 长文本；
    
- 视口底部菜单。
    

---

## P0-02 修正首次安装与启动说明

当前说明书声称：

> 双击 `.command` 会自动安装依赖并启动。

真实实现不是这样。

`.command` 只负责找到 Node 并调用启动脚本；启动脚本发现依赖缺失时会直接要求用户运行 `pnpm install`。

应改为：

```
macOS 首次运行
1. 安装 Node.js 22 LTS；
2. 安装 pnpm 11；
3. 在项目根目录运行 pnpm install；
4. 之后双击 Start Game UI Design Copilot.command，
   或运行 pnpm quick-start。

Windows / Linux
1. pnpm install；
2. pnpm quick-start。
```

同时加入：

```
pnpm quick-start:check
```

用于检查依赖和 5174 端口。

---

## P0-03 处理 existing-guided 的产品与文档冲突

当前 guided 模式仍使用 `underlay-only` Visual Task，并禁止模型生成共享组件和正式文字。

但 Font、Component、Binding 和 Strict Production 面板仅在 strict/locked 模式显示。

这意味着 guided 当前可能生成：

```
只有背景和页面专属装饰的底层图
```

却没有完整的最终组件和文字合成入口。

说明书不能继续把 guided 描述成可完成正式交付的“宽松版严格继承”。

本 PR 推荐采用最小修复：

- UI 中标记“引导继承（实验性）”；
    
- 说明书明确它不保证形成完整可交付页面；
    
- 正式生产推荐 strict；
    
- guided 完整产品化另立任务。
    

---

## P0-04 删除当前界面中不存在的操作说明

### Underlay waiver

说明书写：

> 填写至少 10 字符理由进行 waiver 放行。

当前 Strict Production 面板只有：

- 自动污染审查；
    
- 修复并复审；
    
- 合成预览；
    
- 最终 PNG；
    
- 保真校验；
    
- 导出；
    
- 最终批准。
    

没有 waiver 输入或提交入口。

在功能实现前，说明书必须删除该操作。

### Fidelity major 逐条批准

当前 Fidelity Workbench 是只读证据展示，没有 major issue 的逐项批准按钮或理由输入。

在功能实现前，说明书不能声称 major 可以逐条批准。

---

# 五、P1：建议本 PR 一并完成的事项

## P1-01 统一最终批准与导出顺序

说明书描述：

```
保真校验
→ 最终批准
→ 导出
```

当前界面和后端实际允许：

```
保真校验
→ 导出
→ 最终批准
```

严格导出后端会检查 Fidelity 与输出文件，但不检查 Composition Manifest 是否已经批准。

推荐统一为：

```
Final PNG
→ Fidelity passed
→ Final Approval
→ Export
```

建议：

- 导出按钮要求最终批准；
    
- 后端增加 `FINAL_APPROVAL_REQUIRED`；
    
- 未批准导出时明确阻断；
    
- E2E 覆盖批准前失败、批准后成功。
    

若产品希望允许预导出，应将其命名为“导出评审稿”，与正式交付导出区分。

---

## P1-02 补齐 Reference Inventory 流程

实际严格风格流程需要：

1. 导入参考图；
    
2. 设置每张图的角色；
    
3. 填写页面类型、包含内容和基线；
    
4. 逐张批准；
    
5. 点击“批准参考图清单”；
    
6. Provider 容量超限时检查 omitted；
    
7. 确认后再解析风格。
    

当前说明书遗漏了“批准参考图清单”，也没有解释角色的用途。实际工作台明确包含这些操作。

还应改正：

> “确认省略项并继续”不是有参考图未处理，而是 Provider 容量不足，部分图片不会进入当前模型调用。

---

## P1-03 修正字体授权和 exact 说明

必须删除：

```
license（可再分发）
```

应改为：

> 确认你有权在本项目中使用字体；是否允许再分发取决于许可证，本工具不替你判断。

当前 UI 要求用户勾选项目使用权和 exact，并通过确认操作建立角色。

还要修正：

- exact 不应只写 display/body；
    
- 同一字体绑定多个角色不需要反复重新导入；
    
- 字体文件变化时才需要重新导入；
    
- Font Manifest 角色变更必须通过确认动作。
    

---

## P1-04 补齐 Component Kit 字段说明

说明书至少还需要解释：

- Source BBox；
    
- exact 等比缩放；
    
- min/max scale；
    
- nine-slice 边距顺序；
    
- nine-slice 中心区域合法性；
    
- vector-token 必须是 SVG；
    
- reference-locked；
    
- locked properties；
    
- `text-slot` / `baked` / `none`；
    
- Icon 和无文字导航应选择 `none`。
    

建议加入常用模板：

|   |   |
|---|---|
|组件|推荐配置|
|图标|icon + exact + none|
|主按钮|button + default/pressed/disabled + text-slot|
|导航|navigation + default/selected/disabled|
|页签|tab + default/selected/disabled|
|九宫格面板|nine-slice + 合法边距|
|矢量图标|vector-token + SVG|

还应明确：

> 严格模式当前不会自动生成新的共享 Icon；新 Icon 需要先获得透明 PNG/SVG，再导入 Component Contract。

---

## P1-05 区分应用内编辑和直接改文件

说明书应明确：

### 允许

通过应用里的 Contract、Style、Binding 等工作台编辑，保存时生成新版本。

### 禁止

在 Finder、编辑器或脚本中直接修改：

- Composition Output；
    
- Critique 原始响应；
    
- Fidelity Report；
    
- Final PNG；
    
- 其他管线证据。
    

说明书中的“随时可以回退”也应改为：

> 可以回看历史；当前没有一键恢复历史版本。需要恢复时重新生成，或在重大操作前通过复制项目或工作区外备份保留快照。

---

## P1-06 将 Quick Start 正式纳入文档体系

当前 README 文档索引只列出执行级 Markdown 和 Frontend Design Guide，没有 Quick Start HTML。

必须增加：

- README 的“新用户快速说明”入口；
    
- 应用顶栏或欢迎页帮助入口；
    
- `docs/user/QUICK-START-GUIDE.md`；
    
- Markdown 到 HTML 的生成脚本；
    
- `docs-validate` 校验；
    
- 版本号自动注入；
    
- 命令、锚点、关键文案和代码映射检查。
    

---

## P1-07 修正说明书版本

说明书标记为 v0.2.2，但它描述的 Dropdown 和新文案并不在不可变的 v0.2.2 Tag 中。

应选择：

- 本 PR 发布为 v0.2.3；或
    
- 暂时去掉固定版本，正式发布时自动注入。
    

不能让 v0.2.2 文档描述 v0.2.2 Tag 中不存在的界面。

---

# 六、说明书的内容质量评估

## 优点

- 结构清楚；
    
- 两条路线分开；
    
- 有流程总览；
    
- 有阶段说明；
    
- 有状态表；
    
- 有 FAQ；
    
- strict 链路覆盖较广；
    
- 卡片、表格和字号总体可读。
    

## 主要问题

- Quick Start、路线、阶段三处重复解释相同内容；
    
- 英文术语密度偏高；
    
- 没有截图；
    
- 没有新手练习素材；
    
- 没有明确桌面端/Web 适用范围；
    
- 使用 Finder 作为通用词；
    
- 一些断言过于绝对；
    
- 固定写“Fidelity 13 项”容易过时；
    
- HTML 自己没有完整 Tabs 键盘模型。
    

推荐第一次出现时写：

```
底层图（Underlay）
污染审查（Critique）
保真校验（Fidelity）
精确复用（exact）
九宫格伸缩（nine-slice）
```

后续只使用中文。

---

# 七、说明书视觉一致性问题

说明书自己的 CSS 仍使用与应用不同的状态色：

- warning 为 `#d9a521`；
    
- ok 为 `#3fae7a`；
    
- danger 为 `#d0563f`；
    
- accent-hi 为 `#f0c069`。
    

而新的前端设计规范规定：

- warning `#de7433`；
    
- ok `#5cab82`；
    
- danger `#d95f66`；
    
- accent-hi `#f0b84e`。
    

说明书的警告色重新接近琥珀金，反而违背本 PR 的配色目标。前端设计规范已经把这些颜色定义为唯一事实源。

说明书页签还使用 Emoji；若该 HTML 被视为产品的一部分，应改成文字或 Lucide SVG。

---

# 八、建议的新说明书结构

```
0. 适用版本与平台
1. 你应该选择哪条路线
2. 首次安装与连接检查
3. 10 分钟练习项目
4. 新项目探索路线
5. 已有项目严格继承路线
6. 引导继承当前限制
7. Reference Inventory / Pack
8. 字体
9. 组件与常用模板
10. 控件绑定
11. 布局与底层规范
12. 污染审查与修复
13. 合成、保真、批准与导出
14. 多页面管理
15. 状态、Stale 与历史
16. 常见错误与恢复
17. 能力边界
18. 术语表
```

Quick Start 只保留最短路径，完整技术字段放在后续章节，避免三次重复同一流程。

---

# 九、合并门禁

PR #25 合并前必须满足：

## 代码

- Dropdown 键盘操作完整；
    
- 焦点和 ARIA 完整；
    
- 禁用项不可被键盘选中；
    
- 菜单底部/滚动容器不被裁切；
    
- guided 产品状态有明确决策；
    
- Final Approval 与 Export 语义统一。
    

## 说明书

- 首次启动说明真实；
    
- Reference Inventory 步骤完整；
    
- 删除不存在的 waiver；
    
- 删除不存在的 Fidelity major 审批；
    
- 字体授权表述准确；
    
- 组件字段足够指导用户；
    
- 编辑/只读/历史边界准确；
    
- 版本与发布一致；
    
- README 和应用有入口；
    
- 纳入 docs-validate。
    

## 自动化

- 七项 Required Checks 全绿；
    
- 新增 Dropdown 键盘 Unit Tests；
    
- 新增 Dropdown 键盘 Electron E2E；
    
- 新增 Quick Guide 文档检查；
    
- UI E2E 全量回归；
    
- L3 安全审查无未处理项。
    

---

# 十、最终审核判定

```
前端视觉方向：通过
现有鼠标主链路：通过
自绘 Dropdown 完整性：不通过
新用户说明书真实性：不通过
说明书新手独立使用能力：暂不通过
PR 当前合并建议：暂缓
```

本次不需要推翻 Darkroom Precision，也不建议简单恢复原生 select。

正确的收口方式是：

1. 把共享 Dropdown 补成真正可用的基础控件；
    
2. 把说明书中不存在、错误或过度承诺的内容全部订正；
    
3. 将说明书纳入正式文档事实源和自动校验；
    
4. 重新运行七项 Required Checks；
    
5. 再执行合并验收。
    

修复后，这次前端重制可以成为一次质量较高的产品体验升级；按当前状态直接合并，则可能出现“鼠标用户流程正常，但键盘用户无法使用，新用户按说明书找不到操作”的问题。