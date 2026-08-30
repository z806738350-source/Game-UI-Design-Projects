# ERROR-CATALOG（错误码目录）

本目录是全部公开错误码的唯一事实文档。它与 `electron/services/errorCodes.cjs`
由 `scripts/check-error-docs.cjs` 双向校验：代码中新增/删除错误码必须同步更新本文档，
反之亦然。

错误码分三组：

- **管线错误码（`ERROR_CODES`）**：由后端以 `Error.code` 抛出，或被 IPC/导出门禁引用，
  共 54 个。
- **Fidelity 检查码（`FIDELITY_ISSUE_CODES`）**：写入 Fidelity Report `issues[].code`
  或 Underlay Critique 门禁的结构化检查码，共 27 个。
- **Binding 校验码（`BINDING_VALIDATION_CODES`）**：`validateBindings` 返回的
  结构化错误/警告前缀码，作为 `BINDING_COVERAGE_INCOMPLETE` 的明细出现，共 10 个。

三个重叠码 `COMPONENT_ASSET_HASH_MISMATCH`、`FONT_ASSET_HASH_MISMATCH`、
`COMPOSITION_OUTPUT_UNREADABLE` 既是管线错误码，也被像素检查器作为 issue code 使用；
它们只定义在 `ERROR_CODES` 中，检查器直接引用 `ERROR_CODES.*`。

## 一、管线错误码（ERROR_CODES，68 个）

### Screen 上下文

| 错误码 | 抛出模块 | 触发条件 | 恢复动作 |
| --- | --- | --- | --- |
| `SCREEN_ID_REQUIRED` | `electron/services/designPipeline.cjs` | Screen 作用域操作未传 `screenId` | 前端先激活 Screen 再调用 |
| `SCREEN_NOT_FOUND` | `electron/services/designPipeline.cjs` | Screen 不存在或已归档 | 检查 Screen 列表，切换到有效 Screen |
| `SCREEN_CONTEXT_MISMATCH` | `electron/services/designPipeline.cjs` | 活跃 Screen 与请求 Screen 不一致 | 先 `setActiveScreen` 再执行管线 |

### Clone 事务完整性（M4-K2）

| 错误码 | 抛出模块 | 触发条件 | 恢复动作 |
| --- | --- | --- | --- |
| `CLONE_ROLLBACK_INCOMPLETE` | `electron/services/projectStore.cjs` / `electron/services/designPipeline.cjs` | Clone 主操作失败后回滚自身也失败（目录/备份无法还原），或检测到「Registry 有条目但 Workflow 无对应 stage」的 Clone 不一致状态（Fail-Closed，不自动修复） | 按错误携带的事务信息与 `workflow/transactions/clone-*` 备份执行手工恢复：还原 `screens/index.json` 与 `workflow/state.json` 备份、删除残留目标 Screen 目录；不做启动期自动恢复 |

### 布局与绑定门禁

| 错误码 | 抛出模块 | 触发条件 | 恢复动作 |
| --- | --- | --- | --- |
| `FONT_MANIFEST_REQUIRED` | `electron/services/designPipeline.cjs` | strict 布局要求 Font Manifest 已批准 | 先完成字体导入与确认并批准 |
| `COMPONENT_CONTRACT_REQUIRED` | `electron/services/designPipeline.cjs` | strict 布局要求 Component Contract 已批准 | 先导入组件资产并批准 |
| `BINDING_COVERAGE_INCOMPLETE` | `electron/services/designPipeline.cjs` | 绑定未覆盖全部必要控件或语义校验失败 | 按 `BINDING_*` 错误提示补全显式选择 |
| `LAYOUT_CONSTRAINT_VIOLATION` | `electron/services/designPipeline.cjs` | `validateLayout` 报出 slot/缩放/9-slice 违规；组件绑定门禁仅限严格继承路线 | 修正布局 slot 或组件缩放策略 |
| `STYLE_CONTRACT_INVALID` | `electron/services/designPipeline.cjs` | 批准时 Style Contract 校验未通过 | 重新生成或编辑 Style Contract |
| `UNDERLAY_SPEC_REQUIRED` | `electron/services/designPipeline.cjs` | strict 视觉生成缺少已批准 Underlay Contract 或 Layout Guide | 先生成并批准 Underlay Contract、生成 Layout Guide |

