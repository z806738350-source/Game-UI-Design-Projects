# 前端设计规范（Darkroom Precision）

本规范是 Game UI Design Copilot 全部前端界面的**唯一设计事实来源**。任何新增或修改 UI 的工作必须先读本文件，再读 `src/styles.css`。目标是防止执行者自由发挥导致风格漂移。

规范基线：「Darkroom Precision」令牌全量落地——深墨四级面板、发丝线、琥珀金强调、深色滚动条、`color-scheme: dark`；覆盖五阶段工作台、契约专注检查全屏工作台、布局画布与安全区、风格规范板、视觉探索卡、Artifact 检查器、全部弹窗与崩溃保护屏。

## 1. 技术约束（不可变更）

- **单一样式源**：全部样式集中在 `src/styles.css` 单文件（千行量级，令牌在 `:root`）。禁止 CSS Modules、CSS-in-JS、Tailwind、SCSS/Less 及任何 UI 组件库。
- **固定深色主题**：`:root` 声明 `color-scheme: dark`，不做亮色切换；`body` 最小宽度 1180px、最小高度 760px。
- **图标唯一来源**：`lucide-react`，禁止引入其他图标库或自制 PNG 图标。
- **响应式断点**：shell 布局断点是 **1320px / 1240px**（`--rail-w` 274→244、右侧辅助列 316→280 发生在 1320px 档）；另有 **1120px / 960px** 两条属组件内部窄屏降级（1120px 改 `.input-grid--reworked` / `.focus-body` 等主区网格，960px 只改 `.intent-*` 强制单列）。桌面端 `BrowserWindow` 的 `minWidth: 1180`（`electron/main.cjs`）与 `body` 的 `min-width: 1180px` 同源，因此 **1120px / 960px 两档在桌面端永不触发**，只在 Web 端 viewport < 1180px 时生效，而那时布局已被 `min-width` 裁切——它们是减轻损坏的降级路径，**不是可用适配档位**。禁止新增任意断点；新增窄屏适配前必须先确认目标档位在桌面端真的可达，人工验收也不得把不可达档位列为验收项。
- **助手展开布局**：根据截图问答需求，助手展开时左栏为 210px、右栏为 `clamp(420px, 30vw, 520px)`；1240px 及以下左栏 190px、右栏 380px。主区输入卡片按可用宽度自动换列；960px 以下助手使用固定侧面板降级。关闭助手仍沿用原有轨道与产物检查器尺寸。输入区为全宽文字框、截图预览与独立底部操作行。
- **类名约定**：BEM 风格——区块 `block`、变体 `block--modifier`、状态 `.is-state`（如 `.button--primary`、`.status-pill--approved`、`.is-active`）。删除组件时必须同步删除其死选择器。

## 2. 设计令牌全表（`:root`）

### 2.1 背景层级（深墨六级）

| 令牌 | 值 | 用途 |
|---|---|---|
| `--bg-0` | `#0a0b0e` | 应用画布底（带 44px 网格纹理） |
| `--bg-1` | `#0e0f13` | 阶段轨道侧栏底 |
| `--panel` | `#131419` | 一级面板（卡片、工作台） |
| `--panel-2` | `#191b21` | 二级面板（输入区、胶囊底、按钮底） |
| `--panel-3` | `#20232b` | 三级面板（hover 态、最上层控件） |
| `--panel-soft` | `#171920` | 过渡面板 |

输入框/代码块底色固定 `#0b0c10`（比 `--bg-0` 更深的"井"）。

### 2.2 描边与文字

| 令牌 | 值 | 用途 |
|---|---|---|
| `--line` | `rgba(236,238,244,.07)` | 发丝线：面板间分隔、卡片默认描边 |
| `--line-strong` | `rgba(236,238,244,.14)` | 强发丝线：控件描边、输入框 |
| `--ink` | `#eceef2` | 主文本（标题、正文、关键数值） |
| `--muted` | `#9b9da8` | 次要文本（说明、辅助标签） |
| `--faint` | `#7a7d89` | 最弱文本（placeholder、禁用、空态） |

### 2.3 强调色（琥珀金）

| 令牌 | 值 | 用途 |
|---|---|---|
| `--accent` | `#e3a63d` | 琥珀金主色（hsl≈36°） |
| `--accent-hi` | `#f0b84e` | 高光金（渐变起点、hover 文字） |
| `--accent-ink` | `#1c1305` | 金底上的文字色 |
| `--accent-soft` | `rgba(227,166,61,.12)` | 淡金底（次按钮、选中底） |

### 2.4 语义色

