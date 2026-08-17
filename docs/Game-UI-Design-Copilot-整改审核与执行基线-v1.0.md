**REMEDIATION AUDIT & EXECUTION BASELINE**

**Game UI Design Copilot**

**严格风格继承升级整改审核与执行基线**

用于纠正 0.2.0 当前实现缺口，并将项目推进至可正式验收、可真实交付的目标状态

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>最终审计结论</strong></p>
<p>当前实现属于“架构型 Alpha / 技术预览”：控制面和契约框架已大体建立，但真实生产面尚未闭环。本次验收不通过。执行者必须按本文完成真实最终 PNG、真实字体加载、真实 9-slice、真实 Repair、真实 Critique 指标、真实 Fidelity 和真实 Golden Sample 验收后，方可恢复正式版本发布。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **目标仓库**     | z806738350-source/Game-UI-Design-Projects       |
|------------------|-------------------------------------------------|
| **审计基准**     | main @ 498a8a965d4de374c5ef73389ad7fedc131e0c2c |
| **实现分支头**   | ced8750a452724aff6e4c9fa99800d02806c13d0        |
| **文档版本**     | 1.0                                             |
| **文档状态**     | 整改执行基线 / 未通过项必须全部关闭             |
| **建议版本标识** | 0.2.0-alpha，完成本文全部门禁后再发布正式版本   |
| **审计日期**     | 2026-08-17                                      |

**本文件不是建议清单，而是本轮整改的范围、实施、测试与验收唯一基线。**

# 1. 审计结论与执行原则

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>验收状态：不通过</strong></p>
<p>执行者认真完成了大量真实代码和契约框架，但将“Manifest 与门禁存在”过早等同于“真实生产能力完成”。当前项目尚不能可靠产出、保存、导出和验证最终严格继承成图。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **审计维度**   | **当前状态** | **结论**                                                                                | **正式验收要求**                                   |
|----------------|--------------|-----------------------------------------------------------------------------------------|----------------------------------------------------|
| 严格模式控制面 | **部分通过** | 已有项目默认 strict、参考图容量、字体/组件/Binding/Underlay/Fidelity 契约均有真实代码。 | 保留现有架构，修复门禁和事实一致性。               |
| 真实生产面     | **不通过**   | 最终合成 PNG、字体实装、9-slice、Repair 执行均未完成。                                  | 必须生成真实文件并形成可复现、可导出的闭环。       |
| 自动视觉审查   | **部分通过** | 已调用多模态模型，但缺少 Overlay、组件缩略图和正式低层指标。                            | 双通道 Critique 必须可自动发现真实污染和繁忙背景。 |
| 多页面能力     | **部分通过** | 后端 Screen Registry 存在，前端仍是单页面产品。                                         | 前端 Screen Manager 与每页独立输入必须可用。       |
| 最终保真验收   | **不通过**   | 当前 Fidelity 主要检查清单元数据，不检查最终像素文件。                                  | 必须验证最终 PNG、资产哈希、字体、布局和 9-slice。 |
| 真实业务验证   | **不通过**   | Golden Samples 是合成 JSON，未使用真实截图和真实最终图片。                              | 完成三组合法真实样本和设计师评分。                 |

## 1.1 执行原则

- 不得把“生成 JSON/Manifest”写成“生成最终成图”。

- 不得把“资产登记为 exact”写成“画面已经使用该资产”。

- 不得把“Repair Task 已生成”写成“污染已修复”。

- 不得把“函数单元测试通过”写成“真实视觉链路通过”。

- 所有最终状态必须由后端门禁验证，前端禁用按钮只是辅助。

- 所有最终验收必须附真实输入、真实输出、哈希、测试日志和设计师签核。

- 不允许静默 fallback、静默截断、静默豁免、静默跳过字体或组件资产。

- 不存在可证明的最终输出文件时，Fidelity 不得为 passed。

## 1.2 目标状态

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>已有页面与授权资产<br />
→ Reference Inventory / Reference Pack<br />
→ Style + Font + Component Contracts<br />
→ Stable Control IDs + 100% Bindings<br />
→ Component-aware Layout + Underlay Policy<br />
→ Underlay Contract + Guide / Mask<br />
→ Underlay Generation<br />
→ Semantic + Deterministic Critique<br />
→ Real Repair / Regeneration<br />
→ Real Component + Typography Rendering<br />
→ Final PNG + Composition Manifest<br />
→ Pixel-aware Fidelity Gate<br />
→ Human Visual Acceptance<br />
→ Final Approval</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 2. 审计范围、证据等级与判定方法

**本次审计覆盖：**主分支源码、实现提交、Artifact 数据模型、后端门禁、前端工作台、测试夹具、Golden Samples、发布验收记录和文档。

| **等级** | **类型**   | **使用规则**                                                        |
|----------|------------|---------------------------------------------------------------------|
| **A**    | 源码事实   | 当前 main 分支可以直接证明的行为、缺口和数据流。                    |
| **B**    | 测试事实   | 测试代码能证明函数级行为，但不能自动等价为真实业务链路。            |
| **C**    | 执行者自报 | 本地检查记录、Smoke Test 和验收文档；无仓库 CI 时不得视为独立复核。 |
| **D**    | 缺失证据   | 没有最终文件、没有真实样本、没有设计师签核或没有可复现日志。        |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>审计判定规则</strong></p>
<p>只有“真实功能存在 + 后端门禁存在 + 自动测试存在 + 真实业务证据存在”四项同时满足，才标记为完成。仅有接口、JSON、按钮或单元测试时，一律标记为部分完成或表面完成。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 3. 当前完成情况总览

## 3.1 已认真完成且应保留的部分

- 已有项目默认 existing-strict，严格模式提示词改为 underlay-only。

- Reference Pack 具备确定性角色排序和 omitted 记录，客户端不再静默截断。

- Schema 2.0、Artifact Registry、依赖图和后端 Screen Registry 已建立。

- Font Manifest、Component Contract 和 Component Bindings 已有真实导入和校验逻辑。

- Underlay Contract 与灰阶结构 Guide 能够生成真实 PNG 和哈希。

- Automatic Critique 已接入独立 critiqueModel 或 visionModel 回退。

- Composition Manifest、Fidelity Report 和 Final Approval Gate 已有控制面代码。

- JSON 写入采用临时文件 + rename，基础文件完整性处理正确。

- 新增了若干单元测试、迁移测试和控制面回归测试。

## 3.2 要求完成度矩阵

