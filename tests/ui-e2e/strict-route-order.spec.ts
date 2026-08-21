// UIE2E-13: strict route stage order. Existing-strict projects must resolve
// style (plus fonts, components, bindings) before any layout generation; the
// layout model call must only happen through the explicit strict button after
// all four gates are approved — never implicitly when entering a stage.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider } from './fixtureProvider';
import {
  approveContract, approveStrictLayout, createStrictProject, getProject, importComponents,
  importFonts, importReferencesAndGenerateStyle, importWireframeAndIntent, launchApp,
  selectAndApproveBindings
} from './helpers';
import type { LaunchedApp } from './helpers';

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;

const layoutRequests = () => provider.requests.filter((request) => request.kind === 'chat' && request.head.includes('-layout-proposals')).length;

test.describe.serial('strict route stage order (UIE2E-13)', () => {
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

  test('UIE2E-13a strict contract approval offers style first and never triggers layout', async () => {
    await createStrictProject(page, 'E2E Strict Route Order');
    await importWireframeAndIntent(launched);
    await approveContract(page);

    // Strict ordering: the contract page offers entering style, not layout.
    await expect(page.getByTestId('style-enter')).toBeVisible();
    await expect(page.getByTestId('layout-generate')).toHaveCount(0);

    // Navigation into the style stage is a pure transition: no busy state,
    // no model call of any layout kind.
    await page.getByTestId('style-enter').click();
    await page.waitForTimeout(400);
    await expect(page.locator('.busy-bar')).toHaveCount(0);
    expect(layoutRequests()).toBe(0);
  });

  test('UIE2E-13b component-aware layout only runs from the explicit strict button', async () => {
    await importReferencesAndGenerateStyle(launched);
    // All four gates must be approved before the strict layout button enables.
    await expect(page.getByTestId('strict-layout-generate')).toBeDisabled();
    await importFonts(launched);
    await expect(page.getByTestId('strict-layout-generate')).toBeDisabled();
    await importComponents(launched);
    await expect(page.getByTestId('strict-layout-generate')).toBeDisabled();
    await selectAndApproveBindings(page);
    await expect(page.getByTestId('strict-layout-generate')).toBeEnabled();
    // Completing the gates must not have triggered a layout generation either.
    expect(layoutRequests()).toBe(0);

    await approveStrictLayout(page);
    expect(layoutRequests()).toBe(1);
    const project = await getProject(page, 'E2E Strict Route Order');
    expect(project.artifacts.approvedLayout?.status).toBe('approved');
  });
});
