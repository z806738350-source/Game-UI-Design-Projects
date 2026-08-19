// UIE2E-02: multi-screen isolation. Screen B starts empty and independent;
// approving a contract on Screen A must never leak into Screen B.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider } from './fixtureProvider';
import {
  approveContract, createStrictProject, getProject, importWireframeAndIntent, launchApp
} from './helpers';
import type { LaunchedApp } from './helpers';

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;

test.describe.serial('multi-screen isolation (UIE2E-02)', () => {
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

  test('contract approval on Screen A', async () => {
    await createStrictProject(page, 'E2E Multi Screen');
    await importWireframeAndIntent(launched);
    await approveContract(page);
    const project = await getProject(page);
    expect(project.artifacts.screenContract?.status).toBe('approved');
  });

  test('Screen B starts isolated and stays isolated', async () => {
    const dock = page.getByTestId('screen-manager');
    await dock.locator('input[placeholder="新页面名称"]').fill('battle');
    await dock.getByTestId('screen-manager-create').click();
    await expect(dock.locator('select').first().locator('option')).toHaveCount(2);
    await dock.locator('select').first().selectOption({ label: 'battle' });
    await expect(dock.locator('b', { hasText: 'battle' })).toBeVisible();

    // Independent requirement: Screen B has no inherited intent text.
    await page.getByTestId('stage-input').click();
    await expect(page.locator('.design-brief-card textarea')).toHaveValue('');

    // No inherited contract on Screen B.
    await page.getByTestId('stage-wireframe_interpretation').click();
    await expect(page.locator('.contract-overview')).toHaveCount(0);
    await expect(page.locator('.empty-artifact, [class*="empty"]').first()).toBeVisible();

    const project = await getProject(page);
    expect(project.screen_id).toBe('battle');
    expect(project.artifacts.screenContract).toBeFalsy();
  });

  test('Screen A keeps its approved contract', async () => {
    await page.getByTestId('screen-manager').locator('select').first().selectOption('main');
    await page.getByTestId('stage-wireframe_interpretation').click();
    await expect(page.locator('.contract-overview')).toBeVisible();
    const project = await getProject(page);
    expect(project.screen_id).toBe('main');
    expect(project.artifacts.screenContract?.status).toBe('approved');
  });
});