| **ID**   | **要求**                  | **当前结果**                          | **审计状态** | **主要缺口**                                             | **整改完成证据**                                    |
|----------|---------------------------|---------------------------------------|--------------|----------------------------------------------------------|-----------------------------------------------------|
| **R-01** | Existing strict 默认模式  | 已实现 strict/guided 模式与后端默认值 | **完成**     | 无核心缺口                                               | 创建已有项目自动进入 strict；切换模式触发完整 stale |
| **R-02** | Reference Inventory       | 仅有参考图角色与排序                  | **部分完成** | 没有独立 Inventory 批准、contains 标签和基准页状态       | 可创建、批准并在 UI 中审计 Inventory                |
| **R-03** | Reference Pack            | 确定性排序和 omitted 已实现           | **部分完成** | UI 不展示 omitted；Prompt attachment order 仍可能错配    | UI 可预览，Prompt 使用 selected 顺序和角色描述      |
| **R-04** | Style Contract 2.0        | 现有校验仍较浅                        | **部分完成** | 具体数值与模糊值拒绝不充分                               | 结构和可执行数值校验全部通过                        |
| **R-05** | Font Manifest             | 文件、哈希、覆盖与角色已实现          | **部分完成** | 自动标 exact/confirmed；实际渲染不加载字体               | 用户显式确认，FontFace 实际加载并验证               |
| **R-06** | Component Contract        | 默认状态和复用模式已实现              | **部分完成** | 缺多状态、透明、实际文件、9-slice 完整性                 | 真实组件工作台和文件级校验通过                      |
| **R-07** | Stable Screen Controls    | 仍以 string\[\] 为主                  | **未完成**   | Binding ID 依赖文本 slug，不稳定                         | 控件对象有稳定 ID，改文案不破坏绑定                 |
| **R-08** | 100% Bindings             | 后端覆盖率检查已实现                  | **完成**     | 需补页面专属组件审核和状态完整性                         | 完整绑定、状态和页面专属批准证据                    |
| **R-09** | Component-aware Layout    | Prompt 和基础 Validator 已实现        | **部分完成** | 缺安全区、重叠、文本槽、z-index 等                       | 布局验证覆盖全部硬约束                              |
| **R-10** | Underlay Contract         | 已生成 Reserved Region 和 Guide       | **完成**     | 需补实际 Review Overlay 与审查图                         | Guide 与 Overlay 均落盘并可追踪                     |
| **R-11** | Automatic Critique        | 已有真实多模态调用                    | **部分完成** | 缺 Overlay、组件缩略图和低层指标；部分语义字段未转 Issue | 双通道检测真实污染并通过校准                        |
| **R-12** | Underlay Repair           | 仅生成 Repair Task                    | **表面完成** | 没有执行 Inpaint/Regenerate 和复审                       | 产生新 Underlay、版本和自动 Re-critique             |
| **R-13** | Deterministic Composition | 只生成 Manifest；Canvas 未接主流程    | **表面完成** | 没有最终 PNG；9-slice/字体不真实                         | 最终 PNG 保存、哈希、可复现和可导出                 |
| **R-14** | Typography Rendering      | Canvas 使用 family 或 sans-serif      | **未完成**   | 没有 FontFace、字距/渐变/真实字体验证                    | 最终文本明确使用 Font Manifest 字体                 |
| **R-15** | Final Fidelity            | 主要检查 Manifest 元数据              | **表面完成** | 不读取最终 PNG，不验证像素和实际文件                     | 像素与资产级 Gate 全部通过                          |
| **R-16** | Multi-screen Backend      | Registry、独立目录和 API 已实现       | **完成**     | 每页 Wireframe 仍是全局输入                              | 每个 Screen 独立输入和 Artifact                     |
| **R-17** | Multi-screen UI           | 主 UI 仍显示 1 个页面                 | **未完成**   | 没有 Screen Manager 和切换入口                           | 用户可新建、切换、复制、归档 Screen                 |
| **R-18** | Stale Propagation         | 新依赖图存在                          | **部分完成** | 输入变化与模式变化仍走旧失效逻辑                         | 所有上游变化正确影响相关页面                        |
| **R-19** | Migration rollback        | 成功路径迁移已实现                    | **部分完成** | 非完整备份，无故障注入恢复测试                           | 完整备份、事务、失败自动恢复                        |
| **R-20** | Golden Samples            | 合成 JSON fixture 已实现              | **未完成**   | 没有真实图片、真实模型发现和设计师评分                   | 三组真实样本完整闭环并签核                          |
| **R-21** | CI / independent proof    | 无可见 GitHub Actions                 | **未完成**   | 本地自报不能替代独立 CI                                  | PR 与 main 自动执行完整测试和安全扫描               |
| **R-22** | 专项文档                  | 多为 1 段摘要                         | **部分完成** | 不是执行级字段和 SOP 文档                                | 用户、开发、迁移、故障处理均可独立执行              |

# 4. 阻断正式验收的关键问题与强制整改

## **F-01 没有生成、保存和导出真实最终 PNG**

| **严重级别** | **Blocker**      | **当前状态**   | 当前 composeVisual 只创建 Composition Manifest；导出仍下载原始 Underlay。 |
|--------------|------------------|----------------|---------------------------------------------------------------------------|
| **审计证据** | E-01、E-02、E-03 | **整改优先级** | **P0 - 阻断正式验收**                                                     |

**当前实现：**后端形成层清单，但没有调用实际渲染器，也没有在项目目录生成 final-vN.png。前端严格生产按钮名称写“合成”，实际仅保存 Manifest。

**影响：**用户可能批准一个不存在最终画面的结果；所有“最终合成”“Fidelity passed”结论均缺少交付对象。

**根因：**实现者把控制面当作生产面，缺少 Output Artifact 和文件落盘门禁。

**必须执行的整改动作**

> **1.** 新增 Composition Output Artifact 或在 Composition Manifest 中增加 output.path、output.hash、width、height、rendered_at、renderer_version。
>
> **2.** 将实际合成器接入 composeVisual：读取 Underlay、组件、字体与 Layout，真实生成 PNG。
>
> **3.** 将结果保存为 screens/\<screen-id\>/compositions/preview-vN.png 和 final-vN.png。
>
> **4.** 导出 API 必须导出 final PNG；严格模式不得导出 Underlay 作为最终结果。
>
> **5.** Final Approval 必须验证最终文件存在、可解码、尺寸正确、哈希匹配。

**验收条件**

> **□** 项目目录真实存在 final PNG，且不是 Underlay 文件的副本。
>
> **□** 删除 final PNG 后，Fidelity 和 Final Approval 必须失败。
>
> **□** 导出的 PNG 与 Composition Output 哈希一致。
>
> **□** 同一 Manifest 重渲染产生相同尺寸、相同层顺序和可接受的确定性哈希策略。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止性捷径</strong></p>
<p>禁止把“Manifest 已生成”显示为“最终图片已生成”；禁止导出原始 Provider Underlay 冒充最终成图。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **F-02 组件渲染未实现 exact / nine-slice / vector-token**

| **严重级别** | **Blocker** | **当前状态**   | 现有 Canvas 对所有组件统一 drawImage 拉伸。 |
|--------------|-------------|----------------|---------------------------------------------|
| **审计证据** | E-02、E-04  | **整改优先级** | **P0 - 阻断正式验收**                       |

**当前实现：**即使 CanvasCompositor 接入主流程，nine-slice 仍会整张拉伸，exact 也可能被强制压入任意 Slot。

**影响：**边角、端帽和描边再次变形，直接重现“部件漂”。

**根因：**渲染器没有按 Component Contract 的 reuse_mode 分派实现。

**必须执行的整改动作**

> **1.** 建立 renderer registry：exactRenderer、nineSliceRenderer、vectorTokenRenderer。
>
> **2.** exactRenderer 只允许等比缩放并遵守 min/max scale。
>
> **3.** nineSliceRenderer 将源图分为 9 个区域，四角不缩放、边缘单轴拉伸、中心双轴拉伸。
>
> **4.** vector-token 以 Canvas/SVG 规则渲染，不得降级成普通位图拉伸。
>
> **5.** 每个 renderer 输出实际变换信息和渲染诊断。

**验收条件**

> **□** 使用带明显圆角和边框的 9-slice 测试图，拉伸后四角像素保持一致。
>
> **□** exact 组件非等比 Slot 必须在合成前失败。
>
> **□** 渲染测试比较四角 patch、边缘和中心区域。
>
> **□** Final Fidelity 能识别 renderer 与 Contract 不一致。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止性捷径</strong></p>
<p>禁止用统一 drawImage 覆盖所有 reuse_mode；禁止只在 Validator 中检查、渲染时仍按普通位图处理。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **F-03 字体 exact 声明与实际渲染不一致**

