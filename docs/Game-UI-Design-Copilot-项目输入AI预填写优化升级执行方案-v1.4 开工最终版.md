# Game UI Design Copilot「项目输入」AI 预填写优化升级执行方案
## v1.4 开工最终版

## 0. 文档信息

| 项目 | 内容 |
|---|---|
| 仓库 | `z806738350-source/Game-UI-Design-Projects` |
| 已核对代码基线 | `main@7893ad0babc1c793620e8152e97b05c7ad6db95e` |
| 方案版本 | **v1.4（单一发布点 + 读取时自愈简化版）** |
| 订正日期 | 2026-08-30 |
| 改造范围 | 项目输入 → AI 读取 UE → 结构化分析 → 固定格式预填 → 设计师检查确认 → Functional Screen Contract 输入 |
| 文档用途 | 可直接交给执行者拆分里程碑、修改代码、编写测试、联调、验收和归档 |
| 是否修改功能代码 | 否；本文是执行基线，不是代码提交 |
| 人工美术验收 | 不在本次范围内 |
| 仓库治理 | 单人维护；不要求寻找 GitHub 协作者或第二审批人 |

> 本文在 v1.3 基础上修订，替代 v1.1、v1.2、v1.3 的全部旧口径。执行者不得同时参照多个版本自行取舍；发生冲突时，以本文为唯一实施口径。

### v1.4 相对 v1.3 的订正摘要

1. **崩溃安全体系降级**：v1.3 为"多文件写序列中途崩溃"引入的 transaction journal、六阶段状态机、rollback/roll-forward、`getIntentTransactionStatus`/`recoverIntentTransaction`、独立恢复页、`intent_invalidation_pending` + `retryIntentInvalidation`、`INTENT_TRANSACTION_INCOMPLETE`/`INTENT_ROLLBACK_INCOMPLETE`/`INTENT_INVALIDATION_PENDING` 三个错误码，全部移除。本项目是单进程 + 本地 JSON 文件部署，崩溃安全改由「保守写入顺序 + `inputs.json` 唯一原子发布点 + 读取时自愈」实现（§8.6、§8.7）。
2. **下游失效简化**：权威发布与下游标 stale 在同一项目锁复合操作中完成；stale 是 source binding 的可推导纯函数，任何残留由读取时自愈补齐，不再需要持久化挂起事件和重试 API。
3. **PR-I1 瘦身**：移除事务体系后，PR-I1 可在单个 PR 内完成并保持可审。
4. **措辞订正**：`buildScreenContractIntentContext()` 是本方案新增纯函数，不是现有函数（§6.8）；回滚时 legacy textarea 语义明确（§15）；真实评估增加未达标项的 triage 判定口径（§13.8）。

---

# 1. 审查结论

## 1.1 总体判断

原方向正确：

```text
自由文本模型输出
→ 结构化 Intent Analysis
→ 程序确定性生成 Intent Review
→ 设计师显式确认
→ 程序确定性生成 requirement
→ 进入功能契约
```

这条路线能够直接解决当前项目已经存在的四类问题：

1. 六个信息维度的标题、顺序和颗粒度随机漂移；
2. 可见事实、AI 推断和真正未知规则混写；
3. `uncertainties` 虽被模型返回，但没有稳定进入用户确认界面；
4. 当前后端只验证 `requirement_draft` 是非空字符串，非法或残缺结构也可落盘。

本方案也正确保留了：

- `requirement` 和 `requirement_confirmed` 的下游兼容语义；
- 设计师最终权威；
- 一次任务、失败纠正，而非固定多模型或多次投票；
- UE 替换后的新鲜度约束；
- 重新预填的 candidate—adopt 机制；
- 老项目、人工填写和多 Screen 兼容。

## 1.2 历史缺口清单与 v1.4 解法

源码核对确认的实施漏洞如下。GAP 编号保持稳定以便追溯；v1.3 曾以事务体系解决 GAP-01/16/19/21，v1.4 改为更轻的解法并已标注。

### GAP-01：没有定义跨文件原子提交

当前 `projectStore.saveProject()` 依次写入 `project.json`、`screens/<screenId>/inputs.json`、`screens/<screenId>/inputs/requirement.md`。`jsonStore.writeJson()` 只保证单文件原子替换，不保证三个文件作为一个事务。

**v1.4 解法**：不引入跨文件事务日志。采用「保守写入顺序 + `inputs.json` 唯一原子发布点 + 读取时自愈」：发布前写入要么是孤儿无害文件、要么是可重新派生的投影；发布后崩溃由读取时自愈向前补齐（§8.6、§8.7）。

### GAP-02：现有项目写锁不覆盖新输入操作

当前 `withProjectWriteLock()` 只包装 `createScreen`、`duplicateScreen`、`setActiveScreen`、`updateScreen`、`updateWorkflow`，没有包装 `saveProject`、`importFile`、AI 预填提交、candidate 采用、history 恢复。

### GAP-03：长时间 AI 调用与并发编辑的关系未定义

只记录 wireframe revision 不足以处理"AI 请求进行中 → 用户手工填写 → AI 返回"场景；还缺少同一 Screen 连点两次预填时的"旧响应不得覆盖新响应"规则。

### GAP-04：Intent Review 丢失稳定 ID 和来源信息

纯字符串数组无法可靠实现"图中可见 / AI 推断 / 设计师新增"标签、candidate 差异匹配、单条修改标记、uncertainty 关联和历史恢复后的条目身份。

### GAP-05：`blocking` 问题可被 `deferred` 绕过

真正阻断业务定义的问题不能通过"暂时保留"绕过确认门禁。

### GAP-06：历史恢复可能复活旧确认

恢复旧版本不得自动恢复 `requirement_confirmed=true`，否则会复活已过期的批准事实。

### GAP-07：Screen Clone / Project Clone 对 candidate 与 history 的语义不明确

candidate 绑定原 Screen 和旧 revisions，直接复制后仍可采用会造成跨 Screen 覆盖。

### GAP-08：页面层级示例与校验规则互相冲突

普通顶层弹窗不一定是背景节点的子节点，`parent_id` 只表示真正的嵌套，照字面强制会拒绝合法页面。

### GAP-09：业务断言检测使用全局文字语料会产生假支持

页面某处出现"领取"按钮，不等于"绿色勾表示已领取"。支持证据必须绑定同一实体。

### GAP-10：candidate 生成会误伤当前已批准输入的 Workflow 状态

重新预填只是在生成未采用 candidate，不应把当前权威输入从 approved 改成 failed/reviewed。

### GAP-11：`saveProject` 仍允许客户端伪造 AI 分析

`intent_analysis`、candidate、history、server timestamps 必须改为系统控制字段。

### GAP-12：Screen Contract Prompt 仍接收 Art Direction

界面已承诺"美术大方向不影响功能识别"，功能契约 Prompt 也必须移除 Art Direction。

### GAP-13：确认条件过宽

用户仍可能把任务、流程、控件和信息删空后确认，得到形式完整但不可用的 requirement。

### GAP-14：历史无限增长与路径安全未定义

candidate/history 是 Web 可达的持久化数据，需要数量、字节、文件名和路径约束。

### GAP-15：模型质量验收中的"100%"边界不够精确

100% 只能用于固定 schema、确定性 renderer、冻结的政策正反 fixture、不合格对象不落盘。真实自然语言模型质量必须使用概率阈值和逐条 triage。

### GAP-16：权威输入提交与下游失效的关系

已发布的权威输入绝不能因为下游失效失败而回滚。

**v1.4 解法**：权威发布与下游标 stale 在同一项目锁复合操作中完成，下游标 stale 在发布前保守执行；stale 是 `source.intent_context` 绑定的可推导纯函数，任何残留由读取时自愈机械补齐。不需要第二个事务边界，也不需要持久化挂起事件。"已发布输入不回滚"的原则保留。

### GAP-17：CAS revision 与 Screen Contract 语义 revision 混用

`intent_review_revision` 用于并发保存冲突，不等同于 Screen Contract 的有效输入语义。必须增加独立的 `intent_context_revision` 与规范化 `intent_context_hash`。引入 hash 的具体原因：candidate adopt/history restore 可能产生"revision 不同、六段文本相同、Supporting Context 也相同"的语义 no-op；普通递增 revision 无法识别，会无意义地 stale 下游。

### GAP-18：stale analysis 仍可能越过 Context Builder

只在 UI 显示 stale 不构成后端边界。`buildScreenContractIntentContext()` 必须机械排除旧 analysis 的 layers、controls、information、inference 和 evidence。

### GAP-19：崩溃残留可能阻断项目打开

**v1.4 解法**：不产生可阻断打开的残留。写入顺序保证崩溃后要么权威仍是旧 `inputs.json`（孤儿由自愈清理），要么新 `inputs.json` 已原子发布（投影由自愈补齐）。hydrate 永不因半状态 Fail-Closed，只做向前修复。

### GAP-20：单槽 generation 状态仍可能被旧请求失败回写覆盖

任何终态写回都必须先比较当前 `request_id`；进程重启后旧进程留下的 running 必须转为 interrupted。

### GAP-21：Clone 未覆盖运行态

**v1.4 解法**：Clone 前置条件收缩为"无 `intent_generation.status=running`、无进行中的 adopt/restore 复合操作"（均在项目写锁内检查）。事务态和挂起态在 v1.4 中不存在。

### GAP-22：客户端生成正式 item ID 会混淆新增与已有 AI 条目

正式 ID 必须由服务端生成。前端新增时只能提交临时 `client_mutation_id`。

### GAP-23：Project Type 参与分析，却没有定义变更后的 freshness 传播

Project Type 变化必须使 analysis/candidate stale、取消确认、增加 Intent Context revision 并失效下游。

## 1.3 订正后的结论

完成本文 v1.4 后，方案可以直接交给执行者执行。必须坚持：

```text
AI 分析是证据
Intent Review 是设计师结构化权威
requirement 是 Review 的确定性文本投影
candidate 未采用前没有任何业务效力
history 只能恢复内容，不能自动复活确认
已发布权威输入只允许向前补齐，不允许因任何后续失败回滚
Screen Contract freshness 绑定 Intent Context，而不是绑定全部 CAS revision
旧请求、旧进程和 Clone 不得继承或覆盖活动运行态
崩溃安全由单一发布点与读取时自愈保证：不引入事务日志、显式恢复 API 或阻塞打开的残留态
```

---

# 2. 目标、范围与非范围

## 2.1 目标

