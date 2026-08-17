
# Game UI Design Copilot 已有项目风格继承改造任务计划（订正版）

## 0. 文档信息

| 项目     | 内容                                                                  |
| ------ | ------------------------------------------------------------------- |
| 目标仓库   | https://github.com/z806738350-source/Game-UI-Design-Projects        |
| 竞品仓库   | https://github.com/guiguiyan930-source/game-ui-design-workflow      |
| 建议入库路径 | `docs/EXISTING-STYLE-CONTINUATION-REFACTOR-PLAN.md`                 |
| 文档版本   | 1.1                                                                 |
| 文档状态   | 执行基线                                                                |
| 建议目标版本 | `0.2.0`                                                             |
| 适用对象   | 产品负责人、技术负责人、Electron/Node 开发、前端开发、AI 工作流开发、UI 设计师、测试人员              |
| 改造主题   | 解决已有游戏 UI 延展时“整体氛围正确，但通用部件、文字及其与背景关系发生漂移”的问题                        |
| 完成标准   | 本文所有“必须”项完成；自动化测试、迁移测试、真实样本验收全部通过；不存在未处理的 blocker/critical 问题       |
| 技术基线   | 保留现有 Electron + React + TypeScript + Vite + Node Test 架构，不进行无关技术栈迁移 |

### 0.1 修订记录

|   |   |
|---|---|
|版本|修订内容|
|1.0|建立 Component Contract、组件绑定、多 Screen、确定性装配、Fidelity Gate 等总体改造方案|
|1.1|新增 Underlay Contract、自动 Underlay Critique、Underlay 修复闭环、Typography Asset Gate、字体授权与替代策略、Slot 背景语义及结构引导图；同步更新目标、工作流、Artifact、任务、验收和发布标准|

---

# 1. 文档使用规则

本计划是本轮改造的权威执行依据。执行者可以调整内部函数名、类名、目录细节和 UI 组件拆分，但不得擅自改变以下原则：

1. 已有项目默认采用 `existing-strict` 严格继承模式。
    
2. `Component Contract` 是公共组件身份、状态、资产及复用方式的唯一事实来源。
    
3. `Font Manifest` 是实际字体资产、授权状态和文字角色绑定的唯一事实来源。
    
4. `Underlay Contract` 是 AI 底图为组件槽位预留视觉空间的唯一事实来源。
    
5. 公共组件优先确定性复用，不允许继续依赖整屏模型自由重绘。
    
6. 正式 UI 文字优先确定性渲染，不允许把图片模型生成的文字当作最终交付文字。
    
7. Underlay 在进入合成前必须经过自动 Critique；严格模式不得仅靠人工肉眼发现污染。
    
8. 所有门禁必须由后端逻辑执行，不能只在界面文案或按钮禁用状态中提示。
    
9. 上游 Artifact 修改后，下游 Artifact 必须正确标记为 `stale`。
    
10. 所有参考图选择、结构引导图、组件来源、字体来源、提示词、模型、版本和最终结果必须可追踪。
    
11. 不得为了兼容旧逻辑而静默降级、静默截断、静默忽略缺失组件、缺失字体或 Critique 失败。
    
12. 最终验收不得以“接口调用成功”代替视觉质量和工程可复现性验收。
    
13. 任意偏离本文的架构决策，必须新增 ADR，并说明原因、影响、替代方案和替代验收标准。
    

建议 ADR：

```
docs/decisions/
├── ADR-001-existing-project-strict-mode.md
├── ADR-002-component-contract-source-of-truth.md
├── ADR-003-deterministic-compositor.md
├── ADR-004-project-schema-v2-migration.md
├── ADR-005-underlay-contract-and-critique.md
└── ADR-006-typography-asset-gate.md
```

---

# 2. 执行摘要

当前工具擅长从已有页面提取色彩、材质、光照和整体氛围，但仍会重新生成按钮、面板、页签、图标、导航和文字，因此出现“氛围对、部件漂”的结果。

仅增加更严格的提示词不能根治该问题。本轮改造必须建立以下完整闭环：

```
已有页面分析
→ Style Contract
→ Font Manifest
→ Component Contract
→ 页面控件与组件绑定
→ 组件感知型布局
→ Underlay Contract
→ 结构引导图 / Mask
→ AI Underlay 生成
→ 自动 Underlay Critique
→ 局部修复 / 重新生成 / 人工复核
→ 公共组件与文字确定性合成
→ Fidelity Gate
→ 页面批准
```

本轮需要同时解决三个层面的漂移：

1. **组件漂移**：公共组件轮廓、比例、状态和图标语言不一致。
    
2. **字体漂移**：没有真实字体资产时，确定性排版仍会被设计师一眼识别为错误字体。
    
3. **组件与背景关系漂移**：即使组件本身正确，Underlay 若在 Slot 背后过于繁忙、出现按钮残影或主体穿越，也会导致最终合成违和。
    

因此，严格继承的完成定义不是“模型生成了一张风格相似的整屏图”，而是：

```
正确的组件资产
+ 正确或明确降级的字体资产
+ 正确的布局槽位
+ 为槽位准备好的 Underlay
+ 可审计的自动 Critique
+ 可复现的确定性合成
```

---

# 3. 背景与问题定义

## 3.1 当前应保留的能力

当前工程已经具备以下正确基础，不应推倒重写：

- Artifact 驱动的阶段式工作流。
    
- `schema_version`、`id`、`version`、`status`、`source` 等公共字段。
    
- 人工批准门禁。
    
- 上游变更后的下游失效传播。
    
- Artifact 历史版本保存。
    
- 多模态理解与异步图片生成接入。
    
- 模型结构化输出解析、校验和自动修复。
    
- Electron 本地工作区和主进程密钥管理。
    
- `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm quick-start:check` 等工程检查命令。
    

## 3.2 当前核心问题

### 3.2.1 已有项目分支结束过早

当前已有项目仅在 Style Resolution 阶段与新项目分叉。Style Contract 完成后，仍使用与新项目相同的整屏视觉探索流程。

### 3.2.2 视觉任务主动鼓励组件差异

现有 `visualTask()` 中，`expressive`、`innovative` 以及“通过 component treatment 产生差异”的要求，会主动促使模型改变通用组件。

### 3.2.3 参考图角色在最终生图时丢失

项目类型已经保存 `primary`、`component`、`material`、`composition`、`supporting` 等角色，但最终视觉生成阶段仍把所有图片平铺为普通 `images` 数组。

### 3.2.4 参考图存在静默截断

图片客户端会截取前若干张参考图。被丢弃的组件参考不会形成明确错误、遗漏清单或人工确认。

### 3.2.5 Style Contract 无法表达组件身份

当前 `components` 只要求是一个对象，不能充分表达组件来源、轮廓、尺寸、状态、锁定属性和复用方式。

### 3.2.6 Screen Contract 只有控件名称

`required_controls` 为字符串数组，不能表达“保存按钮必须使用 `button.primary` 的 default 状态”。

### 3.2.7 项目数据仍围绕单一 `main` Screen

现有项目结构更接近单屏视觉探索器，不具备完整的多页面组件复用和依赖管理。

### 3.2.8 Underlay 会污染最终组件区域

即使提示词禁止 UI，图片模型仍可能生成：

- 按钮、页签、导航或货币栏残影；
    
- 假文字和数字；
    
- 规则化的 UI 类框体；
    
- 主体、武器、建筑边缘穿过组件 Slot；
    
- 过强高光、高频纹理或复杂装饰，使正式组件叠加后违和。
    

仅将此问题交给人工验收，会造成大量重复检查和漏检。

### 3.2.9 字体资源缺失会破坏严格保真

字号、字重、描边和阴影不能替代真实字体字形。没有真实字体文件或可靠授权来源时，fallback 即使排版正确，也不能诚实地称为严格继承。

### 3.2.10 布局只描述“组件放在哪里”，未描述“背景应该怎样承载组件”

如果 Provider 不支持 Control Image、Mask 或 Region Prompt，仅靠文字描述区域，Underlay 很可能没有为 Slot 留出低干扰区域。

## 3.3 根因结论

本问题不是单纯的提示词问题，而是缺少四类事实层：

1. **组件事实层**：Component Contract。
    
2. **字体事实层**：Font Manifest。
    
3. **槽位背景事实层**：Underlay Contract。
    
4. **生成后验证层**：Underlay Critique + Fidelity Report。
    

---

# 4. 改造目标

## 4.1 总体目标

将当前工具从“已有风格参考下的整屏视觉探索工具”，升级为：

> 具备已有项目视觉反向工程、字体与组件资产锁定、多页面延展、Underlay 受控生成、自动污染审查、确定性装配和最终保真验收能力的游戏 UI 设计生产工具。

## 4.2 必须达成的产品目标

### G1. 已有项目严格继承

已有项目默认进入 `existing-strict` 模式：

- 公共组件不得被图片模型自由重新设计。
    
- 公共组件必须绑定到已批准组件家族和状态。
    
- 页面差异主要来自布局、内容、主视觉和页面专属装饰。
    
- 不允许通过改变公共组件轮廓制造方案差异。
    
- 缺少关键组件资产时，不得伪装为严格继承成功。
    

### G2. 建立 Component Contract

