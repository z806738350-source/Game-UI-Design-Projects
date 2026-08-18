import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copilotApi } from '../../api';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import { BindingWorkbench } from './BindingWorkbench';

vi.mock('../../api', () => ({
  copilotApi: {
    updateArtifact: vi.fn(),
    approveArtifact: vi.fn()
  }
}));

const api = {
  updateArtifact: vi.mocked(copilotApi.updateArtifact),
  approveArtifact: vi.mocked(copilotApi.approveArtifact)
};

const projectWithControls = (extra = {}) => makeProject({
  artifacts: {
    screenContract: makeArtifact({
      id: 'screen-contract-1', status: 'approved',
      required_controls: [
        { id: 'save', label: '保存', role: 'primary-action', required: true },
        { id: 'back', label: '返回', role: 'navigation', required: true }
      ]
    }),
    componentContract: makeArtifact({
      id: 'component-contract-1', status: 'approved',
      families: [
        { id: 'button.primary', name: '主按钮', category: 'button', status: 'approved', states: { default: {}, disabled: {}, pressed: {} } },
        { id: 'nav.item', name: '导航项', category: 'navigation', status: 'approved', states: { default: {}, selected: {} } }
      ]
    }),
    fontManifest: makeArtifact({ id: 'font-manifest-1', status: 'approved', roles: { 'button-label': {}, 'navigation-label': {} } }),
    ...extra
  }
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('BindingWorkbench（REM-01 显式选择）', () => {
  it('正常路径：逐个显式选择后才允许保存，且不发送 approved 字段', async () => {
    const project = projectWithControls();
    const user = userEvent.setup();
    api.updateArtifact.mockResolvedValue(project);
    render(<BindingWorkbench project={project} busy={false} />);

    const save = screen.getByTestId('binding-save');
    expect(save.hasAttribute('disabled')).toBe(true);

    await user.selectOptions(screen.getByTestId('binding-component-select-save').querySelector('select')!, 'button.primary');
    expect(save.hasAttribute('disabled')).toBe(true);
    await user.selectOptions(screen.getByTestId('binding-component-select-back').querySelector('select')!, 'nav.item');
    expect(save.hasAttribute('disabled')).toBe(false);

    await user.click(save);
    expect(api.updateArtifact).toHaveBeenCalledTimes(1);
    const [projectId, kind, patch] = api.updateArtifact.mock.calls[0];
    expect(projectId).toBe('project-1');
    expect(kind).toBe('component-bindings');
    expect(patch).not.toHaveProperty('approved');
    expect((patch as { bindings: Array<Record<string, unknown>> }).bindings).toEqual([
      expect.objectContaining({ control_id: 'save', component_id: 'button.primary', state: 'default', font_role: 'button-label' }),
      expect.objectContaining({ control_id: 'back', component_id: 'nav.item', state: 'default', font_role: 'navigation-label' })
    ]);
  });

  it('语义不兼容的组件被禁用并显示原因', () => {
    render(<BindingWorkbench project={projectWithControls()} busy={false} />);
    const navigationSelect = screen.getByTestId('binding-component-select-back').querySelector('select')!;
    const incompatible = Array.from(navigationSelect.options).find((option) => option.value === 'button.primary')!;
    expect(incompatible.disabled).toBe(true);
    expect(incompatible.textContent).toContain('语义不兼容');
  });

  it('失败路径：后端拒绝批准时在工作台自身错误槽展示原因', async () => {
    const project = projectWithControls({ bindings: makeArtifact({ id: 'bindings-1', status: 'draft' }) });
    const user = userEvent.setup();
    api.approveArtifact.mockRejectedValue(new Error("Error invoking remote method 'copilot:approve': Error: BINDING_COVERAGE_INCOMPLETE: 必需控件尚未全部绑定"));
    render(<BindingWorkbench project={project} busy={false} />);

    await user.click(screen.getByTestId('binding-approve'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('BINDING_COVERAGE_INCOMPLETE');
    expect(alert.className).toContain('inline-error');
  });
});
