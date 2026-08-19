# 发布检查清单（RELEASE-CHECKLIST）

本仓库为单人仓库，main 分支受 Ruleset 保护（id=20995492）：禁止直推、
要求全部 Required Checks 通过。发布一律走 PR。本清单适用于补丁/次版本
发布（如 0.2.x）。

## 1. 代码与测试（合并前）

- [ ] `pnpm lint` 通过
- [ ] `pnpm test` 全绿（Node --test，服务层全部用例）
- [ ] `pnpm run fixture-e2e` 通过（FixtureProvider 全链路）
- [ ] `pnpm run test:ui-unit` 通过（组件级单测）
- [ ] `pnpm run test:ui-e2e` 通过（Playwright Electron E2E）
- [ ] `pnpm run test:docs` 通过（文档校验，含 check-error-docs）
- [ ] `pnpm run build` 通过（Vite + Electron 产物）

## 2. 安全与审查

- [ ] push 前运行 L3 深度安全扫描（`qodersec review --layer=l3`），
      无发现或发现已处置；每个新提交重跑
- [ ] CodeReview 子代理实质审查通过（发现已修复或说明）
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
| docs-validate | 文档校验（check-docs + check-error-docs） |

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

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
