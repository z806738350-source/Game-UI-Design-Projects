# 失败恢复指南（FAILURE-RECOVERY）

本文档给出管线运行中常见失败的标准恢复路径。原则：**只读证据损坏或
漂移时，唯一恢复方式是重新生成，不允许手工修补文件**。完整错误码
含义见 `docs/dev/ERROR-CATALOG.md`。

## 决策树

```
失败
 ├─ 错误码含 STALE_* / *_STALE      → 按依赖顺序重新生成（见 1）
 ├─ 错误码含 *_HASH_MISMATCH / UNREADABLE → 产物损坏（见 2）
 ├─ 错误码含 BINDING_*              → 绑定语义问题（见 3）
 ├─ UNDERLAY_* / critique blocking  → Underlay 修复链（见 4）
 ├─ FIDELITY_GATE_FAILED            → issues 处理（见 5）
 ├─ 布局先行路线布局链路被旧版循环卡死 → 一次性修复（见 9）
 ├─ 生成/保存任务失败（错误横幅）   → 前端失败与重试（见 10）
 ├─ Provider 超时/鉴权失败           → PROVIDER-TROUBLESHOOTING
 └─ 迁移中断（MIGRATION_*）          → MIGRATION-ROLLBACK
```

## 1. Stale 类失败

症状：批准时抛 `STALE_DEPENDENCY`，或界面提示下游 stale。

恢复：
1. 打开报错信息中被点名的 stale artifact；
2. 按 dev/ARTIFACT-DEPENDENCY-GRAPH.md 从最上游变更点重新生成；
3. 依次重新批准，直到 workflow 恢复 approved。

不要做：手工删除 stale 状态、手工编辑 artifact JSON（生成产物会抛
`GENERATED_EVIDENCE_READ_ONLY`）。

## 2. 产物损坏（哈希/读取失败）

症状：`COMPOSITION_OUTPUT_HASH_MISMATCH`、
`COMPOSITION_OUTPUT_UNREADABLE`、`FONT_ASSET_HASH_MISMATCH`、
`COMPONENT_ASSET_HASH_MISMATCH`、`FINAL_EXPORT_HASH_MISMATCH`。

恢复：
- composition 输出损坏 → 重新合成（preview → final → fidelity）；
- 字体/组件文件损坏 → 重新导入并确认；
- underlay PNG 丢失 → 重新生成视觉 + critique。

## 3. 绑定语义失败

症状：BINDING_* 系列（批准 bindings 或合成门禁时）。

恢复：对照 contracts/COMPONENT-BINDINGS.md 的违规明细修正绑定
（角色词表、状态匹配、文字策略），重新校验后批准。绑定编辑会自动
剥离旧的 approval stamp，需要重新批准。

## 4. Underlay 修复链

症状：critique gate blocking（text-like/ui-like/busyness 等 issue）。

恢复顺序：
1. **repair**：UnderlayWorkbench 触发修复，查看修复后新 critique；
2. repair 达上限（`UNDERLAY_REPAIR_LIMIT`）→ 调整上游（布局 slot
   margin、视觉 prompt）重新生成 underlay；
3. 确认 issue 可接受 → 填写 ≥10 字符 waiver 理由（留痕的人工决策）；
4. `INPAINT_NOT_AVAILABLE`：provider 不支持修复能力，检查
   PROVIDER-TROUBLESHOOTING 或走 waiver/重生成。

## 5. Fidelity 门禁失败

症状：`FIDELITY_GATE_FAILED` / `FIDELITY_CURRENT_EVIDENCE_FAILED` /
`FIDELITY_EVIDENCE_STALE` / `FIDELITY_OUTPUT_STALE`。

恢复：
1. 重跑 `fidelity:run` 生成新 report；
2. 逐条处理 issues：blocker/critical 必须消除（通常是回到上游修复后
   重新生成）；major 可以人工逐条批准（写入 issue.approved）；
3. 重新合成 final（若 output 已变）→ 重跑 fidelity → 再批准。

