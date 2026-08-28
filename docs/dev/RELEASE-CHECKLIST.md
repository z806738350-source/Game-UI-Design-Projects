# 发布检查清单（RELEASE-CHECKLIST）

本仓库为单人仓库，main 分支受 Ruleset 保护（id=20995492）：禁止直推、
要求全部 Required Checks 通过。发布一律走 PR。本清单适用于补丁/次版本
发布（如 0.2.x）。

## 1. 代码与测试（合并前）

- [ ] `pnpm lint` 通过
- [ ] `pnpm test` 全绿（Node --test，服务层全部用例）
- [ ] `pnpm test:fixture-e2e` 通过（FixtureProvider 全链路）
- [ ] `pnpm run test:ui-unit` 通过（组件级单测）
- [ ] `pnpm run test:ui-e2e` 通过（Playwright Electron E2E）
- [ ] `pnpm run test:docs` 通过（check-docs + check-error-docs + check-doc-commands + check-project-tree 四检聚合）
- [ ] `pnpm run build` 通过（Vite + Electron 产物）

## 2. 安全与审查

- [ ] push 前运行 L3 深度安全扫描（`qodersec review --layer=l3`），
      无发现或发现已处置；每个新提交重跑
- [ ] CodeReview 子代理实质审查通过（发现已修复或说明）；单人维护仓库按 ADR-007 批准的例外，以七项 CI 强制 + 子代理实质审查替代真实技术 Reviewer APPROVE
- [ ] PR 描述包含变更动机、影响面与验证证据

## 3. CI Required Checks（Ruleset 强制）

| Check | 内容 |
| --- | --- |
| validate | Linux 单测/构建门禁 |
| fixture-e2e | 管线全链路回归 |
| secret-scan | 密钥扫描 |
| macos-validate | macOS 单测门禁 |
| ui-unit | 前端组件单测 |
| ui-e2e | Playwright Electron E2E |
| docs-validate | 文档校验（pnpm test:docs：check-docs + check-error-docs + check-doc-commands + check-project-tree） |

全部绿才能合并；不得以 --admin 绕过。

## 4. 版本与文档

- [ ] `package.json` version bump（语义化版本）
- [ ] CHANGELOG.md 新条目（面向能力的条目描述，逐条对应 PR）
- [ ] 受影响契约文档（docs/contracts/）版本表追加新行
- [ ] README 与真实运行产物一致（目录树、能力列表）
- [ ] golden evidence 不重跑（release-evidence/ 是历史发布证据，只增不改）

## 5. 合并与打标

- [ ] `gh pr merge --merge`（普通 merge，不 squash/rebase 改变历史语义）
- [ ] 确认 release commit 已在 main
- [ ] 从该 commit 打 tag（`vX.Y.Z`）并创建 GitHub Release
- [ ] Release Notes 与 CHANGELOG 条目一致
- [ ] 不覆盖/删除既有 tag（如 v0.2.0 保持不动）

## 6. 发布后验证

- [ ] 远端 main HEAD 与本地一致
- [ ] tag 指向正确 commit，Release URL 可访问
- [ ] Ruleset 未被弱化（检查项数量与名称不变）
- [ ] 汇总报告：合并结果 + tag/Release + 排除的无关本地改动

## 7. 部署模型边界（M4 归档，审核 §8.1/§8.3）

**当前支持的部署前提：一个 workspace / data volume 只由一个产品进程管理。**

- 桌面：单 Electron 主进程，全部窗口 IPC 共用一个 `ProjectStore`；
- Web：单 Node 进程，每租户缓存一个 `ProjectStore`，同租户多会话共享；
- Clone / Screen 写入的并发隔离（`withProjectWriteLock`）是**进程内锁**，
  只在该前提下成立。

水平扩容注意：多进程、多副本服务共享同一数据卷的部署**不在当前覆盖
范围**。扩容前必须以文件锁、数据库事务、分布式锁或 Registry/Workflow
Revision CAS 取代纯内存锁，并重新验证 Clone 事务结论。

Legacy 迁移边界：`migrateProjectV2` 是一次性迁移，不经项目写锁；当前部署
模型不存在并发首次打开同一 V1 项目的路径。若未来允许多请求并发首次
打开同一 legacy 项目，必须为迁移单独增加互斥或「正在迁移」标记。

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.1 | 2026-08-28 | M4 归档：新增「部署模型边界」节（单进程前提、扩容需跨进程协调、legacy 迁移边界，审核 §8.1/§8.3） |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