| 令牌 | 值 | 语义 | 典型载体 |
|---|---|---|---|
| `--violet` | `#8f86e8` | **AI / 生成中** | `.ai-reading-note`、`status-pill--in_progress`、`status-pill--generated`、`design-brief-card.has-ai-draft` |
| `--ok` | `#5cab82` | **通过 / 已批准** | `status-pill--approved`、`is-approved` 条目左边条与描边、`is-ready`、在线连接点 |
| `--warning` | `#de7433` | **待确认 / 需更新** | `status-pill--reviewed`、`status-pill--stale`、`is-reviewed`/`is-stale` 阶段节点、`capacity-warning`、底部严格继承提示条 |
| `--danger` | `#d95f66` | **失败 / 否决 / 危险操作** | `status-pill--failed`、`status-pill--rejected`、`is-failed`、`error-banner`、`button--danger` |

助手运行状态的语义色绑定（与 §7 中文映射同一套状态）：`running` / thinking 用 `--violet`（AI / 生成中，先例 `.ai-reading-note`、`status-pill--in_progress`）；`awaiting_confirmation` 与 `stale` 用 `--warning`（先例 `status-pill--reviewed`、`status-pill--stale`）；`succeeded` 用 `--ok`；`failed` 与 `interrupted` 用 `--danger`。**「正在思考」必须是紫，不是灰也不是金**——`--violet` 的定义就是 AI / 生成中，用灰会让用户分不清「模型在工作」和「界面卡住」，用金则违反 §3（金不表达语义状态）。`cancelled` 与 `queued` 是中性状态，五个功能色都不适用，用 `--muted` + `--panel-2`（§6.4 中性说明先例）；不要为了「看起来有状态」而借语义色（禁区 6）。

语义色派生透明度约定：描边 `.4~.45`、背景 `.1~.14`。`--warning` 的 rgba 一律写 `rgba(222,116,51, …)`，与令牌同源。

语义提示条内的高亮文字使用同族浅色（不得跨族借色）：橙条内 `#f0b08c`（hsl≈22°，同 `--warning`）、红条内 `#f0b6ba`（同 `--danger`）；实心语义按钮上的文字用 `#fff`；输入井/代码块底色固定 `#0b0c10`。除上述五个功能色外，组件样式不得出现 `:root` 之外的硬编码颜色。

### 2.5 排版令牌

- 字体族：`--sans`（Inter/PingFang SC，正文）、`--disp`（Space Grotesk，标题 h1/h2/h3）、`--mono`（JetBrains Mono，编号/标签/hash/英文 kicker）。禁止直接写字体名。
- 字号阶梯（禁止中间值）：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--type-caption` | 11px | 表单字段标签、最小说明 |
| `--type-small` | 12px | 辅助说明、按钮文字、下拉项 |
| `--type-body` | 13px | 正文 |
| `--type-body-strong` | 15px | 卡片标题 |
| `--type-subtitle` | 17px | 区块副标题 |
| `--type-title` | 22px | 工作台页面标题 |
| `--type-display` | 30px | 欢迎屏/大屏展示 |

## 3. 琥珀金使用红线（最高优先级）

琥珀金**只允许**出现在以下四类位置：

1. **主按钮**：`.button--primary` 实心金渐变（每屏至多一个主操作）。
2. **激活态**：当前阶段 `.is-active` 条目左边条、当前选中导航。
3. **选中描边 / 选中底**：被选中的卡片、列表行、下拉选项（`.is-selected`）。
4. **kicker 强调**：`.kicker` 英文大写 mono 小标签、区块 eyebrow 编号（如 `03 · STYLE RESOLUTION`）。

延伸豁免：`.button--secondary`（金文字 + 金描边 + `--accent-soft` 底）是唯一的次强调按钮；聚焦环 `rgba(227,166,61,.55)`、滚动条 hover、`::selection` 属系统反馈，不算违规。

**禁止**：金色正文段落、金色大面积铺底、用金色表达成功/警告/失败等任何语义状态。

## 4. 琥珀金 ≠ 警示橙（关键配色决策）

`--warning` 曾用 `#cf8a2e`（hsl≈35°），与 `--accent` 金（hsl≈36°）色相几乎相同，同屏无法区分"强调"与"待确认"。现已固定为 `#de7433`（hsl≈22°，偏朱橙）。

- 金色 = "这里可以点击 / 当前选中"（交互强调）
- 橙色 = "这里有事待你处理"（语义状态）
- 二者**不得在同一组件上混用**；修改 `--warning` 必须同步全量替换 `rgba(222,116,51,` 派生值。

## 5. 按钮体系（四级 + 图标按钮）

| 类名 | 外观 | 使用场景 |
|---|---|---|
| `.button--primary` | 实心金渐变 + `--accent-ink` 文字 | 页面当前阶段的唯一主推进操作（批准、生成） |
| `.button--secondary` | 金字 + 金描边 + 淡金底 | 次强调操作（批量添加、编辑规范、重新解析） |
| `.button--ghost` | 灰字透明底，hover 显底 | 常规次要操作（关闭、取消、复审） |
| `.button--danger` | 实心红 | 不可逆/破坏性操作 |
| `.icon-button` | 34×34 方块灰图标 | 工具栏纯图标操作 |

