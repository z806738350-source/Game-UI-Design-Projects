# Game UI Design Copilot 内嵌智能 AI 助手施工执行方案v1.2

> - 文档版本：v1.2
> - 审查日期：2026-09-05
> - 代码基线：`main@10ffb7025a0d656e72097c5cba6ea2ea1a1cae39`，应用版本 `0.2.2`
> - 设计规范基线：`docs/dev/FRONTEND-DESIGN-GUIDE.md` 1.3（唯一设计事实来源；其 §1/§4/§5/§6.4/§6.5/§7/§8 在本方案中按**硬性规定**执行，不得记为「已知偏差」留到验收）
> - 上游方案：`docs/Game-UI-Design-Copilot-AI-Assistant-Implementation-Plan.md`（v1.0）
> - 文档基线规则：`10ffb70` 只标识源码核验点，不包含本方案与指南 1.3；A0 的第一步是把两份文档作为同一 docs-only 基线提交，A1 必须从包含该提交的分支开始
> - 方案状态：**可按 A0 → A1 → A2 顺序施工；不得跳过 A0，也不得直接照搬 v1.0 开工**

---

## 0. 执行结论

v1.0 的产品方向是正确的：把 AI 助手放在现有工作流之上，复用已有的设计管线、校验和存储能力，而不是另做一套“AI 版项目系统”。如果补齐本方案列出的阻断项，最终可以达到预期：

- 在应用内持续对话，读取当前项目和画面上下文；
- 根据当前阶段回答问题、解释问题并给出下一步建议；
- 用户可以创建、切换、重命名和删除独立对话；归档在有完整恢复入口前不进入首版；
- 新对话从空白开始，不继承旧对话记忆；
- AI 只提出结构化动作，应用确认权限、目标和版本后才调用现有领域服务；
- 桌面端与在线版共用同一套助手核心，在线版继续使用既有租户隔离；
- 关闭功能开关后，现有设计工作流不受影响。

但 v1.0 目前不能直接进入全量实现。它有六个会导致安全或正确性问题的阻断项：

1. **允许把旧对话重新绑定到另一个项目**，与“项目间不继承记忆”的核心承诺冲突，也可能把旧项目上下文写进新项目。
2. **把本地历史回放与模型供应商 Thread/Response 状态混用**，可能造成上下文重复、顺序错乱和删除不彻底。
3. **把现有项目写锁误认为覆盖“模型调用到最终提交”的完整事务**。真实代码只串行单次存储调用；两个助手仍可能基于同一旧快照生成并依次写入。
4. **把停止助手回答、取消设计阶段和取消图片任务当成同一个能力**。现有取消键不是 `run_id/job_id`，而且供应商请求没有可从外部传入的中止信号。
5. **在尚未证明当前 Kunpo/OpenAI-compatible 网关支持工具调用、流式返回、审批恢复和 SDK 模型适配前，就固定引入 Agents SDK**。当前代码实际只使用 `/chat/completions`、JSON Object 返回和内部超时控制。
6. **确认接口先执行动作、后记录终态**。两个并发确认都可能读到 `awaiting_confirmation` 并各执行一次；必须先原子认领为 `executing`，再调用领域服务。

### 0.1 v1.2 的核心取舍

v1.2 采用“最小但可交付”的路线：

- 首版不引入通用 Agent 框架，不安装 `@openai/agents`、`openai` 或仅为本功能服务的新校验框架；
- 复用现有 `kunpoClient.cjs`、`jsonStore.cjs`、`galleryStore.cjs` 的单写者队列范式、项目存储、设计管线和意图审查服务；
- 首版采用**一次用户消息最多提出一个待执行动作**的有界协议，不做自主多步循环；
- 首版只有“问答”和“执行”两种交互状态；执行时必须先展示动作卡并由用户确认，单独的“规划模式”不再作为第三套运行逻辑；
- 首版保留完整消息历史和一份滚动摘要，不做语义记忆抽取、记忆 CRUD 和记忆管理面板；
- 首版先交付完整的持久对话与只读理解，再逐个接入已有并发保护或可补齐版本检查的写能力；
- 首版 Web 请求可返回完整结果，不为了“看起来像聊天”提前建设复杂 SSE 重放系统；真实流式能力通过兼容性探针后再增加。
- **设计规范的裁定前置到 A0**：按钮等级、语义色绑定和应用自有中文状态映射在 A0 一次定死，不留到实现期现场发挥。模型正文通过系统提示尽量使用简体中文，但首版不为此增加语言检测或翻译链；助手同时是第一个与主工作区**常驻同屏**的辅助列面板，`button--primary` 唯一性与金橙互斥因此从“可能冲突”变成“必然冲突”。

这不是降低安全标准，而是删除目前没有必要、也没有真实兼容性证据的复杂度。

---

## 1. 对下一步工作意图的理解

这次工作的目标不是增加一个普通聊天框，也不是让模型接管现有应用。真正要建设的是一个**任务范围明确、上下文可信、动作受控、可恢复的设计协作入口**。

用户期望完成如下闭环：

1. 用户在当前项目、当前 Screen 中打开助手；
2. 助手自动拿到最小必要的项目状态，不要求用户重复粘贴需求和产物；
3. 用户可以问“现在缺什么”“为什么校验失败”“下一步该做什么”；
4. 助手可以基于真实状态回答，而不是根据聊天内容猜测；
5. 当用户要求修改或继续执行时，助手生成可审阅的结构化动作；
6. 应用重新读取最新状态、校验目标与版本，再调用已有服务；
7. 助手把真实执行结果解释给用户，不伪造成功；
8. 对话关闭或应用重启后仍可继续；新建对话则必须是干净会话；
9. 桌面版和在线版行为一致，在线版任何时候都不能跨租户读取或写入。

因此，成功标准不应是“接入了某个 Agent SDK”或“模型能输出工具名”，而应是：**用户能在不破坏现有项目正确性的前提下，更快理解当前状态并安全完成下一步操作。**

---

## 2. 当前项目真实基线

以下结论来自当前代码，而不是 v1.0 中的假设。

| 领域 | 当前真实情况 | 对助手方案的影响 |
|---|---|---|
| 模型接入 | `electron/services/kunpoClient.cjs` 使用原生 `fetch` 调用 `${baseUrl}/chat/completions`，非流式，要求 `response_format: { type: "json_object" }` | 现成能力适合“结构化回复 + 单动作提议”；不能据此假设支持原生工具调用、Responses API 或 SDK 会话恢复 |
| 依赖 | `package.json` 没有 Agents SDK、OpenAI SDK、Zod；项目运行时以 `.cjs` 服务为主 | 新 SDK 会同时引入包体、模块格式和兼容性成本，必须先证明必要性 |
| 模型配置 | `env.cjs` 只读写 `visionModel`、`critiqueModel`、`imageModel`，保存时会重建已知字段；现有 `SettingsDialog` 只允许编辑视觉和图像模型 | 必须同时扩展配置读写、`AppConfig` 与现有设置弹窗；桌面配置是应用级，Web 配置是租户级 |
| 项目存储 | `projectStore.cjs` 已提供路径校验、原子 JSON 写入、版本、历史与项目级写队列 | 应复用；但现有队列只保护单次存储调用，不保护“长时间模型计算 + 提交”的完整事务 |
| 意图审查 | `intentStateStore.cjs` 已有 `expectedIntentReviewRevision`、无变化短路和发布顺序 | 是首个最适合接入的写动作，不能重新实现一套意图存储 |
| 设计管线 | `designPipeline.cjs` 已有阶段编排、结构化校验、错误码和产物失效逻辑 | 助手只能调用其公开入口；接入写动作前要补齐或复用目标版本检查 |
| 取消能力 | 视觉阶段取消按 `projectId:screenId` 定位；同一 Screen 的并发任务尚不能用 job 精确隔离；模型请求的 `AbortController` 由客户端内部创建 | 首版不能承诺“停止按钮会终止所有下游调用”；助手取消与管线取消必须拆开 |
| 桌面桥接 | `electron/main.cjs` 和 `preload.cjs` 已通过白名单 IPC 暴露能力 | 继续使用白名单；不要给 Renderer 文件路径、Shell 或通用 RPC |
| 前端 API | `src/api.ts` 已统一 Electron、开发预览和 Web 三种传输 | 直接扩展现有 `DesignCopilotApi`；不要另造第二套前端传输抽象 |
| Web 隔离 | `server/webServer.cjs` 已根据登录身份构造 `dataRoot/tenants/<tenantId>`，每租户创建独立服务上下文 | 助手数据必须挂在同一 `tenantRoot` 下；`conversation_id` 只是租户内选择器，不是安全边界 |
| UI 布局 | 主界面已有左侧导航、主工作区和可选的 316px 产物检查器；主区有最小宽度约束；1320px 断点把右列压到 **280px**、`--rail-w` 由 274 降到 244 | 再永久增加一个右栏会明显挤压画布；首版只与产物检查器复用同一右侧列，不增加覆盖式抽屉；280px 是助手布局的真实约束档位 |
| 前端运行状态 | PR #80 后，`App.tsx` 除 `busy/busyJob` 外还用 `FeedbackScope = workflow \| gallery \| global` 隔离通知；`.overlay-bar > *` 会接收指针事件 | 助手不能复用全局 busy 或默认 `global` 错误，也不能把面板反馈放入 `.overlay-bar`，否则会把刚修复的跨上下文遮挡问题重新引入 |
| 设计规范 | `docs/dev/FRONTEND-DESIGN-GUIDE.md` 1.3 是唯一设计事实来源；其 §5 已新增「常驻辅助列不使用 `.button--primary`」与服务端风险驱动的确认按钮等级，§2.4 已绑定助手语义色，§6.4 已定「凡卡片带橙色左边条，卡上按钮一律 `.button--ghost`」，§6.5 已定遮罩归属、UA 样式重置、受控 `cancel` / StrictMode 生命周期与既有弹窗迁移边界，§7 已补助手状态中文映射并区分应用文本与模型正文 | 助手的按钮等级、配色、弹窗实现与应用自有文案不是实现期的自由选择，而是 A0 必须锁定的既定裁定；违反即返工，不得记为「已知偏差」留到验收 |
| 窗口与断点 | `electron/main.cjs` 的 `minWidth: 1180` 与 `styles.css` 的 `body { min-width: 1180px }` 同源；四条 `@media` 中只有 1320 / 1240 在桌面端可达，1120 / 960 仅是 Web 窄窗的裁切后降级 | 助手只需适配 1320px 一档；人工验收不得把桌面不可达档位列为验收项，否则会漏测真正的 280px 约束 |
| 右列装配 | `App.tsx` 的 `.artifact-inspector` 带 `inert={galleryOpen}`，与 `.stage-rail`、`<main>` 是同一套图库隔离 | 助手复用该列必须同样带 `inert`；这同时使删除确认对话框不可能与图库态并存，不需要另写一套互斥逻辑 |
| 对话写入 | `jsonStore.cjs` 只提供完整 JSON 的目录、读取和原子写入；`galleryStore.cjs` 已有 `Promise` 单写者队列范式 | AssistantStore 自己用原生 `fs.appendFile` 追加 JSONL，并复用 Gallery 队列形状；只有出现第二个调用者时才抽公共 helper |
| 功能开关 | 当前 `electron/server/src` 没有 feature flag 先例；桌面和 Web 都已经通过 `AppConfig` 返回运行配置 | 只增加一个进程级开关，并随现有配置响应进入 Renderer；隐藏入口和后端拒绝必须同时生效 |
| 热点 | `registerIpc`、`handleApi`、`createProjectStore`、`createDesignPipeline` 已是高复杂度入口 | 新功能应通过一个小型共享服务接入，避免继续把所有逻辑堆进主入口 |

代码知识图谱对上述关键文件未记录解析缺口；`src` 范围只存在被 Git 忽略的 `.DS_Store`，不影响本次结论。该信号是尽力而为，关键行为同时以源码为准。

---

## 3. v1.0 审查结果

### 3.1 分级说明

- **P0 阻断**：不修复就可能跨项目污染、误写、重复执行或无法兑现核心承诺；不得进入生产实现。
- **P1 高风险**：可以编码，但大概率带来故障、返工或不可维护性；应在对应阶段前解决。
- **P2 优化**：不阻断首版，但应明确边界和后续升级条件。

### 3.2 问题清单