1. 将自由文本预填升级为可校验的 `Intent Analysis v2`；
2. 分离图中事实、AI 推断与待确认规则；
3. 用程序保证固定六段格式；
4. 让用户看见并处理 uncertainty；
5. 阻止过期 UE 分析继续被确认；
6. 阻止重新预填覆盖设计师工作；
7. 保持老项目、人工需求和下游 Screen Contract 兼容；
8. Electron、Web、Preview 使用同一业务语义；
9. 多 Screen 下完全隔离；
10. 在当前单进程部署中处理并发请求、旧响应、candidate 采用和历史恢复冲突；
11. 崩溃安全：单一发布点 + 读取时自愈，任意崩溃点留下可修复的保守状态；
12. 区分 Review CAS revision 与 Screen Contract Intent Context revision/hash；
13. 让旧请求、旧进程、Clone 和 Project Type 变化都有完整状态生命周期；
14. 不触碰任何生图或后续视觉生产链实现。

## 2.2 本次必须完成

- Intent Analysis v2 数据合同、normalizer、validator；
- 结构和语义纠正循环；
- 确定性 Review Builder 与 Requirement Renderer；
- 专用 Intent 状态存储与单一发布点写入顺序；
- 读取时自愈、孤儿清理与投影补齐；
- 首次预填、重新预填 candidate、采用、放弃、历史恢复；
- AI 请求期间 UE/输入变化和请求 supersede 防护；
- UE 替换后的确认取消和 candidate 过期；
- Project Type 变化后的 analysis/candidate freshness、确认取消和下游失效；
- request-id CAS、进程重启 interrupted、ready candidate 禁止隐式替换；
- 六段编辑器、事实/推断/确认标签；
- uncertainty 四态操作及 blocking 规则；
- Screen Contract 安全交接；
- 老项目与多 Screen 兼容；
- Project/Screen Clone 运行态检查；
- Electron/Web/Preview API；
- 单元、集成、UI、Electron E2E、真实多模态评估；
- 文档、错误码、ADR 和项目树同步。

## 2.3 不在本次范围

- 生图模型、图像任务或图像修复接口；
- Style、Layout、Underlay、Composition、Fidelity 功能改变；
- 更换多模态供应商；
- 固定多次调用或多模型投票；
- 自动替设计师回答隐藏业务规则；
- 将项目输入直接变成 Screen Contract；
- 多进程共享数据卷的跨进程锁；
- 完成 Issue #50 的通用 pipeline `job_id` 改造；
- 事务日志、显式崩溃恢复 API、失效挂起事件（v1.3 方案，已被单一发布点 + 读取时自愈取代）。

## 2.4 产品边界

本方案适用于当前支持部署：

```text
Electron 单主进程
Web 单 Node 进程、每 tenant 单 ProjectStore
```

如未来多个进程或多个服务副本共享同一 workspace，Intent mutation 需要文件锁、数据库事务或 Revision CAS，不能依赖当前内存锁；届时才重新评估是否需要持久化事务协议。

---

# 3. 当前代码事实

基线 `main@7893ad0...` 的真实行为如下（均经源码核对）。

## 3.1 Prompt

`electron/services/prompts.cjs` 的 `intentDraftPrompt()`：

- 返回自由字符串 `requirement_draft`；
- 只附加 `inferred_page_type`、`inferred_rules`、`uncertainties`；
- 包含 `art_direction`；
- 没有稳定 Task Kind；
- 没有层级、实体、引用和 audit 合同。

`screenContractPrompt()` 也包含 Art Direction（L23）。

## 3.2 模型返回校验

`requestJson()` 只检查 `requiredStringKeys: ['requirement_draft']`。它不知道 Intent schema、warnings、自动降级或细粒度修复反馈。

## 3.3 破坏性覆盖

`draftRequirement()` 成功后直接调用 `saveProject()` 覆盖 `requirement`、`requirement_source`、`requirement_confirmed`、`intent_analysis`。已有设计师内容没有 candidate 比较和历史快照。

## 3.4 输入存储

当前 `saveProject()` 分别写 `project.json`、`screens/<screenId>/inputs.json`、`screens/<screenId>/inputs/requirement.md`。三个文件之间不是一个事务；`jsonStore.writeJson()` 只保证单文件原子替换。

## 3.5 UE 替换

`importFile(kind='wireframe')` 会增加 wireframe revision，但不会在同一存储操作中：取消 `requirement_confirmed`、清除 Review 的 `confirmed_at`、标记 analysis freshness、使 candidate 过期。

## 3.6 UI

`InputWorkspace.tsx` 仍是单 textarea；重新预填直接调用当前破坏性 `draftRequirement()`。

## 3.7 当前写锁

现有项目写锁只包装部分 Registry/Workflow 写者，不自动保护 `saveProject()`、`importFile()` 或新 Intent 操作。

## 3.8 下游失效

`invalidateFromInputChange()` 是同进程内本地写的级联（`invalidateArtifacts` + `updateWorkflow`），不跨系统、不跨进程。因此"权威提交 + 下游标 stale"可以在同一项目锁内一次完成。

---

# 4. 权威模型与存储结构

## 4.1 单向权威

```text
Intent Analysis v2（AI 证据，只读）
             ↓
Intent Review v1.1（设计师结构化权威）
             ↓
requirement（后端确定性投影）
             ↓
Functional Screen Contract Prompt
```

旁支：

```text
Intent Candidate（未采用建议）
Intent History（不可变恢复快照）
```

规则：

- 前端不能独立编辑 `requirement` 和 `intent_review`；
- structured-v2 模式下，`requirement` 只能由后端 renderer 生成；
- `intent_analysis` 不能通过普通 PATCH 修改；
- candidate 未采用前不参与下游；
- history 不自动成为当前权威；
- 恢复 history 后必须重新确认。

崩溃安全原则：任何多文件写序列必须满足——发布点之前的写入要么是孤儿无害的追加文件，要么是可重新派生的投影；唯一权威发布点是 `inputs.json` 的单文件原子替换；所有部分状态都偏向保守的更 stale，绝不偏假新鲜。

## 4.2 Screen 级权威文件

```text
screens/<screenId>/inputs.json
```

是当前 Screen 输入的唯一权威数据源，至少包含：

```json
{
  "schema_version": "2.0",
  "screen_id": "main",
  "intent_mode": "legacy | structured-v2",
  "requirement": "...",
  "requirement_source": "none | user | ai",
  "requirement_confirmed": false,
  "intent_analysis": null,
  "intent_review": null,
  "intent_generation": null,
  "intent_context": {
    "revision": 0,
    "hash": null
  },
  "input_revisions": {
    "wireframe": 1,
    "requirement": 3,
    "intent_review": 5,
    "intent_context": 4
  }
}
```

派生文件：

```text
screens/<screenId>/inputs/requirement.md
```

兼容投影：

```text
project.json 中的 requirement 等字段只作为旧版本兼容投影，
不得反向覆盖 Screen 权威输入。
```

补充约束：

- `inputs.json` 是唯一权威发布点，使用 `jsonStore.writeJson()` 的单文件原子替换；
- `screens/<screenId>/inputs.json.input_revisions` 是 Intent CAS 的唯一 revision 来源；
- `project.json.input_revisions` 不得用于判断某个 Screen 的 candidate/history 是否新鲜；
- `hydrate()` 对外返回当前 Screen 的 revisions，不能通过合并全局字段制造假新鲜；
- structured-v2 的 project.json 投影只在当前 active Screen 需要兼容时更新，不允许它反向成为另一个 Screen 的输入；
- `requirement_source` 由后端确定：未被设计师修改的首次 AI review 为 `ai`；任何设计师内容修改、历史恢复或人工新增后为 `user`；
- `intent_review` revision 只承担 CAS/历史/候选基线职责；Screen Contract freshness 不得直接依赖它；
- `intent_context` revision/hash 是 Screen Contract 的专用语义版本，由后端根据规范化 Supporting Context 计算；
- `intent_context.hash` 使用 canonical JSON 的 SHA-256。引入 hash 的具体原因见 GAP-17：识别"revision 不同但语义 no-op"，避免无意义地 stale 下游。

## 4.3 Candidate

```text
screens/<screenId>/inputs/intent-candidate.json
```

```json
{
  "schema_version": "1.0",
  "candidate_id": "uuid",
  "request_id": "uuid",
  "screen_id": "main",
  "status": "ready | stale",
  "generated_at": "...",
  "source_context": {
    "wireframe_revision": 3,
    "project_type": "new"
  },
  "base_current_revisions": {
    "requirement": 5,
    "intent_review": 8,
    "intent_context": 6
  },
  "analysis": {},
  "review": {},
  "warnings": []
}
```

Candidate 只有一个当前槽位：

- 已存在 `ready` candidate 时，禁止启动新 generation，抛 `INTENT_CANDIDATE_REPLACEMENT_REQUIRED`；
- 用户必须先采用或显式丢弃现有 candidate；不得提供隐蔽的 `forceReplace=true`；
- adopt 成功后 candidate 的物理删除是权威发布之后的幂等清理；重复采用由 §8.4 的 revision CAS 机械阻断；
- `stale` candidate 只能查看或丢弃，不能采用；
- 崩溃残留的 `ready` candidate（已被采用、或基于过期 wireframe revision）由读取时自愈（§8.7）清理或标 `stale`。

## 4.4 History

```text
screens/<screenId>/inputs/intent-review-history/
  <history-id>.json
screens/<screenId>/inputs/intent-review-history/index.json
```

每个快照至少包含：

```text
history_id
screen_id
created_at
reason
analysis
review
requirement
requirement_source
was_confirmed（仅审计，不可自动恢复）
wireframe_revision
requirement_revision
intent_review_revision
intent_context_revision
intent_context_hash
```

规则：

- 同 Screen 唯一；
- 文件名只接受服务端生成的 UUID；
- 不允许客户端传任意路径；
- 单文件不超过 1 MiB；
- 每 Screen 最多 100 个、总计最多 64 MiB；
- 超限时不静默删除，抛 `INTENT_HISTORY_LIMIT_REACHED`，由用户删除或导出旧历史；
- 恢复操作前必须先快照当前版本；快照写入失败不得修改当前输入；
- 恢复后 `requirement_confirmed=false`，不得恢复 `was_confirmed`；
- 若历史对应旧 wireframe revision，内容可以恢复为草稿，但 analysis 显示 stale，仍须基于当前 UE 重新核对；
- 历史快照与 index 是发布点之前的追加写入，崩溃孤儿无害，由读取时自愈对齐。