Component Contract 必须覆盖：

- 组件家族、变体、状态；
    
- 组件资产和来源证据；
    
- 固有尺寸和缩放规则；
    
- 9-slice；
    
- 圆角、描边、材质、光向；
    
- 图标视角；
    
- 文本策略；
    
- 锁定属性；
    
- 适用页面和批准状态。
    

### G3. 建立 Typography Asset Gate

新增 Font Manifest，负责：

- 实际字体文件路径和哈希；
    
- 家族名、PostScript 名；
    
- 授权状态；
    
- 中文、拉丁、数字和符号覆盖；
    
- 字体角色绑定；
    
- `exact`、`approved-substitute`、`unresolved` 状态；
    
- 身份关键文字门禁。
    

身份关键字体未解决时：

- 允许继续 Screen、Binding、Layout 和 Underlay 阶段；
    
- 允许生成带明显水印的 Preview Composition；
    
- 不允许最终 Typography Composition 通过；
    
- 不允许 Fidelity Report 变为 `passed`；
    
- 不允许最终页面批准为严格继承。
    

### G4. 页面控件必须绑定组件

每个必要控件必须二选一：

1. 绑定到已批准 `component_id`；
    
2. 明确标记为页面专属组件，并经过单独批准。
    

不得存在“必要控件未绑定，但仍继续生成”的情况。

### G5. 组件约束必须参与布局

已有项目 Layout Proposal 必须同时读取：

- Functional Screen Contract；
    
- Style Contract；
    
- Component Contract；
    
- Component Bindings；
    
- 字体角色和文字尺寸约束；
    
- 组件固有尺寸、缩放和 9-slice 约束；
    
- 目标画布和安全区。
    

### G6. 建立 Underlay Contract

每个页面在 Underlay 生成前必须有 Underlay Contract，明确：

- 主视觉区域；
    
- Reserved Regions；
    
- Slot 保护边距；
    
- 背景细节等级；
    
- 禁止主体穿越；
    
- 禁止 UI 类形状；
    
- 明暗与对比角色；
    
- 结构引导图或 Mask 策略。
    

### G7. 增加自动 Underlay Critique

Underlay 在进入合成前必须自动检查：

- Slot 内和 Slot 周边的类组件图形；
    
- 全画布多余 UI；
    
- 类文字与类数字；
    
- 主体穿越；
    
- 背景繁忙度；
    
- 局部对比冲突；
    
- 强边缘和高光；
    
- 与公共组件缩略图相似的重复轮廓。
    

严格模式中，Underlay Critique 未通过时，后端不得进入最终合成。

### G8. 建立 Underlay 修复闭环

检测到污染后，处理顺序必须为：

```
支持 Mask/Inpaint
→ 局部修复

不支持局部修复
→ 携带 Critique 证据重新生成

自动重试后仍失败
→ 人工修改或切换模型

确认误报
→ 记录人工豁免及理由
```

### G9. 公共组件和文字确定性复用

严格模式中：

- 按钮、面板、卡片、页签、导航、图标、资源栏由确定性渲染或已有资产装配；
    
- 正式文字由确定性文字系统渲染；
    
- 图片模型主要负责背景、角色、场景、页面专属插画和装饰；
    
- 不允许把模型生成的公共 UI 或正式文字直接用于最终交付。
    

### G10. 增加 Final Fidelity Gate

最终页面批准前必须满足：

- 必要控件映射覆盖率 100%；
    
- Underlay Critique 已通过或有明确人工豁免；
    
- 所有公共组件来源可追踪；
    
- 所有字体角色状态明确；
    
- 所有组件状态正确；
    
- 不存在越界、非法拉伸、错误状态、错误家族或文字策略违规；
    
- 不存在 blocker/critical；
    
- 所有人工审核项完成。
    

### G11. 支持真正的多页面项目

项目必须支持：

- 多个 Screen；
    
- 新建、重命名、复制、归档和切换；
    
- 每个 Screen 独立的功能、绑定、布局、Underlay、Composition 和 Fidelity Artifact；
    
- 全局 Style、Font、Component Contract 由多个 Screen 共享；
    
- 全局变更影响相关页面；
    
- 页面局部变更不污染无关页面。
    

### G12. 保留新项目探索能力

新项目首次视觉探索仍允许 `conservative`、`expressive`、`innovative`、`balanced`。当基准页批准后，可建立 Component Kit 并切换到 `locked-continuation`。

---

# 5. 成功指标

|   |   |
|---|---|
|指标|必须达到的结果|
|必要控件绑定覆盖率|100%|
|未绑定必要控件数量|0|
|参考图静默截断次数|0|
|严格模式公共组件自由重绘次数|0|
|严格模式身份关键字体 unresolved 数量|0|
|exact / nine-slice / vector-token 组件来源可追踪率|100%|
|Underlay Contract 生成率|100%|
|Underlay Critique 生成率|100%|
|带已知 critical 污染的 Golden Sample 被自动通过次数|0|
|Final Fidelity Report 生成率|100%|
|带 blocker/critical 页面被批准次数|0|
|新项目关键回归通过率|100%|
|旧项目迁移成功率|100%|
|自动化测试通过率|100%|
|三组真实业务样本关键组件严重漂移数|0|
|三组样本关键 Slot 严重背景冲突数|0|
|设计师组件保真评分|每个样本不低于 4/5|
|设计师字体保真评分|exact 字体样本不低于 4/5；substitute 必须明确标记，不计入 strict 通过|
|设计师整体可用性评分|每个样本不低于 4/5|

## 5.1 组件保真评分

|   |   |
|---|---|
|评分|定义|
|5|公共组件与已有项目一致，除页面内容外无可感知漂移|
|4|少量非关键装饰差异，但组件身份、轮廓、状态和层级一致|
|3|圆角、描边、比例、图标或状态存在明显差异，需要人工修改|
|2|多个公共组件被重新设计，不能直接用于延展|
|1|仅整体氛围接近，组件系统基本不一致|

## 5.2 Underlay 适配评分

|   |   |
|---|---|
|评分|定义|
|5|所有 Slot 背后低干扰、无污染、对比合理，合成自然|
|4|少量非关键区域略繁忙，但不影响组件识别和层级|
|3|至少一个关键 Slot 存在明显高频纹理、主体穿越或对比冲突|
|2|多个 Slot 有按钮残影、假导航或严重背景竞争|
|1|Underlay 无法作为可用底图|

## 5.3 严重问题定义

以下任一情况均为 serious issue：

- 主按钮使用错误组件家族；
    
- 导航或页签状态错误；
    
- 公共图标使用错误视角或底板；
    
- 公共组件被非等比拉伸；
    
- 9-slice 边角形变；
    
- 必要控件缺失；
    
- Underlay 中出现重复按钮、假导航或正式文字残影；
    
- 主体或强边缘穿过关键 Slot；
    
- Slot 背后复杂度导致主操作不可识别；
    
- 身份关键字体使用未批准 fallback；
    
- 公共组件文字由图片模型生成且不可编辑；
    
- 组件、字体或参考图来源不可追踪；
    
- 参考图被静默丢弃；
    
- Underlay Critique/Fidelity 未通过却被批准。
    

---

# 6. 范围与边界

## 6.1 本轮必须包含

1. `existing-strict`、`existing-guided`、`exploration`、`locked-continuation` 模式。
    
2. Reference Inventory 和角色化 Reference Pack。
    
3. Provider Capabilities。
    
4. Style Contract 2.0。
    
5. Font Manifest 和 Typography Asset Gate。
    
6. Component Contract。
    
7. Component Kit 资产导入和人工映射。
    
8. Game UI Forge 组件 Manifest 导入接口。
    
9. 多 Screen 项目结构。
    
10. Component Bindings。
    
11. 组件感知型 Layout。
    
12. Slot Underlay Policy。
    
13. Underlay Contract。
    
14. 结构引导图、Mask 或 Region 策略。
    
15. 已有项目专用 Underlay 视觉任务。
    
16. 自动 Underlay Critique。
    
17. Underlay 修复/重生成闭环。
    
18. 公共组件确定性合成。
    
19. 正式 UI 文字确定性渲染。
    
20. Composition Manifest。
    
21. Fidelity Report。
    
22. 后端强制门禁。
    
23. 完整失效传播。
    
24. 旧项目数据迁移。
    
25. 单元、集成、迁移、Golden Sample 和真实 Provider 验收。
    
26. 用户文档、开发文档和发布说明。
    

## 6.2 本轮不包含

- 完整 Figma 编辑器或 Figma 原生文件生产；
    
- Unity、Godot、Cocos 原生工程导入；
    
- 完整 Sprite Atlas 和引擎 JSON 流程；
    
- 自动训练 LoRA 或定制模型；
    
- 多租户服务器；
    
- 跨进程图片任务恢复队列；
    
- 完整视频和动效生成；
    
- 全自动组件语义识别；
    
- 全自动 9-slice 推断；
    
- 从任意截图自动获得完全可用的透明组件资产；
    
- 自动识别真实商业字体名称并绕过授权；
    
- 未授权第三方游戏 UI 的商业复刻；
    
- 与本问题无关的技术栈升级或 UI 全量重写。
    

## 6.3 与 Game UI Forge 的边界

