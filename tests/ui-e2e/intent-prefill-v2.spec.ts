// v1.4 §16 场景 A/B：空白项目首次预填得到固定六段草稿；需求文本只读；
// 重新预填产生 candidate，采用后必须先处理待确认项才能确认；丢弃不改当前输入。
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider, GOLDEN_ASSETS, intentAnalysisV2Fixture, intentAnalysisV2WithUncertainty } from './fixtureProvider';
import { answerUnreviewedUncertainties, clickRun, createNewProject, getProject, launchApp, queueOpenFiles } from './helpers';
import type { LaunchedApp } from './helpers';

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;

test.describe.serial('structured-v2 intent prefill (v1.4 §16 A/B)', () => {
  test.beforeAll(async () => {
    provider = new FixtureProvider();
    await provider.start();
    launched = await launchApp(provider);
    page = launched.page;
    await createNewProject(page, 'E2E Intent Prefill V2');
    await queueOpenFiles(launched.app, [GOLDEN_ASSETS.wireframe]);
    await clickRun(page, 'wireframe-import');
  });

  test.afterAll(async () => {
    await launched?.app.close();
    await provider?.stop();
  });

  test('blank project first prefill produces the fixed six sections and confirms into the contract', async () => {
    await expect(page.locator('.intent-section')).toHaveCount(0);
    await clickRun(page, 'intent-draft');
    // 六段固定：页面目的 + 四个列表段，全部来自 UI，不需要看 JSON。
    await expect(page.locator('.intent-section')).toHaveCount(5);
    await expect(page.getByLabel('玩家任务第 1 条')).toBeVisible();
    // §10.3 来源标签以文字呈现。
    await expect(page.locator('.intent-badge', { hasText: '图中可见' }).first()).toBeVisible();
    // §15：structured-v2 的需求文本只读展示。
    await expect(page.locator('.design-brief-card.is-readonly textarea')).toBeVisible();
    const project = await getProject(page);
    expect(project.intent_mode).toBe('structured-v2');
    expect(project.requirement_confirmed).toBe(false);
    await clickRun(page, 'intent-confirm');
    await page.getByTestId('stage-wireframe_interpretation').click();
    await expect(page.locator('.contract-overview')).toBeVisible();
  });

  test('regenerate yields a candidate; adopting it blocks confirmation until uncertainties are answered', async () => {
    await page.getByTestId('stage-input').click();
    provider.armIntentAnalysisSequence([intentAnalysisV2WithUncertainty()]);
    await clickRun(page, 'intent-regenerate');
    await expect(page.locator('.intent-candidate-diff')).toBeVisible();
    await clickRun(page, 'intent-candidate-adopt');
    // 采用是整版替换：新的待确认项随之进入评审，确认按钮被门禁挡住。
    await expect(page.locator('.intent-uncertainty.is-unreviewed')).toHaveCount(1);
    await expect(page.getByTestId('intent-confirm')).toBeDisabled();
    await expect(page.locator('.intent-blockers')).toBeVisible();
    const handled = await answerUnreviewedUncertainties(page);
    expect(handled).toBe(1);
    await expect(page.getByTestId('intent-confirm')).toBeEnabled();
    await clickRun(page, 'intent-confirm');
    await page.getByTestId('stage-wireframe_interpretation').click();
    await expect(page.locator('.contract-overview')).toBeVisible();
  });

  test('discarding a candidate keeps the current review untouched', async () => {
    await page.getByTestId('stage-input').click();
    const currentPurpose = await page.locator('textarea[aria-label="页面目的"]').inputValue();
    provider.armIntentAnalysisSequence([intentAnalysisV2Fixture({ page_purpose: '完全不同的另一个页面目的' })]);
    await clickRun(page, 'intent-regenerate');
    await expect(page.locator('.intent-candidate-diff')).toBeVisible();
    await clickRun(page, 'intent-candidate-discard');
    await expect(page.locator('.intent-candidate-diff')).toHaveCount(0);
    await expect(page.locator('textarea[aria-label="页面目的"]')).toHaveValue(currentPurpose);
    const project = await getProject(page);
    expect(project.requirement).not.toContain('完全不同的另一个页面目的');
  });
});