## 4.5 Clone 语义

### Project Duplicate

Project Duplicate 必须先取得**源项目**的同一项目写锁，并在锁内重新检查：

```text
无 intent_generation.status=running
无进行中的 candidate adopt / history restore 复合操作
```

任一存在即 Fail-Closed，返回对应结构化错误，不得复制可能处于半状态的 workspace。

满足前置条件时，完整项目副本可以保留当前 review、history 和确认状态，因为它是静止 workspace 的快照；同时必须：

- 重写绝对路径、project_id 和 Screen 归属；
- 不复制活动 `request_id` 或 `process_instance_id`；
- 副本的 `intent_generation` 归零为 idle/null；
- ready candidate 可以复制内容，但必须改为 `stale`，删除活动 request_id，并记录 `duplicated_from_candidate_id`，不可直接采用；
- history 可完整保留，旧 request_id 只作为审计字符串，不能成为活动任务。

### Screen Duplicate

- 必须取得项目写锁，并额外检查源 Screen 无 generation running、无进行中的 adopt/restore 复合操作；不能只检查 Workflow stage 的 `in_progress`；
- 保留 requirement、review、analysis 和 history 内容；
- 重写 `screen_id`、文件路径和 Screen-scoped ID；
- `requirement_confirmed=false`；
- `intent_review.confirmed_at=null`；
- candidate 复制后必须标为 `stale`，不可直接采用；
- 不复制活动 `request_id`/`process_instance_id`，目标 Screen 的 `intent_generation` 归零；
- 复制后的 analysis 记录 `duplicated_from_screen_id`，用户仍需重新确认；
- 增加 Clone 集成测试，防止 candidate/history 串页。

---

# 5. Intent Analysis v2 数据合同

## 5.1 服务端控制字段

持久化对象由服务端加盖：

```json
{
  "schema_version": "2.0",
  "analysis_id": "uuid",
  "generated_at": "server timestamp",
  "source_revision": {
    "wireframe": 3,
    "project_type": "new"
  },
  "provider": {
    "model": "...",
    "response_id": "...",
    "attempt": 2
  },
  "warnings": []
}
```

模型不得决定或覆盖：

```text
analysis_id
generated_at
source_revision
provider
warnings
```

## 5.2 模型领域字段

```text
page_type
page_purpose
player_tasks
core_flow
screen_layers
visible_controls
visible_information_and_states
uncertainties
uncertainty_audit
```

枚举集中在 `intentAnalysis.cjs`，前端只消费导出的类型/显示映射，不复制规则。

## 5.3 Layer 规则

`parent_id` 只表示真正的嵌套 surface，不表示"前景盖住背景"。合法顶层弹窗可为：

```json
[
  { "id": "background", "kind": "background_frame", "parent_id": null },
  { "id": "modal", "kind": "modal", "parent_id": null }
]
```

校验：

- 所有非空 `parent_id` 必须存在；
- parent graph 不得有环；
- modal/drawer/popover/overlay 至少要有一个 background_frame 或 primary_content 作为同场景上下文；
- 只有真正嵌套时才强制 parent；
- 不得因为顶层 modal 的 `parent_id=null` 判非法。

## 5.4 ID 与自动新增

- 模型实体 ID：`^[a-z][a-z0-9-]{0,63}$`；
- 同一实体集合内唯一；
- 自动降级新增的 uncertainty 使用服务端确定性 ID：`policy-<category>-<entity-id>-<ordinal>`；
- 冲突时服务端追加稳定序号；
- 模型不得伪造服务端 `policy-*` 来源标记。

## 5.5 结构上限

```text
layers <= 12
visible_controls <= 80
visible_information_and_states <= 120
player_tasks <= 20
core_flow <= 30
uncertainties <= 40
单条人类可读文本 <= 500 Unicode code points
对象最大嵌套深度 <= 16
Intent Analysis 序列化后 <= 512 KiB
Intent Review 序列化后 <= 256 KiB
Candidate 文件 <= 1 MiB
```

文本处理：

- Unicode NFC；
- 统一 `\r\n` 为 `\n`；
- 去除除换行和制表符外的 C0 控制字符；
- 不使用 `dangerouslySetInnerHTML`；
- 超限是结构错误，不静默截断。

## 5.6 Evidence 规则

### 阻断引用

- `layer_id` 不存在；
- `parent_id` 不存在或成环；
- `uncertainty_audit` 引用不存在的问题；
- 重复实体 ID。

### 可归一化引用

推断中的 dangling `evidence_ids`：

- 自动删除；
- 记录 warning；
- 全部删除后标记 `ungrounded_inference`；
- 不单独消耗纠正预算。

### 可见事实

`visible_controls`、`visible_information_and_states` 本身就是证据实体，不允许把它们因为引用丢失而悄悄删除。

## 5.7 防过度推断规则

业务断言的支持必须是**实体/证据作用域内支持**，不能扫描全页面文字后全局放行。例：页面另一处存在"领取"按钮 ≠ 奖励节点绿色勾表示"已领取"。

处理步骤：

1. 保留精确 OCR 文本，不改写用户可见文字；
2. 对每个断言定位所属 control/info/flow 实体；
3. 仅使用该实体的 `visible_label`、`visible_text` 和关联 evidence 判断支持；
4. 不支持的 observed business state 从 `observed_states` 移出；
5. 保留为 AI inference，并自动增加对应 uncertainty；
6. 自动修改相应 `uncertainty_audit` 为 `questions_present` 并引用新问题；
7. 若不能安全归属实体或类别，作为阻断语义错误重试。

词表只是 guardrail，不是完备自然语言证明器。100% 验收只适用于冻结政策 fixture，不声称覆盖所有表达方式。

---

# 6. Intent Review v1.1 数据合同

## 6.1 Review Item

不能再使用纯字符串数组。统一采用：

```json
{
  "id": "review-task-1",
  "text": "查看个人与全派伤害信息",
  "origin": "ai_visible | ai_inference | designer",
  "source_evidence_ids": ["info-damage"],
  "designer_modified": false
}
```

规则：

- AI 生成 review 时使用可复现 ID；
- 用户新增条目的正式 ID 只由服务端生成；前端只能携带一次性的 `client_mutation_id` 以便映射 UI 临时条目；
- 已有条目更新必须携带服务端 item ID；ID 不存在且 `operation=update/delete/move` 时拒绝，不得降级为新增；
- `operation=add` 不接受客户端正式 ID，后端生成 UUID，并返回 `client_mutation_id → item_id` 映射；
- 修改 AI 条目后保留 origin，同时 `designer_modified=true`；
- UI 展示来源标签，不展示内部 ID。

## 6.2 Review 结构

```json
{
  "schema_version": "1.1",
  "review_id": "uuid",
  "revision": 1,
  "source_analysis_id": "uuid",
  "source_wireframe_revision": 3,
  "page_purpose": {
    "id": "page-purpose",
    "text": "展示 BOSS、伤害进度和奖励节点，并提供挑战入口",
    "origin": "ai_inference",
    "source_evidence_ids": ["control-challenge", "info-rewards"],
    "designer_modified": false
  },
  "player_tasks": [],
  "core_flow": [],
  "visible_controls": [],
  "visible_information_and_states": [],
  "uncertainties": [],
  "confirmed_at": null
}
```

## 6.3 Uncertainty Review

```json
{
  "id": "uncertainty-state-meaning",
  "category": "state_semantics",
  "question": "绿色勾和黄色高亮分别表示什么业务状态？",
  "priority": "blocking | important | optional",
  "evidence_ids": ["info-rewards"],
  "created_by": "ai | policy | designer",
  "review_status": "unreviewed | answered | deferred | not_applicable",
  "note": "",
  "designer_modified": false
}
```

允许设计师新增 uncertainty；新增项 `created_by=designer`。

## 6.4 确认门禁

确认时：

- 页面目的非空；
- 玩家任务至少 1 项；
- 核心流程至少 1 项；
- 可见控件和可见信息至少合计 1 项；
- 五个内容章节不能只剩 renderer 占位文本；
- 不存在 `unreviewed`；
- `answered` 必须有非空 note；
- `blocking` 不允许 `deferred`；
- `blocking` 标为 `not_applicable` 时必须填写理由；
- `important/optional` 可 deferred；
- 所有 IDs 唯一、文本符合大小限制。

纯信息页也应明确写出：

```text
玩家任务：阅读公告
核心流程：打开页面并查看公告内容
```

不允许通过删除内容绕过结构完整性。

## 6.5 Review 字段信任边界

客户端可以提交：

```text
条目 text
条目顺序
uncertainty review_status / note
用户新增、更新、删除、移动条目的操作意图
新增操作的 client_mutation_id
已有条目的服务端 item_id
expected revision
```

客户端不得决定：

```text
review_id / revision / confirmed_at
AI 条目的 origin / source_evidence_ids
policy uncertainty 的 created_by
server timestamps
analysis_id
新增条目的 canonical item_id
```

后端保存时必须：

- 对已有 item ID，从当前权威 Review 继承 origin 和 source metadata；
- 新增 item 统一标记为 `origin=designer`；
- 用户不能把新增文本伪装成 `ai_visible`；
- 未知 item ID 的 update/delete/move 请求必须拒绝；不能把未知 ID 当作 designer add；
- canonical item ID 只能由服务端生成，前端临时 ID 不能持久化；
- 删除条目是业务编辑，可以执行，但仍受确认完整性门禁；
- client 传入未知系统字段时拒绝或忽略，并有 API 负向测试。

## 6.6 确认印记

- `confirmed_at` 只能由后端写入；
- 任意影响 renderer 输出的 review 修改，清除 `confirmed_at`；
- `requirement_confirmed` 与当前 review revision 绑定；
- history restore 永远不自动恢复确认；
- UE revision 变化清除确认；
- candidate adopt 清除确认。

## 6.7 确定性 renderer

固定六段：

```text
【页面目的】
【玩家任务】
【核心流程】
【可见控件】
【可见信息与状态】
【待确认项】
```

规则：

- 相同 review 字节级输出一致；
- 条目按保存顺序输出；
- core flow 按显式 order 输出；
- draft 空段显示占位；
- confirmation validator 不允许依赖占位通过；
- answered 写入答案；
- deferred 明确写"暂保留，尚未定案"；
- not_applicable 输出"设计师确认不适用"，有理由则附理由；
- renderer 不重新解释视觉状态；
- 前端不得自己实现第二份 renderer。

