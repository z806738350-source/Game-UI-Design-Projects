import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeArtifact, makeProject } from '../../test-utils/fixtures';
import { FidelityWorkbench } from './FidelityWorkbench';

afterEach(cleanup);

describe('FidelityWorkbench（Fidelity 错误展示）', () => {
  it('正常路径：通过时展示状态徽章与 Final PNG 证据，不渲染问题列表', () => {
    const project = makeProject({
      artifacts: {
        compositionOutput: makeArtifact({ id: 'composition-output-1', status: 'generated', path: 'preview/final-v2.png', width: 1920, height: 1080, hash: 'sha256:abc', mode: 'final' }),
        fidelityReport: makeArtifact({ id: 'fidelity-1', status: 'passed', metrics: { drift: 0.01 }, checks: [{ id: 'text-clarity', status: 'passed' }] })
      }
    });
    render(<FidelityWorkbench project={project} />);
    const badge = screen.getByTestId('fidelity-status');
    expect(badge.textContent).toBe('passed');
    expect(badge.className).toContain('is-ready');
    expect(screen.queryByTestId('fidelity-issues')).toBeNull();
    expect(screen.getByText(/final-v2\.png/)).toBeTruthy();
  });

  it('失败路径：失败时以可读问题列表展示，而不是只给原始 JSON', () => {
    const project = makeProject({
      artifacts: {
        fidelityReport: makeArtifact({
          id: 'fidelity-1', status: 'failed',
          issues: [{ message: '主按钮文字被发光层污染' }, { rule: 'text-clarity', message: '正文字号低于最小可读阈值' }],
          checks: [{ id: 'text-clarity', status: 'failed' }]
        })
      }
    });
    render(<FidelityWorkbench project={project} />);
    expect(screen.getByTestId('fidelity-status').className).toContain('is-failed');
    const issues = screen.getByTestId('fidelity-issues');
    expect(issues.getAttribute('role')).toBe('alert');
    expect(issues.textContent).toContain('主按钮文字被发光层污染');
    expect(issues.textContent).toContain('正文字号低于最小可读阈值');
  });
});