| 级别 | 问题 | 真实后果 | v1.2 处理 |
|---|---|---|---|
| P0 | 允许对话重绑到另一个项目 | 旧对话、摘要和待执行动作进入新项目，违反隔离承诺 | 项目绑定不可变；切项目只能创建新对话 |
| P0 | 本地回放与供应商 Thread 同时存在 | 上下文重复、删除不完整、恢复行为依赖供应商 | 首版只使用应用自有历史，不保存 `provider_thread_id` |
| P0 | 把项目写锁当完整事务锁 | 两个请求可读取同一旧版本，先后提交后一个过时结果 | 每个写动作提交前重新读取并做领域级 CAS；不持锁等待模型 |
| P0 | 取消语义混用 | UI 显示已停止，但供应商请求或图片任务仍在继续并可能落盘 | 首版只取消尚未开始的助手动作；下游取消延后到 job 级信号打通后 |
| P0 | 让模型接触批准、豁免或人工结论 | 提示注入可越过人类权限边界 | 永不注册此类工具，服务端再次校验动作名 |
| P0 | 确认接口先执行、后标记结果 | 双击或并发确认都可能在看到 `awaiting_confirmation` 后各执行一次 | 在对话单写者队列内先原子认领 `awaiting_confirmation → executing`；结果/错误持久化后重复确认只回放，不再执行 |
| P1 | 未验证 Agents SDK 与 Kunpo/OpenAI-compatible 网关兼容性 | 可能在模块格式、接口、工具调用、状态序列化处阻塞 | 首版不用 SDK；另设非阻断兼容性探针 |
| P1 | `conversation_id` 被描述为唯一安全边界 | 在线版可能漏掉租户归属校验 | 安全边界定义为租户根目录 + 服务端所有权；ID 仅作选择器 |
| P1 | `context_revision` 只覆盖三个输入 | 意图、艺术方向、引用和产物变化可能未被发现 | 动作记录真实领域 revision/version，不发明一个不完整总版本 |
| P1 | 工具风险分级与实际副作用不一致 | `save_intent_review_draft` 实际替换当前 Intent Review/requirement 并撤销确认，却被标成“不覆盖”；按钮和提示会误导用户 | 风险由服务端静态动作描述符给出 `writes_project/replaces_content/reversible/external_cost`，模型与 Renderer 无权声明或降低；首版任何写入都确认 |
| P1 | 语义记忆、自动抽取、MemoryPanel 同时引入 | 增加隐私、纠错、同步和迁移问题，且不属于核心期望 | 首版删除，仅保留历史和滚动摘要 |
| P1 | `operations.jsonl`、`runs/*.json` 双重记录 | 两份状态容易分叉，恢复逻辑复杂 | 运行与动作审计统一写入 `runs/<runId>.json` |
| P1 | `index.json` 与各对话 `meta.json` 双重记录 | 创建、重命名、删除在崩溃窗口内可能只更新一边，列表与真实目录分叉 | 删除索引；列举 `conversations/*/meta.json`，按 `updated_at` 排序；每个对话只保留一个单写者队列 |
| P1 | 把摘要阈值写成模型窗口百分比 | 任意模型上下文上限未知，无法稳定计算 | 用消息数和序列化字符上限触发，不引入 tokenizer |
| P1 | 能力探测保存为单个全局对象 | 换模型或换网关后复用过期结果，也会与现有图片 `providerCapabilities` 概念混淆 | 首版不保存也不运行时缓存；A0 的一次性验证命名为 `assistantGatewayProbe` |
| P1 | 新建永久右栏 | 与现有检查器共同压缩画布，小屏不可用 | 右侧辅助区互斥展示“助手/产物检查器” |
| P1 | §12 忽略 PR #80 的反馈作用域与覆盖层红线 | 助手错误若走默认 `global` 会跨入图库；覆盖层子元素可能吞掉背后点击 | 助手反馈只在面板内渲染；首版不新增 overlay/drawer，并增加图库上下文回归测试 |
| P1 | ActionCard 按钮等级未定 | 常驻右栏与主工作区 primary 同屏，触发指南禁区 10 | 面板内永不使用 primary；确认按钮按指南 §5 风险二分支（secondary / danger） |
| P1 | ActionCard 同时含「待确认」橙与金色按钮 | 违反指南 §4 金橙同组件互斥 | 待确认 ActionCard 保持中性；橙色只出现在对话列表 `.is-pending` 左边条，执行后卡片才按紫/绿/红呈现 |
| P1 | run 状态英文码可能直接上屏 | 违反指南禁区 7 | 指南 §7 已补助手映射；UI 一律走 `statusLabel`，stale 差异中的 status 同样映射 |
| P1 | 面板内五种反馈未定语义色 | 「正在思考」易被实现成灰或金，用户分不清模型在工作还是界面卡住 | 按指南 §2.4 绑定：thinking 紫、待确认/stale 橙、成功绿、失败/中断红、queued/cancelled 中性 |
| P1 | §15.3 验收档位含桌面不可达的 1120px | 真正的 280px 约束档没被验收，等于一条假验收项 | 改为桌面两档实测 + Web 一档临界窗宽 |
| P1 | 「不新增 z-index 层」与「删除二次确认」表述互斥 | 实现者会在内联弱确认与违规新建层之间二选一 | 明确复用 `.dialog-backdrop`(z-100) + `.utility-dialog`，复用不属新增层 |
| P1 | 把“模型正文必须全中文”写成可保证验收项 | 提示词不能保证输出语言；补语言检测/翻译又会增加误判与新失败面 | 应用自有按钮、状态、字段和错误保证简体中文；模型正文只用系统提示尽力约束，状态词永远走结构化映射 |
| P1 | §13.2 漏 `scripts/check-error-docs.cjs` | 该门禁按三个硬编码标题分段校验，当前无助手分组，加 `ASSISTANT_*` 后 `test:docs` 必挂 | A0 一次定全助手错误码清单，并同改 `errorCodes.cjs`、`ERROR-CATALOG.md` 与门禁分段表 |
| P2 | 未禁原生 `<select>`，未定 Composer 规格、字号阶梯与 BEM 类名 | 实现期风格漂移 | §12 逐项引用指南 §6.1 / §6.2 / §2.5 / §1 |
| P2 | 新增 `<userData>/assistant/` 与 `<tenantRoot>/assistant/` 未登记磁盘布局 | 人读事实源缺项 | §13.2 增加 `docs/dev/PROJECT-DIRECTORY.md` |
| P1 | 大量新组件、策略层和适配层 | 入口分散、状态重复、首版难以定位故障 | 后端三文件、前端一个主要功能组件起步 |
| P1 | Web SSE 缺少断线、背压和重放协议 | 断线后 UI 与服务端状态不一致，可能产生孤儿运行 | 首版同步返回；证明需要流式后再设计 run 序号与恢复 |
| P1 | 删除即“彻底删除”的表述不准确 | 原子替换、备份或回收目录可能仍保留内容 | 删除后先不可访问，再按明确保留期清理，不声称瞬时物理抹除 |
| P1 | `projectStore.open` 被当成纯读 | 打开项目会先迁移并可能执行 Intent 自愈；UI 在设计任务期间每 1200ms 轮询，助手再读会增加提议与确认之间的可见状态变化 | ContextBuilder 固定 Screen 并使用 `includePreviews: false`；明确该路径含自愈，stale 返回发生变化的具体 revision/version/status |
| P1 | `assistantModel` 只有配置字段、没有用户入口与作用域说明 | 用户只能手改文件；桌面全局与 Web 租户级行为不清楚；错误回退描述与现有硬编码默认值不一致 | 在现有 SettingsDialog 加“助手文本模型”；明确两端存储作用域及旧配置回退 |
| P1 | 功能开关只描述前端隐藏 | 桌面与 Web 可能读取不同开关，或 UI 隐藏后后端仍可调用 | 全仓只用一个 `GAME_UI_ASSISTANT_ENABLED`，经 `AppConfig.features.assistant` 下发，并在 IPC/HTTP 服务端同步门禁 |
| P2 | 同时支持多对话并行运行 | 首版收益低，却放大写冲突和取消难题 | 可以切换多个对话，但同一应用/租户首版只允许一个未完成 run |
| P1 | Q&A、执行、stale 与 queued 取消没有完整状态机 | 问答无法进入成功态、stale 无落点、等待确认期间能否继续发送不明确 | 分开定义问答与执行转换；`stale` 为终态；首版同一应用/租户只允许一个未完成 run |
| P1 | 对话归档没有恢复入口 | 用户可把对话变成永久不可选的死状态 | 首版删除归档能力；有可发现的归档列表与恢复入口后再加入 |
| P1 | 只复用弹窗类名、未复用模态行为 | 当前本地 `Modal` 没有 Escape、`aria-modal`、焦点限制与焦点归还 | 把现有 Modal 收敛为共享原生 `<dialog>`；`cancel` 必须走受控 `onClose`，`showModal()` effect 必须在 StrictMode 下可重复执行与清理 |
| P1 | 指南 §10 把「共享 Modal」记为 `ui.tsx` 现有控件 | 唯一设计事实来源指向不存在的组件（该文件无 Modal 导出，`src/` 内无任何 `<dialog>`），实现者会去找一个没有的导出 | 指南 §10 改为如实列出现有导出并把共享 Modal 标为**待建**；方案 §13.2 / §21 同步 |
| P1 | 指南 §6.5「二次确认一律」与方案 §13.2 文件清单矛盾 | 图库豁免与使用指南弹窗不在清单内，首版落地即违反「一律」，只能记为「已知偏差」——正是 §16.5 明令禁止的处理方式 | 指南收窄为「**新建的**二次确认一律」；首批只迁移 App 局部 Modal 的 SettingsDialog、ProjectManager，并供助手删除确认复用，NewProjectDialog、图库豁免与使用指南均延后 |
| P1 | 遮罩归属虽定，但漏了原生 dialog 的 UA 几何限制 | Chromium 中只加 `inset: 0` 仍会受 UA `max-width`、`max-height`、margin 与 border 影响，实测元素只包住内容，§12.6 的视口覆盖断言会失败 | 保留 `:668` 既有规则，另补 `dialog.dialog-backdrop` 的 100% 宽高、无最大尺寸、零 margin/border 重置；`::backdrop` 继续置透明 |
| P1 | 把 Escape 描述成 dialog「自行吃掉」且漏受控状态同步 | Chromium 实际先触发 `window keydown`，再触发 `cancel` / `close`；若不 `preventDefault()` 并调用 `onClose`，DOM 会关闭而 React 状态仍为 true，随后无法重开 | 共享 Modal 监听 `cancel` 并走受控关闭；测试 Escape 关闭后重开、焦点归还与 StrictMode 双 effect；图库迁移前仍先补其分支测试 |
| P1 | 共享 Modal 迁移范围写错 | `App.tsx:24` 局部 Modal 的调用者是 SettingsDialog 与 ProjectManager；NewProjectDialog 是独立遮罩且首次建项目可无 `onClose` | 首批只迁移 SettingsDialog、ProjectManager，并让助手删除确认复用；NewProjectDialog、图库豁免、使用指南均延后 |
| P2 | jsdom 未实现 `HTMLDialogElement.showModal/close` | Vitest 环境直接渲染共享 Modal 会因方法不存在而失败，或诱导生产代码兼容测试环境 | 只在 `App.test.tsx` 增加最小 dialog shim；真实 top layer、Tab、Escape 与几何继续由 Playwright 验证，不加依赖 |
| P2 | `stale` 卡的「重新生成计划」按钮等级未定 | 该卡带橙色左边条，实现者按惯性取 `.button--secondary` 即重现 §4 金橙同卡——裁定二的漏洞只是从待确认态挪到终态 | 固定 `.button--ghost`（§9.2 / §12.4 / §12.6 第 9 条 / §15.1 / §18）；指南 §6.4 补通用条款「凡卡片带橙色左边条，卡上按钮一律 ghost」 |
| P2 | §12.6 第 11 条曾断言 `::backdrop` 的计算样式 | 伪元素计算样式在 Chromium 上不可靠，属会假通过/假失败的断言，与已修正的第 10 条同类错误 | 改为断言 `<dialog>` 自身带 `.dialog-backdrop`、经 UA reset 后 `getBoundingClientRect()` 覆盖视口、计算 `backgroundColor` 等于 `rgba(5,6,9,0.66)`；`::backdrop` 中和规则改由样式源核对 + 代码审查确认 |
| P2 | §13.2 与 §21 仍引用指南「1.1 版 / v1.1」 | 指南已随本轮修订升到 1.3，交叉引用过期会让实现者读到旧条款 | 两处版本号同步为 1.3，并在 §21 列出助手相关条款锚点 |

### 3.3 Ponytail 过度工程结论

v1.0 的主要过度工程不在安全校验，而在“尚未证明需要的通用性”：

- 为单助手提前建设通用 Agent Provider、Policy、Memory、RunState、Operations、SSE 重放和十余个 UI 子组件；
- 在当前只支持 Chat Completions JSON 返回的网关上，预先设计工具流式传输和 SDK 状态恢复；
- 把已有 UI 操作包装成 AI 工具，例如下载、导出、归档和取消，而用户点击现有按钮更直接、更可靠；
- 为未来并行运行设计复杂锁策略，但首版完全可以限制为一个未完成 run；
- 为“记住用户说过的话”建设语义记忆数据库，而对话历史和滚动摘要已经覆盖首版需求。

应保留的复杂度包括：租户隔离、项目与 Screen 绑定、服务端动作白名单、版本检查、显式确认、原子持久化、输入长度限制、敏感信息脱敏和可执行测试。这些不是过度工程，而是避免数据损坏和权限越界的最低成本。

---

## 4. v1.2 产品边界

### 4.1 首版必须提供

1. 右侧辅助区中的助手入口；
2. 新建、切换、重命名、删除对话；
3. 对话绑定当前 `project_id + screen_id`，绑定创建后不可变；
4. 项目/Screen 不匹配时仍可阅读旧对话，但不能继续发送或执行；提供“一键为当前目标新建干净对话”；
5. 基于服务端构建的真实项目上下文进行问答；
6. 历史消息与滚动摘要在重启后恢复；
7. “问答”和“执行”两种入口；
8. 执行请求最多产生一个待确认动作；
9. 动作卡展示目标、原因、输入版本、覆盖范围、成本提示和不可逆影响；
10. 用户确认后重新读取状态并校验版本，再调用已有领域服务；
11. 真实结果回读和错误解释；
12. 桌面版与在线版共用同一核心服务；
13. 功能开关默认关闭，可安全回滚。

### 4.2 首版明确不做

- 多 Agent、Agent 间转交、自动长链任务；
- 对话归档与恢复；仅有归档没有恢复是死状态，首版不交付；
- 供应商托管 Thread/Conversation 状态；
- 向量库、Embedding、跨对话语义记忆；
- 自动记忆提取、记忆编辑页和 MemoryPanel；
- MCP、Computer Use、Shell、任意文件读写、任意网络请求；
- 并行运行多个助手请求；
- 助手触发项目归档、文件下载、最终导出；
- 助手取消正在进行的图片任务或设计阶段；
- 助手执行批准、驳回、豁免、人工验收结论；
- 为没有实际需求的模型供应商抽象一个通用适配框架；
- 在没有真实能力证明前提供流式输出、断点续传和 SDK RunState 恢复。

### 4.3 后续能力的进入条件

只有出现以下真实证据时才升级：

| 候选能力 | 进入条件 |
|---|---|
| Agents SDK | 需要一次运行连续调用多个工具，且兼容性探针证明当前网关支持必需协议 |
| 流式/SSE | 用户可感知等待时间成为主要问题，且服务端能提供真实增量事件 |
| 多运行并发 | 有明确并行使用数据，并已实现 job 级取消和动作级 CAS |
| 语义记忆 | 滚动摘要无法解决的跨长对话召回问题被真实复现 |
| 跨 Screen 协作 | 用户确实需要携带同一对话操作多个 Screen，并有明确的目标切换交互 |
| 更多写工具 | 对应领域服务已有输入校验、版本检查、幂等和测试 |

---

## 5. 简化后的系统结构

```text
AssistantPanel
    │
    ▼
现有 DesignCopilotApi
    ├── Electron IPC 白名单
    └── Web 同源 HTTP 路由
            │
            ▼
AssistantRuntime
    ├── AssistantStore        对话、消息、摘要、运行审计
    ├── ContextBuilder        从现有服务读取最小上下文
    ├── KunpoClient           复用当前 Chat Completions JSON 能力
    └── AssistantTools        严格动作白名单，调用现有领域服务
                                  ├── intentStateStore
                                  ├── projectStore
                                  ├── designPipeline
                                  ├── underlayCritique
                                  ├── compositionPreview
                                  └── fidelityCheck
```

关键原则：

- 模型只负责解释和提出动作，不拥有权限；
- `AssistantRuntime` 只编排，不复制领域规则；
- `AssistantTools` 是薄适配器，不直接读写项目文件；
- `AssistantTools` 必须在项目锁之外调用公开领域方法，既不获取 `withProjectWriteLock`，也不访问 `projectStore.__unsafe`；
- Renderer 不提交根目录、文件路径、租户 ID 或可执行工具名；
- 服务端从当前登录租户和已绑定对话推导全部目标；
- 任何写动作都在确认时重新读取真实状态；
- 不在持有项目写锁时等待模型或外部供应商。

---

## 6. 对话与数据设计

### 6.1 隔离边界

桌面版的存储根：

```text
<userData>/assistant/
```

在线版的存储根：

```text
<dataRoot>/tenants/<tenantId>/assistant/
```

真正的在线安全边界是 `tenantRoot` 和服务端所有权检查。`conversation_id` 只是租户目录内部的随机标识，不能替代身份验证与租户隔离。

每个对话在创建时绑定：

```json
{
  "project_id": "project-uuid",
  "screen_id": "screen-uuid"
}
```

绑定字段不可修改。切换项目或 Screen 时，用户可以查看旧对话，但继续工作必须新建空白对话。首版不提供“重绑”“复制记忆到新目标”或“继承上一对话”。

### 6.2 最小目录结构

```text
assistant/
├── conversations/
│   └── <conversationId>/
│       ├── meta.json
│       ├── messages.jsonl
│       ├── summary.json
│       └── runs/
│           └── <runId>.json
└── .trash/
    └── <conversationId>/
```

相对 v1.0 删除：

- `memories.json`：没有首版必要性；
- `operations.jsonl`：运行文件已经可以承担动作审计；
- 供应商 Thread ID：首版不使用供应商持久会话。

### 6.3 `meta.json`

```json
{
  "schema_version": "1.0",
  "conversation_id": "uuid",
  "title": "主视觉方向梳理",
  "project_id": "project-uuid",
  "screen_id": "screen-uuid",
  "created_at": "2026-09-03T10:00:00.000Z",
  "updated_at": "2026-09-03T10:10:00.000Z"
}
```

约束：

- `project_id`、`screen_id`、`conversation_id` 创建后不可变；
- 标题和时间由服务端写入；
- 标题有长度上限并去除控制字符；
- Renderer 传入的同名字段一律忽略或拒绝。

首版不维护 `index.json`。列举对话时只扫描 `conversations/*/meta.json`，验证目录名与 `conversation_id` 一致后按 `updated_at` 排序；损坏目录隔离并报告，不让一条坏记录阻断其他对话。对首版预期的本地对话规模，O(n) 扫描比维护第二份索引更可靠；只有真实测量证明扫描成为瓶颈后才引入 SQLite 或可重建索引。

### 6.4 `messages.jsonl`

每行只存用户或助手可见消息：

```json
{"id":"uuid","seq":1,"role":"user","content":"帮我看当前方向还缺什么","created_at":"2026-09-03T10:00:00.000Z"}
```

规则：

- `role` 只允许 `user | assistant`；
- 不把工具结果、系统提示、API 请求体或供应商原始响应混入聊天记录；
- 单条消息限制字符数，建议首版 20,000 字符；
- 写入前移除 NUL 和不可见控制字符；
- 读取时按 `seq` 排序并拒绝重复序号；
- 下一序号在对话单写者队列内从最后一条完整、合法 JSONL 记录推导，不在 `meta.json` 复制计数；空文件从 1 开始；
- 只允许恢复末尾一行因进程中断造成的半写入；中间损坏必须停止该对话并提示修复，不能静默跳过；
- 消息文件只追加，不就地重写历史。

### 6.5 `summary.json`

```json
{
  "schema_version": "1.0",
  "through_seq": 40,
  "summary": "用户希望保持暗黑奇幻，并要求按钮在移动端仍清晰……",
  "updated_at": "2026-09-03T10:20:00.000Z"
}
```

首版摘要策略：

- 完整历史始终保留，摘要只是上下文缓存，不是事实源；
- 达到固定消息数或序列化字符上限时触发，例如 30 条或 60,000 字符；
- 摘要只能覆盖 `through_seq` 之前的消息；
- 进入模型的上下文为：一份旧摘要 + 摘要后的最近消息；
- 不根据未知模型窗口计算百分比，不引入 tokenizer 依赖；
- 摘要生成失败时继续使用裁剪后的最近消息，不阻断用户发送。

### 6.6 `runs/<runId>.json`

运行文件同时承担状态、待确认动作和审计，不再维护第二份 operation 日志：

```json
{
  "schema_version": "1.0",
  "run_id": "uuid",
  "conversation_id": "uuid",
  "status": "awaiting_confirmation",
  "mode": "execute",
  "request_message_id": "uuid",
  "context": {
    "project_id": "project-uuid",
    "screen_id": "screen-uuid",
    "input_revisions": {},
    "artifact_versions": {}
  },
  "proposed_action": {
    "action_id": "uuid",
    "name": "save_intent_review_draft",
    "reason": "把本轮意图审查保存为当前草稿",
    "args": {},
    "risk": {
      "writes_project": true,
      "replaces_content": true,
      "reversible": false,
      "external_cost": false
    }
  },
  "result": null,
  "error": null,
  "created_at": "2026-09-03T10:00:00.000Z",
  "updated_at": "2026-09-03T10:00:10.000Z"
}
```

允许状态和转换按运行类型分开定义：

```text
问答：queued → running → succeeded | failed
执行提议：queued → running → awaiting_confirmation → executing → succeeded | failed | stale
用户取消：queued → cancelled；awaiting_confirmation → cancelled
应用重启：queued | running | executing → interrupted
```

