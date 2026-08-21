import type { Artifact, DesignProject } from '../../types';

// P0-02：视觉生成的省略确认必须与任务目的绑定。只有 purpose 为
// underlay-generation 且仍要求确认的 Pack 才构成待确认状态；Style 阶段
// 的 Pack 确认由风格页自己的按钮负责，两者互不代替。
export function visualOmissionPack(project: Pick<DesignProject, 'artifacts'>): Artifact | null {
  const pack = project.artifacts.referencePack;
  if (!pack || pack.purpose !== 'underlay-generation') return null;
  return pack.requires_omission_confirmation === true ? pack : null;
}

// 确认事实绑定当前 Pack 的 hash：参考图、角色优先级或 Provider 容量变化
// 都会让 hash 改变，旧确认自动失效，必须重新确认。
export function omissionConfirmationInput(pack: Artifact | null): Record<string, unknown> {
  if (!pack) return {};
  return { confirmReferenceOmissions: true, referencePackHash: String(pack.pack_hash || '') };
}
