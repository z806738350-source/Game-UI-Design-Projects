// UIE2E-02/02B: multi-screen isolation and full screen lifecycle. Screen B
// starts empty and independent; approving a contract on Screen A must never
// leak into Screen B. Screen B then receives its own wireframe, intent and
// contract, and is renamed, duplicated and archived entirely through the UI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider, GOLDEN_ASSETS } from './fixtureProvider';
import {
  approveContract, clickRun, createStrictProject, deriveAsset, findProjectDir, getProject,
  importWireframeAndIntent, launchApp, queueOpenFiles, switchScreen
} from './helpers';
import type { LaunchedApp } from './helpers';

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;
let wireframeB = '';

test.describe.serial('multi-screen isolation and lifecycle (UIE2E-02/02B)', () => {
  test.beforeAll(async () => {
    provider = new FixtureProvider();
    await provider.start();
    launched = await launchApp(provider);
    page = launched.page;
    // Screen B must import a wireframe that differs from Screen A's; derive a
    // byte-distinct variant from the golden wireframe in the temp workspace.
    wireframeB = path.join(os.tmpdir(), `ui-e2e-wireframe-b-${Date.now()}.png`);
    await deriveAsset(GOLDEN_ASSETS.wireframe, wireframeB);
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
    await switchScreen(page, 'battle');
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
    await switchScreen(page, 'main');
    await page.getByTestId('stage-wireframe_interpretation').click();
    await expect(page.locator('.contract-overview')).toBeVisible();
    const project = await getProject(page);
    expect(project.screen_id).toBe('main');
    expect(project.artifacts.screenContract?.status).toBe('approved');
  });

  test('Screen B imports its own wireframe, intent and contract', async () => {
    await switchScreen(page, 'battle');
    await page.getByTestId('stage-input').click();
    await queueOpenFiles(launched.app, [wireframeB]);
    await clickRun(page, 'wireframe-import');
    // A requirement that differs from Screen A's: typed and confirmed by the
    // designer, no AI draft involved.
    await page.locator('.design-brief-card textarea').fill('独立需求：战斗结算页需要展示本局战损、奖励结算与返回主城入口。');
    await clickRun(page, 'intent-confirm');

    const project = await getProject(page);
    expect(project.screen_id).toBe('battle');
    expect(project.requirement).toContain('战斗结算页');
    const contract = project.artifacts.screenContract;
    expect(contract).toBeTruthy();
    expect(String(contract?.screen_id)).toBe('battle');
    await approveContract(page);
    const approved = await getProject(page);
    expect(approved.artifacts.screenContract?.status).toBe('approved');

    // Switching back to Screen A proves workflow and artifact isolation: A
    // keeps its own approved contract and input text.
    await switchScreen(page, 'main');
    const mainProject = await getProject(page);
    expect(mainProject.screen_id).toBe('main');
    expect(mainProject.artifacts.screenContract?.status).toBe('approved');
    expect(String(mainProject.artifacts.screenContract?.screen_id)).toBe('main');
    expect(mainProject.requirement).not.toContain('战斗结算页');
  });

  test('Screen B is renamed through the UI', async () => {
    const dock = page.getByTestId('screen-manager');
    await switchScreen(page, 'battle');
    await dock.locator('input[aria-label="当前页面名称"]').fill('激战');
    await dock.locator('button[title="重命名当前页面"]').click();
    await expect(dock.locator('b', { hasText: '激战' })).toBeVisible();
    const project = await getProject(page);
    const battle = (project.screens || []).find((screen) => screen.id === 'battle');
    expect(battle?.name).toBe('激战');
    // Renaming never changes the screen identity or its artifacts.
    expect(project.artifacts.screenContract?.status).toBe('approved');
  });

  test('Screen B is duplicated through the UI with its data', async () => {
    const dock = page.getByTestId('screen-manager');
    await dock.locator('button[title="复制当前页面及全部产物"]').click();
    await expect(dock.locator('select').first().locator('option')).toHaveCount(3);

    // Switch to the copy and verify identity plus copied data.
    await switchScreen(page, 'battle-copy');
    const project = await getProject(page);
    expect(project.screen_id).toBe('battle-copy');
    expect(project.artifacts.screenContract?.status).toBe('approved');
    expect(String(project.artifacts.screenContract?.screen_id)).toBe('battle');

    // The duplicated screen input records its provenance on disk.
    const inputsPath = path.join(findProjectDir(launched, 'screens/battle-copy/inputs.json'), 'screens', 'battle-copy', 'inputs.json');
    const inputs = JSON.parse(fs.readFileSync(inputsPath, 'utf8'));
    expect(inputs.duplicated_from_screen_id).toBe('battle');
  });

  test('the duplicate is archived through the UI without touching the original', async () => {
    const dock = page.getByTestId('screen-manager');
    // Archiving requires a different active screen; switch back to the original.
    await switchScreen(page, 'battle');
    await dock.locator('select[aria-label="要归档的非当前页面"]').selectOption('battle-copy');
    await dock.locator('button[title="归档选中的非当前页面"]').click();

    // Archived screens disappear from the switcher but stay in the registry.
    await expect(dock.locator('select').first().locator('option')).toHaveCount(2);
    const project = await getProject(page);
    const copy = (project.screens || []).find((screen) => screen.id === 'battle-copy');
    expect(copy?.status).toBe('archived');
    const battle = (project.screens || []).find((screen) => screen.id === 'battle');
    expect(battle?.status).toBe('active');
    // The original keeps its identity and approved contract.
    expect(project.artifacts.screenContract?.status).toBe('approved');
    expect(String(project.artifacts.screenContract?.screen_id)).toBe('battle');
  });
});