`succeeded`、`failed`、`stale`、`cancelled`、`interrupted` 都是终态。首版不自动恢复 `queued`、`running` 或 `executing`；重启后统一标记 `interrupted`，由用户重新发起。`awaiting_confirmation` 可以恢复展示，但确认时必须重新做版本检查。一个问答 run 在写入助手回复后必须进入 `succeeded`，不能永久停在 `running`。

`result` 只保存回读后的最小结构化结果（如新 revision/version 与 `noop`），`error` 只保存稳定错误码、中文安全说明和允许公开的差异；二者都有大小上限，不保存供应商原文、路径或完整项目对象。ActionCard 直接从 run 渲染终态结果，不再把同一执行结果复制成第二份 `messages.jsonl` 事实。需要额外解释时，由用户发起下一条普通问答。

首版并发上限精确定义为：同一桌面应用实例或在线租户最多存在一个**未完成 run**，即状态属于 `queued | running | awaiting_confirmation | executing`。等待确认期间必须先确认或取消，不能再发送第二个请求；任一终态会释放该名额。该限制同时避免一人积累多个过期待确认动作。

上述状态值**只允许出现在存储文件、服务端响应和测试断言中**，不得直接上屏。按指南 §7 的中文状态映射硬约束，助手运行状态使用以下映射（已写入指南 §7，作为唯一事实来源）：

| 状态码 | 中文 | 语义色（指南 §2.4） |
|---|---|---|
| `queued` | 排队中 | 中性（`--muted` + `--panel-2`） |
| `running` | 正在思考 | 紫（AI 进行中） |
| `awaiting_confirmation` | 待确认执行 | 橙（仅对话列表待办；ActionCard 内中性） |
| `executing` | 执行中 | 紫（AI 进行中） |
| `succeeded` | 已完成 | 绿（通过） |
| `failed` | 失败 | 红 |
| `cancelled` | 已停止 | 中性 |
| `interrupted` | 已中断 | 红（异常终止，与 `failed` 同族） |
| `stale` | 需更新 | 橙（需重新生成动作） |

当前基线的 `src/features/shared/ui.tsx:54-56` 尚未包含 `queued/running/awaiting_confirmation/executing/succeeded/interrupted`，未知值会原样返回。A1 必须先补齐这些映射并用渲染测试锁住；不能直接依赖当前 fallback，否则英文码会静默上屏。`stale/failed/cancelled` 继续复用既有映射。

两条不得含糊的语义区分：`succeeded` 表示"动作已提交成功"，**不得译为「已批准」**——批准是人类权限结论，助手永远无权产出（见 §9.1 最后一行）；`interrupted` 表示"进程重启导致运行未完成"，与"领域服务返回失败"是两件事，文案不得合并为同一句。

### 6.7 并发写入

只实现每个 `conversation_id` 一个进程内单写者队列，保护 meta、消息、摘要和 run 状态的一致顺序。创建使用随机 UUID + 原子目录创建，不需要全局索引队列；列举直接读取各目录的 `meta.json`。

完整 JSON 文件继续复用 `jsonStore.writeJson` 的临时文件 + rename 原子替换。`jsonStore.cjs` 当前没有 JSONL append 能力，首版也不为了一个调用者扩展它：

- `assistantStore.cjs` 在对话单写者队列内直接使用 Node 原生 `fs.appendFile` 写入一行；
- 队列形状沿用 `galleryStore.cjs` 的 `writeQueue.catch(() => {}).then(operation)` 和无拒绝尾部做法，保证前一次失败不会毒死后续队列；
- 队列属于 AssistantStore，不能误用 `withProjectWriteLock`；二者保护的对象和生命周期不同；
- 文件打开、追加或同步失败时返回明确错误；下一 `seq` 只以磁盘上最后一条完整记录为准；
- 只有出现第二个真实 JSONL 调用者时，才把 append 逻辑上提为公共 helper。

这个队列只覆盖当前代码的单进程桌面/单进程 Web 服务模型。若未来同一 `assistantRoot` 被多个服务进程同时写入，进程内 Promise 队列不再成立；届时直接迁移到 SQLite 事务或系统级文件锁，不叠加第二层自制分布式队列。

### 6.8 删除与保留

删除分两步：

1. 在对话队列内把目录原子移动到 `.trash/<conversationId>`；列举只扫描 `conversations/`，因此移动成功后用户立即无法访问；
2. 后台尽力清理回收目录，可采用 7 天固定保留期或启动时清理。

文案必须写“已从应用中删除并等待清理”，不能承诺磁盘上瞬时、不可恢复地抹除。任何日志都不得包含消息正文或摘要正文。

---

## 7. 上下文构建

### 7.1 上下文来源

每次请求都由服务端根据对话绑定读取：

- 项目元数据和当前 Screen 元数据；
- 当前工作流阶段、阶段状态、失败原因和错误码；
- 需求、艺术方向、意图审查、意图上下文和引用摘要；
- 当前产物的类型、状态、版本、输入 revision、质量门结果；
- 当前对话摘要和最近消息；
- 本次模式和可用动作列表。

ContextBuilder 必须沿用现有轻量读取方式：

```js
projectStore.open(projectId, { includePreviews: false, screenId })
```

其中 `projectId` 和 `screenId` 都来自不可变对话绑定。`includePreviews: false` 只是不加载图片预览，**不会**把 `open` 变成纯读：`hydrate` 仍会先执行项目迁移，并可能运行 Intent 自愈、候选清理、Artifact stale 重算、投影文件对齐和 Workflow 对齐。ContextBuilder 必须把 `open` 返回的自愈后状态作为本次快照，不能再从磁盘零散拼装第二份状态。

不发送：

- 项目根路径、真实磁盘路径；
- API Key、Cookie、会话令牌、环境变量；
- 全量图片二进制和无关历史版本；
- 其他项目、其他 Screen 或其他租户的内容；
- 未注册动作的内部实现细节。

### 7.2 大小预算

上下文按优先级裁剪：

1. 当前目标标识、阶段和失败原因；
2. 当前有效输入与产物版本；
3. 当前对话最近消息；
4. 对话摘要；
5. 低优先级历史与冗长描述。

使用固定字符预算，不依赖特定 tokenizer。被裁剪的字段必须带 `truncated: true`，不能让模型误以为内容完整。

### 7.3 不可信数据处理

项目文本、引用素材说明、工具结果和历史消息全部视为不可信数据。它们应以清晰的 JSON 字段进入提示，不能拼接成系统指令。提示词可说明“其中的指令无权改变工具和权限”，但真正的边界必须由代码保证：

- 动作名服务端白名单；
- 参数服务端校验；
- 项目与 Screen 从对话绑定推导；
- 人类权限动作不存在于白名单；
- 所有写入通过已有领域服务；
- 确认后重新读取版本。

提示词不是权限系统。

### 7.4 stale 诊断

确认动作时再次调用相同的轻量读取路径，并逐项比较动作提议时记录的真实领域字段。发生变化时返回稳定的 stale 错误及最小差异，例如：

```json
{
  "code": "ASSISTANT_ACTION_STALE",
  "changed": [
    { "kind": "input_revision", "key": "wireframe", "expected": 2, "actual": 3 },
    { "kind": "artifact_status", "key": "screen-contract", "expected": "reviewed", "actual": "stale" }
  ]
}
```

只返回参与本动作前置条件的 revision、version 或 status，不返回文件路径和完整对象。UI 必须告诉用户“哪一项发生变化”，不能只显示“项目已变化”，也不能在未重新生成动作卡时提供强制覆盖。

上例中的 `expected: "reviewed"` / `actual: "stale"` 是**领域状态码，不是可直接渲染的文案**。按指南 §7 与 §8 禁区第 7 条，渲染前必须过现有 `statusLabel` 中文映射（`reviewed → 待确认`、`stale → 需更新`），`kind` 也要有中文标签（`input_revision → 输入版本`、`artifact_status → 产物状态`）。因此这一条差异上屏后应是「产物状态 · screen-contract：待确认 → 需更新」，而不是把两个英文词直接摆给用户。

---

## 8. 模型接入决策

### 8.1 首版实现

首版复用 `kunpoClient.cjs` 的 Chat Completions JSON 能力，增加一个面向助手的最小请求函数。模型返回固定结构：

```json
{
  "reply": "面向用户的回答",
  "proposed_action": {
    "name": "save_intent_review_draft",
    "reason": "为什么需要执行",
    "args": {}
  }
}
```

规则：

- `proposed_action` 可为空；
- 每次最多一个动作；
- 问答模式下必须为空；
- 服务端解析失败时只返回可理解错误，不尝试从自然语言猜工具；
- 模型给出的动作名不在当前白名单时直接拒绝；
- 模型输出不能直接成为项目写入；
- 系统提示必须固定要求 `reply` 与 `proposed_action.reason` 优先使用**简体中文**；技术专名、代码和用户明确要求的其他语言除外；
- 系统提示同时禁止模型在 `reply` 中输出裸状态码或英文状态词代替中文状态；
- 首个写动作执行后不自动再调用一次模型；ActionCard 用应用自有中文字段展示结构化结果。用户需要解释时再发送普通问答，避免一次确认隐式产生第二次费用与第二份结果正文。

关于语言约束的落点，必须区分**应用可保证**与**模型尽力遵守**两部分：

- 可保证：按钮、状态、阶段标签、动作卡字段名、错误标题、placeholder 和 title 一律由应用以简体中文提供；状态值从**存储的状态码和结构化字段**经 §6.6 / `statusLabel` 渲染。模型 `reply` 里的词不参与状态胶囊或动作风险呈现。
- 尽力遵守：`reply` / `reason` 是模型产出，系统提示要求简体中文，但提示词不等于输出保证。首版**不做**语言检测、自动翻译或因语言拒绝整段回复；验收只检查提示词约束与应用自有文本/状态映射，不把“模型正文永不夹英文”写成不可兑现的硬断言。

这条路径没有通用 Agent 循环、SDK 状态或供应商 Thread，因此恢复面更小，也与当前网关能力相符。

### 8.2 `assistantModel` 配置

在 `models.json` 中只新增：

```json
{
  "schema_version": "1.1",
  "assistantModel": "qwen3.5-plus",
  "visionModel": "...",
  "critiqueModel": "...",
  "imageModel": "..."
}
```

配置作用域必须与现有 `models.json` 一致：

- 桌面端：`app.getPath('userData')/models.json`，对当前桌面应用用户全局生效；
- Web 端：`<tenantRoot>/user/settings/models.json`，只对当前租户生效。

在现有 `App.tsx` 内联 `SettingsDialog` 增加“助手文本模型”输入项，并随已有 `saveModelConfig` 一次保存。不要新建 `AssistantSettings.tsx`。`AppConfig.kunpo`、Electron IPC 返回、Web `/api/config` 返回、保存响应和 `src/vite-env.d.ts` 必须同时增加 `assistantModel`。

旧配置读取回退顺序：

```text
models.json.assistantModel → 当前有效 visionModel
```

当前有效 `visionModel` 已经包含 `models.json → KUNPO_VISION_MODEL → google/gemini-3.1-flash-lite` 的既有回退，因此旧 `1.0` 文件无需迁移即可得到可用助手模型。设置弹窗应显示这个有效值，用户保存后才把它写成显式 `assistantModel`。不要在字段缺失时新增与现有行为不一致的启动报错；只有 Kunpo 网关未配置、模型名为空保存失败或供应商明确拒绝模型时才报错。

保存逻辑必须保留 `assistantModel`、`visionModel`、`critiqueModel`、`imageModel` 四个已知字段，并让 `modelSource` 在只配置 assistantModel 时也正确指向 `models.json`。能力探测结果不写入配置，首版也不增加运行时探测缓存。

### 8.3 Agents SDK 的后续 `assistantGatewayProbe`

Agents SDK 不在首版关键路径。如果未来需要多步工具循环或 SDK 审批恢复，必须先用一个命名为 `assistantGatewayProbe` 的独立、可删除探针验证：

1. 能在 Electron 当前 Node/CommonJS 服务中稳定加载；
2. 能通过**实际 Kunpo/OpenAI-compatible 网关地址**完成一次普通文本请求；
3. 能稳定完成一次严格函数调用和工具结果续写；
4. 能暂停、序列化、重启并恢复待审批运行；
5. `AbortSignal` 能真正传递到网络请求；
6. 供应商状态与追踪可以关闭，应用仍完全掌握历史；
7. 失败时不会退化为自然语言解析工具指令。

七项全部通过后，才可把 SDK 作为“运行循环与审批状态机”，而不是让它接管项目存储、权限和领域规则。未通过则继续使用当前有界协议。

OpenAI 官方文档也把“应用自行控制循环、状态和工具”与“使用 Agents SDK 的内建循环、会话和可恢复审批”作为不同取舍；会话文档明确建议同一会话选择一种状态策略，避免把本地回放与服务端状态混用。本方案因此只保留本地会话策略。

---

## 9. 动作与权限

### 9.1 首版动作等级

首版不建设通用权限引擎，采用一个静态白名单表：

| 动作 | 读取 | 写项目 | 替换内容 | 用户可逆 | 外部费用 | 首版状态 |
|---|---:|---:|---:|---:|---:|---|
| 读取项目上下文 | 是 | 否 | 否 | 不适用 | 否 | 由服务端自动完成，不作为模型工具 |
| `save_intent_review_draft` | 是 | 是 | **是** | **否** | 否 | 首个可写动作，必须确认且使用 danger |
| `run_pipeline_stage` | 是 | 是 | 接入前固定 | 接入前固定 | 接入前固定 | 延后到对应阶段有 CAS 后 |
| `update_draft_artifact` | 是 | 是 | 是 | 接入前固定 | 否 | 延后到通用 artifact CAS 后 |
| `run_underlay_critique` | 是 | 是 | 接入前固定 | 接入前固定 | 是 | 延后；必须显示费用提示 |
| `create_composition_preview` | 是 | 是 | 接入前固定 | 接入前固定 | 视实现而定 | 延后；先补版本检查 |
| `run_fidelity_check` | 是 | 是 | 接入前固定 | 接入前固定 | 否 | 延后；先补输入版本检查 |
| 归档项目 | 是 | 是 | 是 | 否 | 否 | 不接入，使用现有 UI |
| 下载/导出 | 是 | 是/文件系统 | 是 | 否 | 否 | 不接入，使用现有 UI |
| 取消管线阶段 | 是 | 是 | 否 | 视阶段 | 可能 | 不接入，等待 job 级取消 |
| 批准/驳回/豁免/人工验收 | 是 | 是 | 是 | 否 | 否 | 永不提供给模型 |

风险不是模型响应契约的一部分。模型只返回 `name/reason/args`；服务端校验动作名后从静态动作描述符附加 `writes_project/replaces_content/reversible/external_cost`，Renderer 只读展示。任何缺字段或未知描述符都按拒绝处理，不能默认降为低风险。

`save_intent_review_draft` 必须标为 `replaces_content: true, reversible: false`：真实 `saveIntentReview` 会替换当前 `intent_review` 与渲染后的 `requirement`，并把 `requirement_confirmed` 重置为 `false`。即使底层保存了历史快照，当前产品没有面向用户的恢复入口，因此不能把“底层留痕”冒充“用户可逆”。

### 9.2 动作卡

任何写动作都展示：

- 动作名称和自然语言说明；
- 目标项目与 Screen；
- 将读取和写入的领域对象；
- 提议时记录的输入 revision / artifact version；
- 是否覆盖现有内容；
- 是否会触发外部模型或图片费用；
- 可取消或不可逆部分；
- 一对按钮：确认 + 取消。

**按钮等级按服务端动作风险二分支，不得使用 `.button--primary`**（指南 §5 已定：常驻辅助列内不使用实心金主按钮，因为右列与主工作区必然同屏，同屏唯一 primary 的红线在这里是“必然冲突”而非“可能冲突”）：

| `proposed_action.risk` | 确认按钮 | 取消按钮 |
|---|---|---|
| `replaces_content: false` 且 `reversible: true` | `.button--secondary`（金字金描边淡金底） | `.button--ghost` |
| `replaces_content: true` 或 `reversible: false` | `.button--danger`（实心红） | `.button--ghost` |

这个二分支与状态布局共同让指南 §4 的金橙互斥**由构造成立**：待确认 ActionCard 自身保持中性，橙色只落在对话列表项；确认按钮要么是金（不替换且可逆），要么是红（替换或不可逆）。`external_cost: true` 时**不改变按钮等级**，只在卡片正文加一行中性费用说明（见下）。

**卡片配色规则**（指南 §6.4 / §8 禁区第 12 条）：

- 费用提示是**事实说明**，不是待处理状态。写 `--muted` 文字 + `--panel-2` 底，禁止用 `--warning` 橙条或橙字，否则一次点击就"看起来像出了事"，橙色语义（有事待你处理）会被稀释。
- `awaiting_confirmation` 的 ActionCard 使用中性描边和中性文字，不使用橙色左边条或状态胶囊；`executing` 用紫、`succeeded` 用绿、`failed`/`interrupted` 用红、`stale` 用橙、`cancelled` 用中性。每种颜色旁必须有 §6.6 中文文本。
- **带橙色左边条的卡片，卡上按钮一律 `.button--ghost`**（指南 §6.4）。`stale` 卡会同时有橙色左边条和「重新生成计划」按钮，若实现者按惯性取 `.button--secondary`，金与橙就落在同一组件上——正是裁定二要消除的 §4 违规，只是从待确认态挪到了终态。红色 `.button--danger` 同样禁止：`stale` 不是不可逆写入，用 danger 会把「计划过期」误报成「即将覆盖」。
- 动作卡内**不放状态胶囊**。待确认状态已经在对话列表表达；卡片进入执行或终态后才用 2-3px 左边条表达结果。