### 批准新鲜度与路线修复

| 错误码 | 抛出模块 | 触发条件 | 恢复动作 |
| --- | --- | --- | --- |
| `STALE_REAPPROVAL_BLOCKED` | `electron/services/designPipeline.cjs` | 批准已因上游变化失效（stale）的 Artifact、风格基线已变化，或批准布局时提案已失效 | 重新生成对应阶段（或重批允许确定性重验的字体/组件/绑定）后再批准 |
| `SCREEN_CONTRACT_APPROVAL_INVALID` | `electron/services/designPipeline.cjs` | 批准 Screen Contract 时批准即重验（归一化/契约校验）未通过 | 按校验信息修正 Screen Contract 内容后重新批准 |
| `SCREEN_CONTRACT_COVERAGE_INCOMPLETE` | `electron/services/designPipeline.cjs` | 历史码（AUD-06 时期）：批准 Screen Contract 时重算 coverage 存在未覆盖项即抛出；设计师权威语义后覆盖差异不再拦截批准，不再新抛 | 无需恢复；保留以兼容历史执行日志 |
| `ROUTE_CYCLE_REPAIR_INELIGIBLE` | `electron/services/flowStateRepair.cjs` | 项目不满足旧版风格循环一次性修复的识别条件（strict 路线、失效原因不符、输入变化、校验失败等） | 按 stale 原因指引重新生成对应阶段 |

### 参考与输入

| 错误码 | 抛出模块 | 触发条件 | 恢复动作 |
| --- | --- | --- | --- |
| `REFERENCE_OMISSIONS_CONFIRMATION_REQUIRED` | `electron/services/designPipeline.cjs` | 参考图超过服务容量，存在被省略项 | 风格阶段在 Reference Workbench 确认；视觉阶段在视觉探索页核对省略清单（确认绑定当前 Pack hash）后点击“确认省略项并生成” |
| `REFERENCE_INVENTORY_EMPTY` | `electron/services/designPipeline.cjs` | 批准 Reference Inventory 时无任何已批准图片 | 至少批准一张参考图 |
| `REFERENCE_CAPACITY_EXCEEDED` | `electron/services/kunpoClient.cjs` | 参考图数量超过 provider 上限 | 精简参考图或构建显式 reference pack |

### 字体门禁

| 错误码 | 抛出模块 | 触发条件 | 恢复动作 |
| --- | --- | --- | --- |
| `FONT_LICENSE_CONFIRMATION_REQUIRED` | `electron/services/typographyAssets.cjs` | 确认字体用途时未勾选授权确认 | 勾选"确认有权使用"后重试 |
| `FONT_EXACT_CONFIRMATION_REQUIRED` | `electron/services/typographyAssets.cjs` | 确认字体用途时未勾选精确使用确认 | 勾选"必须精确使用此字体"后重试 |
| `FONT_CONFIRMATION_ACTION_REQUIRED` | `electron/services/designPipeline.cjs` | 通过 `updateArtifact` 直接改 `fonts`/`roles` | 使用专用导入与确认动作 |
| `FONT_ASSET_HASH_MISMATCH` | `electron/services/typographyRenderer.cjs`、`electron/main.cjs`、`electron/services/fidelityInspector.cjs` | 字体文件哈希与 Manifest 记录不一致 | 重新导入字体文件 |
| `FONT_ACTUAL_LOAD_FAILED` | `electron/services/typographyRenderer.cjs` | 渲染时实际加载字体文件失败 | 检查 `style/fonts/` 下字体文件是否完整 |

### 组件与合成门禁

