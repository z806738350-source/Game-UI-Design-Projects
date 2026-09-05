# IPC API 参考（API-IPC-REFERENCE）

主进程（`electron/main.cjs`）通过 `ipcMain.handle('copilot:<domain>:<action>')`
注册全部 IPC 通道；preload（`electron/preload.cjs`）以
`window.designCopilot.<method>` 桥接给渲染进程；前端统一经
`src/api.ts` 调用。命名三段式：`copilot:<domain>:<action>`。

## 1. 配置（config）

| 通道 | 参数 | 说明 |
| --- | --- | --- |
| `copilot:config` | 无 | 返回 kunpo 安全配置、workspaceRoot、platform |
| `copilot:config:models` | `input`（visionModel 等） | 保存 models.json 模型配置并热更新 |

## 2. 项目与屏幕（projects / screens）

| 通道 | 参数 | 说明 |
| --- | --- | --- |
| `copilot:projects:list` | 无 | 项目列表 |
| `copilot:projects:create` | `input`（name、continuation_mode 等） | 建项目 |
| `copilot:projects:duplicate` | `projectId` | 复制项目 |
| `copilot:projects:open` | `projectId, options` | 打开项目（可带 screenId） |
| `copilot:projects:save` | `projectId, patch` | 保存项目修改（触发 stale 传播） |
| `copilot:projects:reveal` | `projectId` | 在文件管理器中显示 project.json |
| `copilot:projects:import` | `projectId, kind, screenId` | 文件选择导入 wireframe/参考图 |
| `copilot:projects:reference` | `projectId, input` | 管理参考图 + `invalidateFromInputChange` |
| `copilot:screens:list` | `projectId` | 屏幕列表 |
| `copilot:screens:create` | `projectId, input` | 建屏幕 |
| `copilot:screens:duplicate` | `projectId, screenId, input` | 复制屏幕 |
| `copilot:screens:active` | `projectId, screenId` | 切换活跃屏幕 |
| `copilot:screens:update` | `projectId, screenId, patch` | 更新屏幕元数据 |

## 3. 资产（fonts / components）

| 通道 | 参数 | 说明 |
| --- | --- | --- |
| `copilot:fonts:import` | `projectId, input` | 对话框选 OTF/TTF 导入（哈希入库） |
| `copilot:fonts:confirm` | `projectId, input` | license/exact 确认（confirmFontUsage） |
| `copilot:fonts:bytes` | `projectId, fontId` | 读取字体字节（先比对哈希，不一致抛 `FONT_ASSET_HASH_MISMATCH`） |
| `copilot:components:import` | `projectId, input` | 对话框选图片导入组件切图 |
| `copilot:components:forge-import` | `projectId` | 导入 Game UI Forge manifest |

## 4. 管线（pipeline / input）

| 通道 | 参数 | 说明 |
| --- | --- | --- |
| `copilot:pipeline:run` | `projectId, stage, input` | 运行阶段（runStage） |
| `copilot:pipeline:cancel` | `projectId, stage, input` | 取消阶段 |
| `copilot:pipeline:approve` | `projectId, kind, input` | 批准 artifact（approveArtifact，含各门禁） |
| `copilot:pipeline:update` | `projectId, kind, patch` | 编辑 artifact（受只读/确认规则约束） |
| `copilot:input:draft-requirement` | `projectId, input` | 草拟需求（draftRequirement） |

## 5. Underlay 链（underlay）

| 通道 | 参数 | 说明 |
| --- | --- | --- |
| `copilot:underlay:contract` | `projectId, input` | 生成 Underlay Contract |
| `copilot:underlay:guide` | `projectId, input` | 生成 Layout Guide PNG |
| `copilot:underlay:critique` | `projectId, input` | 运行 Critique（证据落盘） |
| `copilot:underlay:repair` | `projectId, input` | 修复 underlay（有次数上限） |
| `copilot:underlay:waiver` | `projectId, input` | 豁免 issue（理由 ≥10 字符） |

## 6. 合成与交付（composition / fidelity / visual）

| 通道 | 参数 | 说明 |
| --- | --- | --- |
| `copilot:composition:create` | `projectId, input` | 合成（mode: preview/final，四道门禁） |
| `copilot:fidelity:run` | `projectId, input` | 运行 13 项 Fidelity 检查 |
| `copilot:visual:export` | `projectId, variationId` | 导出：strict → final output 校验后导出（`FINAL_EXPORT_BLOCKED`）；guided → 下载 variation 图 |

## 6b. 图库（gallery）

| 通道 | 参数 | 说明 |
| --- | --- | --- |
| `copilot:gallery:list` | `query`（scope/projectId/screenId/orientation/range/sort/query/limit/cursor） | 查询图库；首页查询先回填/对账，翻页（带 cursor）不重复扫描 |
| `copilot:gallery:hide` | `assetId` | 隐藏资产（仅写 `hidden_at`，绝不删除云端文件） |
| `copilot:gallery:restore` | `assetId` | 恢复已隐藏资产 |
| `copilot:gallery:waive` | `assetId`、`reason` | 逐张下载豁免：仅 `mode_provenance==='fail-closed'` 的历史快照资产可豁免；理由 trim 后至少 10 字符（400 `GALLERY_WAIVER_REASON_TOO_SHORT`），非历史快照资产拒绝（409 `GALLERY_WAIVER_NOT_APPLICABLE`）；成功后写入 `download_waiver={at,reason}` 留痕 |
| `copilot:gallery:download` | `assetId` | 下载原图：只按已登记 assetId 读取 URL（Renderer 永不传 URL）；门禁只认登记时 `continuation_mode` 快照，缺失按 `existing-strict` fail-closed 阻断；已留痕豁免的历史快照资产放行；保存前再次校验可信永久 CDN |

