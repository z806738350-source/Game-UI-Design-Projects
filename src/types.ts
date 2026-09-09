export type ArtifactStatus = 'draft' | 'generated' | 'reviewed' | 'approved' | 'rejected' | 'stale' | 'passed';
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
  approved?: boolean;
  screen_type?: string;
  contains?: string[];
  baseline?: string;
  notes?: string;
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
  stale_at?: string;
  stale_reason?: string;
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
  global_stages?: Record<string, { status: string; output?: string; updated_at?: string }>;
  screen_stages?: Record<string, Record<string, { status: string; output?: string; updated_at?: string }>>;
};

export type ScreenEntry = {
  id: string; name: string; status: 'active' | 'archived'; input_mode?: 'own' | 'inherited';
  inherited_from_screen_id?: string; duplicated_from_screen_id?: string; created_at: string; updated_at: string;
};

export type ScreenControl = { id: string; label: string; role: string; required: boolean; migrated_from_label?: string };

// v1.4 structured-v2 Intent 状态（六段评审、候选、历史与生成态）。
export type IntentMode = 'legacy' | 'structured-v2';

export type IntentReview = {
  page_purpose?: Record<string, unknown>;
  player_tasks?: Array<Record<string, unknown>>;
  core_flow?: Array<Record<string, unknown>>;
  visible_controls?: Array<Record<string, unknown>>;
  visible_information_and_states?: Array<Record<string, unknown>>;
  uncertainties?: Array<Record<string, unknown>>;
  source_analysis_id?: string | null;
  source_wireframe_revision?: number;
  revision?: number;
  confirmed_at?: string | null;
} & Record<string, unknown>;

export type IntentGeneration = {
  request_id: string;
  status: 'running' | 'ready' | 'failed' | 'superseded' | 'interrupted' | string;
  purpose?: 'first-draft' | 'candidate' | string;
  wireframe_revision?: number;
  project_type?: string;
  started_at?: string;
  finished_at?: string | null;
  error_code?: string | null;
};

export type IntentCandidate = {
  schema_version?: string;
  candidate_id: string;
  request_id?: string;
  screen_id?: string;
  status?: 'ready' | string;
  generated_at?: string;
  source_context?: { wireframe_revision?: number; project_type?: string };
  base_current_revisions?: Record<string, number>;
  analysis?: Record<string, unknown>;
  review?: IntentReview;
  warnings?: string[];
};

export type IntentHistoryEntry = {
  history_id: string;
  screen_id?: string;
  created_at?: string;
  reason?: string;
  was_confirmed?: boolean;
  wireframe_revision?: number;
  requirement_revision?: number;
  intent_review_revision?: number;
  intent_context_revision?: number;
  intent_context_hash?: string | null;
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
  intent_analysis?: { requirement_draft?: string; inferred_page_type?: string; inferred_rules?: string[]; uncertainties?: string[]; generated_at?: string } & Record<string, unknown>;
  // v1.4 structured-v2：structured-v2 下 intent_analysis 为归一化分析对象，
  // 真实形态以服务端为准，此处仅保证字段可访问。
  intent_mode?: IntentMode;
  intent_review?: IntentReview | null;
  intent_generation?: IntentGeneration | null;
  intent_context?: { revision: number; hash: string } | null;
  screen_id: string;
  active_screen_id?: string;
  screens?: ScreenEntry[];
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
    referenceInventory?: Artifact | null;
    screenContract: Artifact | null;
    bindings?: Artifact | null;
    layouts: (Artifact & { proposals?: LayoutProposal[] }) | null;
    approvedLayout: Artifact | null;
    referencePack?: Artifact | null;
    underlayContract?: Artifact | null;
    underlayCritique?: Artifact | null;
    underlayRepairTask?: Artifact | null;
    compositionManifest?: Artifact | null;
    compositionOutput?: Artifact | null;
    fidelityReport?: Artifact | null;
    styleContract: Artifact | null;
    fontManifest?: Artifact | null;
    componentContract?: Artifact | null;
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
    assistantModel: string;
    visionModel: string;
    critiqueModel?: string;
    imageModel: string;
  };
  features: { assistant: boolean };
};