| 错误码 | 抛出模块 | 触发条件 | 恢复动作 |
| --- | --- | --- | --- |
| `COMPONENT_ASSET_HASH_MISMATCH` | `electron/services/compositionRenderer.cjs`、`electron/services/fidelityInspector.cjs` | 组件资产哈希与契约/Manifest 记录不一致 | 重新导入组件资产 |
| `COMPONENT_RENDERER_MISSING` | `electron/services/compositionRenderer.cjs` | 图层 `renderer` 不在渲染注册表 | 检查 Component Contract `reuse_mode` |
| `VECTOR_TOKEN_SOURCE_REQUIRED` | `electron/services/compositionRenderer.cjs` | vector-token 组件缺少来源声明 | 为组件补充 vector token 来源 |
| `EXACT_NON_UNIFORM_SCALE` | `electron/services/compositionRenderer.cjs` | exact 组件被非等比缩放 | 调整 slot 尺寸保持等比 |
| `EXACT_SCALE_OUT_OF_POLICY` | `electron/services/compositionRenderer.cjs` | exact 组件缩放超出 `scale_policy` 范围 | 调整 slot 或组件缩放策略 |
| `COMPOSITION_GATE_FAILED` | `electron/services/compositor.cjs` | 合成前置门禁（critique/binding/layout/font）未通过 | 按 `missing_requirements` 列表逐项修复 |
| `VISUAL_VARIATION_NOT_FOUND` | `electron/services/designPipeline.cjs` | 合成时未指定或指定了不存在的视觉方向（不再静默回退第一张） | 在视觉探索页选择一个有效方向后再合成 |
| `UNDERLAY_EVIDENCE_MISMATCH` | `electron/services/designPipeline.cjs` | strict 合成时 Critique 审查对象与待合成底图不一致，或记录的像素 hash / Visual Results 版本已与当前证据漂移 | 先对选中的底图执行污染审查 |
| `UNDERLAY_EVIDENCE_STALE` | `electron/services/designPipeline.cjs` | strict 合成时 Critique 已因上游变化失效（stale），不得凭旧 passed 结论放行 | 重新审查当前底图后再合成 |
| `VISUAL_RESULTS_BINDING_STALE` | `electron/services/designPipeline.cjs`、`electron/services/compositionRenderer.cjs` | 最终批准/导出时 Manifest 已不对应当前 Visual Results 评审 | 重新合成最终 PNG 并重走保真与批准 |

### Composition Output 与导出

| 错误码 | 抛出模块 | 触发条件 | 恢复动作 |
| --- | --- | --- | --- |
| `COMPOSITION_OUTPUT_MISSING` | `electron/services/compositionRenderer.cjs` | 需要 Composition Output 但尚未生成 | 先运行合成 |
| `COMPOSITION_OUTPUT_UNREADABLE` | `electron/services/compositionRenderer.cjs`、`electron/services/fidelityInspector.cjs` | PNG 无法解码或读取失败 | 重新合成 |
| `COMPOSITION_OUTPUT_INVALID` | `electron/services/designPipeline.cjs` | 批准 final Manifest 时输出校验或引用不一致 | 重新合成并运行 Fidelity |
| `COMPOSITION_OUTPUT_HASH_MISMATCH` | `electron/services/compositionRenderer.cjs` | PNG 文件哈希与 artifact 记录不一致 | 重新合成（文件被外部改动） |
| `COMPOSITION_OUTPUT_DIMENSION_MISMATCH` | `electron/services/compositionRenderer.cjs` | PNG 实际尺寸与 artifact 记录不一致 | 重新合成 |
| `FINAL_OUTPUT_REQUIRED` | `electron/services/compositionRenderer.cjs` | final 校验时只有 preview 输出 | 先以 final 模式合成 |
| `FINAL_APPROVAL_REQUIRED` | `electron/services/compositionRenderer.cjs`、`electron/main.cjs` | strict 导出时合成清单未完成最终批准 | 先在 STRICT PRODUCTION 面板执行最终批准 |
| `FINAL_EXPORT_BLOCKED` | `electron/services/compositionRenderer.cjs`、`electron/main.cjs` | strict 导出时 final 输出校验未通过 | 按校验 issues 修复后重新合成 |
| `FINAL_EXPORT_HASH_MISMATCH` | `electron/services/compositionRenderer.cjs` | 导出文件哈希与记录不一致 | 重新合成并导出 |
| `GENERATED_EVIDENCE_READ_ONLY` | `electron/services/designPipeline.cjs` | 尝试编辑 `composition-manifest`/`fidelity-report` | 生成类证据只能由管线重写 |

