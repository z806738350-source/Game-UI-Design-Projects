# M4 整改验收核对（AUD-01～14 独立源码审核）

- 审核基线：`main@3342346`，报告 `docs/Game-UI-Design-Copilot-M4-AUD01-14-independent-source-review.md`
- 整改范围：M4-F1～F6（PR-40～45），核对日期 2026-08-24
- 对应报告第 12 节「最终验收清单」逐项核对
- 复审补充：`main@0f8e9ce` 最终复审报告（`docs/Game-UI-Design-Copilot-M4-F1-F6-final-source-audit-0f8e9ce.md`）指出 4 处过度声明与 3 项 MAJOR、3 项 P1；M4-H1～H4（PR-47～51）已逐项整改并 CI 全绿，本文档已同步修订（见「M4-H 复审整改补录」节）

## P0（M4-F1/F2）

| 清单项 | 状态 | 证据 |
| --- | --- | --- |
| Web Strict 导出在未 Fidelity 时返回 409 | ✅ | PR-40：`electron/services/finalDeliveryGate.cjs` + `server/webServer.delivery.test.cjs`（6 个审核者指定场景） |
| Web Strict 导出在未 Final Approval 时返回 409 | ✅ | 同上 |
| Web Strict 导出在 Visual Binding 漂移时返回 409 | ✅ | 同上 |
| mutation 成功、列表刷新失败时不会重跑 mutation | ✅ | PR-41：`App.tsx` refresh 错误隔离 + `App.test.tsx` 负向回归 |
| Cancel/Retry/Result 均绑定原 Job Project + Screen | ✅ | PR-41：`applyJobResult` 身份校验、screen 作用域 cancel key、失败写回原 Screen；`jobIdentity.test.cjs` |

## Contract / Evidence（M4-F3/F6）

| 清单项 | 状态 | 证据 |
| --- | --- | --- |
| Approved Contract 的非法 label-only 编辑不能继续保持 approved | ✅ | PR-42：保存前重算 coverage，破坏即拒绝；`contractLabelGate.test.cjs`；M4-H3（PR-49）补充失败原子性：拒绝发生在任何 invalidate 之前，预置交付链逐字节不变 |
| stale Critique 在 UI 和后端都不构成 passed | ✅ | 后端 reviewGate（M3 已有）+ PR-45 前端 `critique-stale-warning` 与绿灯/合成禁用；`StrictProductionPanel.test.tsx` |
| Critique hash/version 与当前 Underlay 一致才可合成 | ✅ | 后端像素 hash 链（M3）+ PR-45 前端 `visual_results_version` 预对齐（`critique-version-mismatch`） |

## Reference / Clone（M4-F4/F5）

| 清单项 | 状态 | 证据 |
| --- | --- | --- |
| Electron 与 Web 的 Reference no-op 均不 stale | ✅ | Electron（M3 PR-35）+ PR-43 Web `POST /reference` 按 `changed` 判断；`webServer.reference.test.cjs` |
| Clone 后所有真实 Artifact 引用均属于目标 Screen | ✅ | PR-44：`CLONE_FIELD_SCHEMA` 逐类声明 + schema 驱动 rewriter；`cloneSchemaIntegrity.test.cjs` 真实 Strict 树递归扫描。⚠→✅ M4-H 修订：复审发现该声明过度（遗漏 `underlay_critique`/`issue_id`/waiver id/`artifact_id`），M4-H1（PR-47）补齐 schema 并以真实 critique→waiver→composeVisual→runFidelity 交付链重验后成立 |
| 原 Screen id 只允许出现在明确的 provenance 字段 | ✅ | 同上：扫描断言残留为空、provenance 仅 `duplicated_from_screen_id` 1 处。⚠→✅ M4-H 修订：同上，PR-47 后递归扫描（含真实 Manifest/Fidelity/Critique）零残留 |

## UI（M4-F6）

