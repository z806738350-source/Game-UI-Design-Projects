# Provider 故障排查（PROVIDER-TROUBLESHOOTING）

管线通过 Kunpo Gateway（`kunpoClient.cjs`）调用文本/视觉/图像模型。
本文档覆盖配置、常见失败与排查顺序。

## 1. 配置来源

`env.cjs` 的 `.env` 查找顺序（首个命中生效）：

1. 环境变量 `DESIGN_COPILOT_ENV_FILE` 指向的文件；
2. 应用根目录 `.env`；
3. 相邻目录 `../Game UI Forge/.env`（共享配置）。

运行模式：

| 模式 | 判定 | 行为 |
| --- | --- | --- |
| `gateway` | 配置了 Kunpo gateway 端点与凭证 | 走网关调用全部模型 |
| `direct` | 配置了直连 provider | 直连调用 |
| `unconfigured` | 均未配置 | 生成类操作失败，只读功能可用 |

模型映射在 userData 下的 `models.json`（通过 `copilot:config:models`
保存）。默认模型：文本/视觉 `google/gemini-3.1-flash-lite`，图像
`Image-GPT2`。

## 2. 排查顺序

1. **配置界面检查**：`copilot:config` 返回的 kunpo 配置是否为
   unconfigured；
2. **网络连通**：gateway 端点是否可达（DNS/代理/TLS），超时由
   `fetchJson` 的 AbortController 控制；
3. **鉴权**：401/403 → 凭证过期，重新配置 `.env`，不要重试循环；
4. **模型可用性**：`models.json` 中模型 id 与 provider 支持列表一致；
5. **重试**：生成类失败可安全重试（任务幂等，结果按 task id 轮询）。

## 3. 图像 provider 失败码

| 错误码 | 含义 | 处理 |
| --- | --- | --- |
| `TRANSIENT_IMAGE_UNSUPPORTED` | provider 不支持请求的临时图像能力 | 换 provider 或跳过该能力（如 repair 走 waiver） |
| `TRANSIENT_IMAGE_SIZE_INVALID` | 请求尺寸非法 | 检查布局 canvas 尺寸 |
| `TRANSIENT_IMAGE_RATIO_MISMATCH` | 返回图比例与要求不符 | 重试；持续出现则检查 provider 侧参数 |
| `TRANSIENT_IMAGE_DECODE_FAILED` | 返回图像无法解码 | 重试；检查 CDN 返回完整性 |
| `TRANSIENT_IMAGE_DOWNLOAD_FAILED` | CDN 下载失败 | 检查网络；重试 |

图像生成是异步任务：提交 → 轮询 task → CDN 结果。轮询中断不会损坏
已落盘证据，重新触发即可。

## 4. 与证据链的关系

- Provider 失败**不影响**已完成的确定性证据（布局/契约/已合成的
  output）；只有依赖模型输出的阶段需要重试；
- critique 的语义审查失败会体现为 `missing-semantic-evidence`
  （major）或 `low-critique-confidence`，重跑 critique 即可；
- UI E2E 使用本地 FixtureProvider 模拟网关（`tests/ui-e2e/`），本地
  无网络也可回归全流程。

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
