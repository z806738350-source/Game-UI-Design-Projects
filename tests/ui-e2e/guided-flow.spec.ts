// UIE2E-12: guided route (existing project, guided continuation). The guided
// route shares the exploration ordering — layout first, then style — so the
// same two regressions are guarded here: entering the style stage never
// auto-analyzes, and locking the style keeps the approved layout approved so
// visual exploration can advance instead of looping back to layout.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider } from './fixtureProvider';
import {
  approveContract, chooseDropdown, clickRun, getProject, importReferencesAndGenerateStyle,
  importWireframeAndIntent, launchApp
} from './helpers';
import type { LaunchedApp } from './helpers';

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;

const styleRequests = () => provider.requests.filter((request) => request.kind === 'chat' && request.head.includes('-style-contract')).length;

test.describe.serial('guided route flow (UIE2E-12)', () => {
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

  test('UIE2E-12a guided route generates layout first and entering style never auto-analyzes', async () => {
    await page.getByTestId('create-project-dialog').waitFor({ state: 'visible', timeout: 60_000 });
    await page.locator('.create-dialog input[placeholder*="云境计划"]').fill('E2E Guided Flow');
    await page.locator('.project-type-grid button', { hasText: '已有项目' }).click();
    await chooseDropdown(page.getByTestId('create-continuation-select'), 'existing-guided');
    await clickRun(page, 'create-project');
    await importWireframeAndIntent(launched);
    await approveContract(page);
    // Guided ordering matches exploration: layout before style.
    await clickRun(page, 'layout-generate');
    await expect(page.locator('.proposal-tabs')).toBeVisible();
    await clickRun(page, 'layout-approve');

    // Navigation into the style stage must not trigger any model call.
    await clickRun(page, 'style-enter');
    await page.waitForTimeout(400);
    await expect(page.locator('.busy-bar')).toHaveCount(0);
    const project = await getProject(page, 'E2E Guided Flow');
    expect(project.artifacts.styleContract).toBeFalsy();
    expect(styleRequests()).toBe(0);
  });

  test('UIE2E-12b guided style locking keeps the layout approved and visual exploration advances', async () => {
    // Reference import plus the explicit style-generate button are the only
    // style triggers on this route as well.
    await importReferencesAndGenerateStyle(launched);
    expect(styleRequests()).toBe(1);
    const project = await getProject(page, 'E2E Guided Flow');
    expect(project.artifacts.styleContract?.status).toBe('approved');
    // Regression guard for the legacy Layout—Style cycle: the approved layout
    // must survive style resolution on the guided route too.
    expect(project.artifacts.approvedLayout?.status).toBe('approved');

    provider.armUnderlayGeneration();
    await clickRun(page, 'visual-generate');
    await expect(page.locator('.visual-grid .visual-card')).toHaveCount(3, { timeout: 300_000 });
    await expect(page.locator('.error-banner')).toHaveCount(0);
    const after = await getProject(page, 'E2E Guided Flow');
    expect(after.artifacts.approvedLayout?.status).toBe('approved');
    expect(after.artifacts.visualResults?.status).not.toBe('stale');
  });
});