## 6.8 Intent Context 规范化与版本

本方案新增两个纯函数：`buildCanonicalIntentContext(project)` 与 `buildScreenContractIntentContext(project)`（后者合同见 §9.2）。二者是全新函数，当前代码库中不存在同名实现；它们必须共用同一份字段选择和排序的规范化逻辑。`buildCanonicalIntentContext` 输出 canonical JSON，至少包含：

```text
当前 Review 的六段有效内容（不含 confirmed_at 等时间戳）
允许进入下游的 fresh analysis visible facts
deferred uncertainties
wireframe revision
project type
analysis_context_excluded 及排除原因
```

服务端以该 canonical JSON 计算 `intent_context_hash`。规则：

```text
new hash === old hash
→ 不增加 intent_context revision
→ 不触发下游 stale

new hash !== old hash
→ intent_context revision +1
→ 在同一项目锁复合操作中标记下游工件为 stale
→ 权威发布 inputs.json
```

`intent_review_revision` 与 `intent_context_revision` 不得互相代替：前者用于 CAS，后者用于 Screen Contract source binding 和 freshness。Screen Contract 不再以完整通用 `input_revisions` 对象作为 Intent 新鲜度的唯一依据。

---

# 7. Prompt 与多模态返回

## 7.1 Task 标记

第一行固定：

```text
TASK_KIND: intent-analysis-v2
```

Fixture、诊断和真实评估以此路由，不依赖自然语言句子。

## 7.2 三步分析

1. 页面层级与 surface 扫描；
2. 页面目的、玩家任务和流程归纳；
3. 八类未知规则审计。

## 7.3 上下文

Intent Prompt：

- 保留 canvas 和 `project_type`；
- `project_type` 明确不是视觉证据；
- 项目名只用于日志上下文；
- 移除 Art Direction；
- 只返回一个 JSON 对象；
- 不返回 `requirement_draft`；
- 人类文本简体中文，key 英文。

Functional Screen Contract Prompt 同样移除 Art Direction，避免功能识别受到风格先验影响。

## 7.4 防推断示例

保留关于绿色勾、高亮奖励、按钮跳转、背景压暗的示例，并明确：

- exact visible text 可作为事实；
- 视觉状态的业务含义必须另有同实体证据；
- confidence 不能绕过 policy；
- 不确定时推断和问题必须同时存在。

## 7.5 Provider 纠正反馈

扩展 `requestJson()`：

```js
processValue: (raw) => ({
  value,
  errors,
  warnings,
  repairContext
})
captureMeta: boolean
```

约束：

- `processValue` 可归一化，但不能访问 Key；
- errors 最多 20 条，每条最多 300 字符；
- repairContext 必须去敏并限制 64 KiB；
- 总反馈最大 96 KiB；
- warnings 不触发重试；
- errors 才触发纠正；
- 最多 3 次模型尝试；
- image data 在任务开始时读取一次并在本任务内复用；
- `captureMeta` 与 `captureRaw` 语义分开；
- Intent 生产路径禁止 raw text、完整 Prompt、图片 data URL 和 Key 落盘；
- 现有 Underlay Critique 的 `captureRaw` 行为不得因本次改造改变。

三次失败抛：

```text
INTENT_ANALYSIS_INVALID
```


---

# 8. 后端状态机、并发与崩溃安全

## 8.1 专用服务

新增：

```text
electron/services/intentAnalysis.cjs
electron/services/intentStateStore.cjs
```

职责：

### intentAnalysis.cjs

- 枚举；
- normalize；
- validate；
- unsupported claim policy；
- createIntentReview；
- validateIntentReview；
- renderIntentReview；
- buildCanonicalIntentContext；
- buildScreenContractIntentContext；
- diff helpers（纯函数）。

### intentStateStore.cjs

- Screen-scoped Intent mutation；
- candidate/history 文件；
- revisions；
- 单一发布点写入顺序与读取时自愈、孤儿清理；
- candidate adopt/discard；
- history restore/delete；
- freshness；
- structured errors。

`intentStateStore.cjs` 必须在 `projectStore` 内部获得同一项目写锁和受控的 unsafe 文件原语。Pipeline、IPC、HTTP Route 不得自行拼接多个存储写操作，也不得获得 raw lock。

## 8.2 不得把结构化操作塞进普通 saveProject

Structured v2 必须使用专用动作：

```text
saveIntentReview
confirmIntentReview
generateIntentCandidate
adoptIntentCandidate
discardIntentCandidate
listIntentHistory
restoreIntentHistory
deleteIntentHistory
```

`saveProject` 继续用于：

- 项目名；
- Art Direction；
- project type / continuation mode；
- legacy requirement 文本。

Structured v2 下，普通 PATCH 中的下列字段必须忽略或拒绝：

```text
intent_analysis
intent_candidate
intent_review（除专用 API）
confirmed_at
provider meta
history
requirement（除后端 renderer 产物）
intent_generation / process_instance_id
intent_context revision/hash
```

`saveProject` 收到 structured-v2 的 Project Type 修改时，不能只写 `project.json`；它必须在同一项目锁内委托 `intentStateStore` 执行 §8.14 的完整 freshness 转换。Electron/Web 入口不得各自补写这一规则。

## 8.3 长任务两阶段提交

不得在持有项目写锁时等待多模态模型。

### Phase 1：开始任务（短锁）

在项目写锁中：

- 验证 Screen；
- 若已存在 `ready` candidate，拒绝并抛 `INTENT_CANDIDATE_REPLACEMENT_REQUIRED`；
- 读取 wireframe revision、project type；
- 生成 `request_id`；
- 写入当前进程的 `process_instance_id`；
- 将 `intent_generation` 标为 running；
- 记录当前是否存在权威输入；
- 释放锁。

### Phase 2：模型调用（无锁）

- 读取并冻结当前 UE bytes；
- 调用模型，最多 3 次纠正；
- 生成规范化 analysis/review；
- 不写当前权威输入。

### Phase 3：提交结果（短锁）

重新进入项目写锁：

- request_id 仍是当前活动请求；
- process_instance_id 仍属于当前进程；
- wireframe revision 未变；
- project type 未变；
- Screen 未归档；
- 读取提交时当前 requirement/review/context revisions；
- 再次确认没有其他 ready candidate。

然后：

- 若当前仍完全空白：直接作为首次草稿采用；
- 若用户在请求期间新增或修改内容：保存为 candidate，绝不覆盖；
- 若已有更新的 request_id：旧响应抛 `INTENT_REQUEST_SUPERSEDED`；
- 若 UE 已变：抛 `INTENT_ANALYSIS_STALE`；
- 若 Project Type 已变：抛 `INTENT_ANALYSIS_STALE`；
- 失败不改变当前 authority。

任何终态写回都必须先执行 request-id CAS，包括：

```text
ready
failed
stale
superseded
interrupted
provider-timeout
validation-failed
```

若当前 `intent_generation.request_id !== requestId`，旧请求只能向调用方返回 `INTENT_REQUEST_SUPERSEDED`，不得修改当前 generation、candidate、input stage、finished_at 或 error_code。旧请求的 superseded 结果可写诊断日志，但不能覆盖新请求的当前状态槽。

## 8.4 Candidate 基线

Candidate 的 `base_current_revisions` 取**candidate 成功提交时**的当前 revisions，而不是请求开始时的 requirement revision。这样用户可安全查看 AI 结果与请求期间新增的手工内容之间的差异。

Adopt 时再次要求：

```text
candidate_id 匹配
candidate status = ready
wireframe revision 匹配
requirement revision 匹配
intent_review revision 匹配
intent_context revision 匹配
```

否则抛 `INTENT_CANDIDATE_STALE`。该 CAS 同时机械阻断"崩溃残留 candidate 被重复采用"。

## 8.5 Workflow 状态

### 首次空白预填

允许：

```text
input stage → in_progress → reviewed/failed
```

### 已有当前输入时重新预填

不得改写当前 input stage 的 approved/reviewed 状态。使用独立：

```json
{
  "intent_generation": {
    "request_id": "...",
    "process_instance_id": "...",
    "purpose": "candidate",
    "status": "running | ready | failed | superseded | interrupted",
    "started_at": "...",
    "finished_at": "...",
    "error_code": null
  }
}
```

Candidate 失败只更新该任务状态，不把当前权威输入标为 failed。

进程启动时生成新的 `process_instance_id`。ProjectStore 第一次读取某 Screen 时，如果发现：

```text
intent_generation.status=running
且 process_instance_id != 当前进程
```

则在项目写锁中将其机械转换为：

```text
status=interrupted
error_code=INTENT_GENERATION_INTERRUPTED
finished_at=server timestamp
```

该转换不修改 current review/requirement/candidate，不重试模型，也不把 input stage 改成 failed。必须有"进程重启后 running 不永久悬挂"的测试。

## 8.6 单一发布点与写入顺序

本项目是单进程 + 本地文件部署，不引入跨文件事务日志。所有 Intent mutation 通过唯一内部操作执行：

```text
commitScreenIntentState(projectId, screenId, mutation)
```

它在项目写锁中按固定顺序执行（不在锁内等待模型）：

```text
1. 校验 expected revisions、Screen、Project Type、无 running 冲突
2. 生成 next analysis/review/requirement、canonical Intent Context 与 hash、next revisions
3. 写 history 快照与 index（仅追加；崩溃孤儿无害）
4. 写/更新 candidate 文件（原子覆写；崩溃孤儿无害）
5. 写 requirement.md 兼容投影
6. 写 project.json 兼容投影
7. 保守预标下游工件为 stale（先于发布；崩溃在此只会偏更 stale，不会偏假新鲜）
8. 原子发布 inputs.json（唯一权威发布点，单文件原子替换）
9. 更新 workflow 状态；幂等清理已被采用的 candidate
```

失败处理：

- 第 8 步之前失败：权威仍是旧 `inputs.json`；已写孤儿文件由读取时自愈清理；向上抛结构化错误。不需要回滚协议。
- 第 8 步之后：新 `inputs.json` 已是权威，**绝不回滚**；遗漏的投影、候选清理和下游标 stale 由读取时自愈向前补齐。
- 下游标 stale 是同锁内保守预写；即使个别工件未标到，stale 也是 source binding 的可推导纯函数，读取时自愈机械补标（§8.7）。

## 8.7 读取时自愈

`hydrate()`/`openProject()` 对每个 Screen 执行幂等修复：

