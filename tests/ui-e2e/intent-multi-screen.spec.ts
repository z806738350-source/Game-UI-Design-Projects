// v1.4 §16 场景 H：structured-v2 状态按 Screen 隔离——A 屏预填/确认不影响
// B 屏；Screen Clone 的确认被取消，必须重新确认。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider, GOLDEN_ASSETS } from './fixtureProvider';
import {
  clickRun, confirmStructuredIntent, createStrictProject, deriveAsset, findProjectDir, getProject,
  importWireframeAndIntent, launchApp, queueOpenFiles, switchScreen
} from './helpers';
import type { LaunchedApp } from './helpers';

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;
let wireframeB = '';

test.describe.serial('structured-v2 multi-screen isolation (v1.4 §16 H)', () => {
  test.beforeAll(async () => {
    provider = new FixtureProvider();
    await provider.start();
    launched = await launchApp(provider);
    page = launched.page;
    wireframeB = path.join(os.tmpdir(), `ui-e2e-intent-ms-b-${Date.now()}.png`);
    await deriveAsset(GOLDEN_ASSETS.wireframe, wireframeB);
  });

  test.afterAll(async () => {
    await launched?.app.close();
    await provider?.stop();
  });

  test('Screen A prefills and confirms independently', async () => {
    await createStrictProject(page, 'E2E Intent Multi Screen');
    await importWireframeAndIntent(launched);
    const project = await getProject(page);
    expect(project.intent_mode).toBe('structured-v2');
    expect(project.requirement_confirmed).toBe(true);
  });

  test('Screen B starts without inherited intent state and builds its own review', async () => {
    const dock = page.getByTestId('screen-manager');
    await dock.locator('input[placeholder="新页面名称"]').fill('battle');
    await dock.getByTestId('screen-manager-create').click();
    await switchScreen(page, 'battle');
    await page.getByTestId('stage-input').click();
    // B 屏没有任何意图状态：回到空白输入，而不是看到 A 屏的评审。
    await expect(page.locator('.intent-section')).toHaveCount(0);
    await expect(page.locator('.design-brief-card textarea')).toHaveValue('');
    await queueOpenFiles(launched.app, [wireframeB]);
    await clickRun(page, 'wireframe-import');
    await clickRun(page, 'intent-draft');
    await confirmStructuredIntent(page);
    const project = await getProject(page);
    expect(project.screen_id).toBe('battle');
    expect(project.intent_mode).toBe('structured-v2');
    expect(project.requirement_confirmed).toBe(true);
    // 权威输入按 Screen 分文件留档，互不覆盖。
    const projectDir = findProjectDir(launched, 'screens/battle/inputs.json');
    const battleInputs = JSON.parse(fs.readFileSync(path.join(projectDir, 'screens', 'battle', 'inputs.json'), 'utf8'));
    const mainInputs = JSON.parse(fs.readFileSync(path.join(projectDir, 'screens', 'main', 'inputs.json'), 'utf8'));
    expect(battleInputs.intent_review).toBeTruthy();
    expect(mainInputs.intent_review).toBeTruthy();
    expect(battleInputs.intent_review).not.toEqual(mainInputs.intent_review);
  });

  test('Screen A keeps its own confirmed review after B finishes', async () => {
    await switchScreen(page, 'main');
    await page.getByTestId('stage-input').click();
    await expect(page.locator('.intent-section')).toHaveCount(5);
    await expect(page.locator('.intent-uncertainty.is-unreviewed')).toHaveCount(0);
    const project = await getProject(page);
    expect(project.screen_id).toBe('main');
    expect(project.requirement_confirmed).toBe(true);
  });

  test('cloning a confirmed screen cancels confirmation on the copy', async () => {
    const dock = page.getByTestId('screen-manager');
    await dock.locator('button[title="复制当前页面及全部产物"]').click();
    await switchScreen(page, 'main-copy');
    const project = await getProject(page);
    expect(project.screen_id).toBe('main-copy');
    // §16 H：Clone 的 confirmed=false，必须重新确认才能进入下游。
    expect(project.requirement_confirmed).toBe(false);
    expect(project.intent_mode).toBe('structured-v2');
    await page.getByTestId('stage-input').click();
    await expect(page.getByTestId('intent-confirm')).toBeEnabled();
  });
});