规则：基础 `.button` 最小高 40px、圆角 8px、字号 `--type-small`、字重 600；禁用态统一 `opacity:.45; cursor:not-allowed !important`；同屏不得出现两个 `button--primary`。

**常驻辅助列内不使用 `.button--primary`**（`.artifact-inspector` 及任何复用该右列的面板）：primary 的语义是「页面当前阶段的唯一主推进操作」，辅助列不在页面主推进轴上，而主工作区通常已经有 primary，再加一个即触发禁区 10。辅助列内的确认类操作按**服务端动作描述符**给出的风险二选一；模型回复与 Renderer 都无权声明或降低风险。最小风险字段为 `writes_project`、`replaces_content`、`reversible`、`external_cost`：

| 服务端动作风险 | 确认按钮 | 取消按钮 |
|---|---|---|
| `replaces_content: false` 且 `reversible: true` | `.button--secondary` | `.button--ghost` |
| `replaces_content: true` 或 `reversible: false` | `.button--danger` | `.button--ghost` |

这个二分支与状态布局共同让 §4 的金橙互斥**由构造成立**：待确认动作卡本身保持中性，橙色「待确认」只出现在对话列表项；因此可逆动作卡可以使用 secondary，覆盖或不可逆动作卡使用 danger。`external_cost` 只控制中性费用说明，不改变按钮等级。辅助列内的其他操作（新建、重新生成、切换）用 `.button--secondary` 或 `.button--ghost`。

## 6. 控件规范

### 6.1 下拉（Dropdown）

一律使用 `src/features/shared/ui.tsx` 的自绘 `Dropdown` 组件，**禁止原生 `<select>`**。

- 触发元素：`role="combobox"` 的可聚焦容器（非原生 button），36px 高（`field-card` 内 48px），深底 `#0b0c10` + `--line-strong` 描边；右侧 ChevronDown 13px，`aria-expanded=true` 时旋转 180°。
- 菜单：`.dropdown-menu`，`max-height:264px` 滚动，`max-width:min(420px, 100vw-48px)` 防溢出；贴近视口底部时自动向上翻转（`.is-up`）；选项超长时 ellipsis 截断并挂 `title` 全文。
- 选中项：`.is-selected` 金字 + 淡金底 + 左侧勾选（属"选中"红线合法用法）。
- 禁用项：`.is-disabled` 灰字禁点，配合不可选原因文案；键盘导航自动跳过。

键盘与无障碍契约（对齐原生 `<select>`，回归由 `src/features/shared/Dropdown.test.tsx` 与 `tests/ui-e2e/dropdown-keyboard.spec.ts` 守护）：

| 按键 | 行为 |
|---|---|
| ArrowDown / ArrowUp | 打开菜单并定位当前值（无值时定位第一个/最后一个可用项）；已打开时移动活动项 |
| Enter / Space | 关闭时打开菜单；打开时选择活动项并关闭 |
| Home / End | 跳到第一个/最后一个可用项 |
| 字母数字 | 600ms 内连续输入按前缀定位可用项（typeahead），菜单关闭时打开并定位匹配项 |
| Escape | 关闭菜单并恢复按钮焦点 |
| Tab | 关闭菜单并正常离开（不拦截焦点顺序） |

ARIA（WAI-ARIA select-only combobox + listbox 模型）：触发元素是 `role="combobox"` 的可聚焦容器，携带 `aria-haspopup="listbox"` + `aria-expanded` + `aria-controls` + `aria-activedescendant`（活动项只用它表达，不移动真实焦点）；菜单 `role="listbox"`，选项 `role="option"` + `aria-selected` + `aria-disabled`；组件禁用使用 `tabIndex=-1` + `aria-disabled` + 事件直接返回（移出 Tab 顺序）；空列表打开时展示「无可选项」而非拒绝打开。Accessible Name 必须显式提供：`ariaLabelledBy`（优先，可多个 id 拼接，如 Binding 行的「字段名 + 控件图例」）或 `ariaLabel`；占位文本不构成名称，开发态两者都缺失时组件输出一次警告。一行多控件（如绑定行的组件/状态/字体角色）不得共用一个外围 `<label>` 命名，必须用 fieldset/legend 分组 + 独立 labelledby。

### 6.2 输入框 / 文本域

深底 `#0b0c10`、`--line-strong` 描边、圆角 7-8px；聚焦时金描边 + `0 0 0 3px rgba(227,166,61,.1)` 光晕；placeholder 用 `--faint`。字段标签 11px 大写字重 700（`--type-caption` + `--muted`）。复选框 15×15、`accent-color: var(--accent)`。

