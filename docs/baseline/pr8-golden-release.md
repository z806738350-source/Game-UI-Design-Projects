# PR-8 Golden Samples 与正式发布执行基线

本文档是 PR-8（真实 Golden Samples 与正式发布）的执行级记录，覆盖 PR-8A/8B/8C 拆分、真实 Provider 运行手册、证据分层、fixture 重放与发布门禁。审核依据：`docs/Game-UI-Design-Copilot-整改审核与执行基线-v1.0.md` 与 `docs/项目升级改造完整进度审核-2026-08-18.md`。

## 1. PR 拆分与状态

| 单元 | 范围 | 状态 |
| --- | --- | --- |
| PR-8A | 真实 E2E 暴露的运行时修复：signed COS URL 快照、语义置信度分级、BBox 归一化、字体颜色与安全处理 | 已合并（GitHub #9、#10） |
| Style Contract 2.0（P0） | JSON schema、数值类型/单位/上下界、必填语义色与字体效果、模糊词黑名单（根级 `negative_style_constraints` 豁免）、失败测试 | 已合并（GitHub #11，main@e0b233e） |
| PR-8B | fixture E2E 替换合成测试、Model Lineage、证据分层与路径归一化、index 派生、CI（fixture job、gitleaks 秘密扫描、macOS validate）、保留样本与中文字体样本 | 已合并（GitHub #12，main@6d01004） |
| PR-8C | 设计师签核、执行级文档、README/CHANGELOG/版本、最终发布证据 | 签核已完成（`codex/audit-pr8c-docs-signoff`）：五组样本均 APPROVED（各项 ≥ 4、签名与日期齐备），导出归档于 `release-evidence/golden-samples/signoff-results-2026-08-18.json` |

## 2. 样本集合与阈值固定

- 校准集（阈值在其上调整）：`functional-dense`、`visual-hero`、`existing-continuation`。
- 保留集（从未参与调参）：`jade-shop-zh`（简体中文文案 + Noto Sans SC，SIL OFL 1.1）、`frontier-campaign`。
- 固定阈值版本：`underlay-metrics-v1`（`electron/services/underlayReview.cjs` 中 `Object.freeze`）。每次执行日志记录 `threshold_version`；保留集只在该版本固定后运行。保留集失败若需改代码，必须重跑全部校准集与保留集。
- 中文字体样本覆盖：中文按钮文案（立即购买/加入购物车）、中文标题（今日特惠）、中文正文（限时礼包 仅剩2天）、阿拉伯数字、货币（¥）、百分比（-25%）、中英混排（今日特惠 VIP 专享）；字体 cmap 覆盖 `zh_cn/latin/digits/symbols` 由 `typographyAssets.inspectFont` 验证并进入 fixture 断言。

## 3. 运行手册（真实 Provider）

```bash
# 生成隐私安全 source board（_sources/ 不入 Git）
node scripts/generate-reserved-boards.cjs [sample-id...]

# 生成可复现输入（wireframe、组件、污染 underlay、layout-seed、manifest）
node scripts/prepare-real-golden-assets.cjs [--sample <id>] [--layout-only]

# 全量/单样本真实 E2E（negative control 必须被阻断；repair 上限 2 轮）
node scripts/run-real-golden-e2e.cjs --all
node scripts/run-real-golden-e2e.cjs --sample <id>

# 仅重排布局 / 从已捕获证据续跑 / 刷新 index
node scripts/run-real-golden-e2e.cjs --reframe <id>
node scripts/run-real-golden-e2e.cjs --resume <id>
node scripts/run-real-golden-e2e.cjs --refresh-index
```

槽位选择使用 `underlay-metrics-v1` 像素指标在 clean underlay（及已捕获 repair 输出）上扫描最安静区域，最大槽位分数记录于 `scripts/prepare-real-golden-assets.cjs` 注释；瞬态网络错误（socket 错误码与 provider 502/503/504）自动重试一次。

## 4. 证据分层

Git 保留：`inputs/`（可复现 fixture）、`asset-manifest.json`、`evidence/execution-log.json`、`evidence/initial-critique.json`、`evidence/workspace/**/*.json`、`final.png`、`designer-signoff.md`、`index.json`、共享字体与 OFL。

不入 Git（本地/Release Asset）：`_sources/` 原始 board、`*/attempts/` repair 归档、`evidence/workspace/**/*.png` 中间大图、`evidence/workspace/style/fonts/` 运行期字体副本（权威字体保留在 `_shared/fonts/`）、`workflow/history/`。规则见 `.gitignore`。入库体积由 145 MB 降至约 80 MB（含 18 MB 中文字体）。

## 5. Model Lineage 与 index 派生

执行日志 `lineage` 直接包含：`model`、`critique_prompt_hash`、`input_hashes`（wireframe/known-contaminated）、`semantic_responses`（negative control 与每轮 critique 的原始响应路径+哈希）、`repair_chain`（attempt/mode/parent_underlay_id/output_underlay_id/provider_task_id/output_hash）、`final_underlay`、`final_png`、`threshold_version`。

`index.json` 由 `--refresh-index` 从每组 `execution-log.json` 与 `designer-signoff.md` 派生：全通过且全签核=`released`；全通过未签核=`pending-signoff`；任一失败/缺失=`failed`；否则=`prepared`。

## 6. CI 与日常重放

- `test`：单元与契约测试（不含 provider 调用）。
- `test:fixture-e2e`：重放已发布证据链——index 一致性、negative control 阻断、输入哈希重算、semantic responses 哈希重算、repair chain 父子连接与 provider task id、final underlay 复审零阻断、final PNG 解码/哈希/fidelity、组件与字体覆盖（含 zh_cn）。
- CI jobs：`test`/`lint`/`build`、`fixture-e2e`、`secret-scan`（gitleaks）、`macos-validate`。

## 7. 发布门禁

正式发布必须满足：五组样本 `pipeline-passed`、fixture E2E 全绿、三组校准样本设计师真人签核（每项 ≥4 分、无未决 blocker/critical/major、签名与日期）、PR-8B/8C 独立 Code Review 通过。版本保持 `0.2.0-alpha.1` prerelease，直到门禁全部关闭。

当前状态（2026-08-18）：五组样本 pipeline-passed，fixture E2E 与单元测试全绿，五组签核均 APPROVED，`index.json` 派生为 `released`；PR-8B 已合并（#12），PR-8C 随签核记录提交中。门禁关闭后的正式版本提升（恢复 `0.2.0`）与发布通道在 PR-8C 合并后由负责人确认。
