import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import { UnderlayWorkbench } from './UnderlayWorkbench';

afterEach(cleanup);

describe('UnderlayWorkbench（Repair 状态）', () => {
  it('正常路径：Critique 通过时展示结果与零问题计数', () => {
    const project = makeProject({
      artifacts: {
        underlayContract: makeArtifact({ id: 'underlay-contract-1', status: 'approved', slots: [{ id: 'title' }] }),
        underlayCritique: makeArtifact({ id: 'underlay-critique-1', status: 'generated', result: 'passed', issues: [], evidence: {} })
      }
    });
    render(<UnderlayWorkbench project={project} />);
    expect(screen.getByTestId('underlay-critique').textContent).toContain('passed · 0 项问题');
    expect(screen.getByTestId('underlay-repair').textContent).toContain('尚未生成');
  });

  it('失败路径：Repair 尝试链显示当前轮次与失败状态', () => {
    const project = makeProject({
      artifacts: {
        underlayCritique: makeArtifact({ id: 'underlay-critique-1', status: 'generated', result: 'failed', issues: [{ rule: 'text-pollution' }, { rule: 'component-leak' }] }),
        underlayRepairTask: makeArtifact({ id: 'underlay-repair-1', status: 'failed', attempt: 2, repair_mode: 'mask-inpaint', output: {} })
      }
    });
    render(<UnderlayWorkbench project={project} />);
    expect(screen.getByTestId('underlay-critique').textContent).toContain('failed · 2 项问题');
    const repair = screen.getByTestId('underlay-repair');
    expect(repair.textContent).toContain('第 2 次 · failed');
    expect(repair.querySelector('small')!.className).toContain('is-failed');
  });
});