### 6.3 状态胶囊

`.status-pill` + 语义变体（`--approved`/`--generated`/`--reviewed`/`--in_progress`/`--stale`/`--failed`/`--rejected`），前置 6px 同色圆点 `<i>`。文案必须走中文状态映射（见 §7），不得直接渲染英文状态码。

### 6.4 条目左边条与提示条

- 列表/卡片条目的状态用 2-3px 左边条或描边表达（`is-approved` 绿、`is-failed` 红等），与状态胶囊同源。
- 提示条语义：AI 相关用紫（`.ai-reading-note`）、容量/待确认用橙（`.capacity-warning`）、错误用红（`.error-banner`）、中性说明用 `--muted` + `--panel-2`（`.settings-note`），不得随意配色。
- **成本/费用类提示是事实说明，不是状态**：用中性 `--muted` + `--panel-2`（`.settings-note` 先例），不得占用 `--warning`。§2.4 没有「成本」语义色，`--warning` 只表达「待确认 / 需更新 / 容量」；把费用染橙会让「有待办」与「会花钱」两种完全不同的信号在同一屏上无法区分。
- **列表条目的「待处理」状态用 2-3px 左边条 + 中文副标表达**（如 `.is-pending`）。待确认动作卡本身使用中性描边与中性状态文字，不放橙色左边条或橙色状态胶囊；执行开始后才按紫/绿/红呈现运行结果。状态归列表条目，动作归动作区，二者分属不同组件，避免橙色与 secondary 金按钮落在同一张卡上。**凡卡片带橙色左边条（如终态 `stale 需更新`），卡上的按钮一律 `.button--ghost`**——不得用 `.button--secondary`（金）或 `.button--danger`（红），否则 §4 的金橙互斥在终态卡上又被打穿；橙色左边条已经表达了「需要你重新处理」，按钮只承担「重新生成 / 知道了」这类中性动作。
- 顶部通知层几何（`.overlay-bar`，承载 `.busy-bar` / `.error-banner` / 图库撤销提示）：工作流态只覆盖右侧工作区，左边界取 `--rail-w`（DESIGN FLOW 轨道宽度的唯一事实来源，定义在 `.app-shell`，1320px 断点改为 244px），禁止满幅遮挡轨道；仅图库态 `.app-shell.is-gallery` 恢复满幅，且必须同时把垂直起点让到图库标题行下缘（`top: 115px`）——通知层子元素是 `pointer-events: auto`，压住标题行会吞掉「返回工作流」的点击，用户只剩 Escape 可退出。回归测试：`tests/ui-e2e/gallery.spec.ts`「通知层几何」。
- 反馈按上下文隔离：提示条是遮挡层，禁止跨上下文显示。工作流 `.busy-bar` 与 workflow 作用域错误不在图库态渲染（图库标题行用不遮挡的 `.gallery-busy-chip` 解释视觉探索逐张落盘）；图库撤销提示与 gallery 作用域错误不在工作流态渲染；顶栏等两界共用入口的错误为 global，两界都显示。作用域定义见 `src/App.tsx` 的 `FeedbackScope`。两条配套约束：错误条的「重试」入口只跟随 workflow 作用域错误出现，禁止挂在图库或 global 错误上（否则会在图库内静默重跑工作流任务——忙碌条被抑制、状态片只对视觉探索出现，全程零反馈，还会改动 `inert` 覆盖层后面的阶段）；撤销提示的渲染按图库开关门控，因为图库实例常驻、隐藏/恢复/下载的回调在 await 之后无条件触发，在飞请求不得把提示泄漏到工作流。错误状态跨视图是**隐藏而非丢弃**，返回原视图仍可见；关闭图库只清即时回执（撤销提示），不清错误。

### 6.5 弹窗与空态