1. **投影对齐**：`requirement.md` 或 project.json 投影与 `inputs.json` 不一致时，从 `inputs.json` 重新派生；
2. **Candidate GC**：残留 `ready` candidate 若已被采用（其 analysis_id 已是当前权威 `source_analysis_id`）或 wireframe revision 已过期，标 `stale` 或删除；
3. **Stale 再推导**：任何下游工件的 `source.intent_context` 与 `inputs.intent_context` 不一致时，机械标为 stale；
4. **Interrupted 转换**：旧进程留下的 `running` 转为 `interrupted`（§8.5）。

规则：

- 修复只向前补齐，不回滚权威、不复活确认；
- 修复必须幂等，连续两次执行结果不变；
- `hydrate()` 永不因半状态对用户 Fail-Closed；
- 必须有故障注入测试：第 3–9 步每一步之后模拟崩溃，重新打开后状态等于成功提交或保守更 stale。

## 8.8 写锁接线与下游门禁

现有 `withProjectWriteLock()` 是 `projectStore.cjs` 内部实现。新增 Intent 操作必须通过 `intentStateStore` 进入同一项目锁。

不要：

- 在 pipeline 外层持锁后调用已包装 `updateWorkflow()`；
- 在锁内调用公开的 `saveProject()`、`importFile()`、`saveArtifact()` 或其他会再次取锁的方法；
- 将 raw lock 函数暴露给 Renderer/Web；
- 在模型调用期间长期持锁。

必须内部区分：

```text
saveProjectUnsafe / saveArtifactUnsafe
updateWorkflowUnsafe（仅锁内复合操作使用）
invalidateArtifactsUnsafe
公开方法（自动加锁）
```

例如 `adoptIntentCandidate()` 必须是"一次进入项目锁 → 调用 unsafe primitives → 退出"，不得在锁内调用再次排队同一 Promise 锁的公开方法，否则会发生自等待。

同一项目锁必须覆盖：

```text
saveProject
importFile
manageReference（会写 project.json）
saveIntentReview
confirmIntentReview
adopt/discard candidate
restore/delete history
Project Duplicate（取得源项目锁）
Screen Duplicate 的 Intent 运行态检查
```

长时间模型请求仍不得持锁；只锁开始记录和最终提交。

下游唯一门禁是**可推导的 stale 判定**：生成/批准 Screen Contract 前，`assertSourceRevisionsFresh()`（§9.2 的 intent_context 绑定分支）机械拒绝与当前 `inputs.intent_context` 不一致的工件。不需要额外的挂起标志。

## 8.9 保存 Review

`saveIntentReview()`：

1. 校验 `expectedIntentReviewRevision`；
2. normalize/validate draft；
3. 后端 render requirement；
4. 构建 canonical Intent Context 并计算 hash；
5. no-op：Review 和 Context 都完全一致，不写文件、不升 revision；
6. Review 持久化变化：升 `intent_review_revision`，用于 CAS；
7. requirement 投影变化：升 requirement revision；
8. Context hash 变化：升 `intent_context_revision`，在同一锁复合操作中预标下游工件为 stale；
9. Context hash 不变：即使 review CAS revision 变化，也不 stale 下游；
10. 任意有效用户修改都取消确认；structured 模式不接受客户端传另一个 requirement；
11. 用户修改 review 后，`requirement_source=user`；未修改的首次 AI review 才保持 `ai`。

## 8.10 确认 Review

`confirmIntentReview()`：

- revision CAS；
- `forConfirmation=true` 完整验证；
- server 写 `confirmed_at`；
- `requirement_confirmed=true`；
- 同内容重复确认是 no-op；
- 不生成 Screen Contract，由上层显式调用下一阶段。

## 8.11 Adopt Candidate

顺序：

```text
核对 candidate/revisions（§8.4）
→ 写当前版本 history 快照（快照失败不修改当前输入）
→ 写新 analysis/review/requirement
→ requirement_confirmed=false
→ 计算 canonical Intent Context
→ 同锁内保守预标下游为 stale
→ 原子发布 inputs.json（唯一发布点）
→ 发布后幂等清理 candidate
```

已发布的 inputs 绝不回滚；遗漏清理由读取时自愈补齐。重复采用由 §8.4 revision CAS 阻断。

## 8.12 Restore History

- 同 Screen；
- history ID 从 index 查找，不接受路径；
- 恢复前快照当前版本；
- 恢复 content；
- `requirement_confirmed=false`；
- `confirmed_at=null`；
- wireframe revision 不匹配时 analysis 显示 stale；
- 重新计算 canonical Intent Context；
- Context 改变时增加 context revision，同锁内保守预标下游为 stale，即使 requirement 字符串相同；
- 原子发布 inputs.json；
- 恢复可撤销。

## 8.13 UE 替换

唯一实现位置：

```text
electron/services/projectStore.cjs importFile(kind='wireframe')
```

同一锁内：

1. 复制并验证新 UE；
2. bump wireframe revision；
3. 保留 requirement/review；
4. `requirement_confirmed=false`；
5. `intent_review.confirmed_at=null`；
6. analysis 通过 source revision mismatch 变 stale；
7. candidate 标 stale；
8. 重新计算 Context；stale analysis 不进入 Context；
9. 保守预标下游工件为 stale；
10. 原子发布新 inputs.json；
11. 读取时自愈保证任何遗漏的下游标 stale 在下次打开时补齐。

只改 Art Direction 不影响 analysis freshness 或确认。

## 8.14 Project Type 变化

`project_type` 参与 Intent Prompt 且写入 analysis `source_revision`，因此变更必须在 `saveProject` 的同一项目锁内调用统一 Intent mutation：

```text
project_type changed
→ 保留 requirement/review 文本
→ intent_analysis stale
→ ready candidate stale
→ requirement_confirmed=false
→ intent_review.confirmed_at=null
→ 重新计算 Context（排除旧 analysis）
→ intent_context_revision +1（若 hash 改变）
→ 同锁内保守预标下游为 stale
→ 原子发布 inputs.json
```

正在运行的旧 generation 返回时发现 Project Type mismatch，只能返回 `INTENT_ANALYSIS_STALE`；若 request-id 已被新请求替代，则返回 superseded，且两者都不能提交结果。

`continuation_mode` 不进入 Intent Analysis freshness；它继续按现有路线切换规则失效相应下游。Art Direction 不进入 Intent freshness。

---

# 9. Screen Contract 安全交接

## 9.1 输入优先级

```text
设计师已确认 Intent Review
>
UE 可见事实
>
AI 未经设计师确认的推断
```

## 9.2 Supporting Context Builder

新增纯函数：

```text
buildScreenContractIntentContext(project)
```

它与 §6.8 的 `buildCanonicalIntentContext()` 共用同一份字段选择和排序逻辑（两者都是本方案新增函数）。函数首先机械计算：

```js
const analysisFresh =
  analysis?.source_revision?.wireframe === project.input_revisions.wireframe
  && analysis?.source_revision?.project_type === project.project_type;
```

Analysis 新鲜时，模型上下文只输出：

- 已确认六段 review；
- analysis 中可见 layers/controls/information；
- deferred 问题，明确标注 unresolved；
- 不输出未进入 review 的 AI business inference；
- 不输出 unreviewed（确认门禁本就不允许）；
- 不把 deferred 转成已定规则。

Analysis 不新鲜时，必须完全排除：

```text
旧 layers
旧 controls
旧 information
旧 AI inference
旧 evidence IDs
```

此时只允许输出设计师当前已确认的 Review 和设计师显式处理后的 uncertainty。函数同时返回仅供服务端审计、不得发给模型的元数据：

```json
{
  "analysis_context_excluded": true,
  "reason": "wireframe_revision_mismatch | project_type_mismatch"
}
```

生成 Screen Contract 前还必须验证：

```text
requirement_confirmed=true
confirmed review revision 仍是当前 revision
当前 canonical context hash 与 inputs.intent_context.hash 一致
无正在运行且可能提交该 Screen 的 intent_generation
```

Screen Contract source 必须记录专用绑定：

```json
{
  "intent_context": {
    "wireframe_revision": 4,
    "intent_context_revision": 7,
    "intent_context_hash": "sha256:..."
  }
}
```

现有通用 `assertSourceRevisionsFresh()` 必须增加 Screen Contract 专用分支：Screen Contract 以 `source.intent_context` 为新鲜度依据，不再因为无语义影响的 CAS revision 变化而误判，也不能因 requirement 字符串相同而漏掉 Context 变化。该判定是纯函数；读取时自愈（§8.7）依赖同一判定补标遗漏的下游 stale。

## 9.3 Art Direction

从以下 Prompt 移除：

```text
intentDraftPrompt
screenContractPrompt
```

Art Direction 只进入 Style 及后续视觉阶段。

## 9.4 Screen Contract Prompt 规则

必须明确：

```text
- reviewed designer content is authoritative;
- visible facts may supplement it;
- unresolved questions remain unresolved;
- never convert deferred items into facts;
- do not use art direction to infer controls or business rules.
```

不改变现有 Screen Contract 字段合同和 ADR-008 的设计师权威语义。

必须用 Provider Fixture 捕获最终 Prompt 验证：旧 UE history 恢复、手工确认后，Prompt 中不存在旧 Analysis 的层级、控件、文字或 evidence。

---

# 10. 前端实施方案

## 10.1 Input Workspace

保持左右布局，左侧改为：

```text
AI 解读状态
六段 Intent Review Editor
可见证据详情（折叠）
待确认项操作
Candidate Diff
History
保存 / 重新预填 / 确认 / 进入功能解读
```

## 10.2 状态

至少展示：

```text
无 UE
有 UE 无意图
首次 AI 生成中
AI 草稿待审
当前输入已确认
基于旧 UE
旧版自由文本
candidate 生成中
candidate ready
candidate stale
candidate 失败但当前内容仍可用
generation interrupted（应用重启或旧进程中断）
ready candidate 尚未处理，禁止重新生成
history restored（待重新确认）
```

`generation interrupted` 时展示"已中断，可重新预填"；不得把中断显示为当前输入失败。

## 10.3 来源标签

- 图中可见；
- AI 推断；
- 设计师新增；
- 设计师已修改；
- 需要确认；
- 缺少可追溯证据。

颜色不是唯一信息载体；必须有文字和图标。

## 10.4 六段编辑