本项目需要支持：

```
Game UI Forge 输出
→ 组件 PNG / SVG
→ 组件语义 Manifest
→ Game UI Design Copilot Component Contract
```

本轮不在当前项目中重新实现完整的自动元素检测、雪碧图切割、ZIP、Atlas 和引擎导出。

没有 Game UI Forge 输出时，当前项目必须提供人工导入、裁切、命名和状态映射流程。

## 6.4 版权、隐私与字体边界

- 用户必须确认对参考页面、组件资产和字体拥有使用权或合法授权。
    
- 严格继承模式仅用于用户拥有或获授权的项目。
    
- 不得在日志、测试夹具或公开仓库中提交未经授权的商业游戏资产和字体文件。
    
- 字体二进制不得写入 JSON、日志或远程提示词。
    
- 默认不得向外部模型上传字体文件。
    
- API Key 必须继续只在 Electron 主进程读取。
    
- 每次向模型发送哪些图片必须可查看、可追踪。
    

---

# 7. 竞品、对标与替代方案

|   |   |   |   |   |
|---|---|---|---|---|
|对象|优势|不足|本项目应采用|不应照搬|
|`game-ui-design-workflow`|Style、Screen、Component、Manifest 分层清楚，强调单一事实来源和资产交付|主要是 Agent 工作流；自动视觉相似度和 Underlay Critique 有限|多契约架构、组件事实层、资产追踪、门禁和校验器|不应认为只有 YAML 和提示词就能消除漂移|
|当前 Game UI Design Copilot|独立桌面产品；真实多模态和生图；Artifact、历史和失效传播较好|单 Screen；组件无身份；无字体资产门禁；整屏自由生图；无 Underlay Critique|保留产品化、任务执行和状态管理能力|不再沿用“旧项目只在 Style Resolution 分叉”|
|Figma 类设计系统|组件实例、Variant、Token、自动布局和确定性复用成熟|AI 需求理解和玩法推理较弱|学习组件实例不可自由重绘、字体和 Token 为事实来源|不在本轮实现完整设计工具|
|纯图片生成工具|探索快、视觉冲击强|组件、文字、状态和布局重复稳定性差|用于背景、角色、场景和页面专属视觉|不用于最终公共组件和正式文字|
|Game UI Forge|组件提取、切图、Manifest 和交付能力适合资产侧|不负责需求、布局、多页面和最终组装|作为 Component Kit 资产来源|不合并成一个巨型工作台|

改造后的竞争定位：

> 比纯生图工具更稳定，比纯设计系统更自动化，比 Agent 文档工作流更产品化，并通过 Component Contract、Font Manifest、Underlay Contract、自动 Critique、确定性装配和 Fidelity Gate 解决多页面连续延展中的部件、文字和背景关系漂移。

---

# 8. 核心设计原则

## 8.1 契约优先于提示词

提示词只能辅助理解，不能成为组件、字体或 Slot 背景语义的唯一载体。

## 8.2 复用优先于重新生成

公共组件处理优先级：

```
原始组件资产
> 9-slice 资产
> 矢量/Token 确定性渲染
> 已批准裁切参考下的受限生成
> 自由生成
```

严格模式禁止最后一级。

## 8.3 正式文字与图片生成分离

AI 生成底图中不得包含最终正式文字。文字必须通过已批准 Font Manifest 和 Typography Contract 渲染。

## 8.4 布局不仅定义位置，还定义背景承载条件

每个关键 Slot 必须定义 Underlay Policy，说明其背后需要低细节、暗化、禁止主体穿越或其他视觉处理。

## 8.5 自动 Critique 负责筛查，人工负责最终判断

多模态 Critique 必须给出坐标、类型、证据和严重程度；低置信度或语义模糊项进入人工复核。不得将 Critique 模型自报 confidence 当作客观概率。

## 8.6 生成模型与 Critique 模型解耦

优先使用不同模型；条件不允许时，至少使用独立系统提示词、独立上下文和证据框输出。

## 8.7 明确降级，不静默降级

缺组件、缺字体或 Critique 失败时，必须阻止相关门禁并列出处理选项，不得自动改用自由生图或未批准 fallback。

## 8.8 已批准 Artifact 不覆盖

任何修改必须增加版本、保存历史、标记下游 `stale`，并保留来源关系。

## 8.9 一个页面一次生产

多 Screen 项目仍采用逐页批准流程，不引入未经人工检查的大批量最终生成。

---

# 9. 目标工作流

## 9.1 项目模式

```
type ContinuationMode =
  | 'exploration'
  | 'existing-strict'
  | 'existing-guided'
  | 'locked-continuation';
```

规则：

- 新项目默认 `exploration`。
    
- 已有项目默认 `existing-strict`。
    
- 已批准基准页的新项目可切换为 `locked-continuation`。
    
- `existing-guided` 只能由用户显式选择。
    
- 模式变化必须使不兼容的下游 Artifact 失效。
    

## 9.2 已有项目目标流程

```
项目输入
→ 参考图清点与角色设置
→ Reference Inventory 批准
→ Functional Screen Contract
→ Style Resolution
→ Typography Resolution
→ Component Resolution
→ Component Kit 批准
→ 页面控件与组件绑定
→ Component-aware Layout
→ Approved Layout
→ Underlay Contract
→ Layout Guide / Mask
→ Underlay Generation
→ Automatic Underlay Critique
→ Repair / Regeneration / Manual Review
→ Deterministic Component Composition
→ Deterministic Typography Composition
→ Final Fidelity Review
→ 页面批准
```

## 9.3 新项目目标流程

```
项目输入
→ Functional Screen Contract
→ Layout Proposal
→ Style Resolution
→ Visual Exploration
→ 基准页批准
→ 可选建立 Font/Component Kit
→ 后续页面进入 locked-continuation
```

## 9.4 全局阶段与页面阶段

全局阶段：

```
input
reference_analysis
style_resolution
typography_resolution
component_resolution
```

页面阶段：

```
screen_definition
component_binding
layout_design
underlay_specification
underlay_generation
underlay_review
composition
fidelity_review
```

`workflow/state.json` 必须区分：

```
{
  "global_stages": {},
  "screen_stages": {
    "main": {},
    "inventory": {},
    "shop": {}
  },
  "active_screen_id": "inventory"
}
```

---

# 10. 目标项目目录

```
project/
├── project.json
├── inputs/
│   ├── requirement.md
│   └── wireframe.*
├── style/
│   ├── reference-inventory.json
│   ├── reference-pack.json
│   ├── style-contract.json
│   ├── font-manifest.json
│   ├── component-contract.json
│   ├── references/
│   ├── fonts/
│   └── components/
│       ├── button-primary/
│       │   ├── default.png
│       │   ├── pressed.png
│       │   └── disabled.png
│       └── navigation-back/
│           └── default.png
├── screens/
│   ├── index.json
│   ├── main/
│   │   └── ...
│   └── inventory/
│       ├── screen-contract.json
│       ├── component-bindings.json
│       ├── layout-proposals.json
│       ├── approved-layout.json
│       ├── reference-pack.json
│       ├── underlay-contract.json
│       ├── underlay-layout-guide.png
│       ├── visual-task.json
│       ├── underlay-critique.json
│       ├── composition-manifest.json
│       ├── fidelity-report.json
│       ├── underlays/
│       │   ├── underlay-v1.png
│       │   └── underlay-v2.png
│       ├── compositions/
│       │   ├── preview-v1.png
│       │   └── final-v1.png
│       └── explorations/
│           └── results.json
└── workflow/
    ├── state.json
    ├── artifact-history.json
    ├── migration-log.json
    └── history/
```

---

# 11. Artifact 与数据契约

所有新增 Artifact 必须保留：

```
{
  "schema_version": "2.0",
  "id": "stable-id",
  "version": 1,
  "status": "draft",
  "source": {}
}
```

Artifact 状态：

```
draft
generated
reviewed
approved
rejected
stale
```

工作流阶段可额外使用：

```
blocked
in_progress
failed
```

## 11.1 Reference Inventory

```
{
  "assets": [
    {
      "id": "reference-home",
      "path": "style/references/home.png",
      "role": "primary",
      "approved": true,
      "screen_type": "home",
      "contains": ["navigation", "currency-bar", "primary-button"],
      "notes": ""
    }
  ]
}
```

要求：

- 每张图必须有唯一 ID、角色、批准状态和用途说明。
    
- 未设置角色的图不得进入严格模式最终任务。
    

## 11.2 Reference Pack 2.0

逻辑上必须按角色分组：

```
{
  "purpose": "underlay-generation",
  "provider_limit": 6,
  "groups": {
    "structure_guides": [],
    "component_references": [],
    "style_references": [],
    "material_references": [],
    "composition_references": []
  },
  "selected": [],
  "omitted": [],
  "capacity_decision": {
    "used": 6,
    "limit": 6
  },
  "wireframe_strategy": "structured-layout-only"
}
```

要求：

- 选择算法确定性。
    
- 记录 selected、omitted 和原因。
    
- 不得存在业务层静默 `.slice(0, N)`。
    
- Provider 上限来自能力配置。
    
- Wireframe 默认不作为普通风格图。
    
- 结构引导图不得被当作视觉风格来源。
    