| **严重级别** | **Blocker**      | **当前状态**   | 前端导入后自动传 confirmed + exact，Canvas 未加载 font_path。 |
|--------------|------------------|----------------|---------------------------------------------------------------|
| **审计证据** | E-05、E-06、E-07 | **整改优先级** | **P0 - 阻断正式验收**                                         |

**当前实现：**Font Manifest 可能显示 exact，但最终 Canvas 使用 token.family 或 sans-serif；授权状态也由前端默认确认。

**影响：**最终画面字体可能完全错误，但 Fidelity 仍通过；存在合规和可信度风险。

**根因：**字体事实、授权确认和真实渲染链路被拆开，缺少实际加载验证。

**必须执行的整改动作**

> **1.** 导入字体后默认 license_status=unresolved、fidelity_mode=unresolved；由用户显式确认授权和角色。
>
> **2.** 使用 FontFace 从项目资产路径加载字体，等待 document.fonts.ready 后再渲染。
>
> **3.** Font Manifest 记录 family_name、postscript_name、hash、coverage；渲染结果记录 actual_loaded_family。
>
> **4.** Final 模式要求所有 identity-critical 角色 exact 且字体加载成功。
>
> **5.** 暂时移除 WOFF/WOFF2 支持，或引入正确 WOFF/WOFF2 解析器并增加真实测试。
>
> **6.** 补齐字距、行高、描边、阴影、渐变、基线和数字样式。

**验收条件**

> **□** 加载失败时 Final Composition 必须失败，不得回退 sans-serif。
>
> **□** 渲染器记录字体加载成功证据和实际 family。
>
> **□** 同文案 exact 字体与 fallback 的像素差异测试能区分。
>
> **□** 授权未确认时 Final Approval 必须失败。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止性捷径</strong></p>
<p>禁止导入即自动标 exact；禁止把系统 fallback 静默视为 exact；禁止在未确认授权时写 confirmed。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **F-04 Underlay Repair 只有计划，没有执行闭环**

| **严重级别** | **Blocker** | **当前状态**   | repairUnderlay 只保存 underlay-repair-task.json。 |
|--------------|-------------|----------------|---------------------------------------------------|
| **审计证据** | E-08、E-09  | **整改优先级** | **P0 - 阻断正式验收**                             |

**当前实现：**没有 Inpaint、没有 Regenerate、没有新 Underlay、没有自动重新 Critique。

**影响：**污染被识别后无法自动修复，流程会停在任务 JSON。

**根因：**实现了任务规划器，没有实现任务执行器与版本链。

**必须执行的整改动作**

> **1.** 实现 executeRepairTask：根据 Provider Capabilities 调用 inpaint 或重新生成。
>
> **2.** 修复输入必须携带原 Underlay、目标区域、Critique 证据、保留区域和 Underlay Contract。
>
> **3.** 保存 underlay-vN.png/URL、provider_task_id、parent_underlay_id、repair_task_id。
>
> **4.** 修复成功后自动运行 Critique，并更新阶段状态。
>
> **5.** 达到 max attempts 后进入 blocked + manual_review，不得停留在 in_progress。

**验收条件**

> **□** 已知污染样本修复后产生新 Underlay 版本。
>
> **□** 新版本自动 Critique；旧 Critique 不可继续复用。
>
> **□** 修复失败或超限有明确错误和人工处理路径。
>
> **□** Inpaint 与 Regenerate 均有集成测试。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止性捷径</strong></p>
<p>禁止把 Repair Task 的存在展示为污染已修复；禁止无上限自动重试。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **F-05 Automatic Critique 缺少完整双通道输入与低层指标**

| **严重级别** | **Blocker**      | **当前状态**   | 只把 Underlay 图片送给模型；deterministic 指标没有生产计算。 |
|--------------|------------------|----------------|--------------------------------------------------------------|
| **审计证据** | E-10、E-11、E-12 | **整改优先级** | **P0 - 阻断正式验收**                                        |

**当前实现：**没有 Review Overlay、组件缩略图；模型返回 background_busyness/contrast_conflict 未必转为 Issue。

**影响：**复杂背景、强高光和 Slot 竞争可能被自动放过。

**根因：**Critique 数据结构先于真实计算器完成，正式流程只实现语义半链路。

**必须执行的整改动作**

> **1.** 生成 underlay-review-overlay.png：包含 Slot ID、保护区和语义标记。
>
> **2.** 向 Critique 模型同时提供 Underlay、Overlay、关键组件缩略图或组件板。
>
> **3.** 实现 deterministicMetrics 服务：edge_density、local_contrast、color_complexity、highlight_density。
>
> **4.** 把模型的 background_busyness、contrast_conflict、hard_edge_crossing 全部映射为 Issue。
>
> **5.** 阈值必须用真实 Golden Samples 校准并版本化。
>
> **6.** Critique 输出保存模型、Prompt Hash、输入图片哈希和阈值版本。

**验收条件**

> **□** 按钮残影、假导航、假文字、主体穿越、繁忙背景、高光冲突均能被对应测试命中。
>
> **□** 只提供 Underlay、不提供 Overlay 或语义证据时严格模式不得自动 passed。
>
> **□** 低置信度结果进入 manual_review。
>
> **□** 已知 critical 样本 auto-pass 数为 0。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止性捷径</strong></p>
<p>禁止以手写 semantic fixture 代替真实图像发现能力；禁止忽略模型已经返回的 busyness/contrast 字段。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **F-06 Fidelity Gate 只检查 Manifest，不检查真实成图**

| **严重级别** | **Blocker** | **当前状态**   | 当前检查 control layer、hash 字符串格式、font manifest 和 stale。 |
|--------------|-------------|----------------|-------------------------------------------------------------------|
| **审计证据** | E-13        | **整改优先级** | **P0 - 阻断正式验收**                                             |

**当前实现：**不读取最终 PNG，不验证实际文件、像素、文字越界、9-slice 或真实字体。

**影响：**Fidelity passed 不能证明画面正确，只能证明清单字段看起来完整。

**根因：**验证对象选错：检查了声明，没有检查产物。

**必须执行的整改动作**

> **1.** Fidelity 输入必须包含最终 PNG 路径和哈希。
>
> **2.** 验证 PNG 可解码、尺寸、Alpha、文件哈希、画布和输出版本。
>
> **3.** 重新计算组件/字体资产当前哈希，与 Manifest 对比。
>
> **4.** 运行 pixel/layout checks：实际 bbox、越界、重叠、安全区、文字溢出、9-slice 固定区。
>
> **5.** 可选视觉相似度：Canonical Crop 与渲染区域 SSIM/LPIPS/视觉嵌入。
>
> **6.** 最终报告区分 Manifest Consistency 与 Visual Fidelity。

**验收条件**

> **□** 篡改组件文件后，Fidelity 必须失败。
>
> **□** 删除最终 PNG、改变尺寸、制造文字溢出或 9-slice 变形时均失败。
>
> **□** Fidelity Report 保存检查项、证据文件、阈值和结果。
>
> **□** Final Approval 只接受通过的最新报告。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止性捷径</strong></p>
<p>禁止仅检查哈希字符串“长得像 SHA-256”；必须读取文件并重新计算。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **F-07 Reference Inventory 和 Reference Pack 审核工作台未完成**

| **严重级别** | **Critical** | **当前状态**   | 有角色管理和 Pack 生成，但没有 Inventory Artifact 读取/批准和 omitted UI。 |
|--------------|--------------|----------------|----------------------------------------------------------------------------|
| **审计证据** | E-14、E-15   | **整改优先级** | **P0 - 阻断正式验收**                                                      |