**"有一个动作待你确认"的跨消息提示**放在**对话列表项**上，不放在面板正文：当前对话存在 `awaiting_confirmation` 的 run 时，列表项显示 2-3px 橙色左边条（`.is-pending`）+ 中文副标「待确认执行」。这样用户切走再切回来能立刻定位，而不需要在消息流里翻找那张卡。

确认按钮只提交 `conversation_id + run_id + action_id`。Renderer 不回传动作参数，防止页面修改已经审阅的计划。

### 9.3 确认时执行顺序

```text
1. 验证当前用户/租户拥有 conversation
2. 验证 run 属于 conversation，且 action_id 完全匹配服务端保存值
3. 在该 conversation 的单写者队列内原子认领：仅允许 awaiting_confirmation → executing，并先持久化
4. 若已是 executing，返回 `ASSISTANT_ACTION_IN_PROGRESS`；若已是终态，直接返回已保存的 result/error，不再次执行
5. 释放对话队列后，重新打开绑定项目与 Screen
6. 比较动作记录的真实领域 revision/version
7. 不一致则把 run 持久化为 stale + error，不自动重算或覆盖
8. 一致则从锁外调用已有领域服务公开方法
9. 回读持久化结果，并把最小、脱敏的结构化 result 或 error 写入 run 终态；ActionCard 直接展示该终态
```

不要在认领到领域调用之间调用模型。模型计算发生在动作提议阶段；确认阶段只做版本校验与领域调用。对话队列只保护第 3、4、7、9 步的 run 状态持久化，不在领域调用或外部请求期间长期占用。执行结果只以 run 为事实源，不再向消息文件复制一份可能分叉的结果记录。

`AssistantTools` 从锁外调用第 7 步的公开领域方法。它不得先调用 `projectStore.__unsafe.withProjectWriteLock` 再调用公开方法，否则公开方法会排在当前锁尾部等待自己，形成自等待死锁；也不得直接调用其他 Unsafe 原语绕过公开入口的 CAS、失效传播和审计。

### 9.4 CAS 与现有项目锁

现有项目写锁继续保留，但它只负责串行写入，不能替代乐观并发检查。

- 意图审查直接使用已有 `expectedIntentReviewRevision`；
- Artifact 更新应在领域服务中增加 `expectedArtifactVersion`，而不是只在助手适配器外检查；
- 管线阶段应记录实际依赖的 `input_revisions` 和被替换 artifact version；
- 如果动作执行前版本变化，返回稳定的 stale 错误，要求用户重新生成动作卡；
- 禁止“最后写入者获胜”覆盖另一个窗口或另一个对话的修改；
- 禁止为了避免冲突而在整个模型调用期间持有项目锁；
- `AssistantTools` 自身不获取项目锁，只从锁外调用公开领域方法；
- 如果一个动作确实需要多次项目写入保持原子性，应在所属领域服务中增加一个目的明确的公开复合方法：该方法内部只获取一次 `withProjectWriteLock` 并调用 Unsafe 原语，AssistantTools 仍只调用这个公开方法。

根因修复应落在共享领域入口。仅在助手工具里加一次检查，会让现有 UI、未来 API 或其他调用者仍然存在同类竞态。

### 9.5 幂等

每个动作只有一个 `action_id`。执行入口必须满足：

- `awaiting_confirmation → executing` 必须在对话单写者队列内先落盘；不能先做领域写入再改状态；
- 同一 `action_id` 进入任一终态后重复确认，返回 run 中第一次保存的 `result`/`error`，不再次写入；
- 执行中重复确认，返回稳定的 `ASSISTANT_ACTION_IN_PROGRESS` 响应；
- 失败后是否允许用户重试由具体领域动作决定；允许时也必须基于最新状态生成新的 run/action_id，不能复用旧确认请求自动重试；
- 外部费用动作默认不自动重试；
- `run_id` 只组织一次请求，不能替代动作幂等键。

这保证同一进程内的并发确认不会双写。若进程在领域服务已提交、但 run 的 `result` 尚未落盘时崩溃，重启后该 run 标记为 `interrupted` 并显示“执行结果未知，请刷新项目状态”；不得自动重放。要获得跨崩溃严格 exactly-once，必须由对应领域入口持久化 `action_id` 或进入同一数据库事务，不能由 AssistantStore 的两份文件假装完成。

---

## 10. 运行、取消和恢复

### 10.1 首版并发上限

首版每个桌面应用实例或在线租户只允许一个未完成助手 run（`queued | running | awaiting_confirmation | executing`）。用户仍可以切换、查看和管理其他对话，但必须先让当前 run 进入终态，才能发送第二个请求。

这是有意的简化上限：当真实使用证明需要并行，并且 job 级取消与领域 CAS 已完备后，再升级为每项目或每对话队列。

实现时应留下类似注释：

```text
ponytail: 首版每租户一个未完成助手 run；出现真实并行需求且 job 级取消/CAS 完成后改为按项目队列。
```

### 10.2 “停止”语义

首版只承诺：

- 队列中尚未开始的助手请求可以取消；
- 等待用户确认的动作可以取消；
- 尚未进入领域服务的动作不会执行。

首版不承诺：

- 中断已经发往供应商的请求；
- 中断正在执行的图片任务；
- 撤销已经成功提交的领域写入。

在 UI 中应使用“取消待执行动作”而不是误导性的“立即停止所有工作”。等 `AbortSignal` 能从 AssistantRuntime 一直传到 `kunpoClient.fetch`，且设计管线拥有真实 `job_id` 后，才提供强取消。

### 10.3 重启恢复

- `queued/running/executing` 在启动时标记为 `interrupted`；其中 `executing` 必须提示执行结果可能未知；
- 不自动重发模型请求，也不自动重做写入；
- `awaiting_confirmation` 可以重新展示；
- 用户确认恢复的动作时仍须做最新版本检查；
- 历史对话、摘要以及 run 中已持久化的成功结果正常恢复；
- 无法解析的运行文件隔离并显示错误，不影响其他对话。

---

## 11. 桌面与在线传输

### 11.1 共用服务

创建一次 `createAssistantRuntime({ assistantRoot, modelConfig, domainServices })`，桌面和在线只负责把已验证身份与根目录传入。

禁止：

- Electron 和 Web 各复制一份助手业务逻辑；
- Renderer 或请求体决定 `assistantRoot`；
- 在线路由仅凭 `conversation_id` 在全局搜索；
- 把 `projectStore` 的内部路径暴露给前端。

### 11.2 Electron IPC

首版最小 IPC：

```text
assistant:listConversations
assistant:createConversation
assistant:openConversation
assistant:renameConversation
assistant:deleteConversation
assistant:sendMessage
assistant:confirmAction
assistant:cancelAction
```

不增加 `assistant:getMemories`、`assistant:updateMemory`、`assistant:deleteMemory`，也不增加通用 `assistant:invokeTool`。

`preload.cjs` 继续逐项暴露白名单方法，并在 `src/vite-env.d.ts` 的 `DesignCopilotApi` 中同步类型。

### 11.3 Web HTTP

首版使用普通同源 HTTP：

```text
GET    /api/assistant/conversations
POST   /api/assistant/conversations
GET    /api/assistant/conversations/:id
PATCH  /api/assistant/conversations/:id
DELETE /api/assistant/conversations/:id
POST   /api/assistant/conversations/:id/messages
POST   /api/assistant/conversations/:id/runs/:runId/confirm
POST   /api/assistant/conversations/:id/runs/:runId/cancel
```

`sendMessage` 可以在请求内等待完整文本结果。前端显示明确的“正在思考”，而不是伪造逐字流式效果。

所有路由必须继续经过现有登录、同源和租户上下文：

- 每次根据登录身份取得 tenant context；
- 只在该租户的 assistantRoot 中解析 conversation；
- 对 ID 做 UUID/固定格式验证，拒绝路径片段；
- 对 JSON body 和消息长度设置上限；
- 返回 `Cache-Control: no-store`；
- 不在错误响应中返回文件路径、提示词或供应商原始正文。

### 11.4 唯一功能开关与 AppConfig 接线

全仓只增加一个开关：

```text
GAME_UI_ASSISTANT_ENABLED=true|false
```

只有字面值 `true` 启用，缺失或其他值均关闭。这个闸门的具体失效场景是：已发布的 `0.2.2` 应用若发现助手子系统存在严重回归，可以不迁移或删除项目数据，直接关闭整个新子系统。除此之外不增加第二个前端、桌面、Web 或动作级环境开关。

接线方式：

1. Electron 主进程从 `process.env` 读取一次；Web `createApplication(environment)` 从其 `environment` 读取一次；
2. 两端现有配置响应统一增加：

   ```json
   { "features": { "assistant": false } }
   ```

3. Electron `copilot:config`、`copilot:config:models` 与 Web `GET /api/config`、`POST /api/config/models` 都返回同一个值；
4. `src/types.ts` 的 `AppConfig` 和 `src/vite-env.d.ts` 同步该字段；`App.tsx` 继续通过现有 `getConfig → setConfig` 状态通道控制助手入口；
5. Renderer 不读取 `import.meta.env`，也不自己推导平台开关；
6. UI 关闭时隐藏入口；Electron IPC 和 Web assistant 路由也必须在服务端返回稳定的 `ASSISTANT_DISABLED`，不能仅靠隐藏按钮；
7. `saveModelConfig` 的返回值必须保留 `features.assistant`，避免用户保存模型后入口状态被意外清空。

静态动作白名单仍可在代码发布时减少单个动作，但它不是第二个运行时 feature flag。

### 11.5 何时引入 SSE

只有真实流式模型能力验证通过后再增加 SSE。届时必须同时设计：

- 每个事件单调递增 `seq`；
- `run_id` 与租户所有权校验；
- 断线后的 `Last-Event-ID` 或 run 轮询回退；
- 有界事件缓冲和慢消费者处理；
- 客户端断线时运行继续还是取消的明确语义；
- 进程退出后的 `interrupted` 恢复。

不能只增加一个 `text/event-stream` 响应就宣称完成了可恢复流式运行。

---

## 12. UI 施工方案

本章以 `main@10ffb7025a0d656e72097c5cba6ea2ea1a1cae39` 为基线，并继承 PR #80 已落地的通知层上下文隔离规则。`src/App.tsx` 当前只有 `workflow | gallery | global` 三类 `FeedbackScope`，`src/styles.css` 的 `.overlay-bar > *` 会接收指针事件；实现助手时不得绕开这两项既有约束。

### 12.1 布局

助手与现有产物检查器共用右侧辅助区域：

```text
左导航 | 主工作区 | 右侧辅助区（助手 / 产物检查器二选一）
```

- 所有现有断点继续使用同一右侧辅助列，宽度沿用 Artifact Inspector 当前规则；
- 打开助手时自动关闭产物检查器，打开产物检查器时自动关闭助手；
- 打开助手时保留当前主工作区和项目上下文；
- 切到产物检查器不销毁对话状态。

首版不新增第四列、不新增响应式断点，也不实现覆盖式抽屉、全高覆盖层或新的 z-index 层。这样既不会继续压缩 `minmax(650px, 1fr)` 主区，也不会引入覆盖层子元素 `pointer-events: auto` 吞掉背后点击的同类回归。

**真实断点事实（裁定三，指南 §1 已同步）**：`src/styles.css` 有四个 `max-width` 断点，但 `electron/main.cjs` 的 `BrowserWindow` 设了 `minWidth: 1180`，因此桌面端窗口宽度恒 ≥1180px——**1120px 与 960px 两个断点在桌面版是不可达死代码**，只有在线版浏览器窗口变窄时才可能触发。对助手有意义的桌面窄屏只有一档：

| 视口 | `--rail-w` | 右侧辅助列 | 助手必须做的适配 |
|---|---|---|---|
| ≥1321px | 274px | 316px | 基准布局 |
| 1180–1320px | 244px | **280px** | 动作卡字段改两行堆叠、按钮文字不截断、对话列表标题单行省略并挂 `title` 全文 |

禁止为助手新增第五个断点（指南 §8 禁区第 5 条），也禁止把适配写进 1120px/960px 块——那会让桌面版的适配永远不生效，验收时看起来"通过"实际从未运行。**助手窄屏验收只在 1180×760 与 1321×900 两个真实可达视口做**。

**面板必须加 `inert={galleryOpen}`**：`src/App.tsx:223` 已对 `.artifact-inspector` 这么做，助手复用同一右列就必须复用同一处理，否则图库打开时助手面板仍可聚焦、可输入，与 PR #80 的"工作流子树 inert"契约不一致。

**模态必须脱离面板子树**：共享 Modal 用 `createPortal` 挂到 `document.body`，以原生 `<dialog>.showModal()` 进入浏览器 top layer，并复用 `.dialog-backdrop` / `.utility-dialog` 视觉样式。遮罩由 `<dialog>.dialog-backdrop` 自身承载，补齐原生 dialog 的视口尺寸与 UA margin/border/max-size 重置，`::backdrop` 显式置透明。首批只迁移 `App.tsx` 局部 Modal 的两个真实调用者 SettingsDialog、ProjectManager，并供助手删除确认复用；NewProjectDialog、图库豁免与使用指南弹窗留待各自功能改造。助手面板自身不得增加透明 `position: fixed` 节点；这类非模态覆盖物会重现 PR #80 的吞点击问题，也没有首版需求。

### 12.2 最小组件

首版从一个主要功能组件起步：

```text
src/features/assistant/AssistantPanel.tsx
```

在该文件内部先使用小型局部组件，例如 Header、ConversationList、MessageList、Composer、ActionCard。只有单个部分出现独立复用或测试需求时才拆文件。

类名一律 BEM（指南 §1）：区块 `.assistant-panel`，子元素 `.assistant-panel__head` / `__list` / `__composer` / `__action-card`，变体 `.assistant-panel--narrow`，状态 `.is-active` / `.is-pending` / `.is-failed` / `.is-stale` / `.is-thinking`。不得出现 `.aPanel`、`.assistant_box` 之类混合命名；删除任何局部组件时必须同步删掉其死选择器（禁区第 8 条）。

样式先加入现有 `src/styles.css` 的明确 assistant 区段；不要仅为了目录整齐新建一套 CSS 架构。全部颜色走 `:root` 令牌，禁止内联 `style={{...}}` 与硬编码色值（禁区第 1、2 条）。

### 12.3 状态边界

助手拥有独立状态：

- `selectedConversationId`；
- 会话列表与消息；
- `assistantBusy`；
- 当前待确认动作；
- 当前错误、stale 与 interrupted 反馈；
- 面板开关。

不得复用 `App.tsx` 现有面向设计任务的全局 `busy/busyJob`。发送请求前固定 `conversation_id`，响应回来后写入该对话，而不是写入“此刻 UI 正在查看的对话”。

助手的“正在思考 / 失败 / stale / interrupted / 动作已取消”全部在 `AssistantPanel` 内渲染：

- 不调用 App 级 `setError`；
- 不使用默认 `global` scope；
- 不给 `FeedbackScope` 增加第四个 `assistant` 值；
- 不把任何助手节点放入 `.overlay-bar`；
- 不把助手重试按钮挂到现有 workflow error banner；
- 面板关闭后，结果保存在对应对话中，重新打开时展示，不弹跨视图全局通知。

真正属于整个应用的启动或配置错误仍可沿用 `global`，但“某次助手对话失败”不是全局错误。

面板内可见状态的配色与文案（指南 §2.4 / §7，映射表见本方案 §6.6）：

| 面板状态 | 载体 | 语义色 | 中文文案 |
|---|---|---|---|
| 思考中 | 气泡下方说明行 | 紫（`.ai-reading-note` 同族） | 「正在思考…」 |
| 待确认执行 | 动作卡中性说明；对话列表 `.is-pending` 左边条 + 副标 | 卡内中性、列表橙 | 「待确认执行」 |
| 执行中 | 动作卡左边条 | 紫 | 「执行中」 |
| 已完成 | 动作卡左边条 | 绿 | 「已完成」（不得写「已批准」） |
| 失败 / 已中断 | 面板内错误条 | 红 | 「失败」/「已中断」 |
| 目标不匹配（项目或 Screen 已切走） | 面板顶部说明条 | 中性 `--muted` + `--panel-2` | 「该对话绑定的是另一个 Screen，可查看但无法继续」 |
| 外部费用说明 | 动作卡正文一行 | 中性（禁止橙） | 「本动作会调用图像模型，可能产生费用」 |

三条硬约束：面板内**不得出现 `.button--primary`**（裁定一，指南 §5）；**橙色只表达“待你处理”且待确认橙色只落在对话列表项**，费用、目标不匹配、ActionCard 待确认说明一律中性（裁定二，禁区第 12 条）；**动作卡内不放状态胶囊**，执行开始后才用左边条表达运行结果（指南 §4）。

### 12.4 必要交互