- 标题与顺序不可删除；
- 条目可增删改；
- core flow 支持重排；
- 其它条目保留插入顺序；
- 页面目的单独文本；
- 所有修改保留稳定 item ID；
- Screen 切换时按 `project.id + screen_id + review revision` 重建本地状态；
- 不允许 Screen A 未保存内容进入 B。

## 10.5 Uncertainty

操作：

```text
回答
暂时保留
不适用
恢复未检查
新增待确认项
```

门禁：

- blocking 不提供 deferred；
- not_applicable 的 blocking 必须填写原因；
- 有 unreviewed 时确认按钮阻断，并聚焦第一条；
- 显示数量汇总。

## 10.6 Candidate Diff

Diff 不按数组索引自动合并。匹配优先级：

1. 相同 stable item ID；
2. 相同 analysis entity ID；
3. 相同 section + 规范化文本签名，仅用于展示建议；
4. 其余显示新增/删除。

规则：

- Diff 只帮助比较；
- 不自动合并设计师回答到语义不同的新问题；
- 若问题 category、question、evidence 都一致，可展示"可保留旧答案"，仍需用户确认；
- 采用是整版替换，不是假装自动智能合并；
- 保留当前版本会丢弃 candidate，不改当前输入。

## 10.7 History

- 列表显示时间、来源、是否曾确认、wireframe revision；
- 恢复前提示"恢复后需要重新确认"；
- 支持删除单条历史；
- 不允许删除当前版本；
- 超过历史限制时给出清理入口。

## 10.8 可访问性

- 表单控件具备 accessible name；
- uncertainty 操作键盘可达；
- 拖拽重排必须有键盘替代；
- 错误关联到具体字段；
- 窄屏单列；
- 不显示 JSON/evidence ID/堆栈。

---

# 11. API 与错误码

## 11.1 Electron / Web / Preview API

新增同义接口：

```text
draftRequirement / generateIntentCandidate
saveIntentReview
confirmIntentReview
adoptIntentCandidate
discardIntentCandidate
listIntentHistory
restoreIntentHistory
deleteIntentHistory
```

外部 `draftRequirement` 名称可为兼容保留，但返回语义必须升级。

Electron IPC、preload、Web HTTP、`src/api.ts` Preview 必须调用同一 pipeline/projectStore 业务方法，不能各写一套状态转换。

所有 mutation API 的 expected revision 为必填。Web HTTP 至少统一映射：CAS/已有 candidate 为 409，validation 为 422，请求体超限为 413。

## 11.2 错误码

至少增加：

| 错误码 | 含义 |
|---|---|
| `INTENT_ANALYSIS_INVALID` | 三次处理仍非法 |
| `INTENT_ANALYSIS_STALE` | UE/project type 已变化 |
| `INTENT_REVIEW_INCOMPLETE` | 确认门禁未通过 |
| `INTENT_CANDIDATE_STALE` | candidate 基线 revision 不匹配 |
| `INTENT_CANDIDATE_REPLACEMENT_REQUIRED` | 已有 ready candidate，必须先采用或丢弃 |
| `INTENT_HISTORY_VERSION_NOT_FOUND` | 历史不存在或不属当前 Screen |
| `INTENT_REQUEST_SUPERSEDED` | 旧 AI 响应晚于新请求 |
| `INTENT_GENERATION_INTERRUPTED` | 旧进程留下的 running 任务已中断 |
| `INTENT_REVISION_CONFLICT` | 保存/确认/恢复时 CAS 冲突 |
| `INTENT_HISTORY_LIMIT_REACHED` | 历史数量或总字节达到上限 |

同步：

```text
electron/services/errorCodes.cjs
docs/dev/ERROR-CATALOG.md
错误码双向校验
负向测试
```

---

# 12. 文件级改造清单

## 12.1 新增

| 文件 | 目的 |
|---|---|
| `electron/services/intentAnalysis.cjs` | 数据合同、normalizer、validator、policy、review builder、renderer、canonical/context builder |
| `electron/services/intentAnalysis.test.cjs` | 领域正反测试 |
| `electron/services/intentStateStore.cjs` | candidate/history、单一发布点、读取时自愈、revision/freshness；只使用内部锁与 unsafe 原语 |
| `electron/services/intentStateStore.test.cjs` | 原子性、CAS、崩溃注入自愈、限制、多 Screen、request-id CAS |
| `src/features/input/IntentReviewEditor.tsx` | 六段编辑器 |
| `src/features/input/IntentReviewEditor.test.tsx` | 编辑、确认、a11y |
| `src/features/input/IntentCandidateDiff.tsx` | Candidate 对比与采用 |
| `src/features/input/IntentCandidateDiff.test.tsx` | Diff、采用、冲突、历史 |
| `tests/ui-e2e/intent-prefill-v2.spec.ts` | 首次预填、确认、下游交接 |
| `tests/ui-e2e/intent-candidate-history.spec.ts` | Candidate、history、失败保护 |
| `tests/ui-e2e/intent-multi-screen.spec.ts` | Screen 隔离 |
| `scripts/evaluate-intent-prefill.cjs` | 受控真实评估 |
| `docs/decisions/ADR-009-intent-analysis-authority.md` | Intent 权威、候选、历史、确认裁定、崩溃安全模型 |

## 12.2 必改

| 文件 | 必改内容 |
|---|---|
| `electron/services/prompts.cjs` | Intent v2；TASK_KIND；移除 Intent/Screen Contract 的 Art Direction；下游优先级 |
| `electron/services/kunpoClient.cjs` | processValue/captureMeta，限制反馈，不影响图像分支和 captureRaw |
| `electron/services/kunpoClient.test.cjs` | 纠正、warning、meta、旧调用兼容 |
| `electron/services/designPipeline.cjs` | 两阶段 AI 任务；所有终态 request-id CAS；Candidate；Screen Contract context/source freshness；Workflow 状态 |
| `electron/services/projectStore.cjs` | Screen Intent 权威存储；内部 unsafe 原语；读取时自愈；Project/Screen Duplicate 源锁；UE/Project Type 变化 |
| `electron/main.cjs` | 新 IPC；导入仍统一走 projectStore；不复制规则 |
| `electron/preload.cjs` | 新 Screen-scoped API |
| `server/webServer.cjs` | 新 HTTP 动作、输入大小、HTTP 状态映射 |
| `electron/services/errorCodes.cjs` | 新错误码 |
| `src/types.ts` | 完整强类型 |
| `src/vite-env.d.ts` | API 类型 |
| `src/api.ts` | Preview/Web/Electron 语义一致，candidate/history 模拟 |
| `src/features/input/InputWorkspace.tsx` | 编排新组件和全部状态 |
| `src/features/layout/screen-draft-isolation.test.tsx` | v2 草稿隔离 |
| `src/styles.css` | 卡片、badge、diff、history、响应式、a11y |
| `tests/ui-e2e/fixtureProvider.ts` | TASK_KIND 路由，合法/非法 v2 fixture，错路由硬失败 |
| `tests/ui-e2e/helpers.ts` | 处理 uncertainty 后确认 |
| `tests/ui-e2e/failure-paths.spec.ts` | 纠正失败、旧稿保留、stale |
| `tests/ui-e2e/multi-screen.spec.ts` | analysis/review/candidate/history 隔离与 Clone 语义 |
| `docs/dev/PIPELINE-STATE-MACHINE.md` | Input v2 状态机 |
| `docs/dev/PROJECT-TREE` 或 README 项目树 | 新文件/目录 |
| `docs/user/quick-start-guide.html` | 新项目输入操作 |
| `docs/user/WORKBENCH-GUIDE.md` | Candidate/History/确认说明 |

`jsonStore.cjs` 不改动：现有单文件原子替换已满足发布点要求。

---

# 13. 测试方案

## 13.1 Intent 领域单元测试

### 合法

- 全屏；
- modal + background sibling；
- 真正 nested drawer/popover；
- 纯信息页；
- 空 uncertainty 但八类 audit 完整；
- designer-added item/uncertainty；
- designer add 由服务端生成 canonical item ID 并返回 client mutation 映射；
- answered/deferred/not_applicable；
- blocking answered/not_applicable；
- unsupported claim 自动降级并同步 audit。

### 非法

- 缺字段；
- 重复 ID；
- layer parent 环；
- parent/layer/audit 引用悬空；
- modal 无背景上下文；
- blocking deferred；
- answered 无 note；
- confirmed review 关键段为空；
- 超过结构、深度和字节上限；
- 服务端字段伪造；
- add 操作伪造 canonical item ID；
- update/delete/move 使用未知 item ID；
- 业务断言无法安全归属。

### Policy 正反

- 页面别处"领取"不能支持奖励勾"已领取"；
- 同实体 visible text"已领取"可作为支持；
- confidence=high 不能绕过；
- exact OCR 文本不被错误删除；
- 自动问题 ID 稳定且无冲突；
- 自动问题写回 uncertainty audit。

### Intent Context

- canonical 字段顺序和对象 key 顺序变化不改变 hash；
- confirmed_at、provider meta、纯审计字段变化不改变 hash；
- fresh visible analysis、Review 文本、deferred uncertainty、wireframe revision、Project Type 任一有效变化会改变 hash；
- stale analysis 被排除后，其旧 visible facts 不进入 canonical Context；
- context hash 相同不升 context revision；hash 不同只升一次且下游只标一次 stale。

## 13.2 Provider 测试

- 第一轮 schema 错、第二轮成功；
- warning 不消耗重试；
- repairContext 截断；
- 三次失败；
- captureMeta 无 raw/key/data URL；
- captureRaw 旧行为不变；
- 图片只读取一次；
- 其它 requestJson 调用无回归。

## 13.3 存储、并发与崩溃自愈

