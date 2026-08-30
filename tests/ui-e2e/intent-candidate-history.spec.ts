// v1.4 §16 场景 C/G：老项目自由文本照常保存；重新预填先生成 candidate；
// 采用后旧版本进入历史；恢复历史后确认被取消，需要重新确认。
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider, GOLDEN_ASSETS } from './fixtureProvider';
import { clickRun, confirmStructuredIntent, createStrictProject, getProject, launchApp, queueOpenFiles } from './helpers';
import type { LaunchedApp } from './helpers';

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;

test.describe.serial('legacy project candidate and history (v1.4 §16 C/G)', () => {
  test.beforeAll(async () => {
    provider = new FixtureProvider();
    await provider.start();
    launched = await launchApp(provider);
    page = launched.page;
    await createStrictProject(page, 'E2E Intent Candidate History');
    await queueOpenFiles(launched.app, [GOLDEN_ASSETS.wireframe]);
    await clickRun(page, 'wireframe-import');
  });

  test.afterAll(async () => {
    await launched?.app.close();
    await provider?.stop();
  });

  test('legacy free text stays editable, regenerate produces a candidate instead of overwriting', async () => {
    await page.locator('.design-brief-card textarea').fill('老项目的手工意图：展示帮派 BOSS 进度并提供挑战入口。');
    await page.locator('.workspace-heading .button').click();
    await page.locator('.busy-bar').waitFor({ state: 'detached', timeout: 120_000 });
    let project = await getProject(page);
    expect(project.requirement).toContain('老项目的手工意图');
    expect(project.intent_mode).toBeFalsy();
    // §16 G：重新预填不覆盖当前输入，先生成 candidate 等待决定。
    await page.locator('.design-brief-card button', { hasText: '重新预填' }).click();
    await page.locator('.busy-bar').waitFor({ state: 'detached', timeout: 120_000 });
    await expect(page.locator('.error-banner')).toHaveCount(0);
    await expect(page.locator('.intent-candidate-diff')).toBeVisible();
    project = await getProject(page);
    expect(project.requirement).toContain('老项目的手工意图');
    expect(project.intent_mode).toBeFalsy();
  });

  test('adopting the candidate switches to structured-v2 and archives the previous version in history', async () => {
    await clickRun(page, 'intent-candidate-adopt');
    const project = await getProject(page);
    expect(project.intent_mode).toBe('structured-v2');
    expect(project.requirement_confirmed).toBe(false);
    // 采用前的版本自动留档，原因标签对用户可读。
    const historyWrap = page.locator('.intent-history-wrap');
    await historyWrap.locator('summary').click();
    await expect(historyWrap.locator('.intent-history-entry')).toHaveCount(1);
    await expect(historyWrap).toContainText('采用 candidate 前版本');
  });

  test('restoring history cancels confirmation and the flow re-confirms through the UI', async () => {
    const historyWrap = page.locator('.intent-history-wrap');
    const entry = historyWrap.locator('.intent-history-entry').first();
    await entry.locator('button', { hasText: '恢复' }).click();
    // §10.7：恢复前二次确认，并提示恢复后需要重新确认。
    await expect(entry.locator('[role="alert"]')).toContainText('重新确认');
    await entry.locator('button', { hasText: '确认恢复' }).click();
    await page.locator('.busy-bar').waitFor({ state: 'detached', timeout: 120_000 });
    await expect(page.locator('.error-banner')).toHaveCount(0);
    const restored = await getProject(page);
    expect(restored.requirement_confirmed).toBe(false);
    // 恢复的版本重新走确认门禁后仍可进入下游。
    await confirmStructuredIntent(page);
    await page.getByTestId('stage-wireframe_interpretation').click();
    await expect(page.locator('.contract-overview')).toBeVisible();
  });
});
