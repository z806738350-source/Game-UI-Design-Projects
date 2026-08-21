import type { DesignProject } from '../../types';

// 前端路线 Profile 镜像：与后端 electron/services/pipelineProfile.cjs 保持
// 完全一致（pipelineRoute.test.ts 做前后端一致性断言）。所有工作台的路线
// 分支必须走这里，禁止各自拼接 continuation_mode if/else。

export type PipelineProfile = 'exploration' | 'guided' | 'strict';

export const pipelineProfileOf = (project: DesignProject): PipelineProfile => {
  if (project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation') return 'strict';
  if (project.continuation_mode === 'existing-guided') return 'guided';
  return 'exploration';
};

export type PipelineProfileFacts = {
  nextStageAfterContract: string;
  styleBasisKind: 'approved-layout' | 'screen-contract';
  requiresReferenceInventory: boolean;
  usesStrictAssets: boolean;
};

export const PIPELINE_PROFILE_FACTS: Record<PipelineProfile, PipelineProfileFacts> = {
  exploration: { nextStageAfterContract: 'layout_design', styleBasisKind: 'approved-layout', requiresReferenceInventory: true, usesStrictAssets: false },
  guided: { nextStageAfterContract: 'layout_design', styleBasisKind: 'approved-layout', requiresReferenceInventory: true, usesStrictAssets: false },
  strict: { nextStageAfterContract: 'style_resolution', styleBasisKind: 'screen-contract', requiresReferenceInventory: true, usesStrictAssets: true }
};
