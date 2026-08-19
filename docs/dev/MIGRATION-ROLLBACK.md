# 迁移与回滚（MIGRATION-ROLLBACK）

项目 schema 迁移（v1 → v2，见 ADR-004 与 docs/MIGRATION-V2.md）由
`migrations.cjs` 以事务方式执行。本文档说明事务结构、中断后的恢复与
回滚。

## 1. 事务结构

迁移在项目目录的父目录下创建三个兄弟目录（`{transactionId}` 唯一）：

| 目录 | 用途 |
| --- | --- |
| `.{name}.backup-v1-{transactionId}` | 迁移前完整备份（`fs.cp` 递归，已存在即报错） |
| `.{name}.migration-{transactionId}` | staging：在副本上完成全部 v2 改写 |
| `.{name}.rollback-{transactionId}` | 失败时暂存被替换的原目录 |

执行顺序（每步后有 checkpoint）：

```
备份 → stage 副本 → 改写 screens/index → 改写 project.json
     → 改写 workflow/state → 写 migration-log
     → 原目录改名（rollback 目录）→ staging 提升为正式目录
```

提升前对 staging 做 `validateStagedMigration` 校验（project.json /
screens/index.json / workflow/state.json 可解析且结构合法）。任何一步
失败：staging 丢弃，原目录从 rollback 目录恢复，备份保留。

## 2. 故障注入点（测试用）

`MIGRATION_FAULT_POINTS` 共 8 个：`after-backup`、`after-stage-copy`、
`after-screen-index`、`after-project`、`after-state`、`after-log`、
`after-original-rename`、`after-stage-promote`。通过 `faultAt`/
`faultInjector` 注入，抛 `MIGRATION_FAULT_INJECTED`
（`fault_point` 携带点位）。仅测试使用，生产不会触发。

## 3. 中断恢复操作

迁移进程意外中断后：

1. 查看项目父目录的 `.{name}.*-{transactionId}` 目录：
   - 只有 `backup-v1` 与 `migration` 存在 → 迁移未完成，原目录仍为
     v1，重新启动应用会重新迁移；
   - 存在 `rollback` 且正式目录缺失 → 恢复未完成，把 rollback 目录
     改回原名（原子改名步骤未完成），再重启应用；
2. 迁移日志在 `workflow/migration-log.json`（成功迁移后的项目内）；
3. 任何情况下 **backup-v1 目录不要删除**，直到确认 v2 项目可正常打开。

## 4. 手动回滚

如需回到 v1：

1. 关闭应用；
2. 将当前 v2 项目目录改名留存；
3. 将 `.{name}.backup-v1-{transactionId}` 复制/改名为原项目目录名；
4. 重启应用（v1 数据会被识别为旧 schema，下次打开时再次提示迁移——
   若不想再迁移，保持旧版本应用）。

注意：v2 中新增的批准/证据不会出现在 v1 备份中；手动回滚会丢失迁移
后的全部工作。

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
