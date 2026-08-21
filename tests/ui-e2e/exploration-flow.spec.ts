// UIE2E-10/11: exploration route (new project). Style analysis must never
// start automatically when entering the style stage, and locking the style
// must keep the approved layout approved so the pipeline can advance to
// visual exploration without the legacy Layout—Style loop.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider } from './fixtureProvider';
import { approveContract, clickRun, getProject, importWireframeAndIntent, launchApp } from './helpers';
import type { LaunchedApp } from './helpers';

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;

const styleRequests = () => provider.requests.filter((request) => request.kind === 'chat' && request.head.includes('-style-contract')).length;

test.describe.serial('exploration route flow (UIE2E-10/11)', () => {
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

  test('UIE2E-10 entering the style stage never auto-analyzes; only the explicit button does', async () => {
    // Fresh workspace: the create dialog opens automatically; default type is new project.
    await page.getByTestId('create-project-dialog').waitFor({ state: 'visible', timeout: 60_000 });
    await page.locator('.create-dialog input[placeholder*="云境计划"]').fill('E2E Exploration Flow');
    await clickRun(page, 'create-project');
    await importWireframeAndIntent(launched);
    await approveContract(page);
    await clickRun(page, 'layout-generate');
    await expect(page.locator('.proposal-tabs')).toBeVisible();
    await clickRun(page, 'layout-approve');

    // Navigation into the style stage must not trigger any model call.
    await clickRun(page, 'style-enter');
    await page.waitForTimeout(400);
    await expect(page.locator('.busy-bar')).toHaveCount(0);
    const beforeClick = await getProject(page, 'E2E Exploration Flow');
    expect(beforeClick.artifacts.styleContract).toBeFalsy();
    expect(styleRequests()).toBe(0);

    // The explicit style-generate button is the only trigger.
    await clickRun(page, 'style-generate');
    expect(styleRequests()).toBe(1);
  });

  test('UIE2E-11 locking the style keeps the layout approved and visual exploration advances', async () => {
    await clickRun(page, 'style-approve');
    let project = await getProject(page, 'E2E Exploration Flow');
    expect(project.artifacts.styleContract?.status).toBe('approved');
    // Regression guard for the legacy Layout—Style cycle: the approved layout
    // must survive style resolution.
    expect(project.artifacts.approvedLayout?.status).toBe('approved');

    provider.armUnderlayGeneration();
    await clickRun(page, 'visual-generate');
    await expect(page.locator('.visual-grid .visual-card')).toHaveCount(3, { timeout: 300_000 });
    await expect(page.locator('.error-banner')).toHaveCount(0);
    project = await getProject(page, 'E2E Exploration Flow');
    expect(project.artifacts.approvedLayout?.status).toBe('approved');
    expect(project.artifacts.visualResults?.status).not.toBe('stale');
  });
});