**当前实现：**用户看不到最终向模型发送哪些图、哪些图被丢弃、附件角色是否与顺序一致。

**影响：**关键组件参考可能未进入模型，或被错误解释为主参考。

**根因：**后端 Pack 先实现，前端审查和 Prompt 映射未同步。

**必须执行的整改动作**

> **1.** 实现 reference-inventory.json 的创建、编辑、读取、批准和历史。
>
> **2.** 每张图记录 role、approved、screen_type、contains、baseline、notes。
>
> **3.** Reference Workbench 显示 Provider 容量、selected、omitted 和原因。
>
> **4.** Style/Underlay Prompt 必须按 selected 顺序描述每张附件角色。
>
> **5.** Inventory 或 Pack 变化触发完整 stale。

**验收条件**

> **□** 用户能在发送前预览实际附件顺序。
>
> **□** 超限时 omitted 清晰可见并需确认。
>
> **□** Prompt 中的 attachment 1/2/3 与实际图片顺序完全一致。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止性捷径</strong></p>
<p>禁止继续用原 reference_assets 顺序描述已经重排的 selected 图片。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **F-08 Screen Contract 控件身份仍不稳定**

| **严重级别** | **Critical** | **当前状态**   | required_controls 仍以 string\[\] 为主，Binding ID 由文字 slug。 |
|--------------|--------------|----------------|------------------------------------------------------------------|
| **审计证据** | E-16、E-17   | **整改优先级** | **P0 - 阻断正式验收**                                            |

**当前实现：**Screen Contract 的 Prompt、Normalizer 和编辑 UI 仍把必要控件保存为字符串；Binding 在运行时根据显示文字临时生成 slug。

**影响：**修改控件文案可能改变 ID，导致 Binding、Layout 和历史追踪断裂。

**根因：**功能意图与稳定身份没有分离。

**必须执行的整改动作**

> **1.** Screen Contract 2.0 使用 {id,label,role,required} 对象。
>
> **2.** 模型生成时要求稳定 kebab-case ID；人工改 label 不改变 ID。
>
> **3.** 迁移旧 string\[\] 时生成 ID 并记录 migrated_from_label。
>
> **4.** UI 编辑器分别编辑 ID、Label 和 Role。

**验收条件**

> **□** 修改“保存阵容”为“确认阵容”后原 Binding 仍有效。
>
> **□** 重复 Label 不产生重复 ID。
>
> **□** 旧项目迁移可追踪。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止性捷径</strong></p>
<p>禁止以显示文字作为业务身份；禁止每次保存重新 slug 化。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **F-09 Component Kit 工作台与合同校验不完整**

| **严重级别** | **Critical** | **当前状态**   | 仅支持导入一个默认状态和基础类别。 |
|--------------|--------------|----------------|------------------------------------|
| **审计证据** | E-18、E-19   | **整改优先级** | **P0 - 阻断正式验收**              |

**当前实现：**缺多状态、9-slice 编辑、透明检查、Game UI Forge Manifest、Source BBox 和 Scale Policy。

**影响：**公共组件仍无法作为完整可复用资产系统。

**根因：**实现以最小 Demo 为目标，没有覆盖计划要求的设计师工作流。

**必须执行的整改动作**

> **1.** 实现状态列表和预览：default/pressed/selected/disabled 等。
>
> **2.** 实现 9-slice 可视化编辑与最小中心合法性检查。
>
> **3.** 验证透明通道、真实文件存在、当前哈希、尺寸和 MIME。
>
> **4.** 支持 Game UI Forge Manifest 导入和语义映射。
>
> **5.** 支持 Source BBox、locked_properties、scale_policy、text_policy。

**验收条件**

> **□** 设计师无需手工编辑 JSON 即可完成 Component Kit。
>
> **□** 缺关键状态、透明通道或真实文件时不能批准。
>
> **□** Forge Manifest 端到端导入测试通过。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止性捷径</strong></p>
<p>禁止通过前端把所有组件默认设置为 exact 来绕过组件类型与状态设计。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **F-10 多 Screen 只有后端，前端和每页输入未闭环**

| **严重级别** | **Critical** | **当前状态**   | 后端可创建/切换 Screen，主界面仍显示“1 个页面”。 |
|--------------|--------------|----------------|--------------------------------------------------|
| **审计证据** | E-20、E-21   | **整改优先级** | **P0 - 阻断正式验收**                            |

**当前实现：**Project Store 和 IPC 已具备 Screen Registry，但主界面没有 Screen Manager；输入仍读取项目级 requirement 和 wireframe。

**影响：**用户无法通过产品界面完成多页面延展；Wireframe 仍是全局输入。

**根因：**数据层和用户工作流没有同步交付。

**必须执行的整改动作**

> **1.** 实现 Screen Manager：新建、切换、复制、重命名、归档。
>
> **2.** 项目顶部显示活动 Screen 和页面数量。
>
> **3.** 每个 Screen 拥有独立 requirement/wireframe 或明确继承规则。
>
> **4.** 所有 Pipeline API 显式接受 screenId，禁止依赖隐式 main。
>
> **5.** 切换 Screen 时正确加载页面 Artifact 和阶段状态。

**验收条件**

> **□** 用户无需调用 API 即可创建第二页面并完成独立流程。
>
> **□** 两个 Screen 的输入与 Artifact 不互相覆盖。
>
> **□** 归档活动页面有明确切换要求。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止性捷径</strong></p>
<p>禁止把后端 API 存在等同于产品功能可用；禁止多个页面共用同一 Wireframe 而无明确提示。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **F-11 失效传播没有完整接入输入和模式变化**

| **严重级别** | **Critical** | **当前状态**   | 依赖图较完整，但 invalidateFromInputChange 仍调用旧逻辑。 |
|--------------|--------------|----------------|-----------------------------------------------------------|
| **审计证据** | E-22、E-23   | **整改优先级** | **P0 - 阻断正式验收**                                     |

**当前实现：**仓库新增了 artifactDependencies，但 requirement、wireframe、references 和 project type 的变化仍主要走旧的 stage-based invalidateDownstream。

**影响：**参考图、Wireframe、项目类型或 continuation mode 变化后，旧 Critique/Composition/Fidelity 可能仍保持有效。

**根因：**新依赖图与旧 Stage 失效逻辑并存，形成两套事实来源。

**必须执行的整改动作**

> **1.** 删除或收敛旧 invalidateDownstream，所有变化统一调用 artifactDependencies。
>
> **2.** 需求、Wireframe、参考图、Art Direction、Project Type、Continuation Mode 分别映射到 changedKind。
>
> **3.** 全局变化遍历所有非归档 Screen；页面变化只影响当前 Screen。
>
> **4.** 模式变化必须使不兼容 Visual、Underlay、Composition、Fidelity stale。
>
> **5.** 增加多 Screen 传播矩阵测试。

**验收条件**

> **□** 每种上游变化都有自动化测试。
>
> **□** 无关页面不被错误 stale。
>
> **□** stale Artifact 不得参与 Final Approval。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止性捷径</strong></p>
<p>禁止保留两套相互不一致的失效传播系统。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **F-12 迁移不是完整事务，失败恢复不足**

| **严重级别** | **Critical** | **当前状态**   | 仅备份 project/workflow JSON；无故障注入恢复。 |
|--------------|--------------|----------------|------------------------------------------------|
| **审计证据** | E-24、E-25   | **整改优先级** | **P0 - 阻断正式验收**                          |

**当前实现：**migrateProjectV2 直接在原项目目录依次写入 backup、screens/index、project.json、state.json 和 migration log。

**影响：**迁移中途失败可能留下 screens/index.json 与旧项目状态混合。

