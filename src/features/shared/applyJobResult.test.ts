import { describe, expect, it } from 'vitest';
import { makeProject } from '../../test-utils/fixtures';
import { applyJobResult } from './ui';

// P0-07 / AUD-04：并发项目与 Screen 上下文。任务结果只能写回任务发起时的
// 项目与原 Screen；用户切换项目或 Screen 后返回的旧任务结果绝不能覆盖
// 当前页面。
describe('applyJobResult（Job Context 守卫）', () => {
  it('任务结果与当前项目不同源时保留当前项目', () => {
    const current = makeProject({ id: 'project-b' });
    const next = makeProject({ id: 'project-a' });
    expect(applyJobResult(current, next, 'project-a')).toBe(current);
  });

  it('任务与当前项目同源时正常应用并保留预览', () => {
    const current = makeProject({ id: 'project-a', wireframe_preview: 'preview-a' } as never);
    const next = makeProject({ id: 'project-a' });
    const result = applyJobResult(current, next, 'project-a');
    expect(result?.id).toBe('project-a');
    expect(result?.wireframe_preview).toBe('preview-a');
  });

  it('jobId 缺失（创建项目任务）时直接放行', () => {
    const current = makeProject({ id: 'project-b' });
    const next = makeProject({ id: 'project-a' });
    const result = applyJobResult(current, next);
    expect(result).not.toBe(current);
    expect(result?.id).toBe('project-a');
  });

  it('当前无项目但返回对象属于任务上下文时正常应用', () => {
    const next = makeProject({ id: 'project-a' });
    expect(applyJobResult(null, next, 'project-a')?.id).toBe('project-a');
  });

  it('AUD-04 缺口 A：返回对象自身项目身份错误时，即使当前 UI 仍在原上下文也不得应用', () => {
    const current = makeProject({ id: 'project-a' });
    // 晚到响应/错误响应返回了另一个项目的数据。
    const next = makeProject({ id: 'project-b' });
    expect(applyJobResult(current, next, 'project-a')).toBe(current);
    // 当前无项目时同样拒绝，绝不用错误项目填充空状态。
    expect(applyJobResult(null, next, 'project-a')).toBe(null);
  });

  it('AUD-04 缺口 A：返回对象 Screen 身份错误时不得应用', () => {
    const current = makeProject({ id: 'project-a', screen_id: 'screen-battle' });
    const next = makeProject({ id: 'project-a', screen_id: 'screen-shop' });
    expect(applyJobResult(current, next, 'project-a', 'screen-battle')).toBe(current);
  });

  it('同项目但用户已切到其他 Screen 时，旧 Screen 任务结果不得覆盖当前页面', () => {
    const current = makeProject({ id: 'project-a', screen_id: 'screen-shop' });
    const next = makeProject({ id: 'project-a', screen_id: 'screen-battle' });
    expect(applyJobResult(current, next, 'project-a', 'screen-battle')).toBe(current);
  });

  it('项目与 Screen 均与任务上下文一致时正常应用', () => {
    const current = makeProject({ id: 'project-a', screen_id: 'screen-battle' });
    const next = makeProject({ id: 'project-a', screen_id: 'screen-battle' });
    const result = applyJobResult(current, next, 'project-a', 'screen-battle');
    expect(result?.id).toBe('project-a');
    expect(result?.screen_id).toBe('screen-battle');
  });
});
