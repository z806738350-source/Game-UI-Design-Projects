import { describe, expect, it } from 'vitest';
import { layoutStaleGuidance } from './staleReason';

// fix-plan P0-06：stale 指引必须按原因与路线区分，禁止统一文案。
describe('layoutStaleGuidance（stale 原因区分）', () => {
  it('契约/需求/线框变化 → 回到功能契约', () => {
    for (const reason of ['screen-contract_changed', 'screen_contract_changed', 'requirement_changed', 'wireframe_changed']) {
      expect(layoutStaleGuidance(reason, 'exploration').action).toBe('update-contract');
      expect(layoutStaleGuidance(reason, 'strict').action).toBe('update-contract');
    }
  });

  it('旧版风格循环失效只在非 strict 路线走一次性修复', () => {
    expect(layoutStaleGuidance('style_contract_regenerated', 'exploration').action).toBe('legacy-repair');
    expect(layoutStaleGuidance('style_contract_regenerated', 'guided').action).toBe('legacy-repair');
    expect(layoutStaleGuidance('style_contract_regenerated', 'strict').action).toBe('regenerate-strict-layout');
  });

  it('strict 资产变化 → 回严格继承面板', () => {
    for (const reason of ['font_asset_imported', 'component-contract_changed', 'component-bindings_changed']) {
      expect(layoutStaleGuidance(reason, 'strict').action).toBe('update-strict-assets');
    }
  });

  it('未知原因回退到重新生成，绝不误报“先更新功能契约”', () => {
    expect(layoutStaleGuidance(undefined, 'exploration').action).toBe('regenerate');
    expect(layoutStaleGuidance('layout_proposals_regenerated', 'guided').action).toBe('regenerate');
    expect(layoutStaleGuidance('mystery_reason', 'exploration').message).not.toContain('功能契约或画布输入已变化');
  });
});