- 弹窗：`.dialog-backdrop` 遮罩 + `.create-dialog` / `.utility-dialog`；图片预览用 `.lightbox` / `.wireframe-lightbox`。
- **新建的二次确认一律复用共享原生 `<dialog>` + `.dialog-backdrop` / `.utility-dialog` 视觉样式**，不得为确认新建 z-index 层，也不要用「面板内内联弱确认」代替。共享 Modal 通过 Portal 挂到 `document.body` 并调用 `showModal()`，由浏览器 top layer 处理背景 inert 与焦点限制；组件必须监听原生 `cancel`，执行 `preventDefault()` 后调用受控的 `onClose()`，使 React 状态与 DOM `open` 同步。调用 `showModal()` 的 effect 必须以 `dialog.open` 防重，并在清理时关闭仍打开的 dialog，避免 `React.StrictMode` 双 effect 抛错。应用仍负责可访问标题、backdrop 点击、显式关闭和焦点归还；任何面板不得复制手写焦点锁。模态 backdrop 捕获点击是它的职责，与 §6.4 顶部通知层「非模态却吞掉背后点击」的陷阱不是一回事。若确认的触发器位于随图库 `inert` 的子树内，图库态下它天然不可达，不需要再写一套互斥逻辑。
- **遮罩归属：`.dialog-backdrop` 类挂在 `<dialog>` 元素本身**，不靠 `::backdrop` 画遮罩。DOM 结构维持既有的「外层遮罩 + 内层 `.utility-dialog` / `.create-dialog`」两层，只把外层标签由 `div` 换成 `dialog`。`src/styles.css:668` 的既有 `.dialog-backdrop` 规则保留，但原生 dialog 的 UA `max-width`、`max-height`、`margin` 与 `border` 会让元素只包住内容，**不能单靠 `inset: 0` 宣称覆盖视口**；必须补 `dialog.dialog-backdrop { width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; border: 0; }`，并写 `dialog.dialog-backdrop::backdrop { background: transparent; }` 中和 UA 默认 backdrop。`z-index: 100` 在 top layer 中变为惰性但保留无害。反过来「dialog 自身透明、由 `::backdrop` 承载底色与模糊」不可用——会丢掉 `.dialog-backdrop` 上的 `backdrop-filter: blur(8px)` 观感，并让遮罩点击无法再用 `event.target === event.currentTarget` 判定。
- **既有弹窗的迁移边界**：`App.tsx` 当前局部 `Modal` 的实际调用者只有 SettingsDialog 与 ProjectManager；首批共享化只迁移这两处，并供新建的助手删除确认复用。`NewProjectDialog` 是另一套 `div.dialog-backdrop`，首次建项目时还会刻意不传 `onClose`，不在本次范围。图库逐张下载豁免（§6.7）与使用指南弹窗同样保留手写实现，各自在所属功能的改造中处理。原生事件顺序经 Chromium 验证是 `window keydown(Escape) → dialog cancel → dialog close`，不是「dialog 自行吃掉 Escape」；迁移图库的风险在于既有窗口级 Escape 链会先收到按键，而 `cancel` 又会改变关闭路径，必须先补豁免分支的 Escape 与焦点断言并明确去重。现有测试只锁住下拉分支（`GalleryWorkspace.test.tsx:116-123`）与灯箱分支（`:230-243`、`tests/ui-e2e/gallery.spec.ts:91-101`），豁免分支没有这些断言。因此本条适用范围就是「新建的二次确认」；既有三处手写弹窗的迁移有明确归属，不构成本条偏差，也不得反向给新建对话框开手写焦点锁的口子。
- 空态：`.empty-artifact`——虚线描边 + `--faint` 图标文字 + 一句可执行的下一步指引。
- 崩溃保护屏：`.fatal-screen` 网格底 + 面板 + 金色重试按钮。

### 6.6 滚动条与选区

全局细窄暗色滚动条（10px、透明轨道、16% 灰滑块），hover 时 42% 金；文本选区 30% 金底。

### 6.7 图库工作区（`.gallery-*`）

- 入口：顶栏 `data-testid="gallery-entry"` 图标按钮；打开时 `is-active` +
  `aria-current="page"`，再次点击是 no-op（不含糊 Toggle）；「返回工作流」
  按钮显式关闭并把焦点还给入口。
- 视图模型：全屏不透明 overlay（z-60，灯箱 z-70，全局反馈层 z-90）；打开时
  对工作流节点设 `inert`，工作流子树**不卸载、不 `display:none`**，草稿与
  滚动位置天然保留；组件实例由 App 常驻，关闭只卸载 overlay 子树以保留
  筛选与滚动。
- 网格：四列资产卡片（超宽至多五列），图片完整不裁切；按日期分组
  （今天/昨天/日期）；分页首屏 40，「加载更多」追加不重置滚动。
- 筛选：范围页签（全部图片/已移除）为按钮组 `role="group"`；项目、Screen、
  方向、时间、排序一律用 §6.1 的共享自绘 `Dropdown`（`data-testid=
  "gallery-filter-*"` 挂在组件根元素），**禁止原生 `<select>`**——其展开
  列表是系统菜单，无法套用设计令牌。药丸容器 `.filter-field`（32px）内的
  下拉去掉自身边框、内边距与焦点环，聚焦态由 `.filter-field:focus-within`
  统一给出琥珀金描边（沿用 `.project-switcher` 内嵌下拉的先例）；可见标题
  用 `<span>`，Accessible Name 由 `ariaLabel` 提供且包含标题文字（满足
  label-in-name）。空值以「全部项目 / 全部 Screen / 全部方向 / 全部时间」
  真实选项保留，用户可从下拉直接选回全部；无可选 Screen 时该下拉禁用。
  Escape 在展开的下拉里只收起列表，不得连带关闭灯箱或整个图库工作区
  （工作区级监听尊重已被消费的按键）。琥珀金只用于选中态与焦点环，
  不作为成功或警告色。
