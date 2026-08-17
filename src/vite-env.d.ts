/// <reference types="vite/client" />

type ProjectType = 'new' | 'existing';
type PipelineStage = 'wireframe_interpretation' | 'layout_design' | 'style_resolution' | 'visual_exploration';

interface DesignCopilotApi {
  getConfig(): Promise<AppConfig>;
  saveModelConfig(input: { visionModel: string; critiqueModel?: string; imageModel: string }): Promise<AppConfig>;
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: CreateProjectInput): Promise<DesignProject>;
  duplicateProject(projectId: string): Promise<DesignProject>;
  openProject(projectId: string, options?: { includePreviews?: boolean }): Promise<DesignProject>;
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
  cancelStage(projectId: string, stage: PipelineStage, screenId: string): Promise<DesignProject>;
  approveArtifact(projectId: string, kind: 'reference-inventory' | 'screen-contract' | 'component-bindings' | 'approved-layout' | 'underlay-contract' | 'composition-manifest' | 'style-contract' | 'font-manifest' | 'component-contract' | 'visual-results', input?: Record<string, unknown>): Promise<DesignProject>;
  updateArtifact(projectId: string, kind: 'screen-contract' | 'component-bindings' | 'underlay-contract' | 'style-contract' | 'font-manifest' | 'component-contract' | 'visual-results', patch: Record<string, unknown>): Promise<DesignProject>;
  generateUnderlayContract(projectId: string, screenId: string): Promise<DesignProject>;
  generateLayoutGuide(projectId: string, screenId: string): Promise<DesignProject>;
  runUnderlayCritique(projectId: string, input: Record<string, unknown>): Promise<DesignProject>;
  repairUnderlay(projectId: string, input: Record<string, unknown>): Promise<DesignProject>;
  approveUnderlayWaiver(projectId: string, input: { issueId: string; reason: string }): Promise<DesignProject>;
  composeVisual(projectId: string, input: { variationId?: string; mode: 'preview' | 'final' }): Promise<DesignProject>;
  runFidelity(projectId: string, screenId: string): Promise<DesignProject>;
  exportVisual(projectId: string, variationId: string): Promise<{ ok: boolean; filePath?: string }>;
  logout?(): Promise<{ ok: boolean }>;
}

interface Window {
  designCopilot?: DesignCopilotApi;
}
