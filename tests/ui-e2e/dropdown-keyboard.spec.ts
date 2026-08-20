// UIE2E-08 dropdown keyboard & ARIA: the self-drawn Dropdown must be a full
// replacement for native select — arrow keys, Home/End, Enter/Space, Escape
// focus restore, Tab close-out, and complete listbox ARIA wiring, verified in
// the real Electron renderer (not jsdom).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider } from './fixtureProvider';
import { launchApp } from './helpers';
import type { LaunchedApp } from './helpers';

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;

test.describe.serial('dropdown keyboard & ARIA (UIE2E-08)', () => {
  test.beforeAll(async () => {
    provider = new FixtureProvider();
    await provider.start();
    launched = await launchApp(provider);
    page = launched.page;
    await page.getByTestId('create-project-dialog').waitFor({ state: 'visible', timeout: 60_000 });
    // 继承强度 Dropdown 仅在「已有项目」类型下渲染
    await page.getByRole('button', { name: /已有项目/ }).click();
  });

  test.afterAll(async () => {
    await launched?.app.close();
    await provider?.stop();
  });

  test('listbox ARIA wiring is complete', async () => {
    const root = page.getByTestId('create-continuation-select');
    // 语义定位：触发元素是 select-only combobox，以 Accessible Name 可被辅助技术识别
    const combobox = page.getByRole('combobox', { name: '选择继承强度' });
    await expect(combobox).toBeVisible();
    const button = root.locator('.dropdown-button');
    await expect(combobox).toHaveAttribute('aria-haspopup', 'listbox');
    await expect(combobox).toHaveAttribute('aria-expanded', 'false');
    await expect(combobox).toHaveAttribute('aria-controls', /.+/);
    await combobox.focus();
    await page.keyboard.press('ArrowDown');
    await expect(combobox).toHaveAttribute('aria-expanded', 'true');
    const menuId = await combobox.getAttribute('aria-controls');
    // useId() 生成的 id 含冒号，用带引号的属性选择器即可安全匹配（CSS.escape 是浏览器全局，Node 侧不可用）
    const menu = page.locator(`ul[id="${menuId}"]`);
    await expect(menu).toHaveAttribute('role', 'listbox');
    const options = menu.locator('[role="option"]');
    await expect(options).toHaveCount(2);
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    // 当前值定位：活动项指向已选中的严格继承；aria-activedescendant 只挂在 combobox 上
    const activeId = await combobox.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    await expect(page.locator(`[id="${activeId}"]`)).toContainText('严格继承');
    await expect(menu).not.toHaveAttribute('aria-activedescendant', /.+/);
    await page.keyboard.press('Escape');
  });

  test('arrow keys, Home/End navigate; Enter selects and restores focus', async () => {
    const root = page.getByTestId('create-continuation-select');
    const button = root.locator('.dropdown-button');
    await button.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(root.locator('.dropdown-option.is-active')).toContainText('引导继承');
    await page.keyboard.press('Home');
    await expect(root.locator('.dropdown-option.is-active')).toContainText('严格继承');
    await page.keyboard.press('End');
    await expect(root.locator('.dropdown-option.is-active')).toContainText('引导继承');
    // 回绕：End 后再 ArrowDown 回到第一项
    await page.keyboard.press('ArrowDown');
    await expect(root.locator('.dropdown-option.is-active')).toContainText('严格继承');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(root.locator('.dropdown-menu')).toHaveCount(0);
    await expect(button).toContainText('引导继承');
    await expect(button).toBeFocused();
  });

  test('Space opens, Escape closes with focus restored; Tab closes and leaves', async () => {
    const root = page.getByTestId('create-continuation-select');
    const button = root.locator('.dropdown-button');
    await button.focus();
    await page.keyboard.press('Space');
    await expect(root.locator('.dropdown-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(root.locator('.dropdown-menu')).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).not.toHaveAttribute('aria-activedescendant', /.+/);
    // Tab：菜单关闭且焦点正常前进，不被捕获
    await page.keyboard.press('ArrowDown');
    await expect(root.locator('.dropdown-menu')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(root.locator('.dropdown-menu')).toHaveCount(0);
    await expect(button).not.toBeFocused();
  });

  test('mouse and keyboard stay consistent: hover drives active, click selects, focus returns', async () => {
    const root = page.getByTestId('create-continuation-select');
    const button = root.locator('.dropdown-button');
    await button.click();
    await root.locator('.dropdown-option', { hasText: '引导继承' }).hover();
    await expect(root.locator('.dropdown-option.is-active')).toContainText('引导继承');
    await root.locator('.dropdown-option', { hasText: '严格继承' }).click();
    await expect(button).toContainText('严格继承');
    await expect(root.locator('.dropdown-menu')).toHaveCount(0);
    await expect(button).toBeFocused();
    // 键盘再打开时活动项回到当前值
    await page.keyboard.press('ArrowDown');
    await expect(root.locator('.dropdown-option.is-active')).toContainText('严格继承');
    await page.keyboard.press('Escape');
  });
});
