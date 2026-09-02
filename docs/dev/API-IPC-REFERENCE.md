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
