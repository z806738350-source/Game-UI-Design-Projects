# ADR-007：单人维护仓库的 Review 治理（批准的例外）

- 状态：已接受（批准的例外，Approved Exception）
- 日期：2026-08-19
- 关联：REM-05、审核文档《Game-UI-Design-Copilot-v0.2.1-剩余未闭环要求与最终整改执行指导》F-04、ADR-001

## 背景

原《剩余整改任务与执行指导》REM-05 要求 main 分支合并前至少获得一名真实技术协作者的 GitHub APPROVE，CODEOWNERS 由真实协作者承担 Code Owner Review，并通过 stale approval / 对话解决门禁形成可验证闭环。

截至 v0.2.1，仓库 `z806738350-source/Game-UI-Design-Projects` 仅有所有者一名协作者，不存在可邀请的真实技术协作者账号；PR #16～#19 的审批均由 owner 自批满足。项目方（2026-08-19 裁定）明确决定：本仓库维持单人维护，不引入外部协作者。

## 决策

接受"无真实独立技术 Reviewer"为**批准的例外**，并以本 ADR 定义替代门禁。本决定不宣称 REM-05 逐字完成；REM-05 的真实协作者要求以本例外关闭。

替代门禁（全部已在 main Ruleset id=20995492 生效，不得弱化）：

1. main 受 Ruleset 保护：Require PR + 1 approving review + dismiss stale approvals + require conversation resolution + require branch up to date；禁止直推、force push、分支删除；不配置 bypass actors。
2. Required Checks 七项强制：`validate`、`fixture-e2e`、`ui-unit`、`ui-e2e`、`docs-validate`、`secret-scan`、`macos-validate`。
3. 每个 PR 合并前由独立 CodeReview 子代理执行实质代码审查，发现必须修复并回归后才合并；子代理审查记录写入 PR 描述。
4. 每次 push 前自动运行 L3 深度安全扫描，零发现才推送。
5. CODEOWNERS 保留审核域映射（当前全部指向 owner），协作者加入后立即成为 Code Owner Review 的事实来源。

## 明确不满足的部分（例外的边界）

- 无真实非 owner 账号的 GitHub APPROVE 记录；
- Code Owner Review 由 owner 本人满足，不构成独立审查；
- "stale approval 撤销"与"未解决线程阻断"在单人流程中无法产生真实的跨人证据，仅能由 Ruleset 配置保证机制存在。

以上三点在本例外存续期间不再重复整改；出现真实协作者后按"退出条件"恢复字面要求。

## 退出条件

当满足以下任一时，本例外自动失效，必须恢复 REM-05 字面要求：

1. 有真实技术协作者接受仓库邀请；
2. 项目方另行裁定引入外部审查。

恢复动作：更新 CODEOWNERS 将核心目录分配给协作者、Ruleset 启用 Code Owner Review、按审核文档 6.2 节执行治理验证 PR 并留存证据。

## 后果

- v0.2.2 及以后版本在合规口径上标注"REM-05 以 ADR-007 批准的例外关闭"；
- RELEASE-CHECKLIST 与交付证据清单中的"真实 Reviewer APPROVE"项以本 ADR + CodeReview 子代理记录替代；
- 该例外只影响治理口径，不豁免任何代码、测试、文档与安全门禁要求。
