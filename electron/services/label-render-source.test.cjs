// AUD-09 负向回归：最终文字的事实源是当前 Screen Contract 的 label，不是
// Binding 里冻结的旧文本。label-only 编辑不失效 Binding，但重新合成必须
// 读到新 label；Binding 快照文本不得覆盖契约当前值。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCompositionManifest } = require('./compositor.cjs');

function fixtures(contractLabel) {
  const project = {
    continuation_mode: 'exploration',
    canvas_spec: { width: 400, height: 800 },
    artifacts: {
      screenContract: { id: 'main-screen-contract', required_controls: [{ id: 'save', label: contractLabel, role: 'primary-action', required: true }] },
      visualResults: undefined
    }
  };
  const layout = { id: 'main-approved-layout', slots: [{ id: 'bottom-primary', rect: { x: 0.25, y: 0.8, width: 0.5, height: 0.1 } }] };
  const componentContract = {
    id: 'project-component-contract',
    families: [{
      id: 'button.primary', category: 'button', status: 'approved', text_policy: 'text-slot',
      intrinsic_size: [200, 80], reuse_mode: 'exact',
      states: {
        default: { asset_path: 'style/components/button.png', asset_hash: 'sha256:00' },
        pressed: { asset_path: 'style/components/button-pressed.png', asset_hash: 'sha256:01' },
        disabled: { asset_path: 'style/components/button-disabled.png', asset_hash: 'sha256:02' }
      }
    }]
  };
  // Binding 里的 text 是批准时冻结的旧文本“旧文本”。
  const bindings = { bindings: [{ control_id: 'save', component_id: 'button.primary', state: 'default', slot_id: 'bottom-primary', text: '旧文本', font_role: 'button-label', approved: true }] };
  const fontManifest = { roles: { 'button-label': { font_id: 'font-1' } }, fonts: [{ id: 'font-1', local_path: 'style/fonts/main.ttf', file_hash: 'sha256:ff', family_name: 'Main' }] };
  const styleContract = { id: 'project-style-contract', typography: {} };
  const critique = { id: 'main-underlay-critique', result: 'passed', issues: [] };
  const underlay = { path: 'screens/main/underlays/current.png' };
  return { project, layout, componentContract, bindings, fontManifest, styleContract, critique, underlay };
}

test('composition text layers read labels from the current screen contract', () => {
  const before = createCompositionManifest({ ...fixtures('保存'), mode: 'preview' });
  const beforeText = before.layers.find((layer) => layer.type === 'text');
  assert.equal(beforeText.content, '保存');

  // label-only 编辑：契约 label 改为“保存阵容”，Binding 未动（仍是旧文本）。
  const after = createCompositionManifest({ ...fixtures('保存阵容'), mode: 'preview' });
  const afterText = after.layers.find((layer) => layer.type === 'text');
  assert.equal(afterText.content, '保存阵容');
  assert.equal(afterText.control_id, 'save');
});

test('binding text is only used when the contract no longer defines the control label', () => {
  const { project, ...rest } = fixtures('保存');
  // 契约控件清单缺失该控件（极端场景）→ 回退 Binding 自带文本。
  project.artifacts.screenContract = { id: 'main-screen-contract', required_controls: [] };
  const manifest = createCompositionManifest({ project, ...rest, mode: 'preview' });
  const text = manifest.layers.find((layer) => layer.type === 'text');
  assert.equal(text.content, '旧文本');
});