默认优先级：

```
structure guide（若 Provider 需要）
→ component
→ primary
→ material
→ composition
→ supporting
```

## 11.3 Provider Capabilities

```
{
  "max_reference_images": 6,
  "supports_mask": false,
  "supports_control_image": false,
  "supports_region_prompts": false,
  "supports_inpaint": false,
  "supports_multiple_image_roles": false
}
```

Provider 能力变化必须使相关 Reference Pack、Visual Task 和 Repair Task 失效。

## 11.4 Style Contract 2.0

只负责全局视觉规则：

- 平台、画布、安全区；
    
- 颜色、间距、圆角等级、描边等级；
    
- 材质、光向、阴影、高光；
    
- 图标全局视角；
    
- 页面密度；
    
- 全局文字效果 Token；
    
- 全局负面限制。
    

不得接受“高级金色”“适当圆角”“有质感”等无法执行的模糊值。

Component Contract 建立后，Style Contract 不能重复定义具体组件家族。

## 11.5 Font Manifest

```
{
  "schema_version": "2.0",
  "id": "project-font-manifest",
  "version": 1,
  "status": "approved",
  "fonts": [
    {
      "id": "font-ui-body",
      "family_name": "Example UI Sans",
      "postscript_name": "ExampleUISans-Regular",
      "source_type": "user-provided",
      "local_path": "style/fonts/example-ui-sans.otf",
      "file_hash": "sha256:...",
      "license_status": "confirmed",
      "coverage": {
        "zh_cn": true,
        "latin": true,
        "digits": true,
        "symbols": true
      }
    }
  ],
  "roles": {
    "display-title": {
      "font_id": "font-display",
      "fidelity_mode": "exact",
      "identity_critical": true
    },
    "button-label": {
      "font_id": "font-ui-body",
      "fidelity_mode": "exact",
      "identity_critical": true
    },
    "body": {
      "font_id": "font-ui-body",
      "fidelity_mode": "approved-substitute",
      "identity_critical": false
    },
    "numeric": {
      "font_id": "font-numeric",
      "fidelity_mode": "exact",
      "identity_critical": true
    }
  }
}
```

`fidelity_mode`：

```
exact
approved-substitute
unresolved
```

规则：

- 身份关键角色必须为 `exact` 才能通过 strict 最终验收。
    
- 非身份关键角色允许 `approved-substitute`，但必须记录风险。
    
- 不得静默使用系统默认字体。
    
- 字体文件缺失、哈希变化或授权状态变化，必须使 Typography Composition 和 Fidelity 失效。
    

## 11.6 Typography Contract

Style Contract 或独立 Typography 节点必须包含：

```
{
  "button-label": {
    "font_role": "button-label",
    "size": 30,
    "weight": 700,
    "letter_spacing": 1,
    "line_height": 1.1,
    "fill": "#F5EFE0",
    "stroke": {
      "width": 3,
      "color": "#3A210F"
    },
    "shadow": {
      "offset_x": 0,
      "offset_y": 3,
      "blur": 2,
      "color": "rgba(0,0,0,0.55)"
    }
  }
}
```

## 11.7 Component Contract

```
{
  "families": [
    {
      "id": "button.primary",
      "name": "主按钮",
      "category": "button",
      "status": "approved",
      "source": {
        "type": "exact-asset",
        "reference_asset_id": "reference-home",
        "source_bbox": [120, 1420, 640, 180]
      },
      "reuse_mode": "nine-slice",
      "text_policy": "text-slot",
      "intrinsic_size": [640, 180],
      "scale_policy": {
        "uniform_only": true,
        "min_scale": 0.8,
        "max_scale": 1.2
      },
      "slice": {
        "type": "9-slice",
        "margins": [48, 48, 36, 36]
      },
      "locked_properties": [
        "silhouette",
        "corner-radius",
        "border-layers",
        "bevel",
        "light-direction"
      ],
      "states": {
        "default": {
          "asset_path": "style/components/button-primary/default.png"
        },
        "pressed": {
          "asset_path": "style/components/button-primary/pressed.png"
        },
        "disabled": {
          "asset_path": "style/components/button-primary/disabled.png"
        }
      }
    }
  ]
}
```

`reuse_mode`：

```
exact
nine-slice
vector-token
reference-locked
local-generated
```

严格模式规则：

- 主按钮、导航、页签、资源栏和公共图标不得使用 `local-generated`。
    
- `reference-locked` 仅允许非关键或低频组件，并强制人工验收。
    

## 11.8 Screen Contract 2.0

```
{
  "required_controls": [
    {
      "id": "save-party",
      "label": "保存阵容",
      "role": "primary-action",
      "required": true
    }
  ]
}
```

Screen Contract 描述功能，不直接定义具体组件资产。

## 11.9 Component Bindings

```
{
  "bindings": [
    {
      "control_id": "save-party",
      "component_id": "button.primary",
      "state": "default",
      "slot_id": "bottom-primary",
      "reuse_policy": "nine-slice",
      "approved": true
    }
  ],
  "coverage": {
    "required_controls": 8,
    "bound_required_controls": 8,
    "unbound_required_controls": []
  }
}
```

覆盖率必须为 100%，否则不得进入 Layout Design。

## 11.10 Approved Layout 2.0

```
{
  "slots": [
    {
      "id": "bottom-primary",
      "binding_id": "save-party",
      "rect": {
        "x": 0.2,
        "y": 0.82,
        "width": 0.6,
        "height": 0.1
      },
      "anchor": "bottom-center",
      "z_index": 50,
      "resize_mode": "nine-slice",
      "safe_area_compliant": true,
      "keep_clear_margin": {
        "top": 0.03,
        "right": 0.02,
        "bottom": 0.02,
        "left": 0.02
      },
      "underlay_policy": {
        "keep_clear": true,
        "detail_level": "low",
        "subject_overlap": "forbidden",
        "hard_edge_overlap": "forbidden",
        "text_like_shape": "forbidden",
        "preferred_treatment": "darkened-soft-gradient",
        "contrast_role": "surface-behind-primary-action",
        "visual_noise_budget": 0.2
      }
    }
  ]
}
```

`visual_noise_budget` 第一版作为相对等级或内部启发式，不得伪装为已验证的绝对视觉科学指标。

## 11.11 Underlay Contract

```
{
  "schema_version": "2.0",
  "id": "inventory-underlay-contract",
  "version": 1,
  "status": "approved",
  "source": {
    "approved_layout": "inventory-approved-layout-v2",
    "component_bindings": "inventory-bindings-v1"
  },
  "canvas": [1536, 864],
  "focal_regions": [
    {
      "id": "character-focus",
      "bbox": [0.48, 0.08, 0.46, 0.68],
      "priority": "high"
    }
  ],
  "reserved_regions": [
    {
      "slot_id": "bottom-primary",
      "bbox": [0.17, 0.76, 0.66, 0.2],
      "treatment": "low-detail-darkened",
      "subject_overlap": false,
      "hard_edge_overlap": false,
      "text_like_shapes": false,
      "ui_like_shapes": false
    }
  ],
  "global_rules": {
    "do_not_render_shared_ui": true,
    "do_not_render_formal_text": true,
    "do_not_place_main_subject_inside_reserved_regions": true
  }
}
```

## 11.12 Underlay Layout Guide

系统从 Underlay Contract 生成 `underlay-layout-guide.png`：

- 使用灰阶或低信息量编码；
    
- 标出主视觉区、Reserved Region 和禁止穿越区；
    
- 不包含真实组件风格；
    
- 不包含会被模型误抄的装饰边框；
    
- 在 Artifact 中记录图像哈希和来源版本。
    

提示必须明确：

```
This image is a spatial guide only.
Do not reproduce its colors, borders, labels, shapes or placeholder boxes.
Reserved areas must remain visually quiet and free of UI-like forms.
```

Provider 支持 Mask、Control Image、Region Prompt 时，应优先使用原生能力。

## 11.13 Visual Task 2.0

严格模式：

```
{
  "production_mode": "underlay-only",
  "generate": [
    "background",
    "character",
    "scene",
    "page-specific-decoration"
  ],
  "must_not_generate": [
    "shared-buttons",
    "shared-tabs",
    "shared-navigation",
    "shared-icons",
    "formal-ui-text"
  ],
  "underlay_contract_id": "inventory-underlay-contract",
  "layout_guide_id": "inventory-underlay-layout-guide"
}
```

不得包含：

- 通过 component treatment 产生差异；
    
- 引入新公共组件轮廓；
    
- 重新设计通用按钮或导航；
    
- 正式 UI 文字。
    

## 11.14 Underlay Critique

```
{
  "schema_version": "2.0",
  "id": "inventory-underlay-critique-v1",
  "version": 1,
  "status": "reviewed",
  "source": {
    "underlay": "inventory-underlay-v1",
    "approved_layout": "inventory-layout-v2",
    "underlay_contract": "inventory-underlay-contract-v1"
  },
  "global_scan": {
    "suspected_ui_regions": [
      {
        "bbox": [0.02, 0.88, 0.96, 0.1],
        "type": "navigation-like",
        "confidence": 0.86,
        "reason": "底部存在连续等距图标槽和高亮中心入口"
      }
    ],
    "text_like_regions": []
  },
  "slot_checks": [
    {
      "slot_id": "bottom-primary",
      "expanded_bbox": [0.15, 0.77, 0.7, 0.18],
      "ui_like_contamination": {
        "detected": true,
        "type": "button-like",
        "confidence": 0.91
      },
      "background_busyness": "high",
      "contrast_conflict": true,
      "result": "critical"
    }
  ],
  "issues": [
    {
      "severity": "critical",
      "slot_id": "bottom-primary",
      "action": "regenerate-or-inpaint"
    }
  ],
  "result": "failed"
}
```