- 首次打开且无对话：显示当前项目和 Screen，用户点击“新建对话”（`.button--secondary`）；
- 新对话标题可由首条消息生成，但用户输入后必须可编辑；
- 项目/Screen 已切换：旧对话顶部显示目标不匹配，禁用发送，并提供“为当前目标新建对话”；
- 问答/执行模式切换：用 `role="group"` 的按钮组（沿用图库筛选范围页签的做法），**不是**下拉；两个选项都常驻可见，当前项 `.is-active`；
- 对话切换：用 `src/features/shared/ui.tsx` 的共享自绘 `Dropdown`（`data-testid="assistant-conversation-switch"` 挂组件根元素），**禁止原生 `<select>`**（指南 §6.1、禁区第 3 条）。Accessible Name 由 `ariaLabel` 提供且包含可见标题文字；对话标题过长时菜单项 ellipsis 截断并挂 `title` 全文；
- 执行模式：模型提出动作后展示 ActionCard（按钮等级见 §9.2）；
- 确认失败为 stale：列出发生变化的 revision/version/status（走 §7.4 的中文映射），提供“重新生成计划”，不提供强制覆盖；该卡带橙色左边条，按钮等级固定 `.button--ghost`（§9.2、指南 §6.4），不得用 secondary 金或 danger 红；
- 助手关闭或切换对话：后台请求仍归属于原对话，不能串消息；
- 打开图库时助手面板保持自身状态但 `inert`，不向图库泄漏任何反馈；图库现有 `inert`、通知层和“返回工作流”点击行为保持不变；
- 删除对话：把 `App.tsx` 当前局部 `Modal` 收敛到 `src/features/shared/ui.tsx` 的共享原生 `<dialog>`，使用 `createPortal` 挂到 `document.body` 并调用 `showModal()`，复用 `.dialog-backdrop` / `.utility-dialog` 视觉样式。浏览器负责 top layer 与焦点限制；组件负责 `aria-labelledby`、backdrop 点击、显式关闭、焦点归还，并监听 `cancel`：`preventDefault()` 后调用受控 `onClose()`。`showModal()` effect 必须以 `dialog.open` 防重并在 cleanup 关闭仍打开的 dialog，以承受 StrictMode 双 effect。现有 SettingsDialog、ProjectManager 与助手删除确认共同复用。**不做**行内弱确认，也**不新增** z-index 层（指南 §6.5）；
- **遮罩归属已定：`.dialog-backdrop` 类挂在 `<dialog>` 元素本身，不靠 `::backdrop` 画遮罩**。DOM 仍是「外层遮罩 + 内层 `section.utility-dialog`」两层，只把外层标签由 `div` 换成 `dialog`。`src/styles.css:668` 的既有 `.dialog-backdrop` 规则保留，但 Chromium 实测表明 `inset: 0` 不会自动覆盖 UA 的 `max-width`、`max-height`、margin 与 border，必须另加 `dialog.dialog-backdrop { width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; border: 0; }`。同时新增 `dialog.dialog-backdrop::backdrop { background: transparent; }` 中和 UA 默认 backdrop。`z-index: 100` 在 top layer 内变为惰性但保留无害；不得反向让 `::backdrop` 承载底色与模糊（指南 §6.5）；
- **共享 Modal 改造的首版范围是 `src/App.tsx` 局部 `Modal` 的两个真实调用者 SettingsDialog、ProjectManager，以及新建的助手删除确认**。`NewProjectDialog` 是另一套手写 `div.dialog-backdrop`，首次创建项目时还会刻意不传 `onClose`，本阶段不迁移。`src/features/gallery/GalleryWorkspace.tsx:405` 的逐张下载豁免与 `src/features/help/GuideModal.tsx` 同样延后。Chromium 的真实事件顺序是 `window keydown(Escape) → dialog cancel → dialog close`，不是 dialog 自行吃掉 Escape；图库迁移风险来自既有窗口级 Escape 链会先收到按键，原生 cancel 又引入第二条关闭路径。豁免分支焦点归还有实现但没有 Escape/焦点断言，因此必须先补用例、明确去重再迁移，不能在助手工作中顺带做；
- 面板与产物检查器互斥切换：任一时刻只有一个占据右列，切换是显式的（点击另一个入口），不含糊 Toggle。

### 12.5 可访问性

- 对话列表、模式切换和动作按钮支持键盘操作；
- 助手面板是非模态右栏，不使用 focus trap；关闭后焦点返回助手入口；删除对话框是唯一模态，使用原生 `<dialog>` 的焦点限制与共享 Modal 的焦点归还，并遵循 §12.4 的 Escape 层级；
- 运行状态使用文本和 `aria-live`，不能只靠颜色或动画；左边条颜色必须有中文文本同时表达同一状态（指南 §8 禁区第 6 条的"不得只靠颜色"含义）；
- 失败和 stale 信息与触发动作关联；
- 触摸目标不小于项目现有可用标准：`.button` 基础最小高 40px，`.icon-button` 34×34，禁用态统一 `opacity:.45; cursor:not-allowed`（指南 §5）；
- Composer 输入区按指南 §6.2：深底 `#0b0c10`、`--line-strong` 描边、圆角 7-8px、聚焦金描边 + `0 0 0 3px rgba(227,166,61,.1)` 光晕、placeholder 用 `--faint`；字段标签 11px 大写字重 700；
- 字号只用 §2.5 阶梯：消息正文 `--type-body`（13px）、卡片标题 `--type-body-strong`（15px）、面板标题 `--type-subtitle`（17px）、字段标签与最小说明 `--type-caption`（11px）、按钮与辅助说明 `--type-small`（12px）。**禁止中间值**，禁止为"聊天气泡更好看"自造 14px；
- 字体族只用 `--sans` / `--disp` / `--mono` 令牌，禁止直接写字体名；
- 尊重 `prefers-reduced-motion`（`src/styles.css:1046` 已有全局块，助手动画必须落在它覆盖范围内）。

### 12.6 PR #80 回归保护

至少新增以下 UI/E2E 场景：

1. 助手请求失败时，错误只出现在 AssistantPanel，`.overlay-bar` 内没有助手错误；
2. 助手处于 thinking、failed 或 stale 时打开图库，图库内不出现助手错误条、忙碌条或重试按钮；
3. 图库打开时，“返回工作流”仍可点击，助手节点不截获该点击；
4. 助手右栏打开时，右栏外的主工作区可按既有规则交互，不存在透明节点吞点击；
5. 助手与 Artifact Inspector 永不同时占据两列，切换后主区网格宽度不继续缩小；
6. 关闭并重新打开助手后，原对话反馈仍在对应消息流内，未转成 global 通知；
7. **图库打开时 `.assistant-panel` 带 `inert`**：面板内输入框与按钮不可聚焦、不可点击（对齐 `App.test.tsx` 对 `.artifact-inspector` 的既有断言）；
8. **1180×760 视口下右侧辅助列实测 280px**、`--rail-w` 实测 244px，动作卡按钮文字未被截断、对话列表标题单行省略且有 `title`；1321×900 下列宽 316px。不断言 1120px/960px（桌面不可达）；
9. **面板子树内不存在 `.button--primary`**，且确认按钮等级随服务端 `replaces_content/reversible` 在 `secondary`/`danger` 之间切换；`save_intent_review_draft` 必须为 danger；`stale` 卡的「重新生成计划」必须是 `.button--ghost`（该卡带橙色左边条，见 §9.2）；
10. 费用提示、目标不匹配说明和待确认 ActionCard 都没有 warning 状态类；其计算后的 `color` / `backgroundColor` 与同页 `.settings-note` 中性基准相同。不要断言字符串“不含 `--warning`”，CSS 变量在计算样式中已经解析；
11. 删除对话框：共享原生 `<dialog>` 通过 Portal 挂到 `document.body` 且 `open`，元素自身带 `.dialog-backdrop` 类；在 1180×760 下 `getBoundingClientRect()` 必须精确覆盖视口、margin 与 border 为 0、计算 `backgroundColor` 等于既有遮罩值 `rgba(5, 6, 9, 0.66)`，从而同时证明遮罩归属和 UA reset 生效。具备可访问标题，Tab/Shift+Tab 不逃出；Escape 通过 `cancel → preventDefault → onClose` 只关闭对话框、不连带关闭面板，随后可重新打开且关闭后焦点回到删除按钮；StrictMode 下不抛重复 `showModal()`。SettingsDialog / ProjectManager 行为不回归，NewProjectDialog 未被迁移。不要用 `getComputedStyle(dialog, '::backdrop')` 断言伪元素；只核对样式源存在透明规则。Vitest/jsdom 仅在测试入口安装最小 `showModal` / `close` shim，真实 top layer、Tab、Escape 与几何由 Playwright 验证；
12. 对话切换下拉无原生 `<select>`，键盘 ArrowDown/Enter/Escape 行为与 `src/features/shared/Dropdown.test.tsx` 契约一致；
13. 面板内所有**应用自有**状态与操作文本为简体中文，`succeeded` 渲染为「已完成」而非「已批准」，stale 差异渲染为「产物状态 · X：待确认 → 需更新」而非英文状态码；模型正文只验证请求提示明确要求简体中文，不断言永不夹英文；
14. 现有 `src/App.test.tsx` 的“反馈按上下文隔离”和 `tests/ui-e2e/gallery.spec.ts` 的“通知层几何”继续通过。

---

## 13. 建议文件改动

### 13.1 新增文件

```text
electron/services/assistantStore.cjs
electron/services/assistantRuntime.cjs
electron/services/assistantTools.cjs
electron/services/assistantStore.test.cjs
electron/services/assistantRuntime.test.cjs
electron/services/assistantTools.test.cjs
src/features/assistant/AssistantPanel.tsx
src/features/assistant/AssistantPanel.test.tsx
```

如果 `server/webServer.cjs` 在加入路由后继续明显膨胀，可增加一个只处理助手路由的：

```text
server/assistantRoutes.cjs
```

它不是通用路由框架，只接收已认证的 tenant context 和 HTTP 请求。

### 13.2 修改文件

```text
electron/services/env.cjs
electron/services/env.test.cjs
electron/services/kunpoClient.cjs           # safeConfig 返回 assistantModel；不改变请求与图片能力
electron/services/kunpoClient.test.cjs
electron/services/errorCodes.cjs
electron/main.cjs
electron/preload.cjs
server/webServer.cjs
src/api.ts
src/vite-env.d.ts
src/types.ts
src/features/shared/ui.tsx                 # 补助手 statusLabel；新建受控原生 dialog + Portal Modal，首批服务 SettingsDialog、ProjectManager 与助手删除确认
src/App.tsx                                # AssistantPanel 接线、复用共享 Modal、现有 SettingsDialog 增加 assistantModel、读取 AppConfig feature；NewProjectDialog 保持原实现
src/App.test.tsx                           # 最小 jsdom dialog shim；反馈作用域、受控关闭/重开、图库隔离与助手面板 inert 回归
src/styles.css                             # 保留 :668；新增 dialog 元素 UA 几何 reset 与透明 ::backdrop
tests/ui-e2e/gallery.spec.ts               # 通知层几何与 pointer-events 回归
docs/dev/FRONTEND-DESIGN-GUIDE.md          # 助手专属条款已随本方案 v1.2 落入指南 1.3；功能完成时只补实际偏差，不重写裁定
docs/dev/ERROR-CATALOG.md                  # 登记 ASSISTANT_DISABLED、ASSISTANT_ACTION_STALE 等稳定错误码
scripts/check-error-docs.cjs               # 错误码目录门禁：分区标题是硬编码字符串，见下方说明
docs/dev/PROJECT-DIRECTORY.md              # 按图库先例声明助手目录的归属，见下方说明
docs/README.md                             # 功能完成后登记，不提前占位
```

**`scripts/check-error-docs.cjs` 必须同步修改，否则第一个助手错误码就会让 `pnpm run test:docs` 变红。**该脚本对 `errorCodes.cjs` 与 `ERROR-CATALOG.md` 做双向冻结校验，而分区边界是硬编码的字面量（脚本第 43-45 行）：

```js
['ERROR_CODES', '## 一、管线错误码', '## 二、Fidelity 检查码'],
['FIDELITY_ISSUE_CODES', '## 二、Fidelity 检查码', '## 三、绑定语义校验码'],
['BINDING_VALIDATION_CODES', '## 三、绑定语义校验码', '## 四、校验机制']
```

只有落在这三个 `##` 区间内的表格码才会被统计。因此把 `ASSISTANT_*` 放进新开的 `## 五、助手错误码` 而不改脚本，门禁会判定"注册表里有、目录里没有"；反过来只在目录里写而不注册，会判定"目录里有、注册表里没有"。首版按最小改动执行：

1. 把 `## 一、管线错误码` 改名为 `## 一、管线与助手错误码`，并同步改脚本里这一处字面量；
2. 在该区间内新增 `### 助手错误码` 子块（`###` 不影响 `##` 边界识别），表格中登记全部助手码；
3. 助手码继续注册在现有 `ERROR_CODES` 组，**不新增第四个注册组**——新增组意味着再改一次脚本的 `registry` 构造与 `sectionBounds`，而首版助手码数量在个位数，收益不抵成本；
4. 改完立即跑 `pnpm run test:docs`，确认四条门禁全绿再提交。

**`docs/dev/PROJECT-DIRECTORY.md` 必须登记助手目录的归属。**该文档 §2「路径规则」已有图库先例（其自身 v1.2 变更记录：说明 `<workspaceRoot>/.gallery/index.json` 是 workspace 用户级索引，不属项目目录与 Artifact Registry）。助手存储同理但位置不同——它在 `<userData>/assistant/`（桌面）与 `<dataRoot>/tenants/<tenantId>/assistant/`（在线），既不在项目 workspace 内，也不由 Artifact Registry 管理。必须照同一格式补一条说明，否则后来者会以为助手数据是项目产物的一部分，进而把它纳入项目备份、克隆或归档语义（§6.1 的隔离承诺要求它恰恰**不**参与这些）。`scripts/check-project-tree.cjs` 校验的是 README 目录树、`docs/schemas/project-directory.required.json` 与 `artifactRegistry.cjs` 三者一致，助手目录不在这三者的范围内，因此该脚本本身无需修改。

`electron/services/jsonStore.cjs` 首版不修改：完整 JSON 仍复用它，JSONL 由 `assistantStore.cjs` 在自己的单写者队列内直接调用原生 `fs.appendFile`。`galleryStore.cjs` 只作为队列范式引用，不修改；`providerCapabilities.cjs` 与助手网关探针无关，也不修改，其保守的 `max_reference_images: 6` 继续维持。`react-dom` 已安装，共享 Modal 直接使用其 `createPortal`，不新增依赖。Vitest 使用 jsdom，而 jsdom 30 没有实现 `HTMLDialogElement.showModal()` / `close()`；只在 `src/App.test.tsx` 安装最小测试 shim，不把测试环境兼容分支塞进生产组件。真实 top layer、Escape、Tab 与几何仍由 Playwright 验证。现有测试脚本已覆盖 `electron/services/*.test.cjs` 和 Vitest/Playwright，因此没有新脚本需求时不修改 `package.json`。

`App.tsx` 的 `NewProjectDialog`、`src/features/gallery/GalleryWorkspace.tsx`、`src/features/help/GuideModal.tsx` 与 `GalleryWorkspace.test.tsx` 的相关分支**首版一律不迁移**。前三者各自持有一处手写 `div.dialog-backdrop`；NewProjectDialog 首次建项目时可不传 `onClose`，不能机械套用可关闭 Modal。图库的窗口级 Escape 链先收到 `keydown`，原生 dialog 随后才触发 `cancel`；豁免分支的焦点归还有实现无断言，迁移必须先补 Escape、焦点与重复关闭用例。首版只要求现有用例继续通过。把这些迁移塞进助手工作，既扩大范围，也会改变尚未被测试锁住的关闭语义。

### 13.3 不新增的 v1.0 文件

```text
assistantModelProvider.cjs
assistantPolicy.cjs
AssistantDrawer.tsx
ConversationSwitcher.tsx
MessageList.tsx
ActionPlanCard.tsx
MemoryPanel.tsx
AssistantSettings.tsx
```

理由：首版没有第二个 Provider、动态策略系统或语义记忆；UI 子组件也没有被两个地方复用。需要时再拆分比预先维护七个空抽象成本更低。

---

## 14. 分阶段施工顺序

每一阶段都必须独立可验证、可回滚。不要同时打开五个 PR 再等待最后集成。

### 阶段 A0：契约与兼容性验证

目标：确认最小实现边界，消除协议假设。

工作：