| 清单项 | 状态 | 证据 |
| --- | --- | --- |
| stale Layout 只显示一个正确恢复动作 | ✅ | PR-45：LayoutWorkbench stale 分支只保留原因与证据，恢复动作集中在 sticky Footer；`LayoutWorkbench.test.tsx` / `LayoutWorkspace.test.tsx`。⚠→✅ M4-H 修订：复审发现 Footer 对多数 stale 原因落到错误的 `runStage('layout_design')` 兜底，M4-H2（PR-48）改为显式 switch 分派全部 5 种 action 并补 5 个点击级测试后成立 |
| update-contract 场景不再出现可失败的“重新生成布局” | ✅ | 同上：Footer 按 `layoutStaleGuidance` 分派“先更新功能契约”导航 |
| Strict asset stale 场景先引导补资产 | ✅ | 同上：`update-strict-assets` 指引文案与分派（M3 `staleReason.ts` 既有，F6 消除 Workbench 冲突按钮）。⚠→✅ M4-H 修订：复审发现 `update-strict-assets`/`regenerate-strict-layout` 未独立分派，M4-H2（PR-48）后前者导航严格资产阶段、后者仅在资产 Ready 时执行 Layout 后成立 |

## Version（M4-F6）

| 清单项 | 状态 | 证据 |
| --- | --- | --- |
| 首次保存传入 `version:99` 仍落盘 V1 | ✅ | PR-45：`saveArtifact` 首版固定 V1；`artifact-version-monotonic.test.cjs` 注入 version 99 |
| 后续每次落盘严格 `previous + 1` | ✅ | 同上（既有断言保持绿） |
| generation_id 不重复 | ✅ | 同上 |

## 自动化

| 检查 | 状态 | 说明 |
| --- | --- | --- |
| Node tests 全绿 | ✅ | 后端 210（M4-H3 +1 失败原子性） |
| UI Unit 全绿 | ✅ | 144（M4-H2 +5 stale 分派、M4-H4 +7 legacy 守卫与 fetch 导出） |
| Electron E2E 全绿 | ✅ | 36 |
| Web Server 集成测试全绿 | ✅ | `webServer.test.cjs` / `webServer.delivery.test.cjs` / `webServer.reference.test.cjs` |
| docs-validate 全绿 | ✅ | `pnpm test:docs` |
| fixture-e2e 全绿 | ✅ | CI required check |
| macos-validate 全绿 | ✅ | CI required check |
| secret-scan 全绿 | ✅ | gitleaks 8.24.3（CI required check） |

## 报告 10.2「仍缺少的负向回归」覆盖对照

| 要求的负向回归 | 落点 |
| --- | --- |
| mutation 成功 + refreshProjects 失败，不得重试 mutation | `src/App.test.tsx`（PR-41） |
| applyJobResult 拒绝 next.id / next.screen_id 错误 | `src/features/shared/applyJobResult.test.ts`（PR-41） |
| Cancel 使用原 job screen | `jobIdentity.test.cjs`（PR-41） |
| Web Reference no-op 不 stale | `server/webServer.reference.test.cjs`（PR-43） |
| Web Strict export 未批准/未 Fidelity 必须 409 | `server/webServer.delivery.test.cjs`（PR-40） |
| 已批准 Contract label-only 破坏 coverage 时不得保持 approved | `contractLabelGate.test.cjs`（PR-42） |
| Critique stale/version mismatch 时 UI 禁用合成 | `StrictProductionPanel.test.tsx`（PR-45） |
| 首次保存 caller version=99 仍存 V1 | `artifact-version-monotonic.test.cjs`（PR-45） |
| Clone 真实 visual_tasks/task_id/visual_results_id/repair lineage | `cloneSchemaIntegrity.test.cjs`（PR-44） |
| update-contract stale 时 Workbench 不显示可失败的“重新生成布局” | `LayoutWorkbench.test.tsx`（PR-45） |

## M4-H 复审整改补录（PR-47～51，基线 `main@0f8e9ce`）

最终复审报告判定「有条件不通过」，列出 3 项 MAJOR 与 3 项 P1；整改后逐项对照：