Critique 输入至少包含：

1. 原始 Underlay；
    
2. 带 Slot 和保护区的审查图；
    
3. Slot 语义；
    
4. 将放置的组件类别；
    
5. 关键组件缩略图；
    
6. 禁止 UI 类型；
    
7. 页面允许存在的场景元素。
    

Critique 必须同时执行：

- 全画布扫描；
    
- Slot 局部和扩展边界扫描；
    
- 类文字、类按钮、类导航、主体穿越和背景繁忙度判断。
    

建议组合：

- 确定性低层指标：边缘密度、局部对比、亮度变化、颜色复杂度；
    
- 多模态语义判断：类组件、类文字、主体、功能入口和视觉冲突。
    

## 11.15 Underlay Repair Task

```
{
  "source_critique_id": "inventory-underlay-critique-v1",
  "repair_mode": "inpaint",
  "target_regions": ["bottom-primary"],
  "attempt": 1,
  "max_automatic_attempts": 2,
  "instructions": [
    "remove button-like geometry",
    "keep the region low-detail",
    "do not alter the character focal region"
  ]
}
```

自动修复次数必须有限，避免无限重试。

## 11.16 Composition Manifest

```
{
  "canvas": [1536, 864],
  "underlay": {
    "source": "provider-result",
    "task_id": "task-123",
    "critique_id": "inventory-underlay-critique-v2"
  },
  "layers": [
    {
      "type": "component",
      "component_id": "button.primary",
      "state": "default",
      "asset_path": "style/components/button-primary/default.png",
      "asset_hash": "sha256:...",
      "rect": [300, 700, 900, 100],
      "transform": {
        "scale_x": 1,
        "scale_y": 1
      },
      "z_index": 50
    },
    {
      "type": "text",
      "font_role": "button-label",
      "font_id": "font-ui-body",
      "fidelity_mode": "exact",
      "content": "保存阵容"
    }
  ]
}
```

要求：

- 每个公共组件有来源和哈希。
    
- 每个文字层有字体角色和 fidelity mode。
    
- 最终结果可根据 Manifest 重复合成。
    

## 11.17 Fidelity Report

```
{
  "status": "passed",
  "coverage": {
    "required_controls": 8,
    "rendered_controls": 8
  },
  "underlay": {
    "critique_id": "inventory-underlay-critique-v2",
    "result": "passed",
    "manual_waivers": []
  },
  "typography": {
    "identity_critical_roles": 3,
    "exact_roles": 3,
    "unresolved_roles": []
  },
  "checks": [],
  "issues": [],
  "manual_review": {
    "required": false,
    "approved": false
  }
}
```

问题严重级别：

```
blocker
critical
major
minor
info
```

批准条件：

```
blocker = 0
critical = 0
所有 major 已解决或明确批准
所有 manual_review 已完成
所有 identity_critical 字体角色为 exact
Underlay Critique 已通过或具有合法人工豁免
```

---

# 12. 状态机与后端门禁

|   |   |   |
|---|---|---|
|阶段|进入条件|退出条件|
|Reference Analysis|已导入参考图|Reference Inventory approved|
|Style Resolution|Inventory approved|Style Contract approved|
|Typography Resolution|Style 可用|Font Manifest reviewed/approved；未解决项明确|
|Component Resolution|Style approved|Component Contract approved|
|Component Binding|Screen Contract approved|必要控件覆盖率 100%|
|Layout Design|Bindings approved|Layout Validator 通过并 approved|
|Underlay Specification|Layout approved|Underlay Contract + Guide approved|
|Underlay Generation|Contract approved|Underlay 保存成功|
|Underlay Review|Underlay 存在|Critique passed 或合法 waiver|
|Composition|Underlay Review passed；组件可用|Preview/Final Composition 和 Manifest 生成|
|Fidelity Review|Composition 存在|Fidelity passed|
|Final Approval|Fidelity passed|Visual Result approved|

任何门禁必须在后端重复验证，不得仅依赖前端状态。

---

# 13. 前端产品要求

## 13.1 项目创建

显示：

- 新项目探索；
    
- 已有项目严格继承；
    
- 已有项目引导继承。
    

已有项目默认严格继承，并解释：

- 严格继承需要组件资产和身份关键字体；
    
- 只有截图时，部分资产需人工裁切；
    
- 引导继承允许受限重绘，但不能声称像素级一致。
    

## 13.2 Reference Workbench

支持：

- 导入多张参考图；
    
- 设置角色和优先级；
    
- 标记基准页、已批准页；
    
- 查看 Provider 容量；
    
- 预览 Reference Pack；
    
- 查看 omitted 及原因；
    
- 批准 Reference Inventory。
    

## 13.3 Typography Workbench

支持：

- 导入字体文件；
    
- 读取 family / PostScript 名；
    
- 校验 CJK、数字、符号覆盖；
    
- 记录授权状态；
    
- 设置文字角色；
    
- 标记 identity critical；
    
- 设置 exact / approved-substitute / unresolved；
    
- 生成同文案候选预览；
    
- 明确显示 strict 阻断项。
    

不得自动把相似字体标记为 exact。

## 13.4 Component Kit Workbench

支持：

- 导入 PNG/SVG；
    
- 导入 Game UI Forge Manifest；
    
- 人工框选裁切；
    
- 设置组件 ID、家族、类别、状态；
    
- 设置复用模式、尺寸、9-slice、文本策略和锁定属性；
    
- 预览状态；
    
- 显示 strict 可用性；
    
- 后端批准校验。
    

## 13.5 Screen Manager

支持多 Screen 的新建、复制、归档、切换和依赖状态查看。

## 13.6 Component Binding Workbench

显示必要控件、推荐组件、当前绑定、缺失项、状态、页面专属标记和覆盖率。覆盖率不足 100% 时不能继续。

## 13.7 Layout Workbench

同时显示：

- Wireframe；
    
- Style；
    
- 组件缩略图；
    
- 字体角色及文字预估尺寸；
    
- Slot；
    
- 安全区；
    
- 缩放和越界违规；
    
- Underlay Policy；
    
- 保护边距和 Reserved Region。
    

## 13.8 Underlay Workbench

必须显示：

1. Underlay Contract；
    
2. Layout Guide；
    
3. 生成 Underlay；
    
4. Critique Overlay；
    
5. Global Issues；
    
6. Slot Issues；
    
7. 修复历史；
    
8. 人工豁免及理由。
    

## 13.9 Visual Production Workbench

严格模式结果拆分为：

1. AI Underlay；
    
2. Underlay Critique；
    
3. Component Overlay；
    
4. Text Overlay；
    
5. Final Composition；
    
6. Fidelity Report。
    

## 13.10 前端代码边界

新增功能不得继续全部堆入 `src/App.tsx`。至少拆分为：

```
src/features/reference/
src/features/typography/
src/features/component-kit/
src/features/screens/
src/features/bindings/
src/features/layout/
src/features/underlay/
src/features/production/
src/features/fidelity/
```

---

# 14. 后端与服务架构

建议新增：

```
electron/services/
├── providerCapabilities.cjs
├── referencePack.cjs
├── typographyAssets.cjs
├── componentKit.cjs
├── componentBindings.cjs
├── screenRegistry.cjs
├── underlayContract.cjs
├── layoutGuideRenderer.cjs
├── underlayCritique.cjs
├── underlayRepair.cjs
├── compositor.cjs
├── fidelity.cjs
└── migrations.cjs
```

职责：

|   |   |
|---|---|
|服务|职责|
|`providerCapabilities.cjs`|图片上限、Mask、Control、Region、Inpaint 等能力|
|`referencePack.cjs`|角色、排序、容量、selected/omitted|
|`typographyAssets.cjs`|字体导入、哈希、覆盖、授权、角色门禁|
|`componentKit.cjs`|组件导入、校验、Manifest 转换和批准|
|`componentBindings.cjs`|控件映射、覆盖率和状态校验|
|`screenRegistry.cjs`|多 Screen 索引和生命周期|
|`underlayContract.cjs`|从 Layout 和 Bindings 生成 Reserved Regions|
|`layoutGuideRenderer.cjs`|生成结构引导图和审查 Overlay|
|`underlayCritique.cjs`|低层指标 + 多模态语义审查|
|`underlayRepair.cjs`|Inpaint、重生成、重试和 waiver|
|`compositor.cjs`|装配计划、组件和文字层、Manifest|
|`fidelity.cjs`|Underlay、组件、字体、缩放、边界和门禁|
|`migrations.cjs`|1.0 → 2.0 迁移和恢复|

确定性合成第一版优先使用 Electron Renderer Canvas 2D，避免非必要原生依赖。

## 14.1 模型配置

