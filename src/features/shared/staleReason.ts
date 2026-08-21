import type { PipelineProfile } from './pipelineRoute';

// stale 原因 → 用户可见的恢复指引（fix-plan P0-06）。
// 禁止对任意 stale 统一显示“先更新功能契约”：必须按失效原因与路线
// 给出准确的下一步，旧版风格循环造成的错误失效提供一次性修复入口。

export type StaleAction = 'update-contract' | 'regenerate-strict-layout' | 'update-strict-assets' | 'legacy-repair' | 'regenerate';

export interface StaleGuidance {
  message: string;
  action: StaleAction;
}

export function layoutStaleGuidance(staleReason: string | undefined, profile: PipelineProfile): StaleGuidance {
  const reason = String(staleReason || '');
  if (reason.includes('screen_contract') || reason.includes('screen-contract') || reason.includes('requirement') || reason.includes('wireframe')) {
    return { message: '功能契约或画布输入已变化，旧布局只能用于对照。请先回到需求与功能契约更新契约，再重新生成布局。', action: 'update-contract' };
  }
  // 旧版缺陷：布局先行路线上风格重新生成错误地把布局标为 stale。
  // 只在非 strict 路线提供一次性安全修复（flowStateRepair 后端仍会复核资格）。
  if (reason === 'style_contract_regenerated' && profile !== 'strict') {
    return { message: '检测到旧版风格循环缺陷导致的错误失效：布局本身未受影响。可执行一次性安全修复，无需重做需求。', action: 'legacy-repair' };
  }
  if (profile === 'strict' && reason.includes('style')) {
    return { message: '风格规范已变化，组件感知布局需要基于新规范重新生成。', action: 'regenerate-strict-layout' };
  }
  if (profile === 'strict' && (reason.includes('font') || reason.includes('component') || reason.includes('binding'))) {
    return { message: '严格继承资产（字体/组件/绑定）已变化，请返回严格继承面板补齐资产后重新生成布局。', action: 'update-strict-assets' };
  }
  return { message: '布局提案已失效，请重新生成布局。', action: 'regenerate' };
}