**根因：**迁移按顺序直接写入，缺少完整快照和 rollback transaction。

**必须执行的整改动作**

> **1.** 迁移前复制整个项目到同级备份目录，或建立完整文件清单快照。
>
> **2.** 所有新文件先写临时迁移目录，通过校验后原子替换。
>
> **3.** 捕获任意异常后恢复原目录并写 failed migration log。
>
> **4.** 增加故障注入测试：在每个写入点抛错并验证恢复。
>
> **5.** 迁移可重复执行且幂等。

**验收条件**

> **□** 成功、失败、重复执行三类迁移测试全部通过。
>
> **□** 失败后原项目树和哈希与迁移前一致。
>
> **□** Migration Log 记录 backup、失败原因和恢复结果。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止性捷径</strong></p>
<p>禁止只备份两个 JSON 就宣称“完整项目可恢复”。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **F-13 Golden Samples 与发布证据不足**

| **严重级别** | **Blocker**      | **当前状态**   | Golden Samples 是 JSON 描述，测试手工构造 semantic findings。 |
|--------------|------------------|----------------|---------------------------------------------------------------|
| **审计证据** | E-26、E-27、E-28 | **整改优先级** | **P0 - 阻断正式验收**                                         |

**当前实现：**goldenSamples.test.cjs 根据 known_issues 字符串人工构造 suspected_ui_regions 和 slot_checks，未读取任何真实图片，也未调用 Critique 模型。

**影响：**只能证明“已知问题被告诉系统后会阻止”，不能证明模型能从真实图像发现问题。

**根因：**为快速通过门禁使用了合成 fixture，未完成业务验收。

**必须执行的整改动作**

> **1.** 准备三组合法、隐私安全的真实图片样本。
>
> **2.** 样本包含真实参考图、组件资产、字体、Wireframe 和已知污染 Underlay。
>
> **3.** 运行真实 Critique，保存模型原始输出和 Overlay。
>
> **4.** 运行 Repair、Final Composition、Fidelity 和导出。
>
> **5.** UI 设计师按组件、字体、Underlay、整体可用性评分并签核。
>
> **6.** 增加 GitHub Actions，PR 和 main 自动运行 lint/test/build/fixture E2E。

**验收条件**

> **□** 已知 critical 污染 auto-pass = 0。
>
> **□** 三组样本均生成真实 final PNG。
>
> **□** 组件/字体/Underlay/整体评分均达到门槛。
>
> **□** 验收记录包含输入、输出、哈希、日志和签核人。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止性捷径</strong></p>
<p>禁止用字符串 known_issues 生成 semantic 结果来替代真实视觉检测；禁止用本地自报替代 CI。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **F-14 专项文档和工作台拆分未达到执行级要求**

| **严重级别** | **Major**  | **当前状态**   | 多份专项文档只有简短段落；前端仅拆出两个 feature 目录。 |
|--------------|------------|----------------|---------------------------------------------------------|
| **审计证据** | E-29、E-30 | **整改优先级** | **P0 - 阻断正式验收**                                   |

**当前实现：**专项 Markdown 多数只有概念性摘要；src/features 只有 production 与 strict-continuation，主要流程和状态仍集中在 App.tsx。

**影响：**后续维护者无法仅凭文档完成字段、故障和降级处理；App.tsx 仍承担大量逻辑。

**根因：**把“文件存在”当作文档和模块化完成。

**必须执行的整改动作**

> **1.** 补齐字段级文档、SOP、错误码、迁移、故障排查和验收示例。
>
> **2.** 按 reference/typography/component-kit/screens/bindings/layout/underlay/production/fidelity 拆分 Feature。
>
> **3.** 每个 Workbench 有独立状态、API 边界和测试。
>
> **4.** README 不得声称未真实交付的能力。

**验收条件**

> **□** 新执行者仅阅读文档即可完成真实项目流程。
>
> **□** 核心工作台不继续堆入 App.tsx。
>
> **□** 文档与实际 API/Artifact 字段一致。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止性捷径</strong></p>
<p>禁止以“新增了同名 Markdown 文件”认定文档任务完成。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 5. 必须实现的目标架构与事实链

## 5.1 单一事实来源

| **事实层**               | **唯一职责**                                           |
|--------------------------|--------------------------------------------------------|
| **Reference Inventory**  | 参考图身份、角色、批准状态、包含内容和基准页。         |
| **Reference Pack**       | 一次模型调用实际使用的图片、顺序、角色和 omitted。     |
| **Style Contract**       | 全局颜色、几何、材质、光向、排版效果 Token。           |
| **Font Manifest**        | 真实字体文件、哈希、授权、覆盖、角色和 fidelity mode。 |
| **Component Contract**   | 公共组件家族、状态、资产、复用方式、尺寸和锁定属性。   |
| **Screen Contract**      | 页面功能意图与稳定 control ID。                        |
| **Component Bindings**   | control ID 到 component/state/slot/font role 的映射。  |
| **Approved Layout**      | Slot 坐标、层级、尺寸、Underlay Policy 和安全区。      |
| **Underlay Contract**    | Reserved Regions、焦点区、禁止穿越和背景处理。         |
| **Underlay Critique**    | 语义与低层指标、证据框、严重程度和处理建议。           |
| **Composition Manifest** | 真实使用的 Underlay、组件、字体、变换和渲染器。        |
| **Composition Output**   | 最终 PNG 路径、哈希、尺寸、渲染日志和版本。            |
| **Fidelity Report**      | 对真实最终输出执行的 Manifest + Pixel + Asset 检查。   |

## 5.2 目标状态机

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>GLOBAL<br />
input → reference_analysis → style_resolution → typography_resolution → component_resolution<br />
<br />
PER SCREEN<br />
screen_definition → component_binding → layout_design → underlay_specification<br />
→ underlay_generation → underlay_review → repair/review loop<br />
→ composition_preview → composition_final → fidelity_review → approved</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## 5.3 Final Approval 后端门禁

- 所有 required control 已绑定且实际渲染。

- 所有依赖 Artifact 非 stale，版本与 source 链一致。

- Underlay Critique passed 或合法 waiver；waiver 有 issue ID、理由、批准人和时间。

- 最终 PNG 存在、可解码、尺寸和哈希正确。

- 所有组件文件和字体文件存在，当前哈希与 Manifest 一致。

- strict 模式 identity-critical 字体角色全部 exact 且实际加载成功。

- exact、nine-slice、vector-token 渲染方式与 Contract 一致。

- Fidelity blocker/critical = 0，major 均解决或按规则批准。

- 真实输出可导出，导出哈希与项目内 final PNG 一致。

# 6. 整改执行计划与依赖顺序

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>执行顺序不可随意调整</strong></p>
<p>必须先纠正发布状态和证据口径，再实现真实输出；随后完成字体、9-slice、Critique/Repair、Fidelity；最后补齐多 Screen 产品化、迁移、CI、文档和真实业务验收。跳过前置阶段会再次产生“控制面通过、生产面缺失”的假完成。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## 阶段 0：纠正发布状态与冻结基线

| **任务 ID** | **任务**               | **责任模块** | **前置条件** | **交付物**                        | **完成门禁**              |
|-------------|------------------------|--------------|--------------|-----------------------------------|---------------------------|
| **P0-001**  | 将当前版本标记为 alpha | Release/Docs | 无           | README、CHANGELOG、release note   | 不再宣称正式 0.2.0 已通过 |
| **P0-002**  | 建立审计回归基线       | QA           | P0-001       | 当前 main 测试/构建/功能截图      | 基线可复现并存档          |
| **P0-003**  | 配置 GitHub Actions    | CI           | P0-001       | lint/test/build/security workflow | PR 与 main 必须自动执行   |