- 首次预填空项目直接采用；
- AI 请求期间用户输入，结果只保存 candidate；
- 同 Screen 两个请求，旧响应 superseded；
- 新请求 running 时旧请求晚失败，不得把新请求改成 failed；
- 新请求 running 时旧请求晚成功，不得改 candidate/current/finished_at；
- 进程重启后旧 running 变 interrupted，current input 不变；
- 已有 ready candidate 时再次生成被 `INTENT_CANDIDATE_REPLACEMENT_REQUIRED` 阻断；
- 请求期间 UE 替换，结果不落盘；
- 请求期间 Project Type 改变，结果不落盘；
- save review CAS 冲突；
- candidate adopt CAS 冲突；
- history restore CAS 冲突；
- history restore 不恢复 confirmed；
- old-wireframe history 恢复为 stale draft；
- history 快照失败不修改当前；
- 崩溃注入（§8.6 第 3–7 步每一步之后）：重新打开后权威仍是旧 `inputs.json`，孤儿被清理；
- 崩溃注入（第 8 步之后、第 9 步之前）：投影、candidate 清理、下游标 stale 全部由读取时自愈补齐；
- 读取时自愈幂等：连续两次执行结果不变；
- 读取时自愈不回滚权威、不复活确认；
- 下游同步重复执行幂等，不重复 history/version；
- history path traversal 拒绝；
- history/candidate 大小与数量门禁；
- Screen A/B 完全隔离；
- Screen Clone candidate stale、confirmed false，running/adopt/restore 中拒绝复制；
- Project Duplicate 取得源项目锁，running/adopt/restore 中拒绝复制；
- Project Duplicate 不复制活动 request/process ID，副本 candidate stale。

## 13.4 UE 替换

Electron 和 Web 都验证：

```text
wireframe revision +1
requirement/review 保留
confirmed=false
confirmed_at=null
analysis stale
candidate stale
下游 stale
```

只改 Art Direction：

```text
analysis freshness 不变
confirmed 不变
requirement revision 不变
```

修改 Project Type：

```text
requirement/review 文本保留
analysis/candidate stale
confirmed=false
confirmed_at=null
context hash/revision 更新
下游 stale
旧 generation 不提交
```

## 13.5 Workflow

- 首次预填 running/failed/reviewed；
- 已确认输入重新预填时，input stage 保持 approved；
- candidate 失败只影响 `intent_generation`；
- generation interrupted 只影响任务状态；
- 所有 generation 终态写回先做 request-id CAS；
- ready candidate 未处理时不能启动新 generation；
- candidate ready 不影响 Screen Contract freshness；
- adopt/edit 后才使下游 stale。

## 13.6 前端

- 六段和来源标签；
- stable IDs；
- core flow 键盘重排；
- blocking 无 deferred；
- unreviewed 聚焦；
- candidate 新旧差异；
- 保留当前版本；
- adopt 和 stale error；
- restore + 再确认；
- history limit UI；
- generation interrupted UI；
- ready candidate replacement blocked UI；
- Screen 切换隔离；
- 窄屏；
- badge 非纯颜色；
- 不使用 HTML 注入。

## 13.7 Electron E2E

### E2E-INTENT-01 首次预填

```text
新项目 → 上传 UE → AI 预填 → 六段 → 处理问题 → 确认 → Screen Contract
```

### E2E-INTENT-02 重新预填候选

```text
已确认输入 → 重新预填 → 当前不变 → 对比 → 保留/采用 → history → 恢复
```

### E2E-INTENT-03 失败保护

```text
Provider 3 次非法 → 当前输入/确认/下游不变
```

### E2E-INTENT-04 UE 替换

```text
确认 → 替换 UE → stale → 不能直接功能解读 → 重新核对
```

### E2E-INTENT-05 请求竞态

```text
AI 进行中手工编辑 / 发起第二请求 → 旧响应不得覆盖
```

### E2E-INTENT-06 多 Screen

```text
A/B analysis/review/candidate/history/confirmed 完全隔离
```

### E2E-INTENT-07 崩溃自愈与重启

```text
存储层故障注入模拟发布前失败 → 重新打开 → 权威不变、孤儿清理
持久化 running → 重启应用 → interrupted，current input 不变
```

### E2E-INTENT-08 stale analysis 不越界

```text
UE-A analysis/history → 换 UE-B → 恢复旧 history → 手工确认 → Screen Contract
→ Fixture 捕获的最终 Prompt 不含 UE-A layers/controls/text/evidence
```

### E2E-INTENT-09 重启与旧请求晚失败

```text
A running → B running → A provider failure → B 仍 running
```

### E2E-INTENT-10 Project Type 与 Clone

```text
确认输入 → 修改 Project Type → stale/取消确认
running/adopt/restore 中 Project/Screen Duplicate 均 Fail-Closed
静止项目 Duplicate 后无活动 request，candidate 只能 stale
```

## 13.8 真实多模态评估

禁止把本机绝对路径写入代码或普通 CI。使用：

```text
INTENT_BENCHMARK_DIR=/local/private/path
INTENT_BENCHMARK_MANIFEST=/local/private/path/manifest.json
```

报告写入明确的本地评估目录，不进入生产日志；去敏后才可选择性归档统计，不提交用户 UE。

### UE10 20 次

- 程序确定性指标：冻结 fixture 100%；
- 真实任务 3 次内成功：≥19/20；
- 内容质量指标只在成功 analysis 上计算，并单独报告 provider failure；
- 每次固定同一模型、参数和 Prompt 版本；
- 失败逐条 triage。

内容质量至少记录：

| 指标 | 阈值 |
|---|---|
| 背景框架 + 主体弹窗层级 | ≥19/20 |
| 排行榜、问号、挑战入口、奖励进度区域 | ≥19/20 |
| 前两档绿色勾、第三档黄色高亮、其余普通状态 | ≥19/20 |
| 状态语义 uncertainty（模型或 policy 补出） | ≥19/20 |
| 挑战结果/前置条件 uncertainty | ≥19/20 |
| "背景不可交互"等结论保持推断或待确认 | ≥19/20 |

**通过判定口径**：任一项低于阈值时，对该项的每次失败逐条 triage，归类为模型抖动、Prompt 缺陷或指标不合理；放行决定由 triage 结论驱动（模型抖动可复测，Prompt 缺陷必须修复，指标不合理必须修订指标）。指标矩阵本身不自动放行，也不自动一票否决。

### 多类型基准

不少于 12 张，每张至少 3 次，保留原类型覆盖。指标定义必须在 manifest 中给出计算方式，不能只写"看起来覆盖"。

最低指标：

| 指标 | 最低要求 |
|---|---|
| 成功任务结构引用有效率 | 100% |
| 三次内任务成功率 | ≥95% |
| 成功任务固定六段展示率 | 100% |
| dangling evidence warning 可追踪率 | 100% |
| 必需可见元素召回率 | ≥95% |
| 页面层级正确率 | ≥95% |
| 未降级且无 uncertainty 的无支持业务断言率 | 0% |
| 高影响 uncertainty 召回率 | ≥90% |
| 人工确认后 requirement 可用率 | 100% |

### 100% 的正确用法

只能宣称：

- schema/validator/renderer；
- candidate 不覆盖；
- 单一发布点/新鲜度/崩溃自愈；
- 冻结政策 fixture；
- 非法对象不落盘。

不得宣称有限词表可以对所有自然语言过度推断达到绝对 100%。

---

# 14. 分阶段执行与 PR 拆分

六个里程碑，每个对应一个 PR，顺序执行、合并后后续分支 rebase。

## PR-I0：ADR、数据合同和测试 Fixture

- ADR-009；
- Intent types/enums；
- analysis/review schema；
- validator/normalizer/renderer；
- 正反 fixture；
- 不改 UI。

完成门：领域单元测试全绿。

## PR-I1：Intent 状态存储与崩溃自愈

- IntentStateStore 与内部 unsafe 原语；
- review CAS revision 与 Intent Context revision/hash；
- 单一发布点写入顺序；
- 读取时自愈、孤儿清理与投影补齐；
- history/candidate；
- UE/Project Type freshness；
- request-id CAS、process restart interrupted；
- Clone 源锁与运行态检查；
- 故障注入测试。

完成门：每个崩溃点注入后读取时自愈通过；发布后的输入绝不回滚；历史恢复不复活确认；旧请求/旧进程不能覆盖当前运行态。

## PR-I2：Provider 与 Prompt

- TASK_KIND；
- v2 Prompt；
- 移除两个功能 Prompt 的 Art Direction；
- requestJson processValue/meta；
- 两阶段 AI 任务；
- supersede 和 revision check。

完成门：离线 fixture 和 provider 模拟通过；最终 Screen Contract Prompt 捕获证明 stale analysis 被排除。

## PR-I3：Electron/Web/Preview API

- IPC/preload；
- HTTP；
- Preview；
- 错误码；
- 输入大小与系统字段保护；
- 两端一致性测试。

完成门：相同动作在 Electron/Web 产生相同状态。

## PR-I4：Input Workspace UI

- Review Editor；
- uncertainty；
- Candidate Diff；
- History；
- stale/legacy/interrupted；
- a11y；
- UI Unit。

完成门：用户不看 JSON 即可完成全流程。

## PR-I5：下游交接、E2E、文档和真实评估

- Screen Contract context；
- FixtureProvider；
- Electron E2E；
- docs；
- UE10 与多类型 benchmark；
- 评估报告。

完成门：第 16 节全部通过。

### 单人维护纪律

- 不要求寻找外部协作者；
- 每个 PR 自包含；
- 合并后后续分支 rebase；
- CI 全绿；
- 本地 L3 可继续执行，但必须如实区分本地证据与 CI 证据；
- 不把概率性真实模型测试放进普通 CI。

---

# 15. 回滚方案

1. `requirement` 和 `requirement.md` 保留；
2. 老项目不做破坏性自动迁移；
3. structured UI 可回退到 legacy textarea：legacy 模式项目照常编辑；**structured-v2 项目的 requirement 在 textarea 中只读展示**，如需继续编辑必须通过显式的"降级为 legacy 模式"动作（将 structured 字段归档为 `legacy_archived` 后退出 structured 模式）；任何情况下不得删除 structured 文件；
4. Prompt 可回退，不需要批量重写项目；
5. 回滚不恢复 stale 的 confirmed；
6. candidate/history 保留文件级恢复能力；
7. 回滚后专用 API 可隐藏，但不得让普通 PATCH 改写 AI evidence；
8. 回滚后旧 UI 继续通过权威 `inputs.json` 读取 requirement；
9. 已发布的新 `inputs.json` 不得因为任何后续失败回滚；
10. 不清空用户项目、不批量改写 requirement、不弱化当前确认语义。

---

# 16. 最终验收场景

## 场景 A：空白项目首次预填

- 固定六段；
- 事实/推断/问题分离；
- blocking 正确处理；
- 确认后进入 Screen Contract。

## 场景 B：模型过度解释状态

- 绿色勾保持可见事实；
- "已领取"不得无同实体证据成为事实；
- 自动生成/关联 uncertainty；
- 设计师答案才进入 requirement。

## 场景 C：已有设计师工作重新预填

- current 不变；
- candidate ready；
- diff；
- adopt 前 history；
- restore 后重新确认。

