# Strict 延续模式指南（STRICT-CONTINUATION-GUIDE）

本文档解释 `existing-strict` / `locked-continuation` 两种延续模式的门禁
语义与日常操作要点。流程步骤见 `EXISTING-PROJECT-SOP.md`，本篇聚焦
「strict 模式与 guided 有什么不同、遇到拦截怎么办」。

## 两种延续模式

| 模式 | 判定 | 语义 |
| --- | --- | --- |
| `existing-strict` | 建项时选择 | 完整 strict 门禁：证据强制、语义校验、哈希一致 |
| `locked-continuation` | 项目锁定后 | 与 existing-strict 等同的门禁（代码判定：`continuation_mode === 'existing-strict' \|\| 'locked-continuation'`） |
| guided | 默认 | 宽松模式：允许探索性产出，门禁仅保留结构校验 |

## Strict 比 guided 多出的硬门禁

1. **Underlay 生成前置**：已批准的 Underlay Contract + 已生成的 Layout
   Guide，缺一抛 `UNDERLAY_SPEC_REQUIRED`。
2. **布局批准前置**：Component Bindings 必须先批准（三重前置之一）。
3. **字体校验 strict**：identity-critical 角色必须 exact 确认；final
   合成前 `validateFontManifest({ strict: true })` 零错误。
4. **组件状态完整**：button/navigation/tab 必须含 disabled 与
   pressed/selected 状态切图。
5. **Binding 语义门禁**：角色词表（binding-policy-v1）校验，违规绑定
   无法批准（BINDING_* 系列）。
6. **Critique 哈希证据强制**：underlay/overlay/component_board 哈希缺失
   直接是 blocker `incomplete-review-inputs`。

## 证据链原则

Strict 模式下每个批准都依赖可复验的证据，而非模型自述：

- **图像证据**：underlay PNG、review overlay、component board 全部落盘
  并记录 sha256；
- **语义证据**：模型审查原始响应落盘
  （`reviews/{id}-semantic-response.json`）+ prompt_hash；
- **像素证据**：Fidelity 检查实时解码输出 PNG，计算 evidence_digest；
- **引用一致**：manifest ↔ output ↔ fidelity-report 三层互相引用，
  任何一层漂移都会被批准门禁拦下（`COMPOSITION_OUTPUT_INVALID` /
  `FIDELITY_OUTPUT_STALE`）。

## Waiver（豁免）操作

Critique gate 的 blocking issue 有两条出路：

1. **repair**：让管线修复 underlay（有次数上限
   `UNDERLAY_REPAIR_LIMIT`）；
2. **waiver**：人工确认该 issue 可接受，填写 ≥10 字符的理由。理由不足
   10 字符会被拒绝。waiver 写入 `manual_waivers` 并重算 gate，是留痕的
   人工决策，不是绕过。

## Stale 处理原则

上游变化（编辑 bindings、改字体确认、重新生成 layout 等）会沿依赖图
把下游标记为 stale。Strict 下的正确动作：

- 按 `docs/dev/ARTIFACT-DEPENDENCY-GRAPH.md` 的顺序从最上游的变更点
  开始重新生成；
- 不要删除 stale 标记或手工改 JSON——生成产物只读，stale 只能靠重新
  生成解除；
- label-only 修改（只改控件显示名）是例外：不触发 stale
  （语义签名只含 `{id, role, required}`）。

## 交付前自查清单

- [ ] workflow 全部阶段 approved（无 blocked/stale）
- [ ] final composition-manifest 已批准（五重门禁通过）
- [ ] fidelity-report `status: passed`，无未批准 major
- [ ] 导出 PNG 成功（哈希再检通过）
- [ ] underlay waiver 均有合理理由（如有）

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