## 阶段 1：真实合成与最终输出

| **任务 ID** | **任务**                 | **责任模块** | **前置条件** | **交付物**                   | **完成门禁**            |
|-------------|--------------------------|--------------|--------------|------------------------------|-------------------------|
| **P1-101**  | 定义 Composition Output  | Artifacts    | P0           | output path/hash/size/schema | 所有 Final 均有真实文件 |
| **P1-102**  | 实现 exact renderer      | Renderer     | P1-101       | 等比渲染器和测试             | 不允许非法缩放          |
| **P1-103**  | 实现 nine-slice renderer | Renderer     | P1-101       | 9 区渲染与像素测试           | 角/边/中心正确          |
| **P1-104**  | 接入真实 Canvas 合成     | Pipeline/UI  | P1-102/103   | preview/final PNG            | 项目目录可见成图        |
| **P1-105**  | 修复 final 导出          | API          | P1-104       | 导出 final PNG               | 导出哈希一致            |

## 阶段 2：真实字体系统

| **任务 ID** | **任务**           | **责任模块** | **前置条件** | **交付物**                | **完成门禁**           |
|-------------|--------------------|--------------|--------------|---------------------------|------------------------|
| **P2-201**  | 拆分导入与授权确认 | Typography   | P0           | unresolved→confirmed 操作 | 无自动 exact/confirmed |
| **P2-202**  | 实现 FontFace 加载 | Renderer     | P1           | 真实字体加载器            | Final 无 fallback      |
| **P2-203**  | 补齐排版效果       | Renderer     | P2-202       | 字距/行高/描边/渐变       | 视觉样本通过           |
| **P2-204**  | 收敛字体格式支持   | Typography   | P2-202       | 正确 WOFF 解析或移除声明  | 真实文件测试通过       |

## 阶段 3：Critique 与 Repair 真闭环

| **任务 ID** | **任务**                   | **责任模块**      | **前置条件** | **交付物**               | **完成门禁**    |
|-------------|----------------------------|-------------------|--------------|--------------------------|-----------------|
| **P3-301**  | 生成 Review Overlay        | Underlay          | P1           | overlay PNG + hash       | Slot 语义可视   |
| **P3-302**  | 实现 deterministic metrics | Critique          | P3-301       | 边缘/对比/复杂度/高光    | 指标真实计算    |
| **P3-303**  | 扩展多模态 Critique 输入   | AI                | P3-301/302   | Underlay+Overlay+组件板  | 真实污染识别    |
| **P3-304**  | 执行 Repair Task           | Provider/Pipeline | P3-303       | 新 Underlay + task chain | 修复后自动复审  |
| **P3-305**  | 校准阈值与 waiver          | QA                | P3-302/303   | 版本化阈值和人工流程     | 误报/漏报可审计 |

## 阶段 4：真实 Fidelity

| **任务 ID** | **任务**                 | **责任模块** | **前置条件** | **交付物**                      | **完成门禁**        |
|-------------|--------------------------|--------------|--------------|---------------------------------|---------------------|
| **P4-401**  | 文件与资产真实性检查     | Fidelity     | P1/P2        | final/asset/font hash 检查      | 篡改即失败          |
| **P4-402**  | 布局与像素检查           | Fidelity     | P1           | bbox/overlap/safe/text overflow | 真实输出可验证      |
| **P4-403**  | 组件视觉相似度           | Fidelity     | P1           | SSIM/嵌入可选检查               | 关键组件阈值通过    |
| **P4-404**  | 重写 Final Approval Gate | Pipeline     | P4-401/402   | 真实输出门禁                    | 无文件不可能 passed |

## 阶段 5：产品工作台与多 Screen

| **任务 ID** | **任务**                      | **责任模块**   | **前置条件** | **交付物**                   | **完成门禁**          |
|-------------|-------------------------------|----------------|--------------|------------------------------|-----------------------|
| **P5-501**  | Reference Inventory Workbench | Frontend       | P0           | Inventory/Pack 审核 UI       | selected/omitted 可见 |
| **P5-502**  | Typography Workbench          | Frontend       | P2           | 授权/角色/候选预览           | exact 由用户确认      |
| **P5-503**  | Component Kit Workbench       | Frontend       | P1           | 多状态/9-slice/Forge         | 设计师无须改 JSON     |
| **P5-504**  | Screen Manager                | Frontend/Store | P0           | 页面新建/切换/复制/归档      | 真实多页面可用        |
| **P5-505**  | 每页独立输入                  | Store/Pipeline | P5-504       | screen requirement/wireframe | 页面相互隔离          |
| **P5-506**  | Underlay/Fidelity Workbench   | Frontend       | P3/P4        | Overlay、修复历史、报告      | 完整审查可视化        |

## 阶段 6：依赖、迁移、文档与真实验收

| **任务 ID** | **任务**            | **责任模块** | **前置条件** | **交付物**          | **完成门禁**        |
|-------------|---------------------|--------------|--------------|---------------------|---------------------|
| **P6-601**  | 统一 stale 引擎     | Pipeline     | P0           | 单一依赖传播实现    | 矩阵测试全过        |
| **P6-602**  | 事务化 Migration V2 | Migration    | P0           | 全量备份与 rollback | 故障注入恢复        |
| **P6-603**  | 真实 Golden Samples | QA/Design    | P1-P5        | 三套完整样本        | 评分和证据通过      |
| **P6-604**  | 专项文档重写        | Docs         | 所有阶段     | 字段/SOP/故障/验收  | 可独立执行          |
| **P6-605**  | 正式版本发布审查    | Release      | P6-603/604   | 最终验收记录        | 零 blocker/critical |

# 7. 代码级整改清单

| **文件/模块**                                    | **强制改造**                                                                                        |
|--------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| **electron/services/designPipeline.cjs**         | composeVisual 真正调用 renderer；repairUnderlay 真正执行；统一 stale；Final Approval 验证真实输出。 |
| **electron/services/compositor.cjs**             | 从“生成层清单”升级为渲染计划与输出元数据；不得声称已渲染。                                          |
| **src/features/production/CanvasCompositor.tsx** | 接入主 UI；实现 exact/nine-slice/vector；FontFace；错误上报；导出与落盘。                           |
| **electron/services/fidelity.cjs**               | 读取 final PNG 与资产文件；重算哈希；布局/像素/字体/9-slice 检查。                                  |
| **electron/services/underlayCritique.cjs**       | 接收真实 deterministic metrics；映射 busyness/contrast；记录证据与阈值。                            |
| **electron/services/underlayRepair.cjs**         | 增加任务执行状态与 Provider 调用输入，不只 plan。                                                   |
| **electron/services/typographyAssets.cjs**       | 修复格式支持；授权与 exact 分离；实际加载验证。                                                     |
| **electron/services/componentKit.cjs**           | 文件存在、透明、状态、9-slice 中心、当前哈希、Forge Manifest。                                      |
| **electron/services/contracts.cjs**              | Screen Control 对象化；Style 2.0 数值校验；新 Artifact 全量校验。                                   |
| **electron/services/projectStore.cjs**           | 每 Screen 输入、Composition Output、完整历史和事务迁移支持。                                        |
| **electron/services/migrations.cjs**             | 完整项目备份、临时目录、失败 rollback、幂等。                                                       |
| **electron/services/artifactDependencies.cjs**   | 成为唯一 stale 事实来源；覆盖 mode/asset/provider/waiver。                                          |
| **src/features/\***                              | 按 reference/typography/component-kit/screens/bindings/layout/underlay/production/fidelity 拆分。   |
| **src/App.tsx**                                  | 移除领域实现，只保留导航、全局状态和工作台装配。                                                    |
| **scripts/smoke-\***                             | 增加 strict E2E smoke，而非只测普通 Artifact 和普通生图。                                           |
| **.github/workflows/\***                         | 新增 CI、fixture E2E、依赖/秘密扫描和构建产物验证。                                                 |