- 固定对话、消息、run 和模型响应的 JSON schema；run 明确 `result/error`、完整终态、原子认领和服务端风险字段；
- 用命名为 `assistantGatewayProbe` 的一次性探针通过当前 Kunpo/OpenAI-compatible 网关完成一次助手 JSON 请求；
- 验证无工具时、未知动作、非法参数、超长响应和超时错误；
- 记录当前网关是否支持真实流式与原生函数调用，但不以此阻塞首版；
- 确认全仓唯一 `GAME_UI_ASSISTANT_ENABLED` 的默认关闭行为，以及 Electron/Web 均通过 `AppConfig.features.assistant` 返回同一值；
- 以 `10ffb70` 为 UI 基线，锁定助手反馈只在面板内渲染、首版无 overlay/drawer；
- 锁定设计裁定（指南 1.3 §1/§4/§5/§6.4/§6.5）：**裁定一**常驻右列不用 `.button--primary`，按钮按服务端风险取 `secondary`/`danger`；**裁定二**待确认 ActionCard 保持中性、橙色只落对话列表，且带橙色左边条的卡片（含终态 `stale`）按钮一律 `.button--ghost`；**裁定三**窄屏适配只落 `@media (max-width: 1320px)`；**裁定四**遮罩由 `<dialog>.dialog-backdrop` 自身承载，保留 `styles.css:668` 并新增原生 dialog 的 100% 宽高、无最大尺寸、零 margin/border reset 与透明 `::backdrop`；`cancel` 走受控 `onClose`，`showModal()` effect 可防重和清理；**裁定五**首批只迁移 App 局部 Modal 的 SettingsDialog、ProjectManager，并供助手删除确认复用，NewProjectDialog、图库豁免、使用指南均延后；
- 锁定助手状态的中文映射与语义色绑定（§6.6，指南 §2.4/§7），确认 `succeeded` 不译为「已批准」、`interrupted` 与 `failed` 分开文案；
- 确认桌面窗口事实：`electron/main.cjs` 的 `minWidth: 1180` 使 1120px/960px 断点不可达，助手验收视口为 1321×900 与 1180×760；
- 确认所有人类权限动作不进入白名单。

退出条件：

- 有一个可执行的最小探针；
- 失败时能回退为只读回答；
- 没有新增 Agents SDK 依赖；
- schema 与错误码已被测试锁定；
- 五项设计裁定与状态映射已写入方案并对齐指南 1.3，无一项留作“实现时再定”。

### 阶段 A1：持久对话与只读助手

目标：先交付最核心、最低风险的用户价值。

工作：

- 实现 AssistantStore、目录隔离、每对话 Gallery 形状的单写者队列、原生 `fs.appendFile` JSONL 追加、末行推导 seq、尾部恢复和回收目录；不维护 `index.json`；
- 实现 ContextBuilder 和 AssistantRuntime 问答路径；ContextBuilder 固定绑定 Screen，使用 `includePreviews: false`，并承认 `open` 会迁移/自愈；
- 增加 `assistantModel` 容错读写，并在现有 SettingsDialog 中提供编辑入口；
- 接入 Electron IPC、preload 和现有 `DesignCopilotApi`；
- 通过现有 AppConfig 接入唯一功能开关，UI 与后端同时门禁；
- 实现共享右侧列中的 AssistantPanel，不增加 overlay/drawer，反馈不进入 `.overlay-bar`；
- 面板加 `inert={galleryOpen}`，不增加透明 `position: fixed` 覆盖节点；
- 在 `@media (max-width: 1320px)` 内做窄屏适配（右列 280px），不新增断点、不使用桌面不可达的 1120px/960px；
- 对话切换用共享自绘 `Dropdown`，模式切换用 `role="group"` 按钮组；在 `ui.tsx` 新建受控原生 `<dialog>` + Portal Modal，`cancel` 走 `onClose`，effect 对 StrictMode 防重并清理。把 App 局部 Modal 的 SettingsDialog、ProjectManager 收敛到它，并供助手删除确认复用；遮罩由 `<dialog>.dialog-backdrop` 自身承载，同时在 `styles.css` 新增 UA 几何 reset 与透明 `::backdrop`。NewProjectDialog、图库豁免与使用指南弹窗不在本阶段；
- 在 `src/features/shared/ui.tsx` 补齐助手 `statusLabel` 映射；面板内全部应用自有状态文本走该映射，样式只用 `:root` 令牌与 §2.5 字号阶梯，类名符合 BEM；
- Web 使用 tenantRoot 接入同一 runtime；
- 首版只读，不注册任何写动作。

退出条件：

- 桌面和在线均能新建、持久化、切换、重命名和删除对话；首版没有归档死状态；
- 新对话上下文为空；
- 项目/Screen 不匹配时无法继续发送；
- 重启后历史正确恢复；
- 助手错误、thinking 和 stale 不泄漏到图库或全局通知层；
- 图库打开时面板 `inert` 生效，面板内控件不可聚焦不可点击；
- 1180×760 与 1321×900 两档实测通过，1180×760 下右列为 280px 且无文字截断；
- 面板内无 `.button--primary`、无原生 `<select>`、无英文状态码上屏；共享原生 `<dialog>` 的标题关联、受控 Escape、关闭后重开、StrictMode、焦点限制与焦点归还通过，UA reset 后遮罩元素精确覆盖视口；
- 图库豁免对话框与使用指南弹窗未被本阶段改动，`GalleryWorkspace.test.tsx` 与 `tests/ui-e2e/gallery.spec.ts` 的现有 Escape 层级、焦点归还与通知层用例继续通过；
- 租户隔离测试通过；
- 关闭功能开关后现有回归测试不变。

### 阶段 A2：单动作计划与第一个安全写入

目标：完成“建议 → 审阅 → 确认 → 真实执行 → 回读”闭环。

工作：

- 加入执行模式和单动作响应；
- 实现 ActionCard 与确认/取消；模型响应不含风险，服务端动作描述符附加四个风险字段，按钮按 §9.2 取 `secondary`（不替换且可逆）或 `danger`（替换/不可逆），不使用 `.button--primary`；
- 费用提示用中性 `--muted` + `--panel-2`；待确认卡片保持中性且不放状态胶囊，执行后才用左边条 + 中文文本；
- 对话列表项对存在 `awaiting_confirmation` run 的对话显示 `.is-pending` 橙左边条 + 「待确认执行」；
- 只接入 `save_intent_review_draft`；
- 直接复用 `expectedIntentReviewRevision`；
- AssistantTools 从锁外调用公开领域方法，不获取项目锁、不访问 `__unsafe`；
- 实现 `awaiting_confirmation → executing` 原子认领、run `result/error` 持久化与 `action_id` 幂等；
- stale 差异按 §7.4 走 `statusLabel` 中文映射渲染，`kind` 也有中文标签；
- 加入 prompt injection、篡改参数、重复确认和 stale 测试。

退出条件：

- 问答模式永不写项目；
- 执行模式未确认前永不写项目；
- 修改后的 revision 与计划不符时安全失败；
- 双击确认只执行一次；
- 模型无法调用批准、豁免或任意动作；
- `save_intent_review_draft` 的服务端风险固定为替换且用户不可逆，确认按钮为 danger；低风险测试动作仅在“不替换且可逆”时使用 secondary；
- 费用行、待确认卡和目标说明与 `.settings-note` 的中性计算样式一致，不使用 warning 状态类；
- stale 提示逐项指出变化字段且为中文，未出现英文状态码。

### 阶段 A3：逐项扩展领域动作

目标：在共享领域入口具备正确性保护后扩展价值。

建议顺序：

1. `run_fidelity_check`；
2. `create_composition_preview`；
3. `run_underlay_critique`；
4. `update_draft_artifact`；
5. `run_pipeline_stage`。

每加入一个动作都必须：

- 明确真实输入 revision / artifact version；
- 在领域入口补 CAS，而不是只在助手外检查；
- 标出外部费用和替换影响；
- 有一条最小并发或 stale 测试；
- 有一条重复确认幂等测试；
- 回读真实结果；
- 失败不留下“看似成功”的聊天消息。

### 阶段 A4：真实需求驱动的增强

不作为 v1.2 首发条件：

- 流式输出与 SSE 恢复；
- job 级取消；
- Agents SDK 多步循环；
- 多对话并行运行；
- 语义记忆；
- 跨 Screen 对话迁移。

---

## 15. 测试与验收

### 15.1 最小自动化测试矩阵

#### Store

- 两个同时创建请求都形成独立目录，列举能从各 `meta.json` 找到二者；不存在 `index.json`；
- 同一对话并发 `fs.appendFile` 得到连续且唯一的 `seq`，前一次失败不会毒死后续队列；
- 删除 `meta.json.next_message_seq` 后，重启仍能从最后一条完整 JSONL 记录推导下一 `seq`；
- 最后一行半写入可恢复；
- 中间损坏拒绝继续；
- rename 不改变绑定；
- 删除后 `conversations/` 列举不可见、目录进入 trash；
- 路径穿越 ID 被拒绝；
- 旧 schema 能读取，新字段不会在保存时丢失。

#### Runtime

- 新对话不带入任何其他对话的消息或摘要；
- 项目/Screen 不匹配拒绝发送；
- 问答模式丢弃任何 proposed_action；
- 执行模式最多接受一个白名单动作；
- 非 JSON、超长、未知动作和非法参数安全失败；
- 上下文裁剪保留阶段、错误与版本；
- ContextBuilder 固定对话绑定 Screen，并以 `includePreviews: false` 调用现有 `open`；
- `open` 发生迁移或自愈后，记录的是返回的最终快照，不使用自愈前零散数据；
- stale 响应列出实际变化的 revision/version/status；
- 日志不包含 API Key、Cookie、系统提示和消息全文；
- 重启把未完成运行标记为 interrupted。
- 问答 run 在回复持久化后进入 succeeded；stale 是终态；存在 awaiting_confirmation 时拒绝第二个发送请求。

#### Tools

- Renderer 篡改目标项目或 Screen 无效；
- 模型提出审批/豁免动作被拒绝；
- stale revision 不写入；
- AssistantTools 只调用注入的公开领域方法，不获取 `withProjectWriteLock`、不访问 `__unsafe`；
- 同一 action 重复确认只执行一次；
- 两个并发确认只有一个能原子完成 `awaiting_confirmation → executing`，另一个返回 `ASSISTANT_ACTION_IN_PROGRESS` 或持久化终态；
- succeeded/failed/stale 重复确认只回放已保存的 result/error；
- 领域服务失败时 run 为 failed，聊天中不声称成功；
- 成功后回读的 revision/version 与返回一致。

#### Electron/Web

- preload 只暴露白名单；
- 非登录 Web 请求拒绝；
- 跨租户 conversation ID 返回 404/无信息泄露；
- 跨站写请求继续受现有同源保护；
- body 和消息长度上限生效；
- Electron 与 Web 的配置响应都通过 `AppConfig.features.assistant` 返回同一个功能开关语义；
- 保存模型配置后 `features.assistant` 不丢失；
- 功能开关关闭时入口隐藏且 IPC/路由返回 `ASSISTANT_DISABLED`；
- 不影响现有项目创建、保存、管线、导出和审查流程。

#### UI

- 新建、切换、重命名、删除；首版无归档入口和不可恢复的归档项；
- 对话与响应不会因切换视图而串线；
- 目标不匹配时禁用发送；
- ActionCard 信息完整；
- 确认、取消、stale、失败和 interrupted 都有可理解状态；
- 与产物检查器互斥切换；
- 助手 busy/error/stale 只在面板内，不进入 `.overlay-bar` 或默认 `global` scope；
- 助手失败状态下打开图库，不出现跨上下文错误条或重试按钮；
- 图库打开时 `.assistant-panel` 带 `inert`，面板内控件不可聚焦不可点击；
- 图库“返回工作流”及主工作区可交互区域不被助手透明节点截获点击；
- 键盘、焦点和 `aria-live` 行为正确；
- 对话切换使用共享自绘 `Dropdown`，DOM 中不存在原生 `<select>`；
- 删除确认复用共享原生 `<dialog>` + Portal；遮罩由 `<dialog>.dialog-backdrop` 自身承载，经 UA reset 后实测覆盖整个视口；标题关联、Tab/Shift+Tab、受控 Escape、关闭后重开、StrictMode 与焦点归还通过，SettingsDialog / ProjectManager 不回归；NewProjectDialog、图库豁免与使用指南未被迁移；
- 面板子树内不存在 `.button--primary`；按钮只按服务端 `replaces_content/reversible` 在 `secondary`/`danger` 间切换，`save_intent_review_draft` 为 danger；`stale` 卡的「重新生成计划」为 `.button--ghost`；
- 费用提示、目标不匹配说明和待确认 ActionCard 无 warning 状态类，计算后的 `color/backgroundColor` 与 `.settings-note` 中性基准相同；
- 动作卡内没有状态胶囊；待确认卡保持中性，执行后状态由左边条 + 中文文本表达；
- 面板内全部应用自有状态文本为简体中文且来自 §6.6 映射表：`succeeded` 渲染「已完成」而非「已批准」，stale 差异渲染「产物状态 · X：待确认 → 需更新」而非英文状态码；模型正文只验证系统提示要求简体中文；
- 助手样式全部来自 `:root` 令牌，无内联 `style`、无硬编码色值、无阶梯外字号，类名符合 BEM；
- 现有断点下不新增网格列，主画布宽度不比打开 Artifact Inspector 时更窄；
- 窄屏适配只在**桌面真实可达的两档**验收：1321×900（右列 316px、`--rail-w` 274px）与 1180×760（右列 **280px**、`--rail-w` **244px**）。1120px/960px 因 `electron/main.cjs` 的 `minWidth: 1180` 在桌面版不可达，不作为助手验收档位（在线版窄窗仅要求不崩溃、不横向溢出）。

### 15.2 必须保留的一条端到端安全场景

```text
1. 在项目 A / Screen A1 创建对话并生成待确认动作
2. 切换到项目 B / Screen B1
3. 尝试确认旧动作
4. 系统必须根据对话绑定仍指向 A/A1，且 UI 明确提示目标不匹配
5. 如果 A/A1 的相关 revision 已变化，执行必须返回 stale
6. 项目 B 不得出现任何写入
7. 重复提交 action_id 不得产生第二次写入
```

这条测试同时覆盖隔离、UI 上下文漂移、CAS 和幂等，优先级高于大量快照测试。

### 15.3 发布前回归

在同一未变化提交上复用已有测试结果，不重复跑等价检查。最终至少执行项目现有的：

```text
pnpm test
pnpm run test:ui-unit
pnpm run test:ui-e2e
pnpm run build
pnpm run test:docs
```

如果涉及在线路由，再执行现有 Web/tenant 相关回归；如果涉及视觉布局，在**桌面真实可达的两档**做人工验收：1321×900 与 1180×760（后者对应 `@media (max-width: 1320px)`，右列 280px、`--rail-w` 244px）。**不要**在 1120px 做助手验收——`electron/main.cjs` 的 `minWidth: 1180` 使该断点在桌面版永远不触发；在线版只需额外确认窄窗不横向溢出、不崩溃。首版不新增断点，也不引入覆盖式助手布局。

若本次改动触及 `docs/dev/ERROR-CATALOG.md` 或 `electron/services/errorCodes.cjs`，`pnpm run test:docs` 必须与 `scripts/check-error-docs.cjs` 的同步修改（§13.2）一起提交，不得先合并错误码再补门禁。

---

## 16. Definition of Done

只有全部满足，才可以宣称“内嵌智能 AI 助手 v1.2 可用”：

### 16.1 用户价值

- 用户无需复制项目内容即可询问当前状态；
- 回答明确区分真实项目状态与建议；
- 新对话确实为空，不继承旧摘要或供应商状态；
- 用户可以管理多个持久对话；
- 至少一个写动作完成完整确认闭环；
- 失败、stale 和中断状态可理解、可恢复。

### 16.2 正确性与安全

- 对话项目与 Screen 绑定不可变；
- 在线安全边界包含租户身份，不只依赖 conversation ID；
- 模型没有文件系统、Shell、任意网络、批准或豁免权限；
- 所有写动作通过已有领域服务；
- AssistantTools 只从锁外调用公开领域方法，不访问 `projectStore.__unsafe`；
- 所有写动作确认时重新验证版本；
- 确认先原子认领 `awaiting_confirmation → executing`，终态持久化 `result/error`；
- stale 错误指出参与动作前置条件的具体 revision/version/status 变化；
- 重复确认不会重复写入或重复付费；
- 日志和错误不泄露密钥、Cookie、路径或完整聊天内容；
- 删除语义与实际保留策略一致。

### 16.3 可维护性

- 后端助手核心最多从三个职责文件起步；
- 前端继续使用现有 API 门面；
- 助手反馈留在 AssistantPanel，不扩展 App 全局通知状态机；
- 没有第二套项目状态或产物写入实现；
- 没有 `index.json` / `next_message_seq` 这类可由真实目录和 JSONL 推导的第二事实源；
- 没有无调用者的 Provider/Policy/Memory 抽象；
- 每个非平凡动作至少有一条能在逻辑破坏时失败的自动测试；
- 新错误使用稳定错误码，不依赖字符串判断；
- 全仓只有一个 `GAME_UI_ASSISTANT_ENABLED`，通过现有 AppConfig 通道下发；
- 功能开关关闭后现有应用行为与数据格式保持兼容。

### 16.4 性能与运营

- 单条消息和模型上下文均有硬上限；
- 每租户/应用只有一个未完成 run（含等待确认），不会无界堆积待办；
- 模型超时有明确错误；
- 外部费用动作在确认卡中可见；
- 不自动重试付费动作；
- 助手数据增长、trash 清理和摘要触发可观测，但不记录正文。

### 16.5 设计规范合规（硬性）

`docs/dev/FRONTEND-DESIGN-GUIDE.md` 是唯一设计事实来源。以下各项**不得记为「已知偏差」留到验收后再修**——偏差一旦合入就会成为下一个功能的先例：