`FIDELITY_EVIDENCE_STALE` 特指批准时的磁盘证据与 report 记录不一致：
通常是批准前有人动了项目文件，重跑 fidelity 即可。

## 6. 批准前置失败

症状：`Approved Layout is required.`、`UNDERLAY_SPEC_REQUIRED`、
`FONT_CONFIRMATION_ACTION_REQUIRED` 等提示。

恢复：按提示补齐前置。这些不是错误恢复，而是流程顺序问题——回到对应
Workbench 完成前置步骤即可。特别注意：字体 roles 不能直接编辑，必须走
「重新导入 + 确认」动作（`FONT_CONFIRMATION_ACTION_REQUIRED`）。

## 7. Provider 失败

症状：生成/审查阶段超时、鉴权失败、返回空结果。

恢复：见 `docs/dev/PROVIDER-TROUBLESHOOTING.md`。要点：检查 `.env`
配置与 models.json 模型映射；临时图像 provider 失败不阻塞已完成的
证据链，重试即可。

## 8. 迁移中断

症状：升级到 schema v2 时进程中断，出现 `MIGRATION_*` 错误。

恢复：见 `docs/dev/MIGRATION-ROLLBACK.md`。迁移是 backup/staging/
rollback 三目录事务，中断后可回滚到迁移前备份，不会丢数据。

## 9. 旧版风格循环一次性修复（布局先行路线）

症状：探索/引导继承项目里，布局已批准过，但锁定风格后布局页按失效
原因给出对应的恢复指引（不再统一显示「画布或需求已变化」）：契约变化
提示先更新功能契约，旧版循环缺陷提供一次性修复，其余原因提示重新生成
布局（AUD-14：页脚与工作台共用同一指引与恢复按钮）。

恢复：在布局页点对应恢复按钮（如「执行一次性修复」`layout-repair`）。
修复前会完整备份原状态并重跑布局校验，只在失效原因确为旧版循环且输入
未变时恢复；不满足条件会抛 `ROUTE_CYCLE_REPAIR_INELIGIBLE`，此时按提示
重新生成布局链路。严格继承/锁定项目不适用本修复。

## 10. 前端任务失败与重试（AUD-03 / AUD-04）

症状：生成/保存/批准任务失败，顶部出现错误横幅「当前步骤未完成」。

行为保证：

- 失败的任务不会触发任何“成功后动作”：创建项目失败不会打开项目，
  风格保存失败不会进入下一阶段，Reject→重新生成失败不会执行生成；
- 错误横幅提供「重试」：重试固定在任务发起时的原项目与原 Screen，
  切换项目/Screen 后按钮变为「回到原上下文后重试」，晚到的响应也不会
  覆盖当前上下文；
- 后台任务（如逐张保存的视觉探索）属于某个项目与 Screen，结果只应用
  到发起上下文，不覆盖当前打开的另一个页面。

恢复：按横幅提示在原上下文点重试；若错误码属于上游 stale/门禁类，按本
文档对应章节处理后再重试。不要在失败后立即手工改动产物文件。

另：导出最终成图要求 Fidelity 证据与当前合成输出一一对应（内容证据链：
manifest id + output hash）；若提示需要先通过 Final Fidelity 检查，重新
合成 final 并重跑 fidelity 即可（AUD-10 后版本不再用作新鲜度对齐）。

## 兜底原则

1. 项目目录整体可备份：复制整个项目目录即完整快照；
2. 任何不确定的状态，从最上游重新生成永远比手工修补安全；
3. workflow 状态与 artifact-history（`workflow/` 目录）可用于追溯，
   但不要手工改写。

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.2 | 2026-08-23 | PR-35/38：新增前端任务失败与重试（见 10，AUD-03/04）；布局 stale 指引按原因/路线区分（AUD-14）；导出新鲜度改用内容证据链（AUD-10） |
| 1.1 | 2026-08-21 | PR-29 补充旧版风格循环一次性修复（见 9） |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
