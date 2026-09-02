# 前端设计规范（Darkroom Precision）

本规范是 Game UI Design Copilot 全部前端界面的**唯一设计事实来源**。任何新增或修改 UI 的工作必须先读本文件，再读 `src/styles.css`。目标是防止执行者自由发挥导致风格漂移。

规范基线：「Darkroom Precision」令牌全量落地——深墨四级面板、发丝线、琥珀金强调、深色滚动条、`color-scheme: dark`；覆盖五阶段工作台、契约专注检查全屏工作台、布局画布与安全区、风格规范板、视觉探索卡、Artifact 检查器、全部弹窗与崩溃保护屏。

## 1. 技术约束（不可变更）

- **单一样式源**：全部样式集中在 `src/styles.css`（约 785 行）。禁止 CSS Modules、CSS-in-JS、Tailwind、SCSS/Less 及任何 UI 组件库。
- **固定深色主题**：`:root` 声明 `color-scheme: dark`，不做亮色切换；`body` 最小宽度 1180px、最小高度 760px。
- **图标唯一来源**：`lucide-react`，禁止引入其他图标库或自制 PNG 图标。
- **响应式断点仅三个**：1320px / 1240px / 1120px，禁止新增任意断点。
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

### 6.5 弹窗与空态

- 弹窗：`.dialog-backdrop` 遮罩 + `.create-dialog` / `.utility-dialog`；图片预览用 `.lightbox` / `.wireframe-lightbox`。
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
  路线**不提供**豁免口子，点击仍只解释原因。

## 7. 文案规范（简体中文优先）

- 操作界面一切文本（按钮、状态、提示、placeholder、title）使用简体中文。
- 例外：`.kicker` / eyebrow 等英文大写 mono 装饰标签（如 `DESIGN FLOW`、`REFERENCE INVENTORY / PACK`）属设计语言的一部分，非操作文本，保留英文。
- 状态中文映射（`statusLabel`）：`draft 待开始`、`in_progress 运行中`、`reviewed 待确认`、`approved 已批准`、`generated 已生成`、`stale 需更新`、`rejected 已否决`、`failed 失败`、`cancelled 已停止`。
- **提示文本必须随用户选择实时更新**（如绑定工作台在选择组件后才出现"推荐状态/推荐字体角色"提示）。
- 后端机器默认值不得直接上屏：如 `screen_type` 的后端缺省 `unspecified`，显示层必须映射为空值 + placeholder「未指定」。

## 8. 禁区清单（违反即返工）

1. 禁止内联样式 `style={{...}}`（动态坐标/尺寸等运行时值除外）。
2. 禁止硬编码颜色值，一律 `var(--*)`；新增语义色先入 `:root`。
3. 禁止原生 `<select>` 及任何未覆写的系统原生外观控件。
4. 禁止引入新 UI 库、图标库、字体族。
5. 禁止新增响应式断点。
6. 禁止用琥珀金表达语义状态；禁止语义色之间互相借色。
7. 禁止绕过中文状态映射直接渲染英文状态码或后端机器默认值。
8. 禁止删除组件后遗留死选择器。
9. 禁止次要文本使用 `--ink`（主文色），防止层级混乱。
10. 禁止同屏多个 `.button--primary`。

## 9. 新 UI 提交前自查清单

- [ ] 全部颜色来自 `:root` 令牌，无硬编码色值与内联样式
- [ ] 琥珀金仅出现于 §3 允许的四类位置
- [ ] 语义状态全部使用 §2.4 对应语义色
- [ ] 下拉使用自绘 Dropdown，长选项有截断与 title
- [ ] 全部操作文本为简体中文，状态走中文映射
- [ ] 提示文本随选择实时更新，placeholder 用 `--faint`
- [ ] 按钮层级正确（每屏至多一个 primary）
- [ ] `pnpm run lint`、`pnpm run test:ui-unit`、`pnpm run build` 通过；涉及流水线交互时 `pnpm test:ui-e2e` 通过

## 10. 源码与验证指针

- 样式源：`src/styles.css`（令牌在 `:root`，第 5-40 行）
- 共享控件：`src/features/shared/ui.tsx`（Dropdown、friendlyError 等）
- 工作台目录：`src/features/`（binding/、contracts/、layout/、production/、strict-continuation/、workbenches/ 等）
- 验证命令：`pnpm run lint`、`pnpm run test:ui-unit`、`pnpm run build`、`pnpm test:ui-e2e`、文档门禁 `pnpm test:docs`

## 版本与变更记录

- 1.0（2026-08-20）：随全量前端排查整改定稿。关键变更：`--warning` 由 `#cf8a2e` 改为 `#de7433` 以区分琥珀金；状态胶囊 `approved→绿`、`generated→紫` 语义化；新增 `layout-workbench-actions`/`capacity-warning`/`asset-workbench` 表单/`composition-output`/`binding-hint` 等缺失样式；清理 `.rail-title small` 等死选择器；严格生产面板与 Underlay/Fidelity 检查项全量中文化。