- 面板内不存在 `.button--primary`；风险由服务端动作描述符给出，确认按钮按 §9.2 取 `secondary`（不替换且可逆）或 `danger`（替换/不可逆），取消恒为 `ghost`；`save_intent_review_draft` 为 danger（裁定一，指南 §5）；
- 琥珀金只出现在指南 §3 允许的四类位置，且**不与橙色在同一组件上混用**；待确认 ActionCard 保持中性，橙色只落对话列表 `.is-pending`；费用提示、目标不匹配、说明性文字一律中性 `--muted` + `--panel-2`（裁定二，指南 §4 / §6.4）；
- 助手窄屏适配只落在 `@media (max-width: 1320px)` 这一档，桌面验收视口为 1321×900 与 1180×760；未新增第五个断点，也未把适配写进桌面不可达的 1120px/960px 块（裁定三，指南 §1）；
- 删除确认复用共享原生 `<dialog>` + Portal 与 `.dialog-backdrop` / `.utility-dialog` 视觉样式，未新增 z-index 层；标题关联、受控 Escape、关闭后重开、StrictMode、焦点限制和焦点归还通过。遮罩经 UA reset 后实测覆盖整个视口，`src/styles.css` 中同时存在 `dialog.dialog-backdrop` 几何重置与透明 `::backdrop`；首批只迁移 SettingsDialog、ProjectManager 和助手删除确认，NewProjectDialog、图库豁免与使用指南的迁移不计入本功能偏差；
- 面板内全部应用自有状态与操作文本为简体中文，状态来自 §6.6 / `statusLabel` 映射；`succeeded` 未被译为「已批准」；stale 差异未直接渲染英文状态码；模型正文只要求系统提示约束，不声明绝对纯中文（指南 §7 / §8 禁区第 7 条）；
- 对话切换用共享自绘 `Dropdown`，无原生 `<select>`；模式切换是 `role="group"` 按钮组（指南 §6.1）；
- 全部颜色来自 `:root` 令牌、字号来自 §2.5 阶梯、字体族来自 `--sans`/`--disp`/`--mono`；无内联 `style={{...}}`、无硬编码色值（指南 §8 禁区第 1、2 条）；
- 类名符合 BEM 约定，未遗留死选择器（指南 §1 / §8 禁区第 8 条）；
- 助手反馈未进入 `.overlay-bar`、未使用默认 `global` scope、未给 `FeedbackScope` 增加第四值；图库打开时面板 `inert`（PR #80 红线，指南 §6.4）；
- 指南 §9 自查清单逐项通过，且 `pnpm run lint`、`pnpm run test:ui-unit`、`pnpm run build`、`pnpm test:ui-e2e`、`pnpm test:docs` 全绿。

---

## 17. 回滚方案

使用全仓唯一环境开关：

```text
GAME_UI_ASSISTANT_ENABLED=false
```

Electron 主进程和 Web 服务端各自在启动时读取一次，并通过现有 `AppConfig.features.assistant` 下发给 Renderer。不得再增加 `VITE_*` 前端开关、Web 专用开关或桌面专用开关。关闭时既隐藏入口，也由后端拒绝所有助手 IPC/HTTP 请求。

关闭后：

- 前端隐藏助手入口；
- 不再创建新运行；
- 助手 IPC/HTTP 返回稳定的 `ASSISTANT_DISABLED`；
- 已有助手数据保留，不删除项目数据；
- 现有设计管线、审查、导出和画廊功能继续工作；
- 在线版可让助手路由返回稳定的功能关闭错误；
- 不修改或降级项目 schema。

若某个新动作出现问题，优先从静态白名单中禁用单个动作，而不是关闭全部只读问答。

---

## 18. 施工纪律

实现期间按以下顺序判断每一项新增代码：

1. 这个能力是首版验收所必需的吗？
2. 当前代码已有公开服务或 helper 吗？
3. Node、Electron、React 或浏览器原生能力能完成吗？
4. 现有依赖能完成吗？
5. 能否用一个静态表或一个小函数完成，而不是抽象层？
6. 只有上述都不成立时，才新增最少代码。

具体禁止项：

- 不为假想的第二供应商提前建通用 Provider；
- 不为一个静态白名单建策略规则引擎；
- 不复制 `projectStore`、`intentStateStore` 或 `designPipeline` 校验；
- `AssistantTools` 不获取 `withProjectWriteLock`，不调用 `projectStore.__unsafe`；需要复合原子操作时，在所属领域服务新增公开复合方法，由该服务内部一次加锁并调用 Unsafe 原语；
- 不从模型自然语言解析文件路径或工具名；
- 不在前端保存权威 pending action；
- 不增加与现有 UI 等价但更不可靠的 AI 工具；
- 不用新 hash、基线文件或冻结契约替代普通版本、CAS、类型和测试；
- 不把模拟流式、自动恢复或后台重试当作用户价值；
- 不为一个 JSONL 调用者扩展通用 `jsonStore`；直接在 AssistantStore 的单写者队列内使用 Node `fs.appendFile`；
- 不维护可由 `conversations/*/meta.json` 推导的 `index.json`，也不在 `meta.json` 复制 `next_message_seq`；
- 不把助手 busy/error/stale 放入 `.overlay-bar`，不使用默认 `global` scope，也不为了助手新增第四种 `FeedbackScope`；
- 首版不增加覆盖式助手抽屉、全高 overlay、新 z-index 层或响应式断点；
- 不在常驻右列使用 `.button--primary`；模型与 Renderer 不提交风险，确认按钮只按服务端动作描述符取 `secondary` 或 `danger`；
- 不用琥珀金表达任何语义状态，也不用 `--warning` 橙表达费用、目标不匹配或一般说明——橙色只表示"有事待你处理"；
- 不把助手窄屏适配写进 `@media (max-width: 1120px)` 或 `960px`：桌面 `minWidth: 1180` 使二者永不触发，写在那里等于没有适配；
- 不在动作卡内放状态胶囊；待确认 ActionCard 保持中性，橙色待办只落在对话列表，执行后状态才用左边条 + 中文文本；
- 不在带橙色左边条的卡片上用 `.button--secondary` 或 `.button--danger`；`stale` 卡的「重新生成计划」只能是 `.button--ghost`，否则金橙同卡的 §4 违规只是从待确认态挪到了终态；
- 不靠 `::backdrop` 承载遮罩，也不省略 `dialog.dialog-backdrop` 的 UA 几何 reset 或透明 `::backdrop`；不让原生 `cancel` 绕过受控 `onClose`，不在生产组件为 jsdom 写兼容分支；不顺带迁移 NewProjectDialog、图库豁免或使用指南弹窗；
- 不直接渲染英文状态码、领域状态字符串或模型 `reply` 中出现的状态词；状态一律由前端从存储状态码经 §6.6 映射表渲染；
- 不用原生 `<select>`、不引入新 UI/图标/字体库、不写内联 `style={{...}}`、不硬编码 `:root` 之外的颜色、不用阶梯外字号；
- 不把任何设计规范偏差记为「已知偏差」留到验收后修——裁定已在 A0 定死，偏差合入即成为下一个功能的先例；
- 不新增第二个 feature flag；
- 不交付只有归档、没有可发现恢复入口的对话死状态；首版直接不做归档；
- 不在代码没有完成前批量新增文档占位。

遇到共享竞态时修共享领域入口；不要只给报告中的一个调用路径打补丁。

---

## 19. 开工检查单

### 开始 A0 前

- [ ] 本方案与 `FRONTEND-DESIGN-GUIDE.md` 1.3 已形成同一 docs-only 基线提交；A1 分支包含该提交；
- [ ] 产品确认首版项目与 Screen 绑定不可变；
- [ ] 产品接受首版一个未完成 run（包含等待确认）、无伪流式；
- [ ] 明确首个写动作仅为意图审查草稿；
- [ ] 确认全仓唯一 `GAME_UI_ASSISTANT_ENABLED` 默认关闭，并经 AppConfig 同步门禁 UI 与后端；
- [ ] 确认 §12 已以 `10ffb70` 和 PR #80 通知层规则为基线；
- [ ] 确认首版只复用右侧辅助列，不做 overlay/drawer；
- [ ] 确认不引入语义记忆和 MemoryPanel；
- [ ] 已读 `docs/dev/FRONTEND-DESIGN-GUIDE.md` 1.3 全文，并确认其 §1/§4/§5/§6.4/§6.5/§7/§8 在本方案中按硬性规定执行；
- [ ] **裁定一已定死**：常驻右列不使用 `.button--primary`，风险由服务端动作描述符给出，确认按钮按 §9.2 二分支（`secondary` / `danger`），取消恒为 `ghost`；
- [ ] **裁定二已定死**：费用与说明为中性色；待确认 ActionCard 保持中性，动作卡内不放状态胶囊，橙色待办只走对话列表 `.is-pending` 左边条；带橙色左边条的卡片（含终态 `stale`）按钮一律 `.button--ghost`；
- [ ] **裁定三已定死**：助手窄屏适配只落在 `@media (max-width: 1320px)`，桌面验收视口为 1321×900 与 1180×760；未新增断点，未使用桌面不可达的 1120px/960px；
- [ ] **裁定四已定死**：遮罩由 `<dialog>.dialog-backdrop` 自身承载，保留 `styles.css:668` 并补 100% 宽高、无最大尺寸、零 margin/border reset 与透明 `::backdrop`；`cancel` 走受控 `onClose`，effect 对 StrictMode 防重并清理；
- [ ] **裁定五已定死**：共享 Modal 首批只迁移 SettingsDialog、ProjectManager，并供助手删除确认复用；NewProjectDialog、`GalleryWorkspace.tsx` 与 `GuideModal.tsx` 均不迁移，图库迁移前必须先补 Escape、焦点和重复关闭用例；
- [ ] 助手状态中文映射与语义色绑定已写入 §6.6 并与指南 §7 / §2.4 一致，`running` 映射「正在思考」，`succeeded` 明确不译为「已批准」；应用自有文本与模型正文的语言保证边界明确。

### 开始 A1 前

- [ ] 锁定最小文件 schema 与错误码；
- [ ] 明确消息和上下文字符上限；
- [ ] 明确 trash 保留期；
- [ ] Kunpo/OpenAI-compatible 网关 JSON 请求探针通过；
- [ ] 现有 SettingsDialog 可编辑 `assistantModel`，桌面应用级与 Web 租户级存储语义已验证；
- [ ] ContextBuilder 的 `open(..., { includePreviews: false, screenId })` 和自愈语义已写入测试；
- [ ] Gallery 式单写者队列与 AssistantStore 原生 JSONL append 已验证；
- [ ] 对话列举直接读取 `conversations/*/meta.json`，消息 seq 从最后完整 JSONL 记录推导；不存在 `index.json` 与 `next_message_seq` 双重真相；
- [ ] 助手反馈不进入 `.overlay-bar`，PR #80 的图库点击与反馈隔离测试通过；
- [ ] `.assistant-panel` 已加 `inert={galleryOpen}`，且面板没有透明 `position: fixed` 覆盖节点；
- [ ] 共享 Modal 已在 `ui.tsx` 新建为受控原生 `<dialog>` + Portal，SettingsDialog、ProjectManager 已收敛到它；标题关联、cancel/onClose、Escape 后重开、StrictMode、焦点限制与焦点归还通过；
- [ ] `.dialog-backdrop` 挂在 `<dialog>` 元素自身，`src/styles.css` 已保留 `:668` 并新增 dialog UA 几何 reset 与透明 `::backdrop`；1180×760 下元素 rect、margin 和 border 断言通过；
- [ ] `App.test.tsx` 只在测试侧提供最小 `showModal` / `close` shim，生产组件无 jsdom 兼容分支；真实 top layer 行为由 Playwright 覆盖；
- [ ] NewProjectDialog、`GalleryWorkspace.tsx`、`GuideModal.tsx` 与 `GalleryWorkspace.test.tsx` 的相关实现未被迁移，现有用例继续通过（§13.2）；
- [ ] 1180×760 下右列实测 280px、动作卡与对话列表的窄屏适配已生效并有断言；
- [ ] 新增错误码已同时改 `electron/services/errorCodes.cjs`、`docs/dev/ERROR-CATALOG.md` 与 `scripts/check-error-docs.cjs` 的分区标题，`pnpm run test:docs` 四条门禁全绿；
- [ ] `docs/dev/PROJECT-DIRECTORY.md` 已按图库先例登记助手目录归属（应用级/租户级，不属项目目录与 Artifact Registry）；
- [ ] 目标文件的现有调用链已复核。

### 开始 A2 前

- [ ] `save_intent_review_draft` 参数与现有领域入口一一对应；
- [ ] `save_intent_review_draft` 的服务端风险固定为 `writes_project: true, replaces_content: true, reversible: false, external_cost: false`；
- [ ] `expectedIntentReviewRevision` 从提议记录到确认执行全链路保留；
- [ ] ActionCard 不接受 Renderer 回传 args；
- [ ] AssistantTools 从锁外调用公开方法，且无法访问 `__unsafe`；
- [ ] `awaiting_confirmation → executing` 原子认领、终态 result/error 回放、幂等和 stale 测试先写好；
- [ ] 审批/豁免动作不在任何白名单或提示能力描述中。

### 增加任何后续动作前

- [ ] 能说清楚该动作比用户点击现有按钮更有价值；
- [ ] 能命名真实写入对象和外部费用；
- [ ] 领域入口已有输入校验；
- [ ] 领域入口已有 CAS 或已在共享位置补齐；
- [ ] 已定义重复请求语义；
- [ ] 已定义失败后是否允许重试；
- [ ] 已有一条最小可运行测试。

---

## 20. 预期结果判断

按本 v1.2 实施后，用户的核心期望可以达到，且正确性边界比 v1.0 更清楚：

- **能理解真实项目**：上下文由服务端从现有状态构建，不依赖聊天猜测；
- **能持续协作**：历史与摘要由应用持久化，重启不丢失；
- **新对话干净**：无供应商 Thread、无跨会话记忆、绑定不可重写；
- **能安全做事**：一次只提一个动作，确认先原子认领，再读状态并做 CAS；重复确认只回放持久化结果；
- **不会越权**：模型看不到人类权限工具，也不能自选路径或租户；
- **可维护**：只有一个助手核心、一个现有 API 门面、三个起步服务文件；对话列表与消息序号不维护第二事实源；
- **不会破坏设计语言**：服务端风险驱动的按钮等级、ActionCard/列表的金橙分工、应用自有中文状态映射与断点事实在 A0 一次定死，并由 §12.6 与 §16.5 的可执行断言守住；模型正文的语言只作诚实、可实现的尽力约束；
- **可回滚**：功能开关关闭即可退出，不触碰项目数据格式；
- **可渐进增强**：流式、SDK、多步运行和语义记忆都有明确进入条件，而不是首版债务。

最终判断：**建议开工，但必须按 A0 → A1 → A2 顺序推进；禁止直接从 v1.0 的完整文件清单和 SDK 架构开始。**

---

## 21. 参考

### 项目内证据

- `electron/services/kunpoClient.cjs`
- `electron/services/env.cjs`
- `electron/services/jsonStore.cjs`
- `electron/services/galleryStore.cjs`
- `electron/services/projectStore.cjs`
- `electron/services/designPipeline.cjs`
- `electron/services/intentStateStore.cjs`
- `electron/main.cjs`
- `electron/preload.cjs`
- `server/webServer.cjs`
- `src/api.ts`
- `src/vite-env.d.ts`
- `src/types.ts`
- `src/App.tsx`（`FeedbackScope` 与 `feedbackVisible`；`:223` 对 `.artifact-inspector` 的 `inert={galleryOpen}`；`:24` 局部 `Modal` 的真实调用者是 SettingsDialog 与 ProjectManager；NewProjectDialog 是另一套手写遮罩，首次建项目可无 `onClose`）
- `src/main.tsx`（`React.StrictMode` 装配，决定共享 Modal 的 `showModal()` effect 必须防重并清理）
- `vitest.config.ts`（测试环境为 jsdom；其 `HTMLDialogElement` 不实现 `showModal` / `close`，最小 shim 只放测试侧）
- `src/styles.css`（`:44` `body{min-width:1180px}`；`:77` `--rail-w:274px`；`:87` `has-inspector` 三列；`:181` `.overlay-bar`；`:626` `.artifact-inspector`；`:668` `.dialog-backdrop`。Chromium 实测原生 dialog 若不重置 UA `max-width` / `max-height` / margin / border，即使 `inset:0` 也只包住内容；因此 §12.4 同时要求保留既有规则、补 dialog 几何 reset 和透明 `::backdrop`；`:732-734` 1320px 断点降至 `--rail-w:244px` / 右列 280px）
- `src/features/shared/ui.tsx`（共享自绘 `Dropdown`、`statusLabel`；**没有 Modal 导出**，`src/` 内也没有任何 `<dialog>` 元素——共享 Modal 是待建控件，当前基线是 `App.tsx:24` 的局部 `Modal`）
- `src/features/gallery/GalleryWorkspace.tsx`（`:155-178` 窗口级 Escape 链；`:242-246` `closeWaiver` 归还焦点；`:405` 手写 `div.dialog-backdrop` 豁免对话框，已带 `role="dialog"` / `aria-modal="true"`）、`src/features/help/GuideModal.tsx`（`:8` 同类手写遮罩）、`src/features/gallery/GalleryWorkspace.test.tsx`（`:116-123` 下拉 Escape 不关图库、`:230-243` 灯箱 Escape + 焦点归还、`:165-183` 豁免流程**无** Escape/焦点断言）、`tests/ui-e2e/gallery.spec.ts`（`:91-101` 灯箱 Escape + 焦点归还、`:242-278` 豁免放行下载）——共同构成 §12.4「首版不迁移既有对话框、且迁移前必须先补用例」的依据
- `src/features/shared/Dropdown.test.tsx`（下拉键盘与 ARIA 契约）
- `src/App.test.tsx`（反馈按上下文隔离回归）
- `tests/ui-e2e/gallery.spec.ts`（通知层几何与 pointer-events 回归）
- `electron/services/errorCodes.cjs`
- `scripts/check-error-docs.cjs`（`:43-45` 硬编码分区边界）
- `scripts/check-doc-commands.cjs`
- `scripts/check-project-tree.cjs`
- `docs/dev/FRONTEND-DESIGN-GUIDE.md`（1.3，唯一设计事实来源；助手相关条款：§1 断点、§4 金橙互斥、§5 辅助列按钮等级、§6.4 左边条与中性提示、§6.5 弹窗与遮罩归属、§7 中文映射、§8 禁区第 11/12 条、§9 自查清单）
- `docs/dev/ERROR-CATALOG.md`
- `docs/dev/PROJECT-DIRECTORY.md`（§2 路径规则中的图库归属先例）
- `package.json`