配置应增加：

```
visionModel
critiqueModel
imageModel
```

优先使用独立 `critiqueModel`。无法配置时，可回退到 `visionModel`，但必须使用独立 Prompt、独立上下文和证据输出。

---

# 15. API 与 IPC 改造

至少增加：

```
createScreen(projectId, input)
listScreens(projectId)
openScreen(projectId, screenId)
updateScreen(projectId, screenId, patch)
archiveScreen(projectId, screenId)
setActiveScreen(projectId, screenId)

importFontAsset(projectId, input)
updateFontRole(projectId, roleId, patch)
approveFontManifest(projectId)

importComponentAsset(projectId, input)
importComponentManifest(projectId, input)
updateComponent(projectId, componentId, patch)
approveComponentContract(projectId)

updateBindings(projectId, screenId, patch)
approveBindings(projectId, screenId)

generateUnderlayContract(projectId, screenId)
generateLayoutGuide(projectId, screenId)
runUnderlayCritique(projectId, screenId, underlayId)
repairUnderlay(projectId, screenId, critiqueId, input)
approveUnderlayWaiver(projectId, screenId, issueId, reason)

composeVisual(projectId, screenId, variationId, mode)
runFidelity(projectId, screenId)
```

已有方法增加可选 `screenId`。为兼容旧调用可暂用 `active_screen_id`，但内部不得继续依赖固定 `main`。

错误返回至少包含：

```
{
  "code": "UNRESOLVED_IDENTITY_FONT",
  "stage": "composition",
  "missing_requirements": ["button-label", "numeric"]
}
```

---

# 16. 任务拆解与执行顺序

## 阶段 0：基线冻结与样本准备

### BASE-001 建立改造基线

**任务**

- 记录当前主分支提交；
    
- 创建改造分支；
    
- 保存当前工作流截图和 Artifact 示例；
    
- 运行现有 lint、test、build、quick-start check；
    
- 记录已有失败。
    

**产物**

```
docs/baseline/current-workflow.md
docs/baseline/current-test-results.md
```

### BASE-002 建立 Golden Samples

至少准备：

1. 功能密集型；
    
2. 视觉主导型；
    
3. 已有项目延展型。
    

已有项目样本必须含：

- 3–5 张批准页面；
    
- 新页面 Wireframe；
    
- 至少 8 个公共组件家族；
    
- 至少 3 个字体角色；
    
- 人工标注的 Underlay 污染测试图，包括按钮残影、假导航、主体穿越和背景繁忙。
    

记录改造前指标。

---

## 阶段 1：立即阻止已有项目自由漂移

### PIPE-101 增加 Continuation Mode

- 新增模式字段；
    
- 已有项目默认 strict；
    
- 模式变化触发失效；
    
- Preview API 同步。
    

### PROMPT-102 拆分视觉提示词

- 新项目保留探索策略；
    
- 新增 strict/guided Underlay Prompt；
    
- strict 只生成 Underlay；
    
- 删除 component treatment 差异要求；
    
- 禁止公共 UI 和正式文字。
    

### REF-103 移除静默参考图截断

- 引入 Provider Capabilities；
    
- 生成明确 Reference Pack；
    
- 记录 omitted；
    
- Wireframe 不再默认占首位。
    

### VALID-104 强化 Style Contract 校验

- 校验颜色、几何、字体效果 Token、光向、间距和参考证据；
    
- 拒绝空对象和模糊描述。
    

---

## 阶段 2：Schema 2.0 与多 Screen

### DATA-201 项目 Schema 2.0

- 增加 `active_screen_id`、`screens/index.json`；
    
- 全局和页面 Artifact 分离；
    
- Artifact 类型注册表。
    

### DATA-202 新增 Artifact 类型

新增并实现 normalize/validate/save/history：

```
reference-inventory
reference-pack
font-manifest
component-contract
component-bindings
underlay-contract
underlay-critique
composition-manifest
fidelity-report
```

### MIG-203 旧项目迁移

- 迁移前完整备份；
    
- `main` 注册为第一个 Screen；
    
- 旧视觉结果标记 Legacy；
    
- 旧 Style 不自动伪造 Component/Font Contract；
    
- 已有项目缺组件或字体时进入明确 blocked；
    
- 失败恢复原项目；
    
- 写迁移日志。
    

### API-204 更新 IPC 和 Preview API

- 所有 API 支持 Screen；
    
- Preview 与真实 API 类型一致；
    
- 错误结构化。
    

---

## 阶段 3：Reference、Style 与 Typography

### REF-301 Reference Inventory Workbench

- 角色、优先级、批准状态、contains 标签；
    
- Provider 容量预览；
    
- Reference Pack 审核。
    

### TYPE-302 Font Manifest 服务

- 字体导入；
    
- family/PostScript 名读取；
    
- 文件哈希；
    
- CJK/数字/符号覆盖；
    
- 授权状态；
    
- 角色绑定；
    
- exact/substitute/unresolved；
    
- 身份关键门禁。
    

### TYPE-303 Typography Workbench

- 字体预览；
    
- 同文案候选比较；
    
- 替代字体人工批准；
    
- 不得自动标记 exact；
    
- 显示 strict 阻断。
    

### TYPE-304 字体变更失效传播

字体文件、角色或授权变化必须使：

```
Typography Preview
Composition
Fidelity
Final Approval
```

失效。

---

## 阶段 4：Component Kit 与绑定

### COMP-401 Component Contract 服务

- 组件资产和状态导入；
    
- 透明、尺寸、路径、哈希和 9-slice 校验；
    
- Game UI Forge Manifest 转换；
    
- source bbox；
    
- strict 可用性。
    

### COMP-402 Component Kit Workbench

- 设计师无需手工编辑 JSON 即可完成 Kit。
    

### BIND-403 Component Binding 引擎

- 生成建议；
    
- 人工批准；
    
- 100% 覆盖率；
    
- 状态存在性；
    
- 页面专属标记。
    

### BIND-404 Binding Workbench

- 显示控件、推荐、来源、状态、缺失和覆盖率。
    

### INVALID-405 扩展失效传播

|   |   |
|---|---|
|上游变更|必须失效|
|Reference Inventory|Reference Pack、Style、Font Review、Component、所有相关页面后续 Artifact|
|Style Contract|Component Review、Layout、Underlay Contract、Underlay、Critique、Composition、Fidelity|
|Font Manifest|Typography Composition、Composition、Fidelity|
|Component Contract|引用该组件的 Binding、Layout、Underlay Contract、Composition、Fidelity|
|Screen Contract|当前页 Binding 及全部后续|
|Bindings|当前页 Layout 及全部后续|
|Approved Layout|Underlay Contract 及全部后续|
|Underlay Contract/Guide|Underlay、Critique、Composition、Fidelity|
|Underlay|Critique、Composition、Fidelity|
|Critique Waiver|Composition、Fidelity|
|组件/字体资产文件|引用页面 Composition、Fidelity|
|Continuation Mode|所有不兼容后续 Artifact|

---

## 阶段 5：组件感知布局与 Underlay Contract

### LAYOUT-501 已有项目专用 Layout Prompt

输入：Screen、Style、Font、Component、Bindings、Canvas、Safe Area、Wireframe。

输出：

- 区域；
    
- Slot；
    
- 标准化坐标；
    
- z-index；
    
- resize mode；
    
- keep-clear margin；
    
- Underlay Policy；
    
- 约束满足情况。
    

### LAYOUT-502 Layout Validator

检查：

- 安全区；
    
- 越界；
    
- exact 非等比拉伸；
    
- 9-slice 最小尺寸；
    
- 必要组件缺位；
    
- 文本槽宽度；
    
- 交互组件遮挡；
    
- 非法重叠；
    
- Slot 与 Binding 一致。
    

### UNDERLAY-503 Underlay Contract 生成器

- 从 Layout 和 Bindings 生成 Reserved Regions；
    
- 生成 Slot 背景语义；
    
- 记录焦点区、禁止穿越区和视觉处理。
    

### UNDERLAY-504 Layout Guide Renderer

- 生成灰阶结构引导图；
    
- 不泄露真实组件风格；
    
- 支持审查 Overlay；
    
- 记录哈希和来源。
    

---

## 阶段 6：Underlay 生成、自动 Critique 与修复

### GEN-601 Underlay 生成

strict 只生成背景、角色、场景和页面专属装饰，不生成公共 UI 和正式文字。

### CRIT-602 自动 Underlay Critique

必须实现：

- 全画布 UI 类图形扫描；
    
- Slot 及保护区扫描；
    
- 类按钮、类导航、类页签、类文字和类数字；
    
- 主体/武器/建筑边缘穿越；
    
- 背景繁忙度；
    
- 局部对比冲突；
    
- 与公共组件缩略图的语义相似性；
    
- 结构化 issue、bbox、reason、severity 和 action。
    

### CRIT-603 Critique 模型解耦

- 优先独立 critiqueModel；
    
- 回退时使用独立 Prompt 和上下文；
    
- 不允许只输出总分；
    
- 必须输出证据框。
    

### REPAIR-604 Underlay Repair Loop

- 支持 Inpaint/Mask；
    
- 不支持时携带 Critique 证据重生成；
    
- 自动尝试上限；
    
