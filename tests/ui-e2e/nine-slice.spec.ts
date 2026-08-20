// UIE2E-03B: nine-slice components are configured entirely through the
// Component Kit Workbench UI (reuse strategy + L/R/T/B margins), and the
// final composition must prove the nine-slice renderer ran and that fixed
// corner patches stayed pixel-identical.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider } from './fixtureProvider';
import {
  approveContract, approveStrictLayout, clickRun, createStrictProject, generateUnderlays,
  getProject, importComponents, importFonts, importReferencesAndGenerateStyle,
  importWireframeAndIntent, launchApp, selectAndApproveBindings
} from './helpers';
import type { LaunchedApp } from './helpers';

type NineSlicePatch = { fixed_corner?: boolean; source_hash?: string; rendered_hash?: string };
type RenderLogLayer = { renderer?: string; margins?: number[]; patches?: NineSlicePatch[] };

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;

test.describe.serial('nine-slice UI configuration (UIE2E-03B)', () => {
  test.beforeAll(async () => {
    provider = new FixtureProvider();
    await provider.start();
    launched = await launchApp(provider);
    page = launched.page;
  });

  test.afterAll(async () => {
    await launched?.app.close();
    await provider?.stop();
  });

  test('nine-slice family with margins configured through the workbench UI', async () => {
    await createStrictProject(page, 'E2E Nine Slice');
    await importWireframeAndIntent(launched);
    await approveContract(page);
    await importReferencesAndGenerateStyle(launched);
    await importFonts(launched);
    // primary-button ships default/pressed/disabled states and is imported as
    // a nine-slice family with explicit margins through the UI.
    await importComponents(launched, { 'primary-button': { reuse: 'nine-slice', margins: '12,12,12,12' } });

    const project = await getProject(page);
    expect(project.artifacts.componentContract?.status).toBe('approved');
    const families = (project.artifacts.componentContract?.families as Array<Record<string, unknown>>) || [];
    const button = families.find((family) => family.id === 'primary-button');
    expect(button?.reuse_mode).toBe('nine-slice');
    expect((button?.slice as { margins?: number[] })?.margins).toEqual([12, 12, 12, 12]);
    expect(Object.keys((button?.states as Record<string, unknown>) || {})).toEqual(expect.arrayContaining(['default', 'pressed', 'disabled']));
  });

  test('final composition renders nine-slice layers with undistorted fixed corners', async () => {
    await selectAndApproveBindings(page);
    await approveStrictLayout(page);
    await generateUnderlays(launched, provider);
    provider.armCritiqueSequence(['contaminated', 'repaired']);
    await clickRun(page, 'underlay-critique');
    provider.armRepair();
    await clickRun(page, 'underlay-repair');
    await expect(page.getByTestId('strict-gate-critique')).toHaveClass(/is-ready/);
    await clickRun(page, 'composition-final');
    await clickRun(page, 'fidelity-run');

    const project = await getProject(page);
    expect(project.artifacts.fidelityReport?.status).toBe('passed');
    const layers = ((project.artifacts.compositionOutput as { render_log?: { layers?: RenderLogLayer[] } })?.render_log?.layers || []);
    const nineSliceLayers = layers.filter((layer) => layer.renderer === 'nine-slice');
    // primary-action and secondary-action both bind the nine-slice family.
    expect(nineSliceLayers.length).toBeGreaterThanOrEqual(2);
    for (const layer of nineSliceLayers) {
      expect(layer.margins).toEqual([12, 12, 12, 12]);
      const fixedCorners = (layer.patches || []).filter((patch) => patch.fixed_corner);
      expect(fixedCorners.length).toBe(4);
      for (const patch of fixedCorners) {
        // Fixed corner patches are copied, never resized: identical hashes
        // prove the corners stayed pixel-identical (undistorted).
        expect(patch.rendered_hash).toBe(patch.source_hash);
      }
    }
    // The fidelity gate's own nine-slice check agrees with the render log.
    const checks = (project.artifacts.fidelityReport?.checks as unknown as string[]) || [];
    expect(checks).toContain('nine-slice-fixed-regions');
  });
});