- 灯箱：键盘（←/→ 切换、Esc 关闭）在 window 级监听；关闭后焦点回到打开
  它的卡片；缩放 100%–400%，尊重 `prefers-reduced-motion`。
- 隐藏语义：移除只写 `hidden_at`，文案必须写明「不删除云端文件」；5 秒
  撤销提示渲染在全局反馈层（返回工作流后仍可见）；已移除范围提供恢复。
- 下载门禁：严格/锁定路线资产显示「受控交付」受控态（`aria-disabled`），
  点击说明原因，绝不伪装成功；可下载路线显示「下载原图」。
- 门禁解释按登记来源（`mode_provenance`）区分：真实严格/锁定路线说明
  「需回工作流完成正式交付」；历史快照回填（`fail-closed`）说明「快照缺
  路线证据，按受控交付处理」。历史快照的 Screen 上下文由 `variation_id`
  的 Screen id 前缀反查注册表恢复，恢复不了才显示「未知 Screen」。
- 逐张下载豁免：仅 `fail-closed` 历史资产点击「受控交付」时打开豁免对话框
  （`.dialog-backdrop` + `.utility-dialog`，z-100 覆盖灯箱）：说明快照门禁
  语义、理由 textarea（trim 后至少 10 字符，不足时确认按钮禁用）、
  「确认按当前项目路线下载」主按钮；Escape 优先关闭对话框（其次灯箱、
  最后 overlay），关闭后焦点还给打开它的受控按钮。豁免留痕（时间+理由）
  就地写回卡片，该资产翻转为「下载原图」，不重置分页与滚动。严格/锁定
  路线**不提供**豁免口子，点击仍只解释原因。该对话框当前是手写
  `div.dialog-backdrop`（已带 `role="dialog"` / `aria-modal="true"`），
  **尚未**迁移到 §6.5 的共享原生 `<dialog>`。本条描述的 Escape 优先级由
  `GalleryWorkspace.tsx:163` 的窗口级链实现，而该豁免分支目前**没有**
  Escape 与焦点归还断言（现有用例只覆盖打开、填理由、放行与留痕），因此
  迁移属图库改造 PR，且必须先补这两类用例，不随助手或共享 Modal 一起做。

助手面板以聊天记录的可见空间为优先：顶部只保留一行“对话下拉菜单 → 新增对话 → 关闭”，不显示装饰标题。不常驻快捷提问、使用说明或功能跳转区；操作引导通过对话提供，实际步骤仍从左侧 DESIGN FLOW 进入。

聊天统一具备问答与提出执行方案的能力，不显示“问答/执行”切换。待执行方案提供“拒绝执行”和“确认执行”；用户拒绝后，卡片明确显示“已拒绝执行”，恢复聊天输入，并保留决定供后续对话使用。

对话重命名/删除集成在下拉列表各行右侧，不设常驻操作栏。此列表包含多个独立操作，使用按钮展开及分组内的原生按钮，不把操作按钮嵌入只读 `listbox option`；沿用已有下拉菜单样式。Tab 可访问各操作，Escape/焦点移出/点击外部关闭。重命名、删除复用共享 Modal，关闭后焦点返回列表触发按钮；操作必须绑定所点行的 conversation_id，不切换当前聊天。

## 7. 文案规范（简体中文优先）

- 操作界面一切文本（按钮、状态、提示、placeholder、title）使用简体中文。
- 例外：`.kicker` / eyebrow 等英文大写 mono 装饰标签（如 `DESIGN FLOW`、`REFERENCE INVENTORY / PACK`）属设计语言的一部分，非操作文本，保留英文。
- 状态中文映射（`statusLabel`）：`draft 待开始`、`in_progress 运行中`、`reviewed 待确认`、`approved 已批准`、`generated 已生成`、`stale 需更新`、`rejected 已否决`、`failed 失败`、`cancelled 已停止`。
- 助手运行状态中文映射（同一 `statusLabel` 口径，禁止直接渲染英文码）：`queued 排队中`、`running 正在思考`、`awaiting_confirmation 待确认执行`、`executing 执行中`、`succeeded 已完成`、`interrupted 已中断`。四组语义必须与既有映射区分开：`awaiting_confirmation` ≠ `reviewed 待确认`（前者待用户授权一次写入，后者待人工评审产物）；`executing` ≠ `in_progress 运行中`（后者是设计流水线阶段）；`interrupted` ≠ `cancelled 已停止`（前者进程中断，后者用户取消）；`succeeded` **不得译为「已批准」**——批准是人类权限动作，助手永不执行，用「已批准」会让用户误以为人类结论已由模型代签。`stale` 沿用既有「需更新」。
- **应用自有文本必须简体中文，模型正文为尽力约束**：按钮、状态、字段名、错误标题、placeholder、title 与动作卡结构化标签全部由应用提供并保证简体中文；模型 `reply` / `reason` 的系统提示固定要求简体中文，但首版不引入语言检测、自动翻译或整段拒绝。技术专名、代码和模型偶发英文不得冒充应用状态；所有状态类词汇仍从结构化状态码经上面的映射渲染，不从模型正文提取。`.kicker` 的英文豁免只适用于装饰标签。
- **提示文本必须随用户选择实时更新**（如绑定工作台在选择组件后才出现"推荐状态/推荐字体角色"提示）。
- 后端机器默认值不得直接上屏：如 `screen_type` 的后端缺省 `unspecified`，显示层必须映射为空值 + placeholder「未指定」。