### Fidelity 门禁

| 错误码 | 抛出模块 | 触发条件 | 恢复动作 |
| --- | --- | --- | --- |
| `FIDELITY_GATE_FAILED` | `electron/services/designPipeline.cjs` | final 批准门禁存在 blocker/critical 未豁免 | 修复 Fidelity issues 后重跑 |
| `FIDELITY_OUTPUT_STALE` | `electron/services/designPipeline.cjs` | Fidelity Report 引用的不是当前 Composition Output | 重跑 Fidelity |
| `FIDELITY_EVIDENCE_STALE` | `electron/services/fidelity.cjs` | 批准时像素证据摘要与报告不一致 | 重跑 Fidelity（文件已变化） |
| `FIDELITY_CURRENT_EVIDENCE_FAILED` | `electron/services/designPipeline.cjs` | 批准时实时像素检查失败 | 按 issues 修复资产/输出 |

### Underlay 修复与人工复核

| 错误码 | 抛出模块 | 触发条件 | 恢复动作 |
| --- | --- | --- | --- |
| `UNDERLAY_REPAIR_LIMIT` | `electron/services/underlayRepair.cjs` | 自动修复次数达到上限 | 转入人工评审（写入 blocked repair task） |
| `UNDERLAY_MANUAL_REVIEW_NOT_REQUIRED` | `electron/services/designPipeline.cjs` | 对未要求人工复核（或已完成人工复核）的 Critique 调用 `approveUnderlayManualReview` | 仅在 Critique 要求人工复核时使用该动作；其他阻断走修复复审或 issue 豁免 |
| `INPAINT_NOT_AVAILABLE` | `electron/services/underlayRepair.cjs` | 服务不支持 inpaint 修复模式 | 改用重生成模式或升级服务能力 |
| `REPAIR_OUTPUT_MISSING` | `electron/services/underlayRepair.cjs` | 修复任务没有返回图片结果 | 重试修复或检查 provider |
| `REPAIR_EVIDENCE_INCOMPLETE` | `electron/services/underlayRepair.cjs` | 修复所需证据（overlay/mask 等）缺失 | 重跑 critique 后再修复 |

### Provider 临时图像

| 错误码 | 抛出模块 | 触发条件 | 恢复动作 |
| --- | --- | --- | --- |
| `TRANSIENT_IMAGE_UNSUPPORTED` | `electron/services/kunpoClient.cjs` | provider 返回不支持的图像格式 | 更换模型或开启快照模式 |
| `TRANSIENT_IMAGE_SIZE_INVALID` | `electron/services/kunpoClient.cjs` | 返回图像尺寸非法 | 重试生成 |
| `TRANSIENT_IMAGE_RATIO_MISMATCH` | `electron/services/kunpoClient.cjs` | 返回图像宽高比与画布规格不符 | 检查 canvas_spec 与模型能力 |
| `TRANSIENT_IMAGE_DECODE_FAILED` | `electron/services/kunpoClient.cjs` | 返回图像无法解码 | 重试生成 |
| `TRANSIENT_IMAGE_DOWNLOAD_FAILED` | `electron/services/kunpoClient.cjs` | 下载 provider 图像失败 | 检查网络与 gateway |
| `UNTRUSTED_IMAGE_LOCATION` | `electron/services/kunpoClient.cjs` | provider 返回不可信图像地址（未拉取未落盘） | 重试生成；持续出现则检查 provider 返回格式 |

### Intent 预填 v2

