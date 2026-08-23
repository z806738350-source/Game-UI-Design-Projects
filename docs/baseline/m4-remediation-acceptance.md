# M4 整改验收核对（AUD-01～14 独立源码审核）

- 审核基线：`main@3342346`，报告 `docs/Game-UI-Design-Copilot-M4-AUD01-14-independent-source-review.md`
- 整改范围：M4-F1～F6（PR-40～45），核对日期 2026-08-24
- 对应报告第 12 节「最终验收清单」逐项核对

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
| Approved Contract 的非法 label-only 编辑不能继续保持 approved | ✅ | PR-42：保存前重算 coverage，破坏即拒绝；`contractLabelGate.test.cjs` |
| stale Critique 在 UI 和后端都不构成 passed | ✅ | 后端 reviewGate（M3 已有）+ PR-45 前端 `critique-stale-warning` 与绿灯/合成禁用；`StrictProductionPanel.test.tsx` |
| Critique hash/version 与当前 Underlay 一致才可合成 | ✅ | 后端像素 hash 链（M3）+ PR-45 前端 `visual_results_version` 预对齐（`critique-version-mismatch`） |

## Reference / Clone（M4-F4/F5）

| 清单项 | 状态 | 证据 |
| --- | --- | --- |
| Electron 与 Web 的 Reference no-op 均不 stale | ✅ | Electron（M3 PR-35）+ PR-43 Web `POST /reference` 按 `changed` 判断；`webServer.reference.test.cjs` |
| Clone 后所有真实 Artifact 引用均属于目标 Screen | ✅ | PR-44：`CLONE_FIELD_SCHEMA` 逐类声明 + schema 驱动 rewriter；`cloneSchemaIntegrity.test.cjs` 真实 Strict 树递归扫描 |
| 原 Screen id 只允许出现在明确的 provenance 字段 | ✅ | 同上：扫描断言残留为空、provenance 仅 `duplicated_from_screen_id` 1 处 |

## UI（M4-F6）

| 清单项 | 状态 | 证据 |
| --- | --- | --- |
| stale Layout 只显示一个正确恢复动作 | ✅ | PR-45：LayoutWorkbench stale 分支只保留原因与证据，恢复动作集中在 sticky Footer；`LayoutWorkbench.test.tsx` / `LayoutWorkspace.test.tsx` |
| update-contract 场景不再出现可失败的“重新生成布局” | ✅ | 同上：Footer 按 `layoutStaleGuidance` 分派“先更新功能契约”导航 |
| Strict asset stale 场景先引导补资产 | ✅ | 同上：`update-strict-assets` 指引文案与分派（M3 `staleReason.ts` 既有，F6 消除 Workbench 冲突按钮） |

## Version（M4-F6）

| 清单项 | 状态 | 证据 |
| --- | --- | --- |
| 首次保存传入 `version:99` 仍落盘 V1 | ✅ | PR-45：`saveArtifact` 首版固定 V1；`artifact-version-monotonic.test.cjs` 注入 version 99 |
| 后续每次落盘严格 `previous + 1` | ✅ | 同上（既有断言保持绿） |
| generation_id 不重复 | ✅ | 同上 |

## 自动化

| 检查 | 状态 | 说明 |
| --- | --- | --- |
| Node tests 全绿 | ✅ | 后端 209（含 F2~F6 新增负向回归） |
| UI Unit 全绿 | ✅ | 132（F6 +6） |
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

## 结论

M4-F1～F6 全部合并后，报告第 12 节验收清单各项均有对应实现与负向回归证据；
可提交审核者复审，申请把 M4 改判为「完整闭环」。
