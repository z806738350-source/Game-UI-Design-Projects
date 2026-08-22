import { describe, expect, it } from 'vitest';
import { makeProject } from '../../test-utils/fixtures';
import { statusOf } from './ui';

// P1-08：Rail 状态必须按作用域聚合。顶层 workflow.stages 只记录“最后一次
// 操作写入”，多 Screen 下必须以 global_stages / screen_stages[当前屏] 为准。
describe('statusOf（多 Screen 作用域聚合）', () => {
  const projectOf = (screenId: string) => makeProject({
    screen_id: screenId,
    workflow: {
      current_stage: 'layout_design',
      // 最后操作的是 B 屏，顶层状态停在 B 的 stale。
      stages: { layout_design: { status: 'stale' } },
      global_stages: { style_resolution: { status: 'approved' } },
      screen_stages: {
        'screen-a': { layout_design: { status: 'approved' }, component_binding: { status: 'approved' } },
        'screen-b': { layout_design: { status: 'stale' }, component_binding: { status: 'stale' } }
      }
    } as never
  });

  it('Screen 阶段读当前 Screen 的 screen_stages，而不是最后操作页面', () => {
    expect(statusOf(projectOf('screen-a'), 'layout_design')).toBe('approved');
    expect(statusOf(projectOf('screen-b'), 'layout_design')).toBe('stale');
  });

  it('全局阶段读 global_stages', () => {
    expect(statusOf(projectOf('screen-a'), 'style_resolution')).toBe('approved');
  });

  it('严格子阶段 stale 时 Style 组合状态不得继续显示已批准', () => {
    expect(statusOf(projectOf('screen-b'), 'style_resolution')).toBe('stale');
  });
});