# 8. 测试与验收体系

## 8.1 自动化测试分层

| **测试层**                    | **必须证明**                                                         |
|-------------------------------|----------------------------------------------------------------------|
| **Unit**                      | 契约、ID、hash、9-slice 数学、字体解析、Reference Pack、stale 传播。 |
| **Renderer Pixel**            | exact/nine-slice/text 对固定素材生成确定像素输出并做 patch 对比。    |
| **Pipeline Integration**      | 真实文件系统中完成 strict 流程，不使用 mock 最终结果。               |
| **Provider Integration**      | 真实 Critique、Underlay Generation、Repair/Inpaint 或 Regenerate。   |
| **Migration Fault Injection** | 每个迁移写入点故障后验证完整恢复。                                   |
| **UI E2E**                    | 用户通过界面完成多 Screen、字体、组件、Binding、Underlay、Final。    |
| **Golden Visual**             | 真实图片样本 + 设计师评分 + 最终 PNG。                               |

## 8.2 强制验收场景

| **ID**    | **场景**          | **通过条件**                                               |
|-----------|-------------------|------------------------------------------------------------|
| **AC-01** | Final PNG 存在性  | 删除 final PNG 后 Fidelity 与 Final Approval 必须失败。    |
| **AC-02** | 9-slice           | 大幅拉伸按钮后四角 patch 不变，边缘仅单轴拉伸。            |
| **AC-03** | 真实字体          | FontFace 加载失败时 strict Final 必须失败，不得 fallback。 |
| **AC-04** | 授权              | license unresolved 时 preview 可用，Final 不可用。         |
| **AC-05** | Critique 污染     | 真实按钮残影、假导航、假文字均被自动定位。                 |
| **AC-06** | Critique 繁忙背景 | 无类按钮但 Slot 高频纹理/高光冲突时不得 auto-pass。        |
| **AC-07** | Repair            | Critique failed 后产生新 Underlay，自动 Re-critique。      |
| **AC-08** | 资产篡改          | 修改组件或字体文件后 Fidelity stale/failed。               |
| **AC-09** | Stable Control ID | 修改 label 不改变 Binding。                                |
| **AC-10** | 多 Screen         | 两个页面有独立 Wireframe、Artifact 和阶段状态。            |
| **AC-11** | Mode Change       | guided 切 strict 后所有不兼容结果 stale。                  |
| **AC-12** | Migration Failure | 故障注入后项目树完全恢复。                                 |
| **AC-13** | Export            | 导出文件哈希等于 Composition Output。                      |
| **AC-14** | CI                | PR 未通过任一门禁不得合并。                                |

## 8.3 真实 Golden Samples 要求

- 功能密集型：背包/养成，至少 10 个必要控件，包含数字字体、列表和批量操作。

- 视觉主导型：首页/活动/抽卡，包含主视觉与关键 Slot 穿越风险。

- 已有项目延展型：至少 3 张批准参考页、8 个公共组件家族、4 个字体角色。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>每组样本必须保存的证据</strong></p>
<p>原始参考图、Wireframe、Reference Pack、Font/Component Contract、Underlay Contract、Review Overlay、污染 Underlay、Critique 原始输出、Repair 前后版本、Final PNG、Composition Manifest、Fidelity Report、测试日志和设计师评分。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 9. 本次执行中暴露的问题与规避规则

| **问题模式**               | **本次表现**                           | **永久规避规则**                                                           |
|----------------------------|----------------------------------------|----------------------------------------------------------------------------|
| **把控制面当生产面**       | Manifest/Task/Gate 存在就宣布功能完成  | 为每项能力定义“真实输出证据”；无文件、无像素、无 Provider 执行则不算完成。 |
| **测试替身过度**           | 手写 semantic JSON 验证 Gate           | 区分 detector test 与 gate test；Golden 必须用真实图片和真实模型。         |
| **前端默认代替用户确认**   | 导入字体即 confirmed/exact             | 授权、exact、waiver 均要求显式用户动作和审计记录。                         |
| **事实来源重复**           | 旧 invalidateDownstream 与新依赖图并存 | 只保留一个依赖传播引擎，所有调用走同一入口。                               |
| **功能命名夸大**           | “合成”实际只生成 Manifest              | UI、文档、Artifact 名称必须与真实行为一致。                                |
| **文件存在不等于内容完成** | 多个专项文档仅 1 段                    | 文档验收按字段、流程、错误码、示例和 SOP，而不是按文件名。                 |
| **版本发布过早**           | 本地自报通过即正式发布                 | 要求 CI、真实样本、独立设计师签核和零阻断。                                |
| **数据层与 UI 脱节**       | 多 Screen 后端存在但用户不能用         | 每个后端能力必须有用户可执行工作台和 E2E。                                 |
| **声明与渲染不一致**       | font exact 但 Canvas fallback          | Fidelity 检查实际 loaded font 与 renderer 日志。                           |
| **迁移缺少失败设计**       | 只测成功路径                           | 故障注入和 rollback 是迁移 DoD 的一部分。                                  |

# 10. 禁止执行的“伪完成”行为

> **✕** 禁止把 JSON Artifact、Repair Task、Composition Manifest 当作最终图片。
>
> **✕** 禁止导入资产后自动写 confirmed、approved 或 exact。
>
> **✕** 禁止用普通 drawImage 代替 9-slice。
>
> **✕** 禁止字体加载失败后静默使用 sans-serif。
>
> **✕** 禁止用手工构造的 detector 输出替代真实图像检测验收。
>
> **✕** 禁止只跑 smoke-kunpo 与 smoke-image 就宣称 strict E2E 通过。
>
> **✕** 禁止无 final PNG 时生成 passed Fidelity Report。
>
> **✕** 禁止导出 Underlay 并命名为最终结果。
>
> **✕** 禁止保留没有测试覆盖的第二套 stale/状态机逻辑。
>
> **✕** 禁止通过增加同名空文档或空 Feature 目录认定任务完成。
>
> **✕** 禁止在没有设计师真实评分时填写组件/字体/Underlay 4/5。
>
> **✕** 禁止带 blocker、critical 或未解决身份字体发布正式版本。

# 11. PR、评审与责任制度

- PR-1：Release correction + CI + baseline。

- PR-2：Composition Output + exact/nine-slice renderer + final export。

- PR-3：FontFace + typography truth + font format cleanup。

- PR-4：Critique Overlay + deterministic metrics + real Repair。

- PR-5：Pixel-aware Fidelity + Final Approval rewrite。

- PR-6：Reference/Font/Component/Screen/Underlay Workbenches。

- PR-7：Unified stale + transactional migration。

- PR-8：Real Golden Samples + docs + formal release。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>每个 PR 的合并条件</strong></p>
<p>必须包含对应自动化测试、相关文档、错误路径、真实文件证据和变更后的验收记录；不得在同一 PR 混入无关视觉重构或大面积格式化。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 12. 最终完成定义（Definition of Done）

### **真实产物**

> **□** 严格模式生成并保存 final PNG，而非只有 Manifest。
>
> **□** 导出文件与 final PNG 哈希一致。
>
> **□** exact / nine-slice / vector-token 实际渲染正确。

### **字体与组件**