Web 端（`server/webServer.cjs`，每租户独立 galleryStore）：

| 路由 | 说明 |
| --- | --- |
| `GET /api/gallery` | 租户级图库查询（参数同 IPC `query`） |
| `POST /api/gallery/:assetId/hide` | 隐藏（无远端删除） |
| `POST /api/gallery/:assetId/restore` | 恢复 |
| `POST /api/gallery/:assetId/waive` | 逐张下载豁免（body `{reason}`）；校验同 IPC，错误按 400/404/409 返回 |
| `GET /api/gallery/:assetId/download` | 同源流式下载代理（不重定向）；门禁失败返回 409；已留痕豁免的历史快照资产放行；`Content-Disposition` 走 RFC 5987 编码，`Cache-Control: private, no-store` |

约束：无 COS 删除接口；客户端不提供 URL；strict/locked 路线原图下载在
UI 与服务端双重阻断，且不提供豁免口子；仅 fail-closed 历史快照资产可
逐张人工豁免（理由留痕、只放行该资产，不修改路线快照与云端文件）
（见 `docs/dev/ERROR-CATALOG.md` 与 gallery 执行方案 §7.5）。

## 7. 前端调用层

- `src/api.ts`：每个通道对应一个类型化方法，错误统一转成带
  `code` 的 Error；
- 工作台边界（PR-16）：后端按阶段校验调用合法性，跨边界调用被拒绝；
- 错误码语义见 `docs/dev/ERROR-CATALOG.md`。

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次成文（0.2.1） |
| 1.2 | 2026-09-01 | 图库功能：新增 §6b 图库 IPC 与 Web 路由（galleryStore、下载门禁） |
| 1.3 | 2026-09-02 | 图库下载豁免：新增 `copilot:gallery:waive` / `POST /api/gallery/:assetId/waive`，fail-closed 历史资产逐张留痕放行 |


## 内嵌助手截图消息

`sendAssistantMessage(conversationId, input)` 与 `POST /api/assistant/conversations/:id/messages` 共用运行时。`input` 在原有 `mode/content/projectId/screenId` 上增加可选 `attachments: Array<{ name: string, dataUrl: string }>`；缺省与原文字消息兼容。只有用户可附图，纯截图使用默认提问文本。

- PNG/JPEG/WebP 的规范 base64 data URL；最多 4 张，每张 5MiB，合计 12MiB，最大边长 16384px、总像素 4000 万。后端验证真实格式、尺寸和可解码性，不接受远程 URL 或本地路径。
- 消息 POST 独立使用 17MiB 请求上限以容纳 base64，其余 JSON 接口仍为 2MiB；认证、Origin 校验及租户隔离沿用原路径。
- 有界附件随 `messages.jsonl` 持久化；消息可选字段兼容旧记录。截图随对话删除进入既有回收目录。
- 模型请求复用 `requestJson`，以 `image_url` / `detail: high` 发送真实像素，重试沿用图片。最近 24000 字符、摘要之后的消息优先携带最新最多 4 张且总计不超过 12MiB 的图片；文字 prompt 仅放名称和从 1 开始的图片索引，未附带旧图标为 null，摘要不包含像素。
- 图片内容视为不可信材料；写操作仍由原确认、CAS、动作白名单和幂等状态机约束。

### 助手草稿与恢复

- Renderer 统一发送 `mode: execute`，不显示模式切换；旧接口和历史记录仍兼容 `qa`。一般问答返回 `proposed_action: null`。
- “拒绝执行”复用 cancel 接口，在原有运行记录中原子保存 `status: cancelled` 与 `result.user_decision: rejected`。重复拒绝不改变结果，拒绝后确认不会执行。最近 10 条方案及其状态进入 `recent_actions` 上下文（每份草稿最多 2000 字符的去敏摘要），拒绝动作不会额外调用模型或伪造用户聊天消息。

- 消息可选 `currentStage`，只接受五个现有 UI 阶段；仅用于操作引导，不会运行阶段或批准产物。
- `requestAssistant` 的动作校验复用 `validateIntentReview`，字段错误进入既有最多三次 JSON 修正；服务端再次校验并补充风险、版本和可读目标。动作的 `review` 保存修改前文本对照（最多 8000 字，截断明确标识），完整拟写入内容来自 `args.draft`。
- 首次结构化草稿由 `saveIntentReview` 的显式 `initialize: true` 路径处理，必填 `expectedRequirementRevision`，与原 `expectedIntentReviewRevision` 一同在项目锁内检查。旧输入进入现有历史，保存后仍未确认。已有结构化调用的行为不变。
- 列表和打开结果可带 `message_error`：损坏消息隔离，原文件不删，暂停该对话发送和确认；有效运行记录仍可取消，然后使用既有回收机制删除对话。
- 面板重新打开时刷新，恢复中的 queued/running/executing 每 1.5 秒读取状态；请求串行，关闭面板停止刷新，失败后 5 秒重试。不自动重发消息或执行动作。
- 项目诊断和产物正文采用有界、去敏上下文。历史达到既有阈值后保留最近 12 条消息，归档摘录最多 8000 字，其中最初三条用户需求最多 2500 字、最近归档最多 5200 字；原始消息仍保留。图片仍受上述上下文窗口限制。
