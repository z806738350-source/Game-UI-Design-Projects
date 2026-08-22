import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

const run = async (task: () => Promise<DesignProject>) => task();

const references = [
  { id: 'ref-1', path: '/tmp/ref-1.png', name: '主参考.png', role: 'primary' as const, order: 0, approved: true, preview: 'data:1' },
  { id: 'ref-2', path: '/tmp/ref-2.png', name: '辅助.png', role: 'supporting' as const, order: 1, preview: 'data:2' }
];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ReferenceWorkbench（Reference 容量）', () => {
  it('初次进入即常显 6 张上限提示，且不再提供清单批量批准按钮', () => {
    const project = makeProject({ reference_assets: references });
    render(<ReferenceWorkbench project={project} busy={false} run={run} />);

    expect(screen.getByText(/单次生成最多送 6 张/)).toBeTruthy();
    expect(screen.queryByTestId('reference-approve')).toBeNull();
  });

  it('超过 6 张时展示计数警示', () => {
    const overflow = Array.from({ length: 7 }, (_, index) => ({ id: `ref-${index}`, path: `/tmp/ref-${index}.png`, name: `参考${index}.png`, role: 'primary' as const, order: index, preview: `data:${index}` }));
    const project = makeProject({ reference_assets: overflow });
    render(<ReferenceWorkbench project={project} busy={false} run={run} />);
    const warning = screen.getByTestId('reference-limit-warning');
    expect(warning.textContent).toContain('当前已有 7 张');
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

  it('P1-12：存在未批准参考图时明确告知不会进入分析，并在 Pack 预览列出 ignored', () => {
    const project = makeProject({
      reference_assets: references,
      artifacts: {
        referencePack: makeArtifact({ id: 'reference-pack-1', status: 'approved', provider_limit: 10, capacity_decision: { used: 1 }, attachment_order: [{ id: 'ref-1', index: 1, description: '主参考' }], omitted: [] })
      }
    });
    render(<ReferenceWorkbench project={project} busy={false} run={run} />);
    const warning = screen.getByTestId('reference-unapproved-warning');
    expect(warning.getAttribute('role')).toBe('alert');
    expect(warning.textContent).toContain('有 1 张参考图尚未批准');
    const ignored = screen.getByTestId('reference-pack-ignored');
    expect(ignored.textContent).toContain('未批准 1 张（不会送入生成）');
    expect(ignored.textContent).toContain('辅助.png');
  });

  it('全部参考图已批准时不展示未批准警示', () => {
    const allApproved = references.map((asset) => ({ ...asset, approved: true }));
    const project = makeProject({ reference_assets: allApproved });
    render(<ReferenceWorkbench project={project} busy={false} run={run} />);
    expect(screen.queryByTestId('reference-unapproved-warning')).toBeNull();
  });
});