| 复审发现 | 整改 | 证据 |
| --- | --- | --- |
| MAJOR-01：Clone Schema 缺 `underlay_critique`/`issue_id`/waiver 等生产引用 | M4-H1（PR-47）：三类 references 补齐（含 `critique_id`/`artifact_id`）；测试升级为真实 critique→waiver→composeVisual→runFidelity 交付链，递归扫描零残留 | `artifactRegistry.cjs` / `cloneSchemaIntegrity.test.cjs` |
| MAJOR-02：Footer staleAction 未分派 strict actions | M4-H2（PR-48）：显式 switch 分派全部 5 种 action；`update-strict-assets` 导航严格资产阶段；`regenerate-strict-layout` 仅在资产 Ready 时执行；三种 strict stale 原因均有点击级测试 | `LayoutWorkspace.tsx` / `LayoutWorkspace.test.tsx` |
| MAJOR-03：非法 label 编辑先 invalidate 后 validate | M4-H3（PR-49）：重排为先校验后 invalidate；顺带修复种子节点不自 stale 的偏差；预置 4 Artifact 逐字节不变断言 | `designPipeline.cjs` / `contractLabelGate.test.cjs` |
| P1-01：legacy Critique 缺 version 显示假绿灯 | M4-H4（PR-51）：`critiqueEvidenceIncomplete` fail closed，「旧版证据需重新审查」警告 + 禁用合成 | `StrictProductionPanel.tsx` + 3 个新测试 |
| P1-02：取消键无独立 job_id | 登记 Issue #50 跟踪（含验收标准），`visualCancelKey` 处注释指向 | `designPipeline.cjs` |
| P1-03：Web `<a>` 下载看不到 409 | M4-H4（PR-51）：fetch 下载，非 2xx 读 JSON 错误并 throw；2xx 转 Blob；URL 携带冻结 screenId，`/visual/` 路由解析 | `src/api.ts` / `server/webServer.cjs` / `src/api.exportVisual.test.ts` |
| 验收文档 4 处过度声明 | 本文档对应行已标注 ⚠→✅ M4-H 修订并补充整改证据 | 上文 Reference/Clone 与 UI 两节 |

## M4-I 证据完整性与设计师权威收口补录（PR-53～55，基线 `main@759d05e`）

M4-H/PR-53 独立源码审核判定「有条件不通过」：Clone 证据文件完整性未闭环、
Screen Contract 不可变来源边界缺失、生成期门禁存在自我声明绕过。整改对照：

| 审核发现 | 整改 | 证据 |
| --- | --- | --- |
| MAJOR-01（§5）：Clone 物理文件名保留原 Screen 前缀；改写内容后未重算 `hash`/`byte_length` | M4-I1（PR-54）：`renameClonedFiles` 重命名并同步 JSON 路径；`recomputeClonedEvidence` 按实际字节重算（四向一致）；测试扫描文件名本身 | `projectStore.cjs` / `cloneSchemaIntegrity.test.cjs` |
| P1（§6）：Clone 后 Fidelity `passed` 原样继承 | M4-I1（PR-54）：`passed` 与 `approved` 一样降级 `reviewed`（含 workflow stage） | 同上 |
| MAJOR-02（§7）/ PR53-MAJOR-02（§8.3）：通用 PATCH 可改写 `id`/`screen_id`/`source_inventory` 等系统字段 | M4-I2（PR-55）：`SCREEN_CONTRACT_EDITABLE_KEYS` 白名单静默忽略系统字段；仅系统字段的 PATCH 整体 no-op；API 级负向测试按 §7.4 形态 | `designPipeline.cjs` / `screen-contract-field-allowlist.test.cjs` |
| PR53-MAJOR-01（§8.2）：生成期门禁信任模型自报 `covered_items` | M4-I3（并入 PR-53）：`coverageGateErrors` 改用服务端 `recomputeCoverage` 判定；伪造覆盖负向测试必须进修复轮 | `contracts.cjs` / `contracts.test.cjs` |
| PR53-P1（§8.4）：缺设计师删减误判项的 Electron E2E | 核心用户故事已由维护者以真实用户在「新项目」线路完整走通验证；自动化 E2E 登记跟进 Issue（不阻断，其余线路实测留待后续） | 维护者实机验证（2026-08-27） |
| §8.5：产品语义变更缺 ADR | ADR-008 记录设计师权威的新旧语义边界 | `docs/decisions/ADR-008-designer-authority-screen-contract.md` |

## M4-J 变化分类器与 Clone 安全边界补录（PR-58～61，基线 `main@2c80c68`）

M4-I 独立复审判定：变更分类漏掉三个白名单字段，Clone 证据解析仍有累计
资源放大、迁移前 symlink 入口与事务尾段三项残留。整改对照：