> **□** 身份关键字体 exact、授权确认、真实加载成功。
>
> **□** 公共组件状态、文件、哈希、透明和复用方式均通过。
>
> **□** 必要控件绑定与实际渲染覆盖率均为 100%。

### **Underlay**

> **□** Critique 使用 Underlay + Overlay + 组件板 + deterministic metrics。
>
> **□** Repair 真正生成新 Underlay 并自动复审。
>
> **□** 已知 critical 样本 auto-pass 为 0。

### **Fidelity**

> **□** 报告读取真实 final PNG 和真实资产。
>
> **□** blocker/critical 为 0；major 均解决或合规批准。
>
> **□** stale、文件缺失、哈希篡改、字体 fallback 均能阻断。

### **产品能力**

> **□** 用户可在 UI 完成多 Screen 全流程。
>
> **□** Reference、Typography、Component、Underlay、Fidelity 工作台完整。
>
> **□** 每个 Screen 有独立输入和页面 Artifact。

### **工程与发布**

> **□** CI 在 PR/main 自动执行。
>
> **□** Migration 成功/失败/幂等测试通过。
>
> **□** 三组真实 Golden Samples 和设计师评分通过。
>
> **□** README、CHANGELOG 和专项文档与实际功能一致。
>
> **□** 正式验收记录无未解释 blocker/critical。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>正式发布恢复条件</strong></p>
<p>只有上述 DoD 全部勾选、CI 通过、真实样本完成、设计师签核、最终 PNG 和证据包齐全时，才允许将版本从 alpha 升级为正式版本。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 13. 执行者交付与验收签核模板

| **整改版本**           |               |
|------------------------|---------------|
| **提交 / Tag**         |               |
| **执行日期**           |               |
| **执行负责人**         |               |
| **审查负责人**         |               |
| **CI 结果**            |               |
| **真实 Provider 结果** |               |
| **Golden Samples**     |               |
| **最终 PNG 数量**      |               |
| **blocker / critical** |               |
| **最终结论**           | 通过 / 不通过 |

**签核声明：**本人确认没有以 Manifest、Mock、Task JSON、手工 Detector 输出或本地自报替代真实最终结果；所有通过项均有可复现证据。

执行负责人签字：\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ 日期：\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

审查负责人签字：\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ 日期：\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

UI 设计师签字：\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ 日期：\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

# 附录 A：审计证据索引

| **证据 ID** | **文件/位置**                                                | **可证明事项**                                           | **证据强度** |
|-------------|--------------------------------------------------------------|----------------------------------------------------------|--------------|
| **E-01**    | electron/services/designPipeline.cjs::composeVisual          | 仅创建 Composition Manifest，未生成最终 PNG。            | A            |
| **E-02**    | src/features/production/CanvasCompositor.tsx                 | Canvas 组件存在，但未接主流程，统一 drawImage。          | A            |
| **E-03**    | electron/main.cjs::copilot:visual:export                     | 导出原始 visual variation/Underlay。                     | A            |
| **E-04**    | electron/services/compositor.cjs                             | 生成层计划与 provenance，不负责实际像素输出。            | A            |
| **E-05**    | src/features/strict-continuation/StrictContinuationPanel.tsx | 导入字体时自动传 confirmed/exact。                       | A            |
| **E-06**    | electron/services/typographyAssets.cjs                       | 字体资产、覆盖和 manifest 校验。                         | A            |
| **E-07**    | src/features/production/CanvasCompositor.tsx::text           | 未加载 font_path，fallback 到 family/sans-serif。        | A            |
| **E-08**    | electron/services/underlayRepair.cjs                         | 只生成 Repair Task。                                     | A            |
| **E-09**    | electron/services/designPipeline.cjs::repairUnderlay         | 保存任务并把状态设 in_progress，不执行图片修复。         | A            |
| **E-10**    | electron/services/designPipeline.cjs::critiqueUnderlay       | 真实调用 critiqueModel，但只传 Underlay。                | A            |
| **E-11**    | electron/services/underlayCritique.cjs                       | 支持 deterministic 字段但不计算；部分语义未映射。        | A            |
| **E-12**    | electron/services/underlayWorkflow.test.cjs                  | deterministic metrics 为手写 fixture。                   | B            |
| **E-13**    | electron/services/fidelity.cjs                               | 主要检查 Manifest、hash 格式和 stale。                   | A            |
| **E-14**    | electron/services/referencePack.cjs                          | Pack 排序与 omitted 记录。                               | A            |
| **E-15**    | src/App.tsx::StyleWorkspace                                  | 参考图 UI 无 Inventory/Pack 审批与 omitted 预览。        | A            |
| **E-16**    | electron/services/prompts.cjs::screenContractPrompt          | required_controls 仍是 string\[\]。                      | A            |
| **E-17**    | electron/services/componentBindings.cjs                      | 控件 ID 从文本 slug 生成。                               | A            |
| **E-18**    | electron/services/componentKit.cjs                           | 基础组件导入与校验。                                     | A            |
| **E-19**    | StrictContinuationPanel.tsx                                  | 只有简化导入/绑定面板。                                  | A            |
| **E-20**    | electron/services/projectStore.cjs                           | 后端多 Screen Registry 和独立目录。                      | A            |
| **E-21**    | src/App.tsx                                                  | 主界面仍显示 1 个页面，无 Screen Manager。               | A            |
| **E-22**    | electron/services/artifactDependencies.cjs                   | 新依赖图。                                               | A            |
| **E-23**    | designPipeline.cjs::invalidateFromInputChange                | 输入变化仍使用旧失效逻辑。                               | A            |
| **E-24**    | electron/services/migrations.cjs                             | 只备份 project/workflow JSON。                           | A            |
| **E-25**    | electron/services/migrations.test.cjs                        | 只覆盖成功路径。                                         | B            |
| **E-26**    | electron/services/goldenSamples.test.cjs                     | 根据 known_issues 手工构造 semantic。                    | B            |
| **E-27**    | docs/golden-samples/\*.json                                  | 样本为单行 JSON，无真实图片。                            | A            |
| **E-28**    | docs/baseline/final-acceptance-0.2.0.md                      | 执行者本地 43 测试和 Smoke 自报。                        | C            |
| **E-29**    | docs/\*.md 专项说明                                          | 多份文档仅简短摘要。                                     | A            |
| **E-30**    | src/features/                                                | 仅 production 和 strict-continuation 两个 Feature 目录。 | A            |

# 附录 B：最终验收输出包目录

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>release-evidence/<br />
├── ci/<br />
│ ├── lint.txt<br />
│ ├── test.txt<br />
│ ├── build.txt<br />
│ └── security-scan.txt<br />
├── migration/<br />
│ ├── success.log<br />
│ ├── rollback.log<br />
│ └── idempotency.log<br />
├── golden-samples/<br />
│ ├── functional-dense/<br />
│ ├── visual-hero/<br />
│ └── existing-continuation/<br />
│ ├── references/<br />
│ ├── wireframe.png<br />
│ ├── components/<br />
│ ├── fonts/<br />
│ ├── underlay-before.png<br />
│ ├── review-overlay.png<br />
│ ├── critique.json<br />
│ ├── underlay-after.png<br />
│ ├── final.png<br />
│ ├── composition-manifest.json<br />
│ ├── fidelity-report.json<br />
│ └── designer-signoff.md<br />
└── final-acceptance.md</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 附录 C：最终结论

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>当前结论</strong></p>
<p>本次升级方向正确，执行投入真实，但未完成任务文档要求的全部生产能力。当前项目只能作为严格继承架构原型，不得作为正式生产版本验收。执行者必须按本文关闭所有 P0/Blocker 和 Critical 项，再进行第二轮独立验收。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>