## 场景 D：AI 请求期间用户编辑

- 用户输入不被覆盖；
- AI 结果只成为 candidate；
- candidate 基线取提交时当前 revisions。

## 场景 E：两个并发 AI 请求

- 后发 request_id 成为当前；
- 先发旧响应无论晚成功还是晚失败都抛 superseded；
- 不覆盖新 candidate/current。

## 场景 F：UE 替换

- 旧文本保留；
- confirmed 取消；
- analysis/candidate stale；
- 旧 Screen Contract 不能继续作为当前输入链路；
- 手工核对或重新预填后再确认。

## 场景 G：老项目

- 人工文本照常编辑确认；
- 老 AI 四字段不自动转换；
- 重新预填先生成 v2 candidate；
- 用户采用后才切换 structured-v2。

## 场景 H：多 Screen / Clone

- A/B 不串状态；
- Screen Clone confirmed=false；
- candidate 不可直接采用；
- history 归属目标 Screen；
- Project Duplicate 维持静止快照语义；
- running/adopt/restore 中 Clone Fail-Closed；
- 副本无活动 request，candidate 只能 stale。

## 场景 I：崩溃自愈

- 权威发布前任一写失败：重新打开后权威不变，孤儿被清理，可正常重试；
- 权威发布后任一崩溃：投影、candidate 清理、下游标 stale 由读取时自愈补齐；
- 自愈幂等，不回滚权威、不复活确认；
- `hydrate()` 不因半状态对用户 Fail-Closed。

## 场景 J：Context 同文不同义

- requirement 字符串相同但 fresh analysis/deferred/context 改变时，context revision 增加并 stale 下游；
- 纯 CAS/审计变化且 canonical Context 相同时，不无意义 stale；
- Screen Contract source 绑定 context revision/hash。

## 场景 K：stale analysis 隔离

- 恢复旧 UE history 后允许保留 Review 草稿；
- 手工确认后仅传递当前确认 Review；
- 最终 Screen Contract Prompt 不含旧 analysis 的 layers/controls/text/evidence。

## 场景 L：重启和 Project Type

- 旧进程 running 在重启后变 interrupted；
- current input/approval 不被任务中断改写；
- Project Type 改变使 analysis/candidate stale、取消确认并同步下游；
- Art Direction 变化仍不影响 Intent freshness。

---

# 17. Definition of Done

## 数据与 Prompt

- [ ] Intent Analysis v2 结构完成；
- [ ] server-owned metadata 不可伪造；
- [ ] layer 规则无 modal parent 矛盾；
- [ ] 事实/推断/问题物理分离；
- [ ] TASK_KIND 稳定；
- [ ] Intent 与 Screen Contract 功能 Prompt 不含 Art Direction；
- [ ] 八类 audit 完整；
- [ ] evidence 与 unsupported claim policy 有正反测试；
- [ ] 最多三次定向纠正；
- [ ] 非法对象不落盘。

## 权威、存储与并发

- [ ] inputs.json 是 Screen 权威且是唯一原子发布点；
- [ ] requirement 由后端 renderer 生成；
- [ ] 客户端不能伪造 analysis/candidate/history/confirmed_at；
- [ ] 正式 Review item ID 只由服务端生成；
- [ ] AI 长任务两阶段提交；
- [ ] 手工编辑期间 AI 不覆盖；
- [ ] 旧 request 不覆盖新 request；
- [ ] 旧 request 晚失败也不能覆盖新 request；
- [ ] 旧进程 running 自动变 interrupted；
- [ ] ready candidate 禁止隐式替换；
- [ ] Candidate CAS；
- [ ] history restore 不恢复 confirmed；
- [ ] review CAS revision 与 Intent Context revision/hash 分离；
- [ ] 发布前失败：权威不变、孤儿被清理；
- [ ] 发布后失败：只向前补齐，绝不回滚；
- [ ] 读取时自愈幂等且不复活确认；
- [ ] 崩溃注入测试覆盖 §8.6 第 3–9 步；
- [ ] 下游 stale 可由 source binding 机械推导；
- [ ] history/candidate 路径、数量和字节受限；
- [ ] UE 替换取消确认；
- [ ] Project Type 变化传播 freshness、确认和下游失效；
- [ ] Art Direction 不影响 freshness；
- [ ] Project Duplicate 取得源项目锁；
- [ ] 多 Screen / Clone 对 running/adopt/restore 做 Fail-Closed。

## 用户体验

- [ ] 六段稳定；
- [ ] stable item IDs；
- [ ] 来源标签；
- [ ] blocking 不可 deferred；
- [ ] 未检查不可确认；
- [ ] candidate compare/adopt/discard；
- [ ] history restore/delete；
- [ ] stale/legacy 明确；
- [ ] interrupted 明确；
- [ ] 键盘和窄屏可用；
- [ ] 不需要理解 JSON。

## 下游

- [ ] Screen Contract 使用已确认 Review 为最高权威；
- [ ] deferred 不会变成规则；
- [ ] raw AI inference 不会越过 Review；
- [ ] stale analysis 的 layers/controls/information/evidence 不进入 Screen Contract Prompt；
- [ ] Screen Contract source 绑定 context revision/hash；
- [ ] 当前 Screen Contract 字段合同和 ADR-008 不回退。

## 自动化与评估

- [ ] Intent 单元测试；
- [ ] Provider 纠正测试；
- [ ] 崩溃注入/自愈测试；
- [ ] Electron/Web 一致性；
- [ ] UI Unit；
- [ ] Electron E2E；
- [ ] multi-screen/clone；
- [ ] UE10 20 次达标（未达标项按 §13.8 口径 triage）；
- [ ] 12+ 多类型 UE 达标；
- [ ] 每个失败有 triage；
- [ ] `pnpm test`；
- [ ] `pnpm test:ui-unit`；
- [ ] `pnpm test:ui-e2e`；
- [ ] `pnpm test:fixture-e2e`；
- [ ] `pnpm test:docs`；
- [ ] `pnpm lint`；
- [ ] `pnpm build`；
- [ ] macos-validate；
- [ ] secret-scan。

## 范围纪律

- [ ] 未改任何图像生成路由；
- [ ] 未改 Style/Layout/Underlay/Composition/Fidelity 行为；
- [ ] 未引入第二份 renderer 或第二套枚举；
- [ ] 未引入事务日志、显式恢复 API 或失效挂起事件；
- [ ] 未要求外部协作者；
- [ ] L3 与 CI 证据口径如实区分。

---

# 18. 禁止性验收

出现以下任一情况即不通过：

- AI 仍直接决定最终 requirement 格式；
- 重新预填直接覆盖 current；
- 旧 AI 响应可覆盖新请求；
- 旧 AI 请求晚失败可把新请求状态改成 failed；
- 进程重启后旧 running 永久悬挂；
- 已有 ready candidate 时可静默生成并覆盖新 candidate；
- structured v2 前端可直接 PATCH analysis 或伪造 item origin；
- 客户端可为新增条目指定 canonical item ID；
- candidate 未采用前使下游 stale；
- candidate 生成失败把已批准 input stage 改成 failed；
- history restore 自动恢复 confirmed；
- blocking uncertainty 可 deferred；
- modal 顶层结构被错误判非法；
- 页面别处一个业务词可全局支持无关状态断言；
- UE 替换后旧确认仍有效；
- Screen A 的 candidate/history 出现在 B；
- Screen Clone 后 candidate 仍可直接采用；
- Project/Screen Clone 可在 generation running 或 adopt/restore 提交期间继续；
- Project Duplicate 不取得源项目写锁；
- 多文件失败留下 analysis/review/requirement 不一致；
- 权威发布后输入被回滚；
- 崩溃半状态使 `hydrate()` 对用户 Fail-Closed；
- 读取时自愈改变权威或复活确认；
- stale analysis 的 visible facts/evidence 仍进入 Screen Contract Prompt；
- Screen Contract 仍只按 requirement 字符串或完整通用 CAS revisions 判断 Intent freshness；
- Project Type 改变后旧 analysis/确认仍被视为有效；
- 锁内复合操作调用再次取同一项目锁的公开方法；
- Electron/Web 对相同动作产生不同状态；
- Fixture 仍依赖自然语言 Prompt 子串；
- 真实评估硬编码本机绝对路径；
- 为本次改造触碰生图代码。

---

# 19. 给执行者的最终口径

1. 先做数据合同、权威和存储，再做 Prompt 和 UI；
2. 不要把纯字符串 Review 原样实现；必须保留稳定 ID 与来源；
3. 不要在持锁状态等待模型；采用"短锁捕获 → 无锁调用 → 短锁提交"；
4. 首次预填提交时也要重新检查用户是否已经手工输入；
5. candidate 和 history 必须使用专用 API，不得塞入 `saveProject`；
6. history 恢复只恢复内容，不恢复确认；
7. `blocking` 不能暂缓；
8. business claim 的可见支持必须绑定同一实体/evidence；
9. 自动新增 uncertainty 后必须同步 audit；
10. structured mode 下 requirement 永远由后端渲染；
11. Screen Contract 的功能 Prompt 也移除 Art Direction；
12. Candidate 生成任务状态和当前 input approval 状态分开；
13. 所有 generation 终态写回先做 request-id CAS；重启后旧 running 转 interrupted；
14. ready candidate 必须先采用或丢弃，禁止隐式替换；
15. `intent_review_revision` 只做 CAS；Screen Contract freshness 使用 canonical `intent_context_revision/hash`；
16. stale analysis 必须在后端 Context Builder 中完全排除，不能只靠 UI 标签；
17. 单一发布点 + 读取时自愈：发布前崩溃权威不变，发布后崩溃只向前补齐；
18. 下游 stale 是 source binding 的可推导纯函数，不引入挂起事件；
19. 不引入事务日志、显式恢复 API 或阻塞打开的残留态；
20. Intent 复合操作一次进入同一项目锁，并只调用内部 unsafe 原语；
21. Project/Screen Clone 对 running/adopt/restore Fail-Closed，Project Duplicate 必须取得源项目锁；
22. Project Type 变化完整传播 analysis/candidate freshness、确认和下游；Art Direction 不传播；
23. 所有 Screen-scoped 状态、candidate、history 都要有隔离和 Clone 测试；
24. 真实模型指标与工程确定性指标分开，未达标项按 §13.8 口径逐条 triage；
25. 本文完成后，才可以宣称"项目输入 AI 预填写问题已解决"。