| 审核发现 | 整改 | 证据 |
| --- | --- | --- |
| NEW-MAJOR-01（§7）：`secondary_actions`/`data_dependencies`/`design_constraints` 未列入语义变化 | M4-J1（PR-58）：四类显式分类器（semantic/label-only/review-only/noop），可编辑集由分类集推导（单一权威来源）；语义编辑完整传播失效并清除旧批准印记 | `designPipeline.cjs` / `screen-contract-change-classifier.test.cjs` |
| NEW-P1-01（§9）：`review_metadata`-only 保存破坏交付链 | M4-J1（PR-58）：review-only 分类只记录审查进度，不失效任何生产 Artifact | 同上 |
| NEW-P2-01（§10）：系统字段 no-op 绕开 Screen 上下文校验 | M4-J1（PR-58）：no-op 判定移到 `openScreen` 上下文校验之后；完全相同保存整体 no-op | 同上 |
| §6.3：生成期门禁反馈混淆控件/信息 | M4-J1（PR-58）：反馈拆分 `required_controls` / `required_information` 两类 | `contracts.cjs` / `contracts.test.cjs` |
| SEC-MAJOR-01（§6）：证据遍历无预算、无去重，重复引用可放大 I/O | M4-K1（PR-60）：Clone 遍历上下文——深度 64、单 Artifact 节点 2048、单次 Clone 记录 512、唯一字节 256MB；同 realpath 只哈希一次，重复记录复用缓存；超限显式失败并入回滚 | `projectStore.cjs` / `cloneEvidenceSafety.test.cjs` |
| SEC-P1-02（§7）：迁移期在证据解析器之前跟随目录/文件 symlink | M4-K2（PR-61）：复制后、任何读写前全树 `lstat` 扫描，任何 symlink 显式失败，链接目标不被触碰 | `projectStore.cjs` / `cloneTransactionSafety.test.cjs` |
| TX-P1-01（§8）：Registry/Workflow 写入在回滚边界之外 | M4-K2（PR-61）：全事务——原始字节备份到 `workflow/transactions/clone-<id>/`，发布顺序目录→Workflow→Registry（发布点最后），任一失败自动还原备份并删除目录；回滚自身失败抛结构化 `CLONE_ROLLBACK_INCOMPLETE`（事务/步骤/备份路径/人工恢复顺序，诊断记录 best-effort，不做启动期自动恢复——审核者 §8.4 终稿裁定的降级项）；「有条目无 stage」不一致状态在再复制/切换/管线入口 Fail-Closed 阻断（仅检测，不自动修复） | 同上 |

## M4-L Clone 并发事务隔离补录（PR-63，基线 `main@00db588`）

M4-K 独立复审在单请求故障模型之外新发现三项问题，均已关闭（不计为债务）：

| 审核发现 | 整改 | 证据 |
| --- | --- | --- |
| §6（Web 多会话 Major）：Clone 并发请求无串行化，可丢失更新或交叉回滚 | M4-L（PR-63）：项目级异步写锁 `withProjectWriteLock` 串行化同项目全部 `screens/index.json`/`workflow/state.json` 写者（创建/复制/切换/更新 Screen、Workflow 更新）；单进程部署覆盖全部会话；按项目隔离不跨项目互斥 | `projectStore.cjs` / `cloneConcurrency.test.cjs` |
| §7（P1）：`fs.cp` 中途失败首次清理不完整 | M4-L（PR-63）：回滚清理改为按目标目录存在性执行，部分复制目录首次失败即删除 | 同上 |
| §3.3（非阻断优化）：累计字节预算在读后检查 | M4-L（PR-63）：改为读取前按 `stat.size` 预检，最坏读取量精确等于预算 | 同上 |

并发必测四项：不同 ID 并发全部保留、同 ID 并发恰好一个胜出、失败事务
不回滚另一事务已发布结果、Create+Duplicate 并发不丢条目；另有 `fs.cp`
中途失败即时清理与干净重试测试。

## 技术债台账（已接受的公开债务）

