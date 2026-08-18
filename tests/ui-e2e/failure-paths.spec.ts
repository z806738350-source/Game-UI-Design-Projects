// UIE2E-07: failure paths. Provider outages surface in the global error
// banner; semantic contract edits mark downstream bindings stale; a missing
// final PNG blocks export; switching guided→strict invalidates approvals.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider, GOLDEN_ASSETS } from './fixtureProvider';
import {
  approveContract, approveStrictLayout, callRendererApi, clickRun, closeErrorBanner, createStrictProject,
  expectErrorBanner, generateUnderlays, getProject, importComponents, importFonts,
  importReferencesAndGenerateStyle, importWireframeAndIntent, launchApp, queueOpenFiles, selectAndApproveBindings
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

  test('semantic contract edit marks bindings stale and blocks layout gate', async () => {
    const projectId = (await getProject(page)).id;
    await callRendererApi(page, `api.updateArtifact(${JSON.stringify(projectId)}, 'screen-contract', { purpose: 'E2E failure-path semantic edit of the page purpose.', screenId: 'main' })`);
    const project = await getProject(page);
    expect(project.artifacts.bindings?.status).toBe('stale');
    // The renderer-only call bypasses the run() boundary, so reload to let
    // the shell re-read project state; the gate must reflect the staleness.
    await page.reload();
    await page.waitForSelector('.app-shell');
    await page.getByTestId('stage-style_resolution').click();
    await expect(page.locator('.strict-gates i', { hasText: 'Bindings' })).not.toHaveClass(/is-ready/);
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
    const projectDir = fs.readdirSync(launched.workspace)
      .find((entry) => fs.existsSync(path.join(launched.workspace, entry, relativeOutput)));
    expect(projectDir).toBeTruthy();
    const finalPng = path.join(launched.workspace, String(projectDir), relativeOutput);
    expect(fs.existsSync(finalPng)).toBe(true);
    fs.rmSync(finalPng);

    const variationId = String((project.artifacts.visualResults?.variations as Array<{ id: string }>)[0]?.id || '');
    const result = await callRendererApi<{ ok: boolean; message?: string }>(
      page,
      `api.exportVisual(${JSON.stringify(project.id)}, ${JSON.stringify(variationId)}).then(() => ({ ok: true }), (cause) => ({ ok: false, message: String(cause?.message || cause) }))`
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/FINAL_EXPORT_BLOCKED|无法导出最终成图/);
  });

  test('guided→strict switch invalidates approvals and recovers under strict', async () => {
    // New guided project through contract approval. Guided mode deliberately
    // offers no asset/binding workbenches, so deeper stages are only reachable
    // after an explicit switch to strict continuation.
    await page.locator('.project-switcher button', { hasText: '新项目' }).click();
    await page.locator('.create-dialog input[placeholder*="云境计划"]').fill('E2E Guided Switch');
    await page.locator('.project-type-grid button', { hasText: '已有项目' }).click();
    await page.locator('.create-dialog select').selectOption('existing-guided');
    await clickRun(page, 'create-project');
    await importWireframeAndIntent(launched);
    await approveContract(page);
    let project = await getProject(page, 'E2E Guided Switch');
    expect(project.continuation_mode).toBe('existing-guided');
    expect(project.artifacts.screenContract?.status).toBe('approved');

    // Switching continuation mode is a global input change. The functional
    // contract stays valid, but every style-driven approval downstream of the
    // mode becomes stale once it exists.
    await callRendererApi(page, `api.saveProject(${JSON.stringify(project.id)}, { continuationMode: 'existing-strict', screenId: 'main' })`);
    project = await getProject(page, 'E2E Guided Switch');
    expect(project.continuation_mode).toBe('existing-strict');
    expect(project.artifacts.screenContract?.status).toBe('approved');
    await page.reload();
    await page.waitForSelector('.app-shell');

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
    await callRendererApi(page, `api.saveProject(${JSON.stringify(project.id)}, { continuationMode: 'existing-guided', screenId: 'main' })`);
    project = await getProject(page, 'E2E Guided Switch');
    expect(project.continuation_mode).toBe('existing-guided');
    expect(project.artifacts.styleContract?.status).toBe('stale');
    expect(project.artifacts.approvedLayout?.status).toBe('stale');
    await page.reload();
    await page.waitForSelector('.app-shell');
    await page.getByTestId('stage-layout_design').click();
    await expect(page.locator('.stale-guidance').first()).toBeVisible();
  });
});
