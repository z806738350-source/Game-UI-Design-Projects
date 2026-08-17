/// <reference types="vite/client" />

type ProjectType = 'new' | 'existing';
type PipelineStage = 'wireframe_interpretation' | 'layout_design' | 'style_resolution' | 'visual_exploration';

interface DesignCopilotApi {
  getConfig(): Promise<AppConfig>;
  saveModelConfig(input: { visionModel: string; imageModel: string }): Promise<AppConfig>;
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: CreateProjectInput): Promise<DesignProject>;
  duplicateProject(projectId: string): Promise<DesignProject>;
  openProject(projectId: string, options?: { includePreviews?: boolean }): Promise<DesignProject>;
  listScreens(projectId: string): Promise<{ active_screen_id: string; screens: ScreenEntry[] }>;
  createScreen(projectId: string, input: { id?: string; name: string }): Promise<ScreenEntry>;
  setActiveScreen(projectId: string, screenId: string): Promise<DesignProject>;
  updateScreen(projectId: string, screenId: string, patch: { name?: string; status?: 'archived' }): Promise<ScreenEntry>;
  saveProject(projectId: string, patch: Partial<CreateProjectInput>): Promise<DesignProject>;
  importFile(projectId: string, kind: 'wireframe' | 'reference'): Promise<DesignProject>;
  manageReference(projectId: string, input: { id: string; action: 'remove' | 'move' | 'role'; direction?: 'up' | 'down'; role?: string }): Promise<DesignProject>;
  importFontAsset(projectId: string, input: Record<string, unknown>): Promise<DesignProject>;
  importComponentAsset(projectId: string, input: Record<string, unknown>): Promise<DesignProject>;
  revealProject(projectId: string): Promise<{ ok: boolean }>;
  runStage(projectId: string, stage: PipelineStage, input?: Record<string, unknown>): Promise<DesignProject>;
  draftRequirement(projectId: string): Promise<DesignProject>;
  cancelStage(projectId: string, stage: PipelineStage): Promise<DesignProject>;
  approveArtifact(projectId: string, kind: 'screen-contract' | 'approved-layout' | 'style-contract' | 'font-manifest' | 'component-contract' | 'visual-results', input?: Record<string, unknown>): Promise<DesignProject>;
  updateArtifact(projectId: string, kind: 'screen-contract' | 'style-contract' | 'font-manifest' | 'component-contract' | 'visual-results', patch: Record<string, unknown>): Promise<DesignProject>;
  exportVisual(projectId: string, variationId: string): Promise<{ ok: boolean; filePath?: string }>;
  logout?(): Promise<{ ok: boolean }>;
}

interface Window {
  designCopilot?: DesignCopilotApi;
}