- 修复历史；
    
- 人工豁免和理由。
    

### GATE-605 Underlay Review 后端门禁

- critical/blocker 必须阻断；
    
- major 默认阻断并人工复核；
    
- low-confidence 进入人工复核；
    
- minor 可由设计师明确接受；
    
- passed 才能进入 Composition。
    

---

## 阶段 7：确定性组件和文字合成

### RENDER-701 Canvas Compositor

- exact、nine-slice、vector-token；
    
- z-index、裁切、锚点和安全区；
    
- 输出 PNG 和 Composition Manifest；
    
- 不依赖网络二次合成。
    

### TEXT-702 确定性文字系统

- 按 Font Manifest 和 Typography Token 渲染；
    
- 正式文字不依赖图片模型；
    
- 支持描边、投影、渐变、字距、行高；
    
- 未解决身份关键字体时仅允许 Preview，并加明确标识；
    
- final 模式后端阻断。
    

### RESULT-703 结果来源追踪

记录 Screen、Layout、Style、Font、Component、Binding、Underlay、Critique、模型、Prompt Hash、Provider Task、Composition 和 Fidelity。

---

## 阶段 8：Final Fidelity Gate

### FID-801 自动检查

- 必要控件完整性；
    
- Binding 与实际层一致；
    
- 组件状态、Asset Hash 和路径；
    
- exact 缩放；
    
- 9-slice；
    
- Slot 和安全区；
    
- 文本角色、字体模式和授权；
    
- Underlay Critique；
    
- 页面专属组件批准状态。
    

### FID-802 人工检查

以下情况必须人工检查：

- `reference-locked`；
    
- 截图裁切存在背景残留；
    
- 页面专属新组件；
    
- 缺少完整状态；
    
- approved-substitute 字体；
    
- Critique 低置信度；
    
- Underlay 疑似重复 UI；
    
- waiver。
    

### FID-803 最终批准门禁

批准前检查：

1. Composition Manifest 存在；
    
2. Underlay Critique 通过或 waiver 合法；
    
3. Fidelity Report 为 passed；
    
4. blocker/critical 为 0；
    
5. major 已解决或明确批准；
    
6. identity-critical 字体全部 exact；
    
7. 所有依赖 Artifact 非 stale。
    

---

## 阶段 9：测试、文档与发布

### TEST-901 单元测试

覆盖：

- Mode 默认值；
    
- strict Prompt 禁止词；
    
- Reference Pack；
    
- Provider Limit；
    
- Font Manifest；
    
- identity critical 门禁；
    
- Component Contract；
    
- Binding 覆盖率；
    
- Layout Slot；
    
- Underlay Contract；
    
- Layout Guide；
    
- Critique 解析与门禁；
    
- Repair Loop；
    
- Compositor；
    
- Typography；
    
- Fidelity；
    
- 失效传播；
    
- 多 Screen；
    
- Schema Migration。
    

### TEST-902 集成测试

完整 strict 路径：

```
创建已有项目
→ 导入 Wireframe 和参考图
→ 批准 Inventory
→ Style
→ Font Manifest
→ Component Kit
→ Screen Contract
→ Bindings
→ Layout
→ Underlay Contract/Guide
→ Underlay
→ Critique
→ Repair
→ Composition
→ Fidelity
→ Final Approval
```

### TEST-903 新项目回归

证明新项目仍可完成原探索流程，不被 Component/Font Kit 阻断。

### GOLD-904 Golden Sample 验收

每组记录：

- 功能遗漏；
    
- 未绑定控件；
    
- 公共组件严重漂移；
    
- 身份关键字体状态；
    
- Underlay critical 污染漏检；
    
- Slot 背景冲突；
    
- 人工修改步骤；
    
- 三类评分。
    

正式通过条件：

```
未绑定必要控件 = 0
关键组件严重漂移 = 0
带已知 critical 污染的样本自动通过 = 0
身份关键字体 unresolved = 0（strict 样本）
关键 Slot 严重背景冲突 = 0
组件保真 >= 4/5
Underlay 适配 >= 4/5
整体可用性 >= 4/5
```

### DOC-905 文档

必须更新或新增：

```
README.md
docs/EXISTING-PROJECT-WORKFLOW.md
docs/COMPONENT-CONTRACT.md
docs/FONT-MANIFEST.md
docs/REFERENCE-PACK.md
docs/UNDERLAY-CONTRACT.md
docs/UNDERLAY-CRITIQUE.md
docs/MIGRATION-V2.md
docs/FIDELITY-REVIEW.md
docs/GAME-UI-FORGE-INTEGRATION.md
CHANGELOG.md
```

### REL-906 发布检查

```
pnpm lint
pnpm test
pnpm build
pnpm quick-start:check
```

真实 API 环境可用时：

```
pnpm test:kunpo
pnpm test:kunpo-image
```

---

# 17. 验收场景

## AC-01 已有项目严格继承

最终必须使用 exact/nine-slice/vector-token 公共组件、确定性文字、Underlay Critique 和 Fidelity Gate。

## AC-02 参考图超限

10 张参考、Provider 上限 6 时，必须显示 selected 6、omitted 4 和原因，不得静默截断。

## AC-03 缺少公共组件

Binding 覆盖率不足时后端阻止 Layout，不得自动自由生成。

## AC-04 Component Contract 变更

所有引用页面的 Layout/Underlay/Composition/Fidelity 正确失效，无关页面不受影响。

## AC-05 多 Screen 隔离

修改 `inventory` 不得错误失效 `main` 和 `shop`。

## AC-06 Style 全局变更

所有依赖 Style 的相关 Artifact 失效，并列出受影响页面。

## AC-07 旧项目迁移

自动备份、注册 main、保留旧 Artifact、Legacy 标记、缺组件/字体时明确 blocked。

## AC-08 新项目回归

新项目仍可完成探索流程，不要求预先建立 Kit。

## AC-09 最终批准门禁

存在 critical 时，即使前端按钮错误启用，后端仍拒绝批准。

## AC-10 可复现性

相同 Underlay、资产、字体、Layout 和 Manifest 再次合成时，结果层级和位置一致。

## AC-11 Underlay 类按钮污染

主按钮 Slot 中存在按钮残影时，Critique 必须定位并输出 critical，系统不得进入 Composition。

## AC-12 Slot 背景过于繁忙

无明显按钮残影但存在武器、高频纹理或强高光时，Critique 必须报告 busyness/contrast conflict，并阻止或进入人工复核。

## AC-13 全画布多余导航

Underlay 底部出现不在 Slot 中的假导航时，全局扫描必须发现并至少标为 critical。

## AC-14 身份关键字体缺失

Layout 和 Underlay 可继续；Final Typography、Fidelity 和 Final Approval 必须阻断。

## AC-15 已批准替代字体

非身份关键角色可使用 approved-substitute，但必须明确记录，不得显示为 exact。

## AC-16 Underlay 预留区链路一致

同一 Slot ID 必须贯穿：

```
Approved Layout
→ Underlay Contract
→ Layout Guide
→ Visual Task
→ Critique
→ Composition
→ Fidelity
```

## AC-17 Critique 低置信度

低置信度结果不得自动通过，必须进入人工复核。

## AC-18 Critique 误报豁免

设计师确认误报时，必须记录 issue、理由、批准人和时间；waiver 变化使 Fidelity 失效。

## AC-19 Repair Loop

Provider 支持 Inpaint 时优先局部修复；不支持时带 Critique 证据重生成；超过自动上限后转人工处理。

## AC-20 字体文件变化

字体哈希变化后，所有使用该字体的 Composition 和 Fidelity 必须 stale。

---

# 18. 非功能要求

## 18.1 数据完整性

- 原子写入；
    
- 迁移前备份；
    
- 写入失败不改变阶段完成状态；
    
- 不允许半迁移；
    
- Artifact 不得引用不存在文件。
    

## 18.2 可维护性

- 不继续把全部逻辑堆入 `designPipeline.cjs`；
    
- 新领域独立服务；
    
- 新 Artifact 使用统一注册表；
    
- 前端按 Feature 拆分；
    
- 关键规则必须有代码和测试，不只存在 Prompt。
    

## 18.3 可观察性

每次任务记录：

- Project、Screen、Stage、Mode；
    
- Artifact 版本；
    
- Reference Pack；
    
- Style、Font、Component、Binding；
    
- Underlay Contract、Critique、Repair Attempt；
    
- Model、Prompt Hash、Provider Task；
    
- 成功、失败和 stale 原因。
    

不得在日志中写入字体二进制或敏感资产内容。

## 18.4 错误可操作性

错误必须准确列出缺失项和处理路径，不得只返回 `Validation failed`。

## 18.5 性能边界

- 大体积图片和字体不写入 `project.json` Base64；
    
- 预览懒加载；
    
- Canvas 合成不阻塞主进程；
    
- Critique 支持取消和失败恢复；
    
- 相同资产复用缓存。
    

## 18.6 Critique 安全边界

- Critique 只能作为质量筛查，不得自动修改用户批准的 Layout/Component Contract；
    
- 自动修复只能作用于 Underlay；
    
- 所有 waiver 可追踪；
    
- 不允许无限自动重试。
    

---

# 19. 风险与应对

