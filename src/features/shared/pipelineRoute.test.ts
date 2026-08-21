import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { PIPELINE_PROFILE_FACTS, pipelineProfileOf } from './pipelineRoute';
import { makeProject } from '../../test-utils/fixtures';

// 前端 Profile 是后端 pipelineProfile.cjs 的镜像；任一侧规则漂移都会让
// 工作台 CTA 与后端门禁脱节（本次 Layout—Style 循环事故的前端侧根因），
// 因此对全部 continuation_mode 做前后端一致性断言。
const requireCjs = createRequire(import.meta.url);
const backend = requireCjs('../../../electron/services/pipelineProfile.cjs') as {
  PIPELINE_PROFILES: string[];
  PROFILE_FACTS: Record<string, Record<string, unknown>>;
  profileOf: (project: { continuation_mode?: string }) => string;
};

const CONTINUATION_MODES = ['exploration', 'existing-guided', 'existing-strict', 'locked-continuation', undefined, 'some-future-mode'] as const;

describe('pipelineRoute 与后端 pipelineProfile 一致性', () => {
  it('所有 continuation_mode 的 Profile 判定一致', () => {
    for (const mode of CONTINUATION_MODES) {
      const project = { continuation_mode: mode } as Parameters<typeof pipelineProfileOf>[0];
      expect(pipelineProfileOf(project)).toBe(backend.profileOf({ continuation_mode: mode }));
    }
  });

  it('Profile 事实表（下一步/风格基线/参考要求/严格资产）逐项一致', () => {
    expect(Object.keys(PIPELINE_PROFILE_FACTS).sort()).toEqual([...backend.PIPELINE_PROFILES].sort());
    for (const profile of backend.PIPELINE_PROFILES) {
      expect(PIPELINE_PROFILE_FACTS[profile as keyof typeof PIPELINE_PROFILE_FACTS]).toEqual(backend.PROFILE_FACTS[profile]);
    }
  });

  it('探索/引导路线布局先行，严格路线风格先行', () => {
    expect(pipelineProfileOf(makeProject({ continuation_mode: 'exploration' as never }))).toBe('exploration');
    expect(PIPELINE_PROFILE_FACTS.exploration.nextStageAfterContract).toBe('layout_design');
    expect(PIPELINE_PROFILE_FACTS.guided.styleBasisKind).toBe('approved-layout');
    expect(PIPELINE_PROFILE_FACTS.strict.nextStageAfterContract).toBe('style_resolution');
    expect(PIPELINE_PROFILE_FACTS.strict.styleBasisKind).toBe('screen-contract');
  });
});