| 错误码 | 抛出模块 | 触发条件 | 恢复动作 |
| --- | --- | --- | --- |
| `INTENT_ANALYSIS_INVALID` | `electron/services/intentStateStore.cjs` | 模型返回经纠正后仍不符合 Intent Analysis v2 合同 | 重新发起预填或手工填写 |
| `INTENT_ANALYSIS_STALE` | `electron/services/intentStateStore.cjs` | 提交结果时 UE/Project Type 已变化 | 基于当前输入重新预填 |
| `INTENT_REVIEW_INCOMPLETE` | `electron/services/intentStateStore.cjs` | 确认门禁未通过（blocking 未处理、内容为空等） | 处理待确认项后再确认 |
| `INTENT_CANDIDATE_STALE` | `electron/services/intentStateStore.cjs` | candidate 基线 revision 与当前不匹配 | 丢弃 candidate 后重新预填 |
| `INTENT_CANDIDATE_REPLACEMENT_REQUIRED` | `electron/services/intentStateStore.cjs` | 已有 ready candidate 时再次发起生成 | 先采用或丢弃现有 candidate |
| `INTENT_HISTORY_VERSION_NOT_FOUND` | `electron/services/intentStateStore.cjs` | 历史 ID 不存在或不属当前 Screen | 刷新历史列表 |
| `INTENT_REQUEST_SUPERSEDED` | `electron/services/intentStateStore.cjs` | 旧 AI 响应晚于新请求到达 | 无需处理，以新请求为准 |
| `INTENT_GENERATION_INTERRUPTED` | `electron/services/intentStateStore.cjs` | 旧进程留下的 running 任务被重启中断 | 重新发起预填 |
| `INTENT_REVISION_CONFLICT` | `electron/services/intentStateStore.cjs` | 保存/确认/恢复时 expected revision CAS 冲突 | 刷新后基于最新版本重试 |
| `INTENT_HISTORY_LIMIT_REACHED` | `electron/services/intentStateStore.cjs` | 历史达到 100 条或 64 MiB 上限 | 删除或导出旧历史后重试 |

### 迁移

| 错误码 | 抛出模块 | 触发条件 | 恢复动作 |
| --- | --- | --- | --- |
| `MIGRATION_FAULT_INJECTED` | `electron/services/migrations.cjs` | 测试用故障注入点触发 | 仅测试使用；检查 fault 配置 |

## 二、Fidelity 检查码（FIDELITY_ISSUE_CODES，27 个）

这些码出现在 `fidelity-report.json` 的 `issues[].code`（由 `fidelity.cjs` 与
`fidelityInspector.cjs` 写入）。severity 为 `blocker`/`critical`/`major` 的 issue
会阻断 final 批准与导出。

### 控件覆盖与 Underlay 门禁

| 检查码 | 写入模块 | severity | 含义 |
| --- | --- | --- | --- |
| `MISSING_RENDERED_CONTROL` | `electron/services/fidelity.cjs` | blocker | 绑定中的控件未出现在合成图层 |
| `UNDERLAY_REVIEW_FAILED` | `electron/services/fidelity.cjs` | blocker/critical | Underlay Critique 门禁存在未豁免阻断项 |
| `TYPOGRAPHY_GATE_FAILED` | `electron/services/fidelity.cjs` | critical | Font Manifest 校验失败（授权/exact/覆盖） |

### 字体渲染证据

| 检查码 | 写入模块 | severity | 含义 |
| --- | --- | --- | --- |
| `UNRESOLVED_IDENTITY_FONT` | `electron/services/fidelity.cjs` | critical | 文字图层 `fidelity_mode` 为 unresolved |
| `FONT_RENDER_NOT_VERIFIED` | `electron/services/fidelity.cjs` | critical | exact 文字未经过已验证字体文件渲染 |
| `FONT_RENDER_HASH_MISMATCH` | `electron/services/fidelity.cjs` | critical | 渲染日志字体哈希与图层声明不一致 |
| `FONT_RENDER_FAMILY_MISMATCH` | `electron/services/fidelity.cjs` | critical | 实际加载字族与声明不一致 |
| `FONT_IDENTITY_MISMATCH` | `electron/services/fidelityInspector.cjs` | blocker | 字体文件当前 family/postscript 与 Manifest 不一致 |
| `FONT_ASSET_UNREADABLE` | `electron/services/fidelityInspector.cjs` | blocker | 字体文件无法解析 |

