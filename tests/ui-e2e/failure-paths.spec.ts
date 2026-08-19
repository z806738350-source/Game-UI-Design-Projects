// UIE2E-07 failure paths: every mutation is performed through the real UI.
// A provider outage surfaces as an error banner with recovery; a semantic
// contract edit marks downstream bindings stale; a missing final PNG blocks
// export; switching guided↔strict through the input-stage UI invalidates
// mode-dependent approvals. No renderer API mutation calls remain (F-03).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider, GOLDEN_ASSETS } from './fixtureProvider';
import {
  approveContract, approveStrictLayout, chooseDropdown, clickRun, closeErrorBanner, createStrictProject,
  editContractPurposeViaUi, expectErrorBanner, findProjectDir, generateUnderlays, getProject,
  importComponents, importFonts, importReferencesAndGenerateStyle, importWireframeAndIntent,
  launchApp, queueOpenFiles, selectAndApproveBindings, switchContinuationModeViaUi
} from './helpers';
import type { LaunchedApp } from './helpers';

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;

test.describe.serial('failure paths (UIE2E-07)', () => {
  test.beforeAll(async () => {
    provider = new FixtureProvider();
    await provider.start();
    launched = await launchApp(provider);
    page = launched.page;
    await createStrictProject(page, 'E2E Failure Paths');
  });

  test.afterAll(async () => {
    await launched?.app.close();
    await provider?.stop();
  });

  test('provider outage blocks intent drafting with a visible error', async () => {
    await queueOpenFiles(launched.app, [GOLDEN_ASSETS.wireframe]);
    await clickRun(page, 'wireframe-import');
    provider.failNextChatRequests(3);
    await clickRun(page, 'intent-draft', { allowError: true });
    await expectErrorBanner(page, /Kunpo request failed|fixture provider/);
    await closeErrorBanner(page);
    // Recovery: the same action succeeds once the provider is healthy again.
    await clickRun(page, 'intent-draft');
  });

  test('happy path reaches approved bindings', async () => {
    await clickRun(page, 'intent-confirm');
    await approveContract(page);
    await importReferencesAndGenerateStyle(launched);
    await importFonts(launched);
    await importComponents(launched);
    await selectAndApproveBindings(page);
    const project = await getProject(page);
    expect(project.artifacts.bindings?.status).toBe('approved');
  });

  test('semantic contract edit through the workbench UI marks bindings stale', async () => {
    await editContractPurposeViaUi(page, 'E2E failure-path semantic edit of the page purpose.');
    const project = await getProject(page);
    expect(project.artifacts.bindings?.status).toBe('stale');
    // The edit went through the run() boundary, so the shell already holds
    // fresh state; the layout gate must reflect the staleness immediately.
    await page.getByTestId('stage-style_resolution').click();
    await expect(page.locator('.strict-gates i', { hasText: '控件绑定' })).not.toHaveClass(/is-ready/);
    await expect(page.getByTestId('strict-layout-generate')).toBeDisabled();
  });

  test('re-approve contract, bindings, reach final, then missing final PNG blocks export', async () => {
    // The semantic edit also demoted the contract itself and downstream
    // approvals; re-approve them before strict production can resume.
    await approveContract(page);
    await page.getByTestId('stage-style_resolution').click();
    await clickRun(page, 'style-generate');
    await clickRun(page, 'style-approve');
    // Stale propagation also demoted the imported asset approvals; the assets
    // themselves are unchanged, so re-approval restores the gates.
    await clickRun(page, 'font-approve');
    await clickRun(page, 'component-approve');
    await clickRun(page, 'binding-approve');
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
    const relativeOutput = String((project.artifacts.compositionOutput as { path?: string })?.path || '');
    const finalPng = path.join(findProjectDir(launched, relativeOutput), relativeOutput);
    expect(fs.existsSync(finalPng)).toBe(true);
    fs.rmSync(finalPng);

    // Export is clicked through the UI; the blocked export must surface as a
    // visible error, not as a silent rejection.
    await clickRun(page, 'final-export', { allowError: true });
    await expectErrorBanner(page, /FINAL_EXPORT_BLOCKED|无法导出最终成图/);
    await closeErrorBanner(page);
  });

  test('guided→strict switch through the input-stage UI invalidates approvals and recovers', async () => {
    // New guided project through contract approval. Guided mode deliberately
    // offers no asset/binding workbenches, so deeper stages are only reachable
    // after an explicit switch to strict continuation.
    await page.locator('.project-switcher button', { hasText: '新项目' }).click();
    await page.locator('.create-dialog input[placeholder*="云境计划"]').fill('E2E Guided Switch');
    await page.locator('.project-type-grid button', { hasText: '已有项目' }).click();
    await chooseDropdown(page.getByTestId('create-continuation-select'), 'existing-guided');
    await clickRun(page, 'create-project');
    await importWireframeAndIntent(launched);
    await approveContract(page);
    let project = await getProject(page, 'E2E Guided Switch');
    expect(project.continuation_mode).toBe('existing-guided');
    expect(project.artifacts.screenContract?.status).toBe('approved');

    // Switching continuation mode is a global input change, performed via the
    // input-stage select. The functional contract stays valid, but every
    // style-driven approval downstream of the mode becomes stale once it exists.
    await switchContinuationModeViaUi(page, 'existing-strict');
    project = await getProject(page, 'E2E Guided Switch');
    expect(project.continuation_mode).toBe('existing-strict');
    expect(project.artifacts.screenContract?.status).toBe('approved');

    // Recovery: the strict workbenches become available and the full pipeline
    // can rebuild every approval on top of the same inputs.
    await importReferencesAndGenerateStyle(launched);
    await importFonts(launched);
    await importComponents(launched);
    await selectAndApproveBindings(page);
    await approveStrictLayout(page);
    project = await getProject(page, 'E2E Guided Switch');
    expect(project.artifacts.bindings?.status).toBe('approved');
    expect(project.artifacts.approvedLayout?.status).toBe('approved');

    // Switching back to guided invalidates the mode-dependent approvals.
    await switchContinuationModeViaUi(page, 'existing-guided');
    project = await getProject(page, 'E2E Guided Switch');
    expect(project.continuation_mode).toBe('existing-guided');
    expect(project.artifacts.styleContract?.status).toBe('stale');
    expect(project.artifacts.approvedLayout?.status).toBe('stale');
    await page.getByTestId('stage-layout_design').click();
    await expect(page.locator('.stale-guidance').first()).toBeVisible();
  });
});
