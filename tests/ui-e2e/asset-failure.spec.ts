// UIE2E-07B/07C/07D: local file faults and component changes, all triggered
// and observed through the UI. The test process deletes or tampers with
// workspace files (allowed fault injection); every gate reaction must be
// visible as an error banner, a fidelity issue code, a disabled approval, or
// a stale artifact chain — never a silent pass.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider, GOLDEN_ASSETS } from './fixtureProvider';
import {
  approveContract, approveStrictLayout, clickRun, closeErrorBanner, createStrictProject,
  deriveAsset, expectErrorBanner, findProjectDir, generateUnderlays, getProject,
  importComponentState, importComponents, importFonts, importReferencesAndGenerateStyle,
  importWireframeAndIntent, launchApp, selectAndApproveBindings
} from './helpers';
import type { LaunchedApp } from './helpers';

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;

test.describe.serial('asset failure paths (UIE2E-07B/07C/07D)', () => {
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

  test('happy path reaches final composition with passing fidelity', async () => {
    await createStrictProject(page, 'E2E Asset Failures');
    await importWireframeAndIntent(launched);
    await approveContract(page);
    await importReferencesAndGenerateStyle(launched);
    await importFonts(launched);
    await importComponents(launched);
    await selectAndApproveBindings(page);
    await approveStrictLayout(page);
    await generateUnderlays(launched, provider);
    provider.armCritiqueSequence(['contaminated', 'repaired']);
    await clickRun(page, 'underlay-critique');
    provider.armRepair();
    await clickRun(page, 'underlay-repair');
    await expect(page.locator('.strict-production header i', { hasText: 'Critique' })).toHaveClass(/is-ready/);
    await clickRun(page, 'composition-final');
    await clickRun(page, 'fidelity-run');
    const project = await getProject(page);
    expect(project.artifacts.fidelityReport?.status).toBe('passed');
    expect(project.artifacts.compositionOutput?.mode).toBe('final');
  });

  test('UIE2E-07B deleting the font file blocks Final Composition through the UI', async () => {
    const fontPath = path.join(findProjectDir(launched, 'style/fonts/oxanium.ttf'), 'style', 'fonts', 'oxanium.ttf');
    expect(fs.existsSync(fontPath)).toBe(true);
    fs.rmSync(fontPath);

    await clickRun(page, 'composition-final', { allowError: true });
    await expectErrorBanner(page, /FONT_ASSET_HASH_MISMATCH|FONT_ACTUAL_LOAD_FAILED/);
    await closeErrorBanner(page);

    // The failed regeneration attempt invalidates the previous evidence chain:
    // final approval must stay unavailable until fonts are restored and the
    // composition plus fidelity gates pass again.
    await expect(page.getByTestId('final-approve')).toBeDisabled();

    // Recovery: restore the identical golden font and rebuild the evidence.
    fs.copyFileSync(GOLDEN_ASSETS.font, fontPath);
    await clickRun(page, 'composition-final');
    await clickRun(page, 'fidelity-run');
    const project = await getProject(page);
    expect(project.artifacts.fidelityReport?.status).toBe('passed');
  });

  test('UIE2E-07C tampering with a component asset fails Fidelity and blocks approval/export', async () => {
    const componentPath = path.join(findProjectDir(launched, 'style/components/primary-button/default.png'), 'style', 'components', 'primary-button', 'default.png');
    // Replace the approved asset bytes with a different image (same format).
    await deriveAsset(GOLDEN_ASSETS.componentAsset('primary-button', 'pressed'), componentPath);

    await clickRun(page, 'fidelity-run');
    // The failed gate is shown as issue codes in the Fidelity Workbench.
    await expect(page.getByTestId('fidelity-status')).not.toHaveText('passed');
    await expect(page.getByTestId('fidelity-issues')).toContainText('COMPONENT_ASSET_HASH_MISMATCH');

    const project = await getProject(page);
    expect(project.artifacts.fidelityReport?.status).not.toBe('passed');
    await expect(page.getByTestId('final-approve')).toBeDisabled();

    // Export is blocked by the failed fidelity gate and surfaces the block.
    await clickRun(page, 'final-export', { allowError: true });
    await expectErrorBanner(page, /FINAL_EXPORT_BLOCKED|无法导出最终成图/);
    await closeErrorBanner(page);

    // Restore the approved asset bytes for the next scenario.
    fs.copyFileSync(GOLDEN_ASSETS.componentAsset('primary-button', 'default'), componentPath);
  });

  test('UIE2E-07D re-importing a changed component propagates stale through the dependency graph', async () => {
    const changedAsset = path.join(os.tmpdir(), `ui-e2e-changed-component-${Date.now()}.png`);
    await deriveAsset(GOLDEN_ASSETS.componentAsset('primary-button', 'default'), changedAsset);

    // The re-import goes through the Component Kit Workbench UI.
    await page.getByTestId('stage-style_resolution').click();
    await importComponentState(launched, 'primary-button', 'default', { filePath: changedAsset });

    const project = await getProject(page);
    expect(project.artifacts.componentContract?.status).toBe('reviewed');
    // The whole downstream chain follows the dependency graph.
    expect(project.artifacts.bindings?.status).toBe('stale');
    expect(project.artifacts.approvedLayout?.status).toBe('stale');
    expect(project.artifacts.compositionManifest?.status).toBe('stale');
    expect(project.artifacts.compositionOutput?.status).toBe('stale');
    expect(project.artifacts.fidelityReport?.status).toBe('stale');

    // Final approval and export are unavailable while the chain is stale.
    await page.getByTestId('stage-visual_exploration').click();
    await expect(page.getByTestId('final-approve')).toBeDisabled();
    await clickRun(page, 'final-export', { allowError: true });
    await expectErrorBanner(page, /FINAL_EXPORT_BLOCKED|无法导出最终成图/);
    await closeErrorBanner(page);
  });
});
