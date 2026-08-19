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
        { id: 'button.primary', name: '主按钮', category: 'button', status: 'approved', text_policy: 'text-slot', states: { default: {}, disabled: {}, pressed: {} } },
        { id: 'nav.item', name: '导航项', category: 'navigation', status: 'approved', text_policy: 'none', states: { default: {}, selected: {} } }
      ]
    }),
    fontManifest: makeArtifact({ id: 'font-manifest-1', status: 'approved', roles: { 'button-label': {}, 'navigation-label': {} } }),
    ...extra
  }
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

// 自绘下拉框交互：展开后点击目标选项（data-value）。
const pick = async (user: ReturnType<typeof userEvent.setup>, testId: string, value: string) => {
  const root = screen.getByTestId(testId);
  await user.click(root.querySelector('.dropdown-button') as HTMLElement);
  await user.click(root.querySelector(`.dropdown-option[data-value="${value}"]`) as HTMLElement);
};

describe('BindingWorkbench（REM-01 / F-01 显式选择）', () => {
  it('正常路径：组件/状态/字体角色逐项显式确认后才允许保存，且不发送 approved 字段', async () => {
    const project = projectWithControls();
    const user = userEvent.setup();
    api.updateArtifact.mockResolvedValue(project);
    render(<BindingWorkbench project={project} busy={false} />);

    const save = screen.getByTestId('binding-save');
    expect(save.hasAttribute('disabled')).toBe(true);

    await pick(user, 'binding-component-select-save', 'button.primary');
    await pick(user, 'binding-component-select-back', 'nav.item');
    // Choosing families alone never confirms state or font role.
    expect(save.hasAttribute('disabled')).toBe(true);

    await pick(user, 'binding-state-select-save', 'default');
    // text-slot family still requires an explicit font role.
    expect(save.hasAttribute('disabled')).toBe(true);
    await pick(user, 'binding-font-role-select-save', 'button-label');

    await pick(user, 'binding-state-select-back', 'default');
    // nav.item has text_policy none: no font role required.
    expect(save.hasAttribute('disabled')).toBe(false);

    await user.click(save);
    expect(api.updateArtifact).toHaveBeenCalledTimes(1);
    const [projectId, kind, patch] = api.updateArtifact.mock.calls[0];
    expect(projectId).toBe('project-1');
    expect(kind).toBe('component-bindings');
    expect(patch).not.toHaveProperty('approved');
    const bindings = (patch as { bindings: Array<Record<string, unknown>> }).bindings;
    expect(bindings[0]).toEqual(expect.objectContaining({ control_id: 'save', component_id: 'button.primary', state: 'default', font_role: 'button-label' }));
    expect(bindings[1]).toEqual(expect.objectContaining({ control_id: 'back', component_id: 'nav.item', state: 'default' }));
    expect(bindings[1].font_role).toBeUndefined();
  });

  it('选择组件后状态与字体角色保持空值，仅显示推荐提示', async () => {
    const user = userEvent.setup();
    render(<BindingWorkbench project={projectWithControls()} busy={false} />);
    await pick(user, 'binding-component-select-save', 'button.primary');
    // 选择组件后状态与字体角色仍为占位文案（未确认）。
    expect(screen.getByTestId('binding-state-select-save').querySelector('.dropdown-button > span')?.textContent).toContain('必选');
    expect(screen.getByTestId('binding-font-role-select-save').querySelector('.dropdown-button > span')?.textContent).toContain('必选');
  });

  it('语义不兼容的组件被禁用并显示原因', async () => {
    const user = userEvent.setup();
    render(<BindingWorkbench project={projectWithControls()} busy={false} />);
    await user.click(screen.getByTestId('binding-component-select-back').querySelector('.dropdown-button') as HTMLElement);
    const incompatible = screen.getByTestId('binding-component-select-back').querySelector('.dropdown-option[data-value="button.primary"]') as HTMLElement;
    expect(incompatible.className).toContain('is-disabled');
    expect(incompatible.textContent).toContain('语义不兼容');
  });

  it('存量 action 控件显示待语义解析标记', () => {
    const project = makeProject({
      artifacts: {
        screenContract: makeArtifact({
          id: 'screen-contract-2', status: 'approved',
          required_controls: [{ id: 'legacy', label: '旧控件', role: 'action', required: true }]
        }),
        componentContract: makeArtifact({
          id: 'component-contract-2', status: 'approved',
          families: [{ id: 'button.primary', name: '主按钮', category: 'button', status: 'approved', text_policy: 'none', states: { default: {} } }]
        }),
        fontManifest: makeArtifact({ id: 'font-manifest-2', status: 'approved', roles: {} })
      }
    });
    render(<BindingWorkbench project={project} busy={false} />);
    expect(screen.getByTestId('binding-unresolved-role-legacy').textContent).toContain('待语义解析');
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
