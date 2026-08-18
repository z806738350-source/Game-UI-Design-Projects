import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copilotApi } from '../../api';
import type { DesignProject } from '../../types';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import { ComponentKitWorkbench } from './ComponentKitWorkbench';

vi.mock('../../api', () => ({
  copilotApi: {
    approveArtifact: vi.fn(),
    importComponentAsset: vi.fn(),
    importForgeManifest: vi.fn(),
    updateArtifact: vi.fn()
  }
}));

const api = { importComponentAsset: vi.mocked(copilotApi.importComponentAsset) };
const run = async (task: () => Promise<DesignProject>) => task();

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ComponentKitWorkbench（组件导入）', () => {
  it('正常路径：导入状态资产时携带组件身份与缩放策略', async () => {
    const project = makeProject({
      artifacts: {
        componentContract: makeArtifact({
          id: 'component-contract-1', status: 'generated',
          families: [{ id: 'button.primary', name: '主按钮', category: 'button', states: { default: {}, disabled: {}, pressed: {} } }]
        })
      }
    });
    const user = userEvent.setup();
    api.importComponentAsset.mockResolvedValue(project);
    render(<ComponentKitWorkbench project={project} busy={false} run={run} />);

    expect(screen.queryByTestId('component-state-coverage')).toBeNull();
    await user.click(screen.getByTestId('component-import'));
    expect(api.importComponentAsset).toHaveBeenCalledWith('project-1', expect.objectContaining({
      componentId: 'button.primary', category: 'button', state: 'default', reuseMode: 'exact',
      scalePolicy: expect.objectContaining({ uniform_only: true })
    }));
  });

  it('失败路径：按钮类组件缺少必需状态时先展示覆盖缺口', () => {
    const project = makeProject({
      artifacts: {
        componentContract: makeArtifact({
          id: 'component-contract-1', status: 'generated',
          families: [{ id: 'button.primary', name: '主按钮', category: 'button', states: { default: {} } }]
        })
      }
    });
    render(<ComponentKitWorkbench project={project} busy={false} run={run} />);
    const coverage = screen.getByTestId('component-state-coverage');
    expect(coverage.getAttribute('role')).toBe('alert');
    expect(coverage.textContent).toContain('button.primary：缺少 disabled、pressed/selected 状态');
  });
});
