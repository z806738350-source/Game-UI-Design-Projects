# 存量项目接入 SOP（EXISTING-PROJECT-SOP）

本文档是「把已有游戏 UI 风格延续到新界面」的标准操作流程（SOP）。
对应管线的 `existing-strict` 延续模式。全程不需要编写任何 JSON：所有
artifact 由应用生成、校验、批准。

## 适用场景

- 游戏已有成型 UI（截图/设计稿），新界面必须延续既有风格；
- 团队要求"看起来像同一个游戏"，不接受模型自由发挥。

不适用：全新风格探索（用 guided 模式建普通项目即可）。

## 前置条件

| 条件 | 说明 |
| --- | --- |
| 参考素材 | ≥1 张既有 UI 截图（PNG/JPG），越接近目标屏幕越好 |
| 字体文件 | 既有 UI 使用的 OTF/TTF 字体（含可再分发许可确认） |
| 组件切图 | 按钮/导航等控件的各状态 PNG（strict 要求完整状态集） |
| Provider | `.env` 已配置可用的图像/文本 provider（见 PROVIDER-TROUBLESHOOTING） |

## 标准流程（13 步）

### 阶段一：立项与参考

1. **创建项目**：选择「延续既有项目（existing-strict）」模式。创建后
   项目即进入 strict 门禁体系，任何产物都必须带证据批准。
2. **导入参考素材**：上传既有 UI 截图。管线做参考分析
   （reference-inventory），对每张图给出 approved/rejected 结论。
3. **批准参考**：至少 1 张 approved，否则后续风格解析被阻断。

### 阶段二：风格与资产

4. **风格解析**：生成 Style Contract（颜色/排版/形状语言）。人工核对
   可执行值（hex 颜色、数字尺寸），禁止出现"适度""大气"类模糊词。
5. **导入并确认字体**：导入 OTF/TTF → 逐项确认 license 与 exact 匹配。
   strict 下 identity-critical 角色（display/body）必须 exact。
6. **导入组件切图**：按 family/state 导入 PNG。strict 要求
   button/navigation/tab 类控件具备 disabled + pressed/selected 状态。
7. **批准组件契约**：系统对切图做物理校验（哈希、尺寸），全部通过后批准。

### 阶段三：屏幕设计

8. **创建屏幕并批准 Screen Contract**：确认控件清单（id/role/required）
   覆盖了需求中的全部元素；`uncovered_items` 必须为空。
9. **完成 Component Bindings**：为每个控件绑定组件 family 与文字策略。
   语义门禁（BINDING_POLICY_VERSION=binding-policy-v1）校验角色匹配，
   通过后批准。
10. **布局设计**：生成 3 个布局提案 → 选择并批准 Approved Layout
    （strict 前置：bindings 已批准）。

### 阶段四：视觉与合成

11. **Underlay 链路**：生成 Underlay Contract → 批准 → 生成 Layout Guide
    → 生成视觉 → Critique 审查。Critique gate 未过时：修复（repair）或
    填写 ≥10 字符理由的 waiver。
12. **合成**：preview 合成预览 → final 合成（final 需要字体 strict 校验
    通过）→ 运行 Fidelity 检查（13 项）→ 处理 issues → 批准 final。
13. **导出**：批准后导出最终 PNG。导出会再次校验哈希
    （`FINAL_EXPORT_HASH_MISMATCH` 说明输出被外部改动，需重新合成）。

## 关键红线

- **不要手工编辑**任何生成的 JSON/PNG：composition-manifest、
  composition-output、fidelity-report 是只读证据
  （`GENERATED_EVIDENCE_READ_ONLY`）。
- **上游改动会 stale 下游**：改了 bindings/layout/字体后，按提示重新
  生成受影响环节即可，不要尝试绕过 stale 提示直接批准。
- **strict 无捷径**：缺 Layout Guide 生成视觉会被
  `UNDERLAY_SPEC_REQUIRED` 拦截，这是设计，不是故障。

## 常见阻塞速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `STALE_DEPENDENCY` | 上游 artifact 变化 | 按依赖顺序重新生成（见 dev/ARTIFACT-DEPENDENCY-GRAPH） |
| `BINDING_*` 门禁失败 | binding 语义/状态不合法 | 见 contracts/COMPONENT-BINDINGS.md |
| `UNDERLAY_REPAIR_LIMIT` | 修复次数用尽 | 调整布局 slot 或 prompt 后重新生成 underlay |
| `FIDELITY_GATE_FAILED` | blocker/critical/未批准 major | 逐条处理 issues 后重跑 fidelity |

完整错误码含义见 `docs/dev/ERROR-CATALOG.md`；失败恢复路径见
`docs/user/FAILURE-RECOVERY.md`。

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
