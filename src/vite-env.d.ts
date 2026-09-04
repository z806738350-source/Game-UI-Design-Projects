/// <reference types="vite/client" />

type ProjectType = 'new' | 'existing';
type PipelineStage = 'wireframe_interpretation' | 'layout_design' | 'style_resolution' | 'visual_exploration';

interface DesignCopilotApi {
  getConfig(): Promise<AppConfig>;
  saveModelConfig(input: { assistantModel: string; visionModel: string; critiqueModel?: string; imageModel: string }): Promise<AppConfig>;
  listAssistantConversations(): Promise<AssistantConversationList>;
  createAssistantConversation(input: { projectId: string; screenId: string; title?: string }): Promise<AssistantConversation>;
  openAssistantConversation(conversationId: string): Promise<AssistantConversation>;
  renameAssistantConversation(conversationId: string, title: string): Promise<AssistantConversation>;
  deleteAssistantConversation(conversationId: string): Promise<{ deleted: true; conversation_id: string }>;
  sendAssistantMessage(conversationId: string, input: { mode: AssistantMode; content: string; projectId: string; screenId: string }): Promise<AssistantConversation>;
  confirmAssistantAction(conversationId: string, runId: string, actionId: string): Promise<AssistantConversation>;
  cancelAssistantAction(conversationId: string, runId: string, actionId: string): Promise<AssistantConversation>;
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: CreateProjectInput): Promise<DesignProject>;
  duplicateProject(projectId: string): Promise<DesignProject>;
  openProject(projectId: string, options?: { includePreviews?: boolean; screenId?: string }): Promise<DesignProject>;
  listScreens(projectId: string): Promise<{ active_screen_id: string; screens: ScreenEntry[] }>;
  createScreen(projectId: string, input: { id?: string; name: string }): Promise<ScreenEntry>;
  duplicateScreen(projectId: string, screenId: string, input?: { id?: string; name?: string }): Promise<ScreenEntry>;
  setActiveScreen(projectId: string, screenId: string): Promise<DesignProject>;
  updateScreen(projectId: string, screenId: string, patch: { name?: string; status?: 'archived' }): Promise<ScreenEntry>;
  saveProject(projectId: string, patch: Partial<CreateProjectInput>): Promise<DesignProject>;
  importFile(projectId: string, kind: 'wireframe' | 'reference', screenId: string): Promise<DesignProject>;
  manageReference(projectId: string, input: { id: string; action: 'remove' | 'move' | 'role' | 'details' | 'approval'; direction?: 'up' | 'down'; role?: string; approved?: boolean; screenType?: string; contains?: string[]; baseline?: string; notes?: string }): Promise<DesignProject>;
  importFontAsset(projectId: string, input: Record<string, unknown>): Promise<DesignProject>;
  confirmFontUsage(projectId: string, input: Record<string, unknown>): Promise<DesignProject>;
  loadFontBytes(projectId: string, fontId: string): Promise<ArrayBuffer | Uint8Array>;
  importComponentAsset(projectId: string, input: Record<string, unknown>): Promise<DesignProject>;
  importForgeManifest(projectId: string): Promise<DesignProject>;
  revealProject(projectId: string): Promise<{ ok: boolean }>;
  runStage(projectId: string, stage: PipelineStage, input?: Record<string, unknown>): Promise<DesignProject>;
  draftRequirement(projectId: string, screenId: string): Promise<DesignProject>;
  // v1.4 §11.1：structured-v2 Intent 同义接口；所有 mutation 必填 expected
  // revision，缺失/落后时服务端返回 INTENT_REVISION_CONFLICT。
  generateIntentCandidate(projectId: string, screenId: string): Promise<DesignProject>;
  saveIntentReview(projectId: string, input: { screenId: string; expectedIntentReviewRevision: number; draft: IntentReview }): Promise<DesignProject>;
  confirmIntentReview(projectId: string, input: { screenId: string; expectedIntentReviewRevision: number }): Promise<DesignProject>;
  adoptIntentCandidate(projectId: string, input: { screenId: string; candidateId: string; expectedIntentReviewRevision: number }): Promise<DesignProject>;
  discardIntentCandidate(projectId: string, input: { screenId: string; candidateId: string }): Promise<DesignProject>;
  getIntentCandidate(projectId: string, screenId: string): Promise<IntentCandidate | null>;
  listIntentHistory(projectId: string, screenId: string): Promise<IntentHistoryEntry[]>;
  restoreIntentHistory(projectId: string, screenId: string, input: { historyId: string; expectedIntentReviewRevision: number }): Promise<DesignProject>;
  deleteIntentHistory(projectId: string, screenId: string, input: { historyId: string }): Promise<DesignProject>;
  cancelStage(projectId: string, stage: PipelineStage, screenId: string): Promise<DesignProject>;
  approveArtifact(projectId: string, kind: 'reference-inventory' | 'screen-contract' | 'component-bindings' | 'approved-layout' | 'underlay-contract' | 'composition-manifest' | 'style-contract' | 'font-manifest' | 'component-contract' | 'visual-results', input?: Record<string, unknown>): Promise<DesignProject>;
  repairRouteCycle(projectId: string, input: { screenId: string }): Promise<DesignProject>;
  updateArtifact(projectId: string, kind: 'screen-contract' | 'component-bindings' | 'underlay-contract' | 'style-contract' | 'font-manifest' | 'component-contract' | 'visual-results', patch: Record<string, unknown>): Promise<DesignProject>;
  generateUnderlayContract(projectId: string, screenId: string): Promise<DesignProject>;
  generateLayoutGuide(projectId: string, screenId: string): Promise<DesignProject>;
  runUnderlayCritique(projectId: string, input: Record<string, unknown>): Promise<DesignProject>;
  repairUnderlay(projectId: string, input: Record<string, unknown>): Promise<DesignProject>;
  approveUnderlayWaiver(projectId: string, input: { issueId: string; reason: string; screenId: string }): Promise<DesignProject>;
  approveUnderlayManualReview(projectId: string, input: { conclusion: string; reason: string; screenId: string }): Promise<DesignProject>;
  composeVisual(projectId: string, input: { variationId?: string; mode: 'preview' | 'final'; screenId: string }): Promise<DesignProject>;
  runFidelity(projectId: string, screenId: string): Promise<DesignProject>;
  exportVisual(projectId: string, variationId: string): Promise<{ ok: boolean; filePath?: string }>;
  openUserGuide(): Promise<{ ok: boolean }>;
  // 图库（v1.1 §7.2/§7.4）：Renderer 只传 assetId，永不传 URL；
  // 下载门禁由服务端按登记时 continuation_mode 快照判定。
  listGallery(query: GalleryQuery): Promise<GalleryListResult>;
  hideGalleryAsset(assetId: string): Promise<GalleryAsset>;
  restoreGalleryAsset(assetId: string): Promise<GalleryAsset>;
  waiveGalleryDownload(assetId: string, reason: string): Promise<GalleryAsset>;
  downloadGalleryAsset(assetId: string): Promise<GalleryDownloadResult>;
  logout?(): Promise<{ ok: boolean }>;
}

interface Window {
  designCopilot?: DesignCopilotApi;
}