|   |   |   |
|---|---|---|
|风险|影响|应对|
|只有截图，没有透明组件资产|strict 无法确定性复用|人工裁切、Forge 导入、guided 模式；strict 明确阻断|
|Underlay 仍生成按钮/导航|重复 UI|Underlay Contract、Guide、自动 Critique、Repair Loop|
|Critique 把建筑结构误判为按钮|人工负担|低层指标 + 多模态语义；低置信度人工复核；Golden 校准|
|Critique 漏检关键污染|最终违和|Golden Sample 中任何已知 critical 不得自动通过；人工抽检|
|Provider 不支持结构控制|Slot 无法预留|结构引导图、角色化 Reference Pack、Prompt 和 Critique 闭环|
|拿不到真实字体|strict 字体不成立|Font Gate；前期可继续，Final 阻断；guided 使用明确 substitute|
|字体授权不清|合规风险|license_status；不上传字体；未确认不允许 final|
|Canvas 与游戏引擎抗锯齿不同|细微文字差异|字体 Preview、效果 Token、人工评分；必要时记录引擎后处理|
|Component Kit 过大|管理复杂|家族/Variant/状态层级、按页面过滤、懒加载|
|多 Screen 重构回归|数据损坏|备份、迁移、兼容适配器和测试|
|Style 与 Component 重复定义|双重事实来源|Style 只保留全局 Token；具体组件只在 Component Contract|
|资产更新后仍用旧结果|错误批准|Hash + stale 传播|
|执行者只改 Prompt|根因未解决|DoD 强制检查 Font、Component、Underlay、Critique、Compositor、Fidelity|
|自动化通过但视觉仍漂|假完成|Golden Sample 和 UI 设计师评分为发布门禁|

---

# 20. 角色与责任

|   |   |
|---|---|
|角色|责任|
|产品负责人|范围、优先级、模式定义、最终验收|
|技术负责人|Schema、状态机、服务边界、迁移、ADR|
|AI 工作流开发|Prompt、Reference Pack、Critique、Repair、模型配置|
|Electron/Node 开发|文件、IPC、服务、迁移、后端门禁|
|前端开发|各 Workbench、Overlay、状态和错误交互|
|UI 设计师|Component Kit、Font Role、Slot Policy、Golden 评分、waiver|
|测试人员|单元、集成、迁移、Golden、回归和发布检查|

关键门禁不得由单一角色口头跳过。

---

# 21. PR 与合并顺序

## PR 1：Existing Mode Guardrails

- Mode；
    
- strict Prompt；
    
- Provider Capabilities；
    
- Reference Pack；
    
- 去除静默截断；
    
- 测试。
    

## PR 2：Schema 2.0 与迁移

- 多 Screen；
    
- Artifact 注册；
    
- API/IPC；
    
- 迁移和恢复。
    

## PR 3：Typography 与 Component Kit

- Font Manifest；
    
- Typography Workbench；
    
- Component Contract；
    
- Forge 导入；
    
- 合法性测试。
    

## PR 4：Bindings 与 Component-aware Layout

- Binding；
    
- 覆盖率；
    
- Slot；
    
- Underlay Policy；
    
- Validator；
    
- stale 传播。
    

## PR 5：Underlay Contract、Guide 与 Critique

- Underlay Contract；
    
- Layout Guide；
    
- Underlay Prompt；
    
- Critique；
    
- Repair Loop；
    
- 门禁和测试。
    

## PR 6：Compositor、Typography Rendering 与 Fidelity

- Canvas Compositor；
    
- Text Rendering；
    
- Composition Manifest；
    
- Final Fidelity Gate。
    

## PR 7：Golden Samples、文档与发布

- 真实样本；
    
- 回归；
    
- 文档；
    
- CHANGELOG；
    
- 版本升级；
    
- 发布检查。
    

每个 PR 必须有明确范围、测试和相关文档，不得混入无关格式化，也不得以“后续补测试”为合并条件。

---

# 22. 最终完成定义

## 22.1 数据与架构

- Schema 2.0。
    
- 旧项目安全迁移。
    
- 多 Screen。
    
- Style、Font、Component 职责分离。
    
- Component Bindings。
    
- Layout Slot + Underlay Policy。
    
- Underlay Contract + Guide。
    
- Underlay Critique + Repair。
    
- Composition Manifest。
    
- Fidelity Report。
    

## 22.2 严格模式

- 默认 `existing-strict`。
    
- 不使用公共组件探索策略。
    
- 不生成正式 UI 文字。
    
- 公共组件确定性复用。
    
- 必要控件覆盖率 100%。
    
- 缺组件时后端阻断。
    
- identity-critical 字体 unresolved 时 Final 阻断。
    
- Reference Pack 不静默截断。
    
- Underlay Critique 未通过时 Composition 阻断。
    

## 22.3 门禁与失效传播

- Kit 未批准不能 strict Layout。
    
- Bindings 未完整不能 Layout。
    
- Layout 未批准不能 Underlay Contract。
    
- Critique 未通过不能 Final Composition。
    
- Typography 未解决不能 Final Approval。
    
- Fidelity 未通过不能批准页面。
    
- 上游变更正确 stale。
    
- 后端可阻止前端错误操作。
    

## 22.4 测试

- 单元测试。
    
- 集成测试。
    
- 迁移测试。
    
- 新项目回归。
    
- 三组 Golden Samples。
    
- lint/test/build/quick-start check。
    
- 真实 Provider Smoke Test。
    

## 22.5 设计质量

- 必要控件遗漏 0。
    
- 关键组件严重漂移 0。
    
- 已知 critical Underlay 污染自动通过 0。
    
- strict 样本 identity-critical 字体 unresolved 0。
    
- 关键 Slot 严重背景冲突 0。
    
- 组件保真评分 ≥ 4/5。
    
- Underlay 适配评分 ≥ 4/5。
    
- 整体可用性评分 ≥ 4/5。
    

## 22.6 文档与发布

- README 和专项文档更新。
    
- CHANGELOG。
    
- 版本升级。
    
- 无未解释阻断警告。
    
- 无 TODO、Mock 或假数据代替正式能力。
    

---

# 23. 最终验收结论模板

```
改造版本：
验收提交：
验收日期：

一、自动化检查
- lint：
- test：
- build：
- migration：
- provider smoke：

二、Golden Samples
- 功能密集型：
  - 必要控件遗漏：
  - 关键组件严重漂移：
  - Underlay critical 漏检：
  - 身份关键字体状态：
  - 组件保真评分：
  - Underlay 适配评分：
  - 整体可用性评分：

- 视觉主导型：
  - 必要控件遗漏：
  - 关键组件严重漂移：
  - Underlay critical 漏检：
  - 身份关键字体状态：
  - 组件保真评分：
  - Underlay 适配评分：
  - 整体可用性评分：

- 已有项目延展型：
  - 必要控件遗漏：
  - 关键组件严重漂移：
  - Underlay critical 漏检：
  - 身份关键字体状态：
  - 组件保真评分：
  - Underlay 适配评分：
  - 整体可用性评分：

三、迁移
- 旧项目数量：
- 成功数量：
- 失败数量：
- 数据丢失：

四、阻断问题
- blocker：
- critical：
- major：

五、人工豁免
- Underlay waiver：
- 字体 substitute：
- reference-locked 组件：

六、最终结论
- 通过 / 不通过

七、未完成项
- 无 / 列明具体任务 ID
```

未填写完整验收结论，不得发布 `0.2.0`。

---

# 24. 执行者首个动作

开始编码前必须依次完成：

1. 将本文加入仓库。
    
2. 完成 BASE-001。
    
3. 完成 BASE-002，并加入带标注的 Underlay 污染样本和字体样本。
    
4. 创建六份 ADR。
    
5. 提交 PR 1 技术设计说明。
    
6. 技术设计中列出所有新增 Artifact、路径、API、状态机、失效规则、字体门禁、Critique 门禁和迁移方案。
    
7. 通过技术设计评审后再修改生产代码。
    

本轮禁止从 UI 小修或只改提示词开始。必须先冻结基线、确认数据契约、阶段依赖和门禁，再进入实现。

---

# 附录 A：当前代码审查定位

执行者开始时应优先复核以下文件：

```
electron/services/prompts.cjs
- 当前已有/新项目只在 stylePrompt 分叉。
- visualTask 仍包含 expressive、innovative 和 component treatment 差异要求。

electron/services/designPipeline.cjs
- 当前视觉阶段将 Wireframe 与全部参考图平铺给图片模型。
- 当前阶段顺序尚无 Typography、Underlay Contract、Critique 和 Composition。

electron/services/kunpoClient.cjs
- 当前图片参考存在数量截取逻辑。
- 当前 Provider 接口主要使用普通 image/images，尚无正式能力注册。

electron/services/contracts.cjs
- 当前 Style components 仅检查对象结构。
- 当前 Screen required_controls 为字符串数组。

electron/services/projectStore.cjs
src/types.ts
- 当前项目和类型仍以活动 `main` Screen 为中心。

src/App.tsx
- 体积已经较大；新增工作台不得继续集中堆叠。
```

附录中的定位仅用于启动复核。执行者必须以实际分支最新代码为准，并在 BASE-001 中记录差异。