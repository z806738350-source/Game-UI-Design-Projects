# Workbench 使用指南（WORKBENCH-GUIDE）

应用主界面由多个 Workbench（工作台）组成，每个 Workbench 只负责管线中
的一个阶段，并受「工作台边界」（PR-16）约束：只能调用本阶段允许的
操作，跨阶段操作会被后端拒绝。这保证了证据链不会被跳步污染。

## Workbench 一览

| Workbench | 负责阶段 | 主要操作 |
| --- | --- | --- |
| InputWorkspace | 需求输入 | AI 预填意图、逐段评审、确认（`input:prefill-intent` / `input:confirm-intent-review`） |
| ReferenceWorkbench | 参考分析 | 导入参考图、批准/拒绝参考 |
| StyleWorkspace | 风格解析 | 生成/批准 Style Contract |
| TypographyWorkbench | 字体 | 导入字体、license/exact 确认、批准 Font Manifest |
| ComponentKitWorkbench | 组件 | 导入切图（含 Forge 导入）、批准 Component Contract |
| ScreenManager | 屏幕管理 | 创建/复制屏幕、切换活跃屏幕、批准 Screen Contract |
| ContractWorkspace | 契约总览 | 查看各 artifact 状态与版本 |
| BindingWorkbench | 绑定 | 编辑 bindings、语义校验、批准 |
| LayoutWorkbench | 布局 | 生成提案、选择、批准 Approved Layout |
| VisualWorkspace | 视觉探索 | 生成 visual task/results |
| UnderlayWorkbench | Underlay | 契约生成、Layout Guide、critique、repair、waiver |
| CanvasCompositor | 合成与交付 | preview/final 合成、Fidelity 运行、批准、导出 |

## 推荐工作顺序

按管线阶段自上而下操作（详见 dev/PIPELINE-STATE-MACHINE.md）：

```
需求 → 参考 → 风格 → 字体 → 组件 → 屏幕 → 绑定 → 布局
     → Underlay（契约→Guide→视觉→Critique）→ 合成 → Fidelity → 导出
```

每个 Workbench 内部的操作按钮只在满足前置条件时可用；置灰或报错时
先回到上游 Workbench 完成对应批准。

## 输入阶段：AI 预填、Candidate 与确认（structured-v2）

导入线框稿（UE）后，输入阶段提供两种工作方式：

- **新项目 / 空白输入**：点「AI 预填」，AI 看图生成固定六段草稿（页面目的、
  玩家任务、核心流程、可见控件、可见信息与状态）。首稿直接采用，逐段评审后确认。
- **已有内容（旧版文本或已确认评审）**：重新预填不会覆盖当前输入，而是生成一个
  **candidate（候选）**，界面上以差异对比呈现：
  - **采用**：整版替换当前评审，旧版本自动留档到历史；确认被取消，需重新确认；
  - **丢弃**：当前输入原封不动。
  candidate 待处理时不能再次预填；若预填后其它输入已变化，candidate 会显示过期，
  只能丢弃后重新预填。
- **历史**：每次采用/保存前的版本都会留档，可在历史面板中查看与恢复；恢复前会二次确认，
  恢复后确认被取消，需要重新确认才能进入下游。

**确认门禁**：条目上会显示来源标签（图中可见 / AI 推断 / 设计师新增 / 设计师已修改）；存在未处理的待确认项（AI 提出的疑问）或六段内容低于空下限时，确认按钮不可用。
确认后进入功能解读阶段；此后再编辑评审会取消确认，需重新确认。
更换线框稿或 Project Type 后，旧分析会标记为「基于旧 UE」，请核对或重新预填。
状态机细节见 `docs/dev/PIPELINE-STATE-MACHINE.md`。

## 工作台边界（重要）

后端按阶段划分 IPC 权限：

- 每个 Workbench 只能触发本阶段与紧邻查询类的操作；
- 试图用错误入口执行敏感动作（如在绑定台直接批准 final 合成）会被
  拒绝并记录；
- UI E2E（`tests/ui-e2e/`）覆盖了边界行为，回归时会验证。

对用户的影响：**按界面提供的按钮操作即可**；不要依赖隐藏路径或
直接改项目目录文件。

## 状态指示约定

- 每个 Workbench 显示当前 artifact 的 `status`：draft / generated /
  reviewed / approved / rejected / stale / passed；
- `stale` 提示表示上游已变化，需要重新生成；
- `blocked`（workflow 级）表示门禁未过，查看 issues 明细处理。

## 常见操作问答

**Q：改了一个控件的显示名，下游全 stale 了？**
A：label-only 修改不触发 stale（语义签名只含 id/role/required）。如果
仍然 stale，说明同时改动了 id、role 或 required。

**Q：preview 合成上有水印？**
A：存在未 exact 确认的文字图层时，preview 会叠加
`TYPOGRAPHY PREVIEW · FONT FIDELITY UNRESOLVED` 水印。完成字体 exact
确认后重新合成即消失。

**Q：导出按钮不可用？**
A：导出要求 final composition-manifest 已批准（五重门禁通过）。回到
CanvasCompositor 依次完成 final 合成、Fidelity 运行、批准。

**Q：字体导入后还要点什么？**
A：导入 ≠ 确认。需要在 TypographyWorkbench 逐项确认 license（可再分发）
与 exact（与目标字体完全一致），否则合成门禁会拦下。

**Q：组件从 Game UI Forge 导入？**
A：ComponentKitWorkbench 支持 `components:forge-import`，从 Forge 拉取
组件切图；导入后同样走物理校验与批准。

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.1 | 2026-08-30 | PR-I5：InputWorkspace 升级为 structured-v2 意图预填（六段评审、candidate/历史、确认门禁） |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