| Issue | 内容 | 状态与口径 |
| --- | --- | --- |
| #50 | 同一 Screen 并行任务的独立 `job_id`（当前取消键为 `projectId:screenId`） | OPEN。M4-H 起登记的接受债务；桌面单窗口串行路径风险低，Web 多标签/多会话/直接 API/未来并行任务场景需要；不阻断当前归档 |
| #57 | 设计师删除 AI 误判项的自动化 Electron E2E | OPEN。核心用户故事已由维护者以真实用户在「新项目」线路完整走通验证（2026-08-27）；其余线路（含 Clone）无人工实测，自动化覆盖作为回归投资跟进；不阻断当前归档 |

既往汇报中「仅剩 Issue #57」的表述不准确，正确口径为上表两项并列披露。

## L3 深度安全审查的证据位置

L3 审查通过本地 `~/.qodersec/bin/qodersec review --layer=l3` 在每个提交
推送前执行；当前七项 CI 不含独立 L3 Job，审核者无法从 CI 独立复核。
每个批次审查输出的原文（`{"layer":"l3","findings_count":0,...}`）引用在
对应 PR 描述与提交说明中（PR-53～61）。若后续引入无人值守部署，应将
L3 纳入 CI 产出可下载报告。

## 结论

M4-F1～F6 全部合并后，报告第 12 节验收清单各项均有对应实现与负向回归证据；
最终复审（`main@0f8e9ce`）提出的 3 项 MAJOR 与 3 项 P1 已由 M4-H1～H4（PR-47～51）逐项关闭。
M4-H/PR-53 独立审核（2026-08-27）在 Clone 物理证据完整性与 Screen Contract
信任边界上提出的新发现，已由 M4-I1～I3（PR-54/55 与并入 PR-53 的 M4-I3）逐项关闭，
产品语义变更以 ADR-008 固化；「设计师权威」语义（PR-53）已在真实环境由维护者
完整走通验证。
M4-I 复审提出的变更分类与 Clone 安全/事务残留（NEW-MAJOR-01、NEW-P1-01、
NEW-P2-01、SEC-MAJOR-01、SEC-P1-02、TX-P1-01），已由 M4-J1（PR-58）与
M4-K1/K2（PR-60/61）逐项关闭。
M4-K 复审在单请求故障模型之外新发现的并发隔离缺失（§6）、`fs.cp` 中途
失败清理（§7）与预算预检（§3.3），已由 M4-L（PR-63）关闭——本项目
单进程部署下，同项目全部 Registry/Workflow 写者串行化，并发丢失更新与
交叉回滚路线不再成立。自 M4-L 合并起：

- 变化分类以单一权威来源驱动，语义/文字/审查/无变化各有明确失效语义；
- Clone 具备遍历资源预算、全树 symlink 拒绝、全事务回滚、双重故障的
  结构化恢复指引与项目级并发隔离；
- 自动化覆盖维持全绿（Node 237 / ui-unit 146 / docs 26）。

M4-L 复审（2026-08-28，基线 `main@12fa7c1`）判定 M4-L 通过、可以归档，
并提出四项非阻断边界建议，已由 M4 收尾批（PR-64）全部关闭：

| 复审建议 | 收尾处置 |
| --- | --- |
| §8.1 部署边界写入文档 | `RELEASE-CHECKLIST.md` 新增「部署模型边界」节：单进程前提、多进程/多副本扩容需跨进程锁或 Revision CAS |
| §8.2 锁 Map 生命周期 | `withProjectWriteLock` 尾部完成且无后续排队时删除条目，避免无界增长 |
| §8.3 Legacy 迁移例外 | 并入「部署模型边界」节：一次性迁移不经写锁，未来并发首开同一 V1 项目需单独互斥 |
| §8.4 Clone 与源 Screen 并发编辑 | 廉价守卫：源 Screen 有 `in_progress` 阶段时禁止复制（明确文案），生成结束后复制可用；负向/正向测试覆盖 |

## M4 归档结论（按审核者最终口径）

```text
M4 工程整改：完成
当前支持部署：单进程（桌面单主进程 / Web 单 Node 进程、每租户单 Store）
已接受债务：Issue #50、Issue #57
后续硬化：启动期自动恢复、跨进程锁 / Revision CAS（仅在扩容时需要）
L3：本地审查证据，非独立 CI Job
```