## 8. 禁区清单（违反即返工）

1. 禁止内联样式 `style={{...}}`（动态坐标/尺寸等运行时值除外）。
2. 禁止硬编码颜色值，一律 `var(--*)`；新增语义色先入 `:root`。
3. 禁止原生 `<select>` 及任何未覆写的系统原生外观控件。
4. 禁止引入新 UI 库、图标库、字体族。
5. 禁止新增响应式断点。
6. 禁止用琥珀金表达语义状态；禁止语义色之间互相借色。
7. 禁止绕过中文状态映射直接渲染英文状态码、后端机器默认值或模型返回的状态类词汇。
8. 禁止删除组件后遗留死选择器。
9. 禁止次要文本使用 `--ink`（主文色），防止层级混乱。
10. 禁止同屏多个 `.button--primary`。
11. 禁止在常驻辅助列（右侧 316px / 280px 列）内使用 `.button--primary`；确认按钮等级按 §5 的动作风险二分支机械决定，不由实现者临场选择。
12. 禁止把成本 / 费用提示染成 `--warning`——费用是事实说明不是状态，用中性 `--muted` + `--panel-2`（§6.4）。

## 9. 新 UI 提交前自查清单

- [ ] 全部颜色来自 `:root` 令牌，无硬编码色值与内联样式
- [ ] 琥珀金仅出现于 §3 允许的四类位置
- [ ] 语义状态全部使用 §2.4 对应语义色
- [ ] 下拉使用自绘 Dropdown，长选项有截断与 title
- [ ] 全部应用自有操作文本为简体中文，状态走中文映射；模型正文已在系统提示中要求简体中文
- [ ] 提示文本随选择实时更新，placeholder 用 `--faint`
- [ ] 按钮层级正确（每屏至多一个 primary）
- [ ] 常驻辅助列内无 `.button--primary`，确认按钮等级与动作风险一致（§5）
- [ ] 金与橙没有出现在同一组件上（§4）；成本提示用中性色未染橙（§6.4）
- [ ] 新增窄屏适配前已确认目标断点在桌面端可达（§1）
- [ ] 新建的二次确认复用共享原生 `<dialog>` 与 `.dialog-backdrop` / `.utility-dialog` 视觉样式，未手写焦点锁、未新建 z-index 层；已补 dialog 的视口尺寸/UA margin 与 border 重置，并把 `::backdrop` 置为透明（§6.5）
- [ ] 共享 Modal 的 `cancel` 走受控 `onClose`，`showModal()` effect 可在 StrictMode 下重复执行和清理；Escape 关闭后能重新打开，焦点归还触发器（§6.5）
- [ ] 迁移既有二次确认时先补齐其 Escape 层级与焦点归还用例再改实现，未在共享 Modal 的 PR 里顺带改动图库（§6.5 / §6.7）
- [ ] `pnpm run lint`、`pnpm run test:ui-unit`、`pnpm run build` 通过；涉及流水线交互时 `pnpm test:ui-e2e` 通过

## 10. 源码与验证指针

- 样式源：`src/styles.css`（令牌在 `:root`，第 5-40 行）
- 共享控件：`src/features/shared/ui.tsx`（现有导出为 `Dropdown`、`statusLabel`、`friendlyError`、`StatusPill`、`WireframeLightbox` 等）。**共享 Modal 尚不存在**：该文件没有 Modal 导出，`src/` 内也没有任何 `<dialog>` 元素。它是 §6.5 要求的**待建**控件，当前基线是 `src/App.tsx:24` 的局部 `Modal`（实际调用者为 SettingsDialog 与 ProjectManager；`div.dialog-backdrop` + `section.utility-dialog`，缺 `role="dialog"`、`aria-modal`、Escape 与关闭后焦点归还）。`NewProjectDialog` 是 `App.tsx` 内另一套手写遮罩，图库与使用指南也各有一处；这三处不在首批共享化范围，迁移边界见 §6.5
- 工作台目录：`src/features/`（binding/、contracts/、layout/、production/、strict-continuation/、workbenches/ 等）
- 桌面窗口下限：`electron/main.cjs`（`minWidth: 1180` / `minHeight: 760`，决定 §1 中断点档位在桌面端是否可达）
- 右列与通知层装配：`src/App.tsx`（`FeedbackScope`、`inert={galleryOpen}`、`.artifact-inspector` 与 `.overlay-bar` 的挂载位置）
- 验证命令：`pnpm run lint`、`pnpm run test:ui-unit`、`pnpm run build`、`pnpm test:ui-e2e`、文档门禁 `pnpm test:docs`

