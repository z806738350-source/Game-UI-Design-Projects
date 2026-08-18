import type { Artifact, DesignProject } from '../types';

// Minimal DesignProject factory for UI unit tests. Only fields the workbenches
// read are meaningful; everything else stays inert defaults.
export function makeProject(overrides: Partial<Omit<DesignProject, 'artifacts'>> & { artifacts?: Partial<DesignProject['artifacts']> } = {}): DesignProject {
  const { artifacts, ...rest } = overrides;
  return {
    id: 'project-1',
    name: '测试项目',
    project_type: 'existing',
    continuation_mode: 'existing-strict',
    art_direction: '',
    requirement: '',
    screen_id: 'screen-main',
    workspacePath: '/tmp/project-1',
    updated_at: '2026-01-01T00:00:00.000Z',
    workflow: { current_stage: 'style_resolution', stages: {} },
    artifacts: {
      screenContract: null,
      layouts: null,
      approvedLayout: null,
      styleContract: null,
      visualTask: null,
      visualResults: { schema_version: 'visual-results/1.0', id: 'visual-results-1', version: 1, status: 'draft', source: {} },
      ...artifacts
    },
    ...rest
  };
}

export function makeArtifact(overrides: Record<string, unknown> = {}): Artifact {
  return { schema_version: 'artifact/1.0', id: 'artifact-1', version: 1, status: 'draft' as const, source: {}, ...overrides } as Artifact;
}