export type AssistantMode = 'qa' | 'execute';
export type AssistantRunStatus = 'queued' | 'running' | 'awaiting_confirmation' | 'executing' | 'succeeded' | 'failed' | 'stale' | 'cancelled' | 'interrupted';
export type AssistantConversationMeta = {
  schema_version: '1.0';
  conversation_id: string;
  title: string;
  project_id: string;
  screen_id: string;
  created_at: string;
  updated_at: string;
  has_pending_action?: boolean;
  message_error?: string;
};
export type AssistantAttachment = { name: string; dataUrl: string };
export type AssistantMessage = {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  attachments?: AssistantAttachment[];
  content: string;
  created_at: string;
};
export type AssistantRisk = {
  writes_project: boolean;
  replaces_content: boolean;
  reversible: boolean;
  external_cost: boolean;
};
export type AssistantAction = {
  action_id: string;
  name: 'save_intent_review_draft';
  label: string;
  reason: string;
  args: Record<string, unknown>;
  risk: AssistantRisk;
  review?: { project_name: string; screen_name: string; before: string; before_truncated: boolean };
};
export type AssistantChangedField = { kind: 'input_revision' | 'artifact_version' | 'artifact_status'; key: string; expected: number | string; actual: number | string };
export type AssistantRun = {
  schema_version: '1.0';
  run_id: string;
  conversation_id: string;
  status: AssistantRunStatus;
  mode: AssistantMode;
  request_message_id: string | null;
  context: { project_id: string; screen_id: string; input_revisions: Record<string, number>; artifact_versions: Record<string, number> };
  proposed_action: AssistantAction | null;
  result: { noop?: boolean; intent_review_revision?: number; reply_saved?: boolean; user_decision?: 'rejected' } | null;
  error: { code: string; message: string; changed?: AssistantChangedField[] } | null;
  created_at: string;
  updated_at: string;
};
export type AssistantConversation = {
  message_error?: string;
  meta: AssistantConversationMeta;
  messages: AssistantMessage[];
  runs: AssistantRun[];
  summary: { schema_version: '1.0'; through_seq: number; summary: string; updated_at: string } | null;
};
export type AssistantConversationList = {
  conversations: AssistantConversationMeta[];
  warnings: Array<{ conversation_id: string; code: string; message: string }>;
};

// 图库（v1.1 §5.3 / §7）：用户级索引资产与查询合同。
export type GalleryAsset = {
  id: string;
  cdn_url: string;
  provider: 'kunpo';
  provider_task_id?: string;
  storage_mode: 'provider_cdn';
  remote_only: true;
  origin_kind: 'visual_exploration' | 'underlay_repair';
  continuation_mode?: ContinuationMode;
  mode_provenance?: 'task-start' | 'fail-closed';
  download_waiver?: { at: string; reason: string };
  project_id?: string;
  project_name_snapshot?: string;
  project_status_snapshot?: 'draft' | 'archived';
  screen_id?: string;
  screen_name_snapshot?: string;
  variation_id?: string;
  strategy?: string;
  layout_name?: string;
  style_name?: string;
  width?: number;
  height?: number;
  target_size?: string;
  created_at: string;
  indexed_at: string;
  last_seen_at: string;
  hidden_at?: string | null;
};

export type GalleryQuery = {
  scope?: 'all' | 'hidden';
  projectId?: string;
  screenId?: string;
  orientation?: 'landscape' | 'portrait' | 'square';
  range?: 'today' | '7d' | '30d' | 'all';
  query?: string;
  sort?: 'newest' | 'oldest';
  cursor?: string;
  limit?: number;
};

export type GalleryListResult = {
  items: GalleryAsset[];
  total: number;
  nextCursor: string | null;
  facets: {
    projects: Array<{ id: string; name: string; status: 'draft' | 'archived' }>;
    screens: Array<{ id: string; name: string; projectId?: string }>;
  };
};

export type GalleryDownloadResult = {
  status: 'saved' | 'cancelled' | 'blocked' | 'failed';
  message?: string;
  path?: string;
};