### OpenAI 官方资料

- [Agents 指南](https://developers.openai.com/api/docs/guides/agents)
- [Agents SDK 模型与 Provider](https://developers.openai.com/api/docs/guides/agents/models)
- [运行 Agent 与会话状态](https://developers.openai.com/api/docs/guides/agents/running-agents)
- [运行结果、Interruptions 与 State](https://developers.openai.com/api/docs/guides/agents/results)
- [Guardrails 与 Approvals](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals)
- [Responses API create](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)

---

## 22. 修订记录

### v1.2 三次审校：原生 `<dialog>` 运行语义与真实调用范围（2026-09-05）

本轮不扩产品范围，只修正二次审校后仍会导致实现或测试直接失败的四处事实；下方二次审校记录保留为历史，但其中「`:668` 一行即可覆盖视口」「dialog 自行吃 Escape」「Settings/新建项目」等旧判断均由本节覆盖。

1. **补齐 UA 几何 reset**：Chromium 实测只给 `<dialog>` 复用 `.dialog-backdrop { inset: 0 }` 时，UA `max-width`、`max-height`、margin 与 border 仍会让元素只包住内容。施工必须保留既有规则，并新增 `dialog.dialog-backdrop` 的 `width/height:100%`、`max-width/max-height:none`、`margin/border:0`；透明 `::backdrop` 规则继续保留。第 11 条 E2E 同时断言 rect、margin、border 与背景色。
2. **改正 Escape 与受控状态语义**：Chromium 真实顺序是 `window keydown(Escape) → dialog cancel → dialog close`，不是 dialog 自行吞掉 Escape。共享 Modal 必须在 `cancel` 中 `preventDefault()` 并调用 `onClose()`，否则 DOM 已关而 React 状态仍为 true，下一次无法重开。因入口使用 `React.StrictMode`，`showModal()` effect 还必须检查 `dialog.open` 并在 cleanup 关闭仍打开的元素。
3. **修正迁移清单**：`App.tsx:24` 局部 Modal 的真实调用者是 SettingsDialog 与 ProjectManager，不含 NewProjectDialog。后者是独立手写遮罩，且首次建项目会刻意不传 `onClose`。首批只迁移前两者并供助手删除确认复用；NewProjectDialog、图库豁免和使用指南均保持现状。
4. **明确测试环境边界**：Vitest 使用 jsdom 30，其 `HTMLDialogElement` 没有 `showModal()` / `close()`。只在 `App.test.tsx` 增加最小 shim；不污染生产组件，也不新增依赖。真实 top layer、Tab、Escape、视口几何和焦点归还仍由 Playwright 验证。

### v1.2 二次审校：闭合共享 `<dialog>` 缺口（2026-09-05）

触发原因：上一轮把弹窗方案收敛为共享原生 `<dialog>` 后，方向正确但没有落到可施工的粒度——指南与方案之间出现一处直接矛盾、一处事实错误，遮罩的实现归属未定，另有一处裁定二的残留漏洞。本轮不扩展产品范围，只把这四处补成 A0 可收口的裁定。指南同步由 1.2 升到 **1.3**。

1. **修正指南 §10 的事实错误**：原把「共享 Modal」列为 `src/features/shared/ui.tsx` 的现有控件，实际该文件没有 Modal 导出、`src/` 内也没有任何 `<dialog>` 元素。唯一设计事实来源不得指向不存在的组件，现改为如实列出现有导出（`Dropdown`、`statusLabel`、`friendlyError`、`StatusPill` 等）并把共享 Modal 标为**待建**，附当前基线 `App.tsx:24` 局部 `Modal` 的具体缺陷。方案 §13.2 / §21 同步。
2. **收窄指南 §6.5 的「一律」并划清迁移边界**：原文要求二次确认「一律」复用共享原生 `<dialog>`，但方案 §13.2 的修改文件清单不含 `GalleryWorkspace.tsx`（现存唯一的另一处二次确认）与 `GuideModal.tsx`——照字面执行，首版落地当天就违反指南，唯一出路是记为「已知偏差」，而这正是 §16.5 明令禁止的。现把适用范围明确为「**新建的**二次确认」，既有两处归各自功能的改造 PR；方案 §12.4 / §13.2 / §14 A1 退出条件 / §19 检查单同步划界。
3. **裁定遮罩归属**：`.dialog-backdrop` 类挂在 `<dialog>` 元素本身，不靠 `::backdrop` 承载。DOM 维持「外层遮罩 + 内层 `section.utility-dialog`」两层，只把外层标签由 `div` 换成 `dialog`，`styles.css:668` 一行不改（`inset: 0` 与 `place-items: center` 在 top layer 内照样成立，`z-index: 100` 变惰性但无害）；同时必须新增 `dialog.dialog-backdrop::backdrop { background: transparent; }`，因为 `styles.css` 目前没有任何 `::backdrop` 规则，UA 默认那层 `rgba(0,0,0,.1)` 会透过半透明的 `rgba(5,6,9,.66)` 叠加，使新弹窗比现有弹窗更暗。反向方案（dialog 自身透明、由 `::backdrop` 承载底色）被否决：会丢掉 `backdrop-filter: blur(8px)` 观感，并让「点遮罩关闭」无法再用 `event.target === event.currentTarget` 判定。
4. **补上一条比"已有覆盖"更硬的理由**：核查源码后发现，图库豁免对话框的焦点归还**有实现无断言**——`closeWaiver` 在 `GalleryWorkspace.tsx:242-246` 归还焦点，但现有测试只锁住下拉分支（`GalleryWorkspace.test.tsx:116-123`）与灯箱分支（`:230-243`、`gallery.spec.ts:91-101`），豁免分支（`:165-183`、`gallery.spec.ts:242-278`）没有任何 Escape 或焦点断言。它是 `:155-178` 那条窗口级 Escape 链的第一优先分支，而 `showModal()` 自行吃 Escape 并把自身画进 top layer（高于图库 z-60/70/90/100），因此迁移必须**先补用例再改实现**，否则是静默回归。这条同时说明为什么不能把它塞进助手 PR。
5. **堵住裁定二的残留漏洞**：§9.2 给 `stale` 卡橙色左边条，而 §12.4 在同一张卡上放「重新生成计划」却未指定按钮等级；实现者按惯性取 `.button--secondary` 就会让金与橙同卡，§4 违规只是从待确认态挪到了终态。现固定为 `.button--ghost`（并禁止 danger：`stale` 不是不可逆写入，用红会把「计划过期」误报成「即将覆盖」）。指南 §6.4 同步补通用条款「凡卡片带橙色左边条，卡上按钮一律 `.button--ghost`」，使其不限于助手。
6. **让第 11 条断言可执行**：原写「`.dialog-backdrop` / `::backdrop` 实测覆盖整个视口」——遮罩归属未定时这句无从落地，且 `getComputedStyle(dialog, '::backdrop')` 在 Chromium 上不可靠，与上一轮已修正的第 10 条属同类错误。改为断言 `<dialog>` 自身带 `.dialog-backdrop`、`getBoundingClientRect()` 覆盖视口、计算 `backgroundColor` 等于既有遮罩值 `rgba(5, 6, 9, 0.66)`；`::backdrop` 的中和规则改为核对 `styles.css` 中存在该条规则，由 §16.5 自查与代码审查确认。
7. **同步过期交叉引用**：§13.2「已在本次 v1.2 修订中落入 1.1 版」与 §21「`FRONTEND-DESIGN-GUIDE.md`（v1.1，唯一设计事实来源）」均指向已被取代的指南版本，改为 1.3 并在 §21 列出助手相关条款锚点（§1 / §4 / §5 / §6.4 / §6.5 / §7 / §8 / §9）。

指南侧同步修订（1.2 → 1.3）：§6.4 新增橙色左边条卡片的 ghost 按钮约束；§6.5 收窄「一律」适用范围、新增遮罩归属裁定与既有对话框迁移边界；§6.7 豁免对话框条目补现状、Escape 链实现位置与覆盖缺口；§9 自查清单把原一条拆为两条（新建对话框断言 `::backdrop` 已置透明；迁移既有对话框须先补用例且不顺带改图库）；§10 修正共享 Modal 的事实错误。本轮未修改任何源码，未提交 Git。

### v1.2 审校修正（2026-09-05）

本轮不扩展产品范围，只修正会导致实现歧义或重复建设的契约：

1. **确认幂等改为先认领后执行**：在对话单写者队列内先持久化 `awaiting_confirmation → executing`，run 保存脱敏 `result/error`；并发或重复确认只返回进行中/首次终态，不再调用领域服务。跨崩溃窗口诚实标记 `interrupted`，不伪称 exactly-once。
2. **动作风险改为服务端所有**：模型只返回 `name/reason/args`，服务端静态描述符附加 `writes_project/replaces_content/reversible/external_cost`。按真实源码，`save_intent_review_draft` 会替换当前 Intent Review/requirement 并撤销确认，且当前无用户恢复入口，因此固定为替换、不可逆，使用 danger。
3. **补全 run 状态机**：问答明确 `running → succeeded`，`stale` 为终态，queued 可取消；并发上限精确定义为一个未完成 run，包含等待确认。
4. **删除双重事实源**：移除 `assistant/index.json` 与 `meta.next_message_seq`；对话列表从 `conversations/*/meta.json` 读取，seq 从最后完整 JSONL 记录推导。保留每对话进程内队列，并写明多进程时直接升级 SQLite/文件锁的边界。
5. **关闭 UI 死路与复用缺口**：首版移除只有归档没有恢复的对话归档能力；`src/features/shared/ui.tsx` 纳入修改清单，补助手状态映射，并把现有 App 局部 Modal 收敛为共享原生 `<dialog>` + Portal，复用浏览器模态行为而非手写焦点锁或只复用类名。
6. **修正金橙与中文保证**：待确认 ActionCard 保持中性，橙色只落对话列表；应用自有状态与操作文本保证简体中文，模型正文只由系统提示尽力约束，不增加语言检测/翻译失败面。
7. **让测试断言可执行**：不再检查计算样式字符串是否“含 `--warning`”，改为检查无 warning 状态类且实际 `color/backgroundColor` 与 `.settings-note` 中性基准一致；命令统一使用仓库锁定的 pnpm。

### v1.1 → v1.2（2026-09-04）

触发原因：把 `docs/dev/FRONTEND-DESIGN-GUIDE.md` 作为**硬性规定**对本方案做了一轮设计合规评审，发现 §12 的 UI 章节虽然已对齐 PR #80 的通知层规则，但对设计语言本身只写了"不新增断点、不做 overlay"这类否定式约束，缺少正面裁定；有三处会在施工时必然撞上指南红线，另有两处会让文档门禁变红。三项裁定已同步写入指南 v1.1，本方案与之互为引用。

| # | 变更 | 依据 |
|---|---|---|
| 1 | 头部新增「设计规范基线」行，声明指南 §1/§4/§5/§7/§8 按硬性规定执行、不得记为「已知偏差」 | 用户裁定：设计红线不作为验收期偏差处理 |
| 2 | **裁定一**：常驻右列禁用 `.button--primary`，动作卡确认按钮按 `replaces_content` 二分支取 `secondary`/`danger`，取消恒 `ghost`（§9.2、§12.3、§16.5、§18、§19） | 助手与主工作区**常驻同屏**，指南 §8 禁区第 10 条（同屏唯一 primary）从"可能冲突"变为"必然冲突"；二分支同时让指南 §4 金橙互斥由构造成立 |
| 3 | **裁定二**：费用与说明为中性 `--muted` + `--panel-2`，橙色只表达"待你处理"；动作卡内不放状态胶囊；"待确认"提示改走对话列表 `.is-pending` 左边条（§9.2、§12.3、§18） | 指南 §4 金橙分工 + §6.4 提示条语义；一次点击就"看起来像出了事"会稀释橙色语义 |
| 4 | **裁定三**：查明 `electron/main.cjs` 设 `minWidth: 1180`，1120px 与 960px 断点在桌面版**不可达**；助手窄屏适配只落 `@media (max-width: 1320px)`（右列 316px→280px、`--rail-w` 274→244），验收视口改为 1321×900 与 1180×760（§2、§12.1、§15.1、§15.3） | 原 §15.3 写"在 1320/1240/1120 三个断点人工验收"，其中 1120 永不触发——写在那里的适配等于没有适配，且验收会给出假通过 |
| 5 | §6.6 新增运行状态中文映射表与语义色绑定；明确 `succeeded` 不得译为「已批准」、`interrupted` 与 `failed` 不得合并文案 | 指南 §7 中文状态映射 + §8 禁区第 7 条；助手状态码此前只在存储层定义，无上屏约束 |
| 6 | §7.4 补 stale 差异的渲染要求：`expected`/`actual` 是领域状态码，必须过 `statusLabel` 映射，`kind` 也要中文标签 | 同上；原示例 JSON 直接展示 `"reviewed" → "stale"`，照抄即违规 |
| 7 | §8.1 补模型输出语言边界：应用自有文本与状态映射保证简体中文，`reply` 正文只由系统提示尽力约束；首版**不做**语言检测、自动翻译或因语言拒绝 | 提示词不能构成输出保证；把不可保证项写成硬验收会诱发新的检测/翻译失败面 |
| 8 | §12.1 补 `inert={galleryOpen}` 与 fixed 包含块风险 | `App.tsx:223` 已对 `.artifact-inspector` 加 inert；本轮审校进一步改为共享原生 `<dialog>` + Portal，从结构上消除右列祖先包含块影响 |
| 9 | §12.2 补 BEM 类名与令牌、无内联样式要求；§12.4 明确模式切换用 `role="group"` 按钮组、对话切换用共享 `Dropdown`（禁原生 `<select>`）、删除用 `.dialog-backdrop` + `.utility-dialog` 且不新增 z-index 层；§12.5 补 Composer 样式、字号阶梯与字体族令牌 | 指南 §1 / §2.5 / §6.1 / §6.2 / §6.5 |
| 10 | §12.6 回归场景从 7 条扩到 14 条，新增 inert、280px 实测、无 primary、费用/说明中性计算样式、遮罩覆盖视口、无原生 select、中文状态渲染等可执行断言 | 裁定需要断言守护，否则下一轮改动会静默回退 |
| 11 | §13.2 补入 `scripts/check-error-docs.cjs` 与 `docs/dev/PROJECT-DIRECTORY.md`，并给出错误码分区的最小改法（改 `## 一、` 标题 + 加 `### 助手错误码` 子块，不新增第四个注册组） | 该门禁的分区边界是硬编码字面量，只加目录不改脚本会让 `pnpm run test:docs` 变红；PROJECT-DIRECTORY 已有图库归属登记先例 |
| 12 | §2 基线表新增「设计规范」「窗口与断点」「右列装配」三行，并修正「UI 布局」行补入 1320px 实测值 | 原表缺少设计事实来源与窗口下限，导致 §12 只能写否定式约束 |
| 13 | §3.2 问题清单新增 8 条 P1 与 2 条 P2 | 对应上述各项的评审发现 |
| 14 | §16 新增 §16.5「设计规范合规（硬性）」；DoD 标题与 §20 结论的版本号同步为 v1.2，并新增"不会破坏设计语言"一条 | 设计规范合规需要与正确性、安全、可维护性并列，不能作为可维护性的子项被忽略 |

指南侧同步修订（v1.0 → v1.1，已落盘并通过四条文档门禁）：§1 断点改为事实版并区分 shell 断点与 Web-only 降级；§1 样式源行数改为不易腐烂的量级表述；§5 新增常驻辅助列按钮等级二分支表；§6.4 新增"费用是事实不是状态"与列表待办左边条约定；§6.5 新增对话框复用与 `fixed` 包含块陷阱；§2.4 新增助手语义色绑定；§7 新增助手状态映射与模型文本语言约束；§8 禁区第 7 条扩至模型返回状态词并新增第 11、12 条；§9 新增 4 条自查项；§10 新增 `electron/main.cjs` 与 `src/App.tsx` 指针。

文件名处理：v1.1 文档**原地升级并重命名**为 v1.2（该文件仍为 Git 未跟踪状态，不存在已发布版本需要保留），变更记录集中在本节，避免同一方案在 `docs/` 下产生多份并行副本造成基线歧义。