### 资产一致性

| 检查码 | 写入模块 | severity | 含义 |
| --- | --- | --- | --- |
| `COMPONENT_ASSET_UNIDENTIFIED` | `electron/services/fidelity.cjs` | critical | 组件图层缺少合法 sha256 哈希 |
| `COMPONENT_ASSET_UNREADABLE` | `electron/services/fidelityInspector.cjs` | blocker | 组件资产文件缺失或不可读 |

### 输出与依赖一致性

| 检查码 | 写入模块 | severity | 含义 |
| --- | --- | --- | --- |
| `COMPOSITION_OUTPUT_MISSING` | `electron/services/fidelity.cjs` | blocker | Composition Output 缺失 |
| `COMPOSITION_OUTPUT_REFERENCE_MISMATCH` | `electron/services/fidelity.cjs` | blocker | Manifest 未引用当前 Output |
| `COMPOSITION_OUTPUT_MODE_MISMATCH` | `electron/services/fidelity.cjs` | blocker | Manifest 与 Output 的 mode 不一致 |
| `STALE_DEPENDENCY` | `electron/services/fidelity.cjs` | blocker | 上游依赖 artifact stale 或缺失 |
| `OUTPUT_SOURCE_MISMATCH` | `electron/services/fidelityInspector.cjs` | blocker | 输出 source 引用与当前 Manifest 不一致 |
| `OUTPUT_VERSION_MISMATCH` | `electron/services/fidelityInspector.cjs` | blocker | 输出版本与 Manifest 引用版本不一致 |

### 像素级检查

`fidelityInspector.cjs` 的检查器对所有 inspector issue 固定写入
`severity: 'blocker'`，因此下表 severity 全部为 blocker。

| 检查码 | 写入模块 | severity | 含义 |
| --- | --- | --- | --- |
| `COMPONENT_OVERLAP` | `electron/services/fidelityInspector.cjs` | blocker | 组件图层互相重叠 |
| `FINAL_ALPHA_MISSING` | `electron/services/fidelityInspector.cjs` | blocker | final 输出缺少 alpha 通道 |
| `FINAL_CANVAS_MISMATCH` | `electron/services/fidelityInspector.cjs` | blocker | 输出尺寸与画布规格不一致 |
| `FINAL_PIXELS_EMPTY` | `electron/services/fidelityInspector.cjs` | blocker | 输出像素为空/纯色 |
| `LAYER_OUT_OF_BOUNDS` | `electron/services/fidelityInspector.cjs` | blocker | 渲染 bbox 超出 slot 或画布 |
| `RENDERED_BBOX_MISMATCH` | `electron/services/fidelityInspector.cjs` | blocker | 渲染 bbox 与声明 rect 偏差超阈值 |
| `NINE_SLICE_FIXED_REGIONS_MISSING` | `electron/services/fidelityInspector.cjs` | blocker | 9-slice 固定区域检查缺少输入 |
| `NINE_SLICE_FIXED_REGION_DEFORMED` | `electron/services/fidelityInspector.cjs` | blocker | 9-slice 固定角区被变形渲染 |
| `SAFE_AREA_VIOLATION` | `electron/services/fidelityInspector.cjs` | blocker | 图层侵入安全区约束 |
| `TEXT_OVERFLOW` | `electron/services/fidelityInspector.cjs` | blocker | 文字渲染触及 slot 边界外 |

## 三、绑定语义校验码（BINDING_VALIDATION_CODES，10 个）