## 版本与变更记录

- 1.3（2026-09-05）：闭合共享原生 `<dialog>` 条款并完成实现前复核。§6.5 把「二次确认一律复用」收窄为「**新建的**二次确认一律复用」；遮罩由 `<dialog>.dialog-backdrop` 自身承载，除透明 `::backdrop` 外必须重置原生 dialog 的视口尺寸、`max-width` / `max-height`、margin 与 border，避免 UA 样式使遮罩只包住内容；`cancel` 必须 `preventDefault()` 后走受控 `onClose`，`showModal()` effect 必须防重并清理，以通过 StrictMode、Escape 后重开与焦点归还。纠正事件事实：Chromium 顺序是 `window keydown → dialog cancel → dialog close`，不是 dialog 吞掉 Escape。首批共享化的真实范围是 App 局部 Modal 的 SettingsDialog、ProjectManager 与新助手删除确认；`NewProjectDialog`、图库豁免、使用指南三套手写遮罩均延后，其中图库迁移前必须补豁免 Escape/焦点断言。§6.4 同步补橙色左边条卡片只用 ghost 按钮；§9 与 §10 按上述事实更新。
- 1.2（2026-09-05）：收紧助手施工契约。动作风险归服务端动作描述符所有，补 `reversible` 并禁止模型/Renderer 降级风险；待确认橙色只落在对话列表，ActionCard 保持中性，避免与 secondary 金按钮同组件。弹窗要求复用共享原生 `<dialog>` 的完整模态行为而非只复用类名或手写焦点锁。中文规范区分「应用自有文本可保证」与「模型正文尽力约束」，首版不为此引入语言检测或翻译失败面；`statusLabel` 补齐 `running` 等助手状态。
- 1.1（2026-09-04）：修正与补齐事实源，为内嵌 AI 助手右栏开工做前置裁定。§1 如实修正断点可达性——源码有四条 `@media`（1320 / 1240 / 1120 / 960），而桌面 `minWidth: 1180` 使 1120px 与 960px 两档在桌面端永不触发，只在 Web 窄窗作为裁切后的降级路径生效；同时移除已过期的 `styles.css`「约 785 行」计数（实际 1048 行），改为不随样式增长腐烂的量级表述。§2.4 增加助手运行状态的语义色绑定，明确「正在思考」用紫不用灰或金，`cancelled` / `queued` 属中性状态不得借语义色。§4 的金橙互斥补上可执行落点：§5 新增「常驻辅助列不使用 `.button--primary`」与按动作风险二选一的确认按钮等级表（不覆盖且可逆 → secondary，覆盖或不可逆 → danger），使互斥由构造成立而非依赖自觉。§6.4 明确成本/费用属中性事实说明不占 `--warning`，列表「待处理」状态优先用左边条而非塞进带动作的组件。§6.5 明确二次确认一律复用 `.dialog-backdrop`（z-100）+ `.utility-dialog`，不新建 z-index 层，并记录 `inert` 子树内触发器天然不可达、以及 fixed backdrop 会被祖先 `transform`/`filter`/`backdrop-filter` 困住的陷阱。§7 补 5 个助手运行状态中文映射及其与既有状态的语义区分（`succeeded` 不得译为「已批准」），并明确模型生成文本同受简体中文约束、须由系统提示与上屏前校验保证。§8 禁区新增第 11、12 条，第 7 条扩及模型返回的状态类词汇。§9 自查清单增加四项机械可查条目。§10 补 `electron/main.cjs` 与 `src/App.tsx` 指针。
- 1.0（2026-08-20）：随全量前端排查整改定稿。关键变更：`--warning` 由 `#cf8a2e` 改为 `#de7433` 以区分琥珀金；状态胶囊 `approved→绿`、`generated→紫` 语义化；新增 `layout-workbench-actions`/`capacity-warning`/`asset-workbench` 表单/`composition-output`/`binding-hint` 等缺失样式；清理 `.rail-title small` 等死选择器；严格生产面板与 Underlay/Fidelity 检查项全量中文化。
