import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copilotApi } from '../../api';
import type { DesignProject } from '../../types';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import { TypographyWorkbench } from './TypographyWorkbench';

vi.mock('../../api', () => ({
  copilotApi: {
    approveArtifact: vi.fn(),
    confirmFontUsage: vi.fn(),
    importFontAsset: vi.fn()
  }
}));

const api = { confirmFontUsage: vi.mocked(copilotApi.confirmFontUsage) };
const run = async (task: () => Promise<DesignProject>) => task();

const projectWithManifest = () => makeProject({
  artifacts: {
    fontManifest: makeArtifact({
      id: 'font-manifest-1', status: 'generated',
      fonts: [{ id: 'ui-primary', format: 'otf', actual_family: '思源黑体' }],
      roles: { 'button-label': { font_id: 'ui-primary' }, body: {} }
    })
  }
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('TypographyWorkbench（字体授权）', () => {
  it('正常路径：勾选授权与精确使用后确认字体角色，并展示角色覆盖', async () => {
    const project = projectWithManifest();
    const user = userEvent.setup();
    api.confirmFontUsage.mockResolvedValue(project);
    render(<TypographyWorkbench project={project} busy={false} run={run} />);

    expect(screen.getByTestId('font-role-coverage').textContent).toContain('未绑定字体');
    const confirm = screen.getByTestId('font-confirm');
    expect(confirm.hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByLabelText(/我确认有权在本项目中使用/));
    await user.click(screen.getByLabelText(/该角色必须精确使用此字体/));
    expect(confirm.hasAttribute('disabled')).toBe(false);

    await user.click(confirm);
    expect(api.confirmFontUsage).toHaveBeenCalledWith('project-1', expect.objectContaining({ fontId: 'ui-primary', roleId: 'button-label', licenseConfirmed: true, exactConfirmed: true }));
  });

  it('失败路径：未确认授权时提交被阻断并给出引导', () => {
    render(<TypographyWorkbench project={projectWithManifest()} busy={false} run={run} />);
    expect(screen.getByTestId('font-confirm').hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('勾选授权确认后才能提交字体使用。')).toBeTruthy();
  });
});