`electron/services/errorCodes.cjs` 冻结导出 `BINDING_VALIDATION_CODES` 注册表，
`componentBindings.cjs` 与 `compositor.cjs` 一律从该注册表引用，不允许字面量。
这些码以结构化错误/警告字符串前缀出现（如
`BINDING_COMPONENT_NOT_SELECTED: control …`），作为
`BINDING_COVERAGE_INCOMPLETE` 的明细出现在批准错误消息中；strict 合成器缺
font_role 时也以 `Error.code` 直接抛出 `BINDING_FONT_ROLE_REQUIRED`。完整语义见
[COMPONENT-BINDINGS 契约](../contracts/COMPONENT-BINDINGS.md)。

| 校验码 | 抛出/产生模块 | 触发条件 | 恢复动作 |
| --- | --- | --- | --- |
| `BINDING_COMPONENT_NOT_SELECTED` | `electron/services/componentBindings.cjs` | binding 未选择 component_id | 在 Binding 工作台选择组件 |
| `BINDING_COMPONENT_NOT_APPROVED` | `electron/services/componentBindings.cjs` | 所选 family 未批准 | 先批准 Component Contract |
| `BINDING_STATE_REQUIRED` | `electron/services/componentBindings.cjs` | binding 未显式选择 state（无隐式 `default` 回退） | 在 Binding 工作台选择状态 |
| `BINDING_COMPONENT_STATE_MISSING` | `electron/services/componentBindings.cjs` | state 不在 family `states` 中，或 family 缺少角色 required_states | 选择存在的状态或补齐组件状态资产 |
| `BINDING_FONT_ROLE_REQUIRED` | `electron/services/componentBindings.cjs`、`electron/services/compositor.cjs` | text-slot family 的 binding 未选择 font_role（strict 合成器直接抛错） | 在 Binding 工作台选择字体角色 |
| `BINDING_COMPONENT_CATEGORY_MISMATCH` | `electron/services/componentBindings.cjs` | family.category 与控件角色不兼容 | 更换兼容组件或修正控件角色 |
| `BINDING_FONT_ROLE_MISMATCH` | `electron/services/componentBindings.cjs` | font_role 不在角色策略允许列表 | 选择策略允许的字体角色 |
| `BINDING_FONT_ROLE_MISSING` | `electron/services/componentBindings.cjs` | font_role 不在 Font Manifest `roles` 中 | 先在字体工作台确认该角色 |
| `BINDING_UNKNOWN_CONTROL_ROLE` | `electron/services/componentBindings.cjs` | 控件角色不在冻结策略词表（strict 报错 / guided warning） | 在功能契约中改为具体角色 |
| `BINDING_GENERIC_ROLE_UNRESOLVED` | `electron/services/componentBindings.cjs` | 控件仍为 legacy `action` 角色（strict 报错 / guided warning） | 在功能契约中解析为具体角色后重新批准 |

## 四、校验机制

- `electron/services/errorCodes.cjs` 冻结导出 `ERROR_CODES`、
  `FIDELITY_ISSUE_CODES` 与 `BINDING_VALIDATION_CODES`；各服务一律从该模块
  引用，不允许字面量。
- `scripts/check-error-docs.cjs` 双向校验：
  1. `errorCodes.cjs` 中的每个 `ERROR_CODES` / `FIDELITY_ISSUE_CODES` 键必须在本文档对应表格中出现；
  2. 本文档表格中的每个码必须存在于 `errorCodes.cjs`；`BINDING_*` 码当前
     在两个方向均豁免比对（豁免移除后纳入全量双向校验）。
- CI `docs-validate` job 运行 `pnpm test:docs`（包含本校验）。

## 版本与变更记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.0 | 2026-08-19 | PR-18 首次建立错误码事实目录（0.2.1） |
| 1.1 | 2026-08-19 | F-01：新增 `BINDING_VALIDATION_CODES`（10 个）完整表格；`BINDING_FONT_ROLE_REQUIRED` 标注 strict 合成器抛错路径 |
| 1.2 | 2026-08-30 | PR-I1：新增 Intent 预填 v2 错误码（10 个）；`ERROR_CODES` 总数 58 → 68 |
