export type ArtifactStatus = 'draft' | 'generated' | 'reviewed' | 'approved' | 'rejected' | 'stale';
export type ContinuationMode = 'exploration' | 'existing-strict' | 'existing-guided' | 'locked-continuation';

export type CanvasSpec = {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape' | 'square';
  aspect_ratio: string;
  generation_size: string;
};

export type ReferenceAsset = {
  id: string;
  path: string;
  name: string;
  role: 'primary' | 'component' | 'material' | 'composition' | 'supporting';
  order: number;
  preview?: string;
  metadata?: { mime: string; width: number; height: number; canvas_spec: CanvasSpec };
};

export type Artifact = {
  schema_version: string;
  id: string;
  version: number;
  status: ArtifactStatus;
  source: Record<string, unknown>;
  designer_summary?: string;
  [key: string]: unknown;
};

export type LayoutProposal = {
  id: string;
  name: string;
  strategy: string;
  designer_fit?: string;
  visual_hierarchy?: string[];
  regions?: Record<string, { label?: string; recommended_ratio?: number }>;
  interaction_flow?: string[];
  tradeoffs?: string[];
  rationale?: Array<{ change?: string; reason?: string; impact?: string }>;
};

export type VisualVariation = {
  id: string;
  strategy: string;
  image_url: string;
  provider_task_id: string;
  layout_version: string;
  style_version: string;
  created_at: string;
  status: string;
  storageMode?: 'provider_cdn';
  storageProvider?: 'kunpo';
  storageDurability?: 'provider_managed';
  remoteOnly?: boolean;
  layout_name?: string;
  style_name?: string;
  target_size?: string;
  output_width?: number;
  output_height?: number;
  canvas_spec?: CanvasSpec;
};

export type WorkflowState = {
  current_stage: string;
  stages: Record<string, { status: string; output?: string; updated_at?: string; progress?: { completed: number; total: number; message?: string } }>;
};

export type DesignProject = {
  id: string;
  name: string;
  project_type: ProjectType;
  continuation_mode: ContinuationMode;
  art_direction: string;
  requirement: string;
  requirement_source?: 'none' | 'user' | 'ai';
  requirement_confirmed?: boolean;
  intent_analysis?: { requirement_draft?: string; inferred_page_type?: string; inferred_rules?: string[]; uncertainties?: string[]; generated_at?: string };
  screen_id: string;
  workspacePath: string;
  wireframe_path?: string;
  wireframe_name?: string;
  wireframe_preview?: string;
  wireframe_metadata?: { mime: string; width: number; height: number; canvas_spec: CanvasSpec };
  canvas_spec?: CanvasSpec;
  reference_paths?: string[];
  reference_assets?: ReferenceAsset[];
  input_revisions?: Record<string, number>;
  status?: 'draft' | 'archived';
  artifactHistory?: Array<{ kind: string; id?: string; version?: number; status?: string; saved_at: string; snapshot: string }>;
  updated_at: string;
  workflow: WorkflowState;
  artifacts: {
    screenContract: Artifact | null;
    layouts: (Artifact & { proposals?: LayoutProposal[] }) | null;
    approvedLayout: Artifact | null;
    styleContract: Artifact | null;
    visualTask: Artifact | null;
    visualResults: Artifact & { variations?: VisualVariation[] };
  };
};

export type ProjectSummary = Pick<DesignProject, 'id' | 'name' | 'project_type' | 'updated_at' | 'status'> & { workspacePath: string };

export type CreateProjectInput = {
  name: string;
  projectType: ProjectType;
  artDirection: string;
  requirement: string;
  requirementSource?: 'none' | 'user' | 'ai';
  requirementConfirmed?: boolean;
  intentAnalysis?: Record<string, unknown>;
  continuationMode?: ContinuationMode;
};

export type AppConfig = {
  workspaceRoot: string;
  platform?: string;
  kunpo: {
    configured: boolean;
    mode: string;
    envSource: string;
    modelSource?: string;
    visionModel: string;
    imageModel: string;
  };
};
