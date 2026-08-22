import { describe, expect, it } from 'vitest';
import { makeProject } from '../../test-utils/fixtures';
import { retryContextMatches, statusOf } from './ui';

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

// AUD-12：typography/component resolution 由 updateWorkflow 写入 global_stages
// 而非 screen_stages，Style Rail 聚合必须读全局作用域；只有 component_binding
// 是 Screen 作用域。stale 与 blocked 都计入未就绪。
describe('statusOf（AUD-12 严格子阶段作用域）', () => {
  const styleApprovedWith = (global: Record<string, unknown>, screenStage: Record<string, unknown> = {}) => makeProject({
    screen_id: 'screen-a',
    workflow: {
      current_stage: 'style_resolution',
      stages: {},
      global_stages: { style_resolution: { status: 'approved' }, ...global },
      screen_stages: { 'screen-a': { component_binding: { status: 'approved' }, ...screenStage } }
    } as never
  });

  it('全局字体解析 stale（写在 global_stages）时 Style Rail 不得显示已批准', () => {
    expect(statusOf(styleApprovedWith({ typography_resolution: { status: 'stale' } }), 'style_resolution')).toBe('stale');
  });

  it('全局组件解析 blocked 时 Style Rail 不得显示已批准', () => {
    expect(statusOf(styleApprovedWith({ component_resolution: { status: 'blocked' } }), 'style_resolution')).toBe('stale');
  });

  it('全局子阶段全部就绪时保持已批准', () => {
    expect(statusOf(styleApprovedWith({ typography_resolution: { status: 'approved' }, component_resolution: { status: 'approved' } }), 'style_resolution')).toBe('approved');
  });

  it('screen_stages 里的同名残留条目不得冒充全局事实', () => {
    // 旧实现读 screen_stages.typography_resolution；新实现必须忽略它。
    const project = styleApprovedWith({ typography_resolution: { status: 'approved' } }, { typography_resolution: { status: 'stale' } });
    expect(statusOf(project, 'style_resolution')).toBe('approved');
  });
});

// AUD-04：重试上下文。失败任务冻结发起时的项目与 Screen，只有用户仍在
// 原上下文才允许重试；切换项目或 Screen 后不得拿当前 UI 上下文执行旧任务。
describe('retryContextMatches（重试上下文守卫）', () => {
  it('任务无项目上下文（创建项目）时直接放行', () => {
    expect(retryContextMatches({ task: undefined } as never, makeProject())).toBe(true);
    expect(retryContextMatches(null, null)).toBe(true);
  });

  it('仍在原项目与原 Screen 时允许重试', () => {
    const project = makeProject({ id: 'project-a', screen_id: 'screen-battle' });
    expect(retryContextMatches({ projectId: 'project-a', screenId: 'screen-battle' }, project)).toBe(true);
  });

  it('已切到另一个项目时不允许重试', () => {
    const project = makeProject({ id: 'project-b', screen_id: 'screen-battle' });
    expect(retryContextMatches({ projectId: 'project-a', screenId: 'screen-battle' }, project)).toBe(false);
    expect(retryContextMatches({ projectId: 'project-a', screenId: 'screen-battle' }, null)).toBe(false);
  });

  it('同项目但已切到另一个 Screen 时不允许重试', () => {
    const project = makeProject({ id: 'project-a', screen_id: 'screen-shop' });
    expect(retryContextMatches({ projectId: 'project-a', screenId: 'screen-battle' }, project)).toBe(false);
  });

  it('任务未绑定 Screen 时同项目即放行', () => {
    const project = makeProject({ id: 'project-a', screen_id: 'screen-shop' });
    expect(retryContextMatches({ projectId: 'project-a' }, project)).toBe(true);
  });
});
