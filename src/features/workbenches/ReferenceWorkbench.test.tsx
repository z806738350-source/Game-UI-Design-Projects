import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copilotApi } from '../../api';
import type { DesignProject } from '../../types';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import { ReferenceWorkbench } from './ReferenceWorkbench';

vi.mock('../../api', () => ({
  copilotApi: {
    approveArtifact: vi.fn(),
    importFile: vi.fn(),
    manageReference: vi.fn()
  }
}));

const api = { approveArtifact: vi.mocked(copilotApi.approveArtifact) };
const run = async (task: () => Promise<DesignProject>) => task();

const references = [
  { id: 'ref-1', path: '/tmp/ref-1.png', name: '主参考.png', role: 'primary' as const, order: 0, approved: true, preview: 'data:1' },
  { id: 'ref-2', path: '/tmp/ref-2.png', name: '辅助.png', role: 'supporting' as const, order: 1, preview: 'data:2' }
];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ReferenceWorkbench（Reference 容量）', () => {
  it('正常路径：存在已批准参考图时可以提交 Inventory 批准', async () => {
    const project = makeProject({ reference_assets: references });
    const user = userEvent.setup();
    api.approveArtifact.mockResolvedValue(project);
    render(<ReferenceWorkbench project={project} busy={false} run={run} />);

    await user.click(screen.getByTestId('reference-approve'));
    expect(api.approveArtifact).toHaveBeenCalledWith('project-1', 'reference-inventory');
  });

  it('失败路径：容量达到上限时必须先看到省略警告', () => {
    const project = makeProject({
      reference_assets: references,
      artifacts: {
        referencePack: makeArtifact({
          id: 'reference-pack-1', status: 'generated', provider_limit: 5,
          capacity_decision: { used: 5, strategy: 'omit-lowest-priority' },
          attachment_order: [{ id: 'ref-1', index: 1, description: '主参考' }],
          omitted: [{ id: 'ref-6', name: '额外参考.png', reason: '超出 Provider 附件上限' }]
        })
      }
    });
    render(<ReferenceWorkbench project={project} busy={false} run={run} />);
    const warning = screen.getByTestId('reference-capacity-warning');
    expect(warning.getAttribute('role')).toBe('alert');
    expect(warning.textContent).toContain('容量已达上限');
    expect(screen.getByText(/超出 Provider 附件上限/)).toBeTruthy();
  });

  it('容量未达上限时不展示警告', () => {
    const project = makeProject({
      reference_assets: references,
      artifacts: {
        referencePack: makeArtifact({ id: 'reference-pack-1', status: 'approved', provider_limit: 10, capacity_decision: { used: 2 }, attachment_order: [], omitted: [] })
      }
    });
    render(<ReferenceWorkbench project={project} busy={false} run={run} />);
    expect(screen.queryByTestId('reference-capacity-warning')).toBeNull();
  });
});
