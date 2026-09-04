import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider, GOLDEN_ASSETS } from './fixtureProvider';
import { chooseDropdown, clickRun, createNewProject, getProject, launchApp, queueOpenFiles } from './helpers';
import type { LaunchedApp } from './helpers';

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;

test.describe.serial('内嵌智能助手 A1/A2 安全闭环', () => {
  test.beforeAll(async () => {
    provider = new FixtureProvider();
    await provider.start();
    launched = await launchApp(provider, { assistant: true });
    page = launched.page;
  });

  test.afterAll(async () => {
    await launched?.app.close();
    await provider?.stop();
  });

  test('跨项目确认不串写，版本漂移进入 stale，并保持图库/模态/窄屏边界', async () => {
    await createNewProject(page, 'E2E 助手项目 A');
    await queueOpenFiles(launched.app, [GOLDEN_ASSETS.wireframe]);
    await clickRun(page, 'wireframe-import');
    await clickRun(page, 'intent-draft');
    const projectA = await getProject(page, 'E2E 助手项目 A');

    await page.getByRole('button', { name: 'AI 助手' }).click();
    const panel = page.getByTestId('assistant-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: '新建对话', exact: true }).click();
    await panel.getByRole('button', { name: '执行', exact: true }).click();
    await panel.getByLabel('输入消息').fill('请补充页面目的，并准备保存意图审查草稿。');
    await panel.getByRole('button', { name: '发送' }).click();
    const confirm = panel.getByRole('button', { name: '确认执行' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toHaveClass(/button--danger/);
    await expect(panel.locator('.button--primary')).toHaveCount(0);
    await expect(panel.getByTestId('assistant-conversation-switch').locator('.dropdown-button')).toContainText('待确认执行');
    const proposedRevision = Number((await getProject(page, 'E2E 助手项目 A')).input_revisions?.intent_review || 0);

    // 在确认前从正常 UI 改变 A 的 Intent revision，构造真实 stale。
    await panel.getByRole('button', { name: '关闭助手' }).click();
    await page.getByTestId('stage-input').click();
    const purpose = page.getByRole('textbox', { name: '页面目的' });
    await purpose.fill(`${await purpose.inputValue()}（设计师在确认前已更新）`);
    await clickRun(page, 'intent-review-save');
    expect(Number((await getProject(page, 'E2E 助手项目 A')).input_revisions?.intent_review || 0)).toBeGreaterThan(proposedRevision);

    // 切到 B 后旧对话可查看但不能继续。
    await page.getByRole('button', { name: 'AI 助手' }).click();
    await page.locator('.project-switcher > button').filter({ hasText: '新项目' }).click();
    await createNewProject(page, 'E2E 助手项目 B');
    const projectBBefore = await getProject(page, 'E2E 助手项目 B');
    await expect(panel).toContainText('该对话绑定的是另一个项目或 Screen');
    await expect(confirm).toBeDisabled();

    // 回到 A 确认旧动作：必须 stale，不得强制覆盖。
    await chooseDropdown(page.getByTestId('project-switcher-select'), projectA.id);
    await expect(page.getByTestId('project-switcher-select').locator('.dropdown-button')).toContainText('E2E 助手项目 A');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(panel.locator('.assistant-panel__action-card.is-stale')).toContainText('需更新');
    await expect(panel.locator('.assistant-panel__action-card.is-stale')).toContainText('意图审查');
    await expect(panel.getByRole('button', { name: '重新生成计划' })).toHaveClass(/button--ghost/);
    await expect(page.locator('.overlay-bar .assistant-panel__run-error')).toHaveCount(0);

    // 基于最新版本重生成并确认后，主工作区必须立即看到领域写入结果。
    await panel.getByRole('button', { name: '重新生成计划' }).click();
    const freshConfirm = panel.getByRole('button', { name: '确认执行' });
    await expect(freshConfirm).toBeEnabled();
    await freshConfirm.click();
    await expect(panel.locator('.assistant-panel__action-card.is-succeeded')).toContainText('已完成');
    await expect(page.getByRole('textbox', { name: '页面目的' })).toHaveValue(/助手草稿/);

    await chooseDropdown(page.getByTestId('project-switcher-select'), projectBBefore.id);
    await expect(page.getByTestId('project-switcher-select').locator('.dropdown-button')).toContainText('E2E 助手项目 B');
    const projectBAfter = await getProject(page, 'E2E 助手项目 B');
    expect(projectBAfter.input_revisions?.intent_review || 0).toBe(projectBBefore.input_revisions?.intent_review || 0);
    expect(projectBAfter.requirement).toBe(projectBBefore.requirement);

    // 图库使助手 inert，返回入口仍可点，助手反馈不进入全局层。
    await page.getByTestId('gallery-entry').click();
    await expect(page.getByTestId('gallery-overlay')).toBeVisible();
    await expect(panel).toHaveAttribute('inert', '');
    await expect(page.locator('.overlay-bar .error-banner')).toHaveCount(0);
    await page.getByTestId('gallery-back').click();
    await expect(page.getByTestId('gallery-overlay')).toHaveCount(0);

    // 助手与产物检查器永远复用同一右列。
    await page.getByTitle('查看 AI 输入、产物与历史版本').click();
    await expect(panel).toBeHidden();
    await expect(page.locator('.artifact-inspector')).toBeVisible();
    await page.getByRole('button', { name: 'AI 助手' }).click();
    await expect(panel).toBeVisible();
    await expect(page.locator('.artifact-inspector')).toHaveCount(0);

    // 两个桌面真实可达宽度：右列分别为 316 / 280px，不新增断点。
    const originalContentSize = await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize());
    await page.setViewportSize({ width: 1321, height: 900 });
    expect(await panel.evaluate((node) => node.getBoundingClientRect().width)).toBeCloseTo(316, 0);
    await page.setViewportSize({ width: 1180, height: 760 });
    expect(await panel.evaluate((node) => node.getBoundingClientRect().width)).toBeCloseTo(280, 0);
    const regenerateFits = await panel.getByRole('button', { name: '重新生成计划' }).evaluate((node) => node.scrollWidth <= node.clientWidth);
    expect(regenerateFits).toBe(true);

    // 删除确认在 body top layer，遮罩由 dialog 自身覆盖视口。
    const deleteTrigger = panel.getByRole('button', { name: '删除对话' });
    await deleteTrigger.click();
    const dialog = page.getByRole('dialog', { name: '删除对话' });
    await expect(dialog).toBeVisible();
    const geometry = await dialog.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { parent: node.parentElement?.tagName, left: rect.left, top: rect.top, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight, margin: style.margin, borderWidth: style.borderWidth, background: style.backgroundColor, open: (node as HTMLDialogElement).open };
    });
    expect(geometry).toMatchObject({ parent: 'BODY', left: 0, top: 0, open: true, margin: '0px', borderWidth: '0px', background: 'rgba(5, 6, 9, 0.66)' });
    expect(geometry.width).toBeCloseTo(geometry.viewportWidth, 0);
    expect(geometry.height).toBeCloseTo(geometry.viewportHeight, 0);
    for (let step = 0; step < 6; step += 1) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(deleteTrigger).toBeFocused();
    await deleteTrigger.click();
    await expect(page.getByRole('dialog', { name: '删除对话' })).toBeVisible();
    await page.getByRole('dialog', { name: '删除对话' }).getByRole('button', { name: '取消' }).click();
    await launched.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), originalContentSize);
  });
});
