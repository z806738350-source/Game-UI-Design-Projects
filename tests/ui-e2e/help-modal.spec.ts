// UIE2E-09 help modal: the top-bar guide button opens an in-app modal whose
// iframe must actually load the bundled guide under real Electron (file://
// dist + CSP frame-src 'self'), and the guide's own inline tab script must
// run autonomously inside the frame. The system-browser fallback stays
// available from within the modal.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider } from './fixtureProvider';
import { createStrictProject, launchApp } from './helpers';
import type { LaunchedApp } from './helpers';

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;

test.describe('help modal (UIE2E-09)', () => {
  test.beforeAll(async () => {
    provider = new FixtureProvider();
    await provider.start();
    launched = await launchApp(provider);
    page = launched.page;
    // 空工作区会自动弹出不可取消的新建项目对话框，先创建一个项目解除遮罩
    await createStrictProject(page, 'E2E Help Modal');
  });

  test.afterAll(async () => {
    await launched?.app.close();
    await provider?.stop();
  });

  test('guide modal opens, iframe loads the bundled guide, tab script runs, modal closes', async () => {
    await page.getByTitle('使用说明书').click();
    const dialog = page.getByRole('dialog', { name: '使用说明书' });
    await expect(dialog).toBeVisible();

    // iframe 真实加载 dist/guide/quick-start-guide.html（file:// + CSP 下的关键验证点）
    const frame = page.frameLocator('iframe.guide-frame');
    await expect(frame.getByRole('heading', { name: '使用说明书', level: 1 })).toBeVisible({ timeout: 15_000 });

    // 说明书内联标签页脚本在 frame 内自治运行：切换到「常见问题」面板
    await frame.getByRole('tab', { name: /常见问题/ }).click();
    await expect(frame.locator('#panel-faq')).toBeVisible();
    await expect(frame.locator('#panel-start')).toBeHidden();

    // 浏览器兜底入口保留在弹窗内（不点击，避免真拉起系统浏览器）
    await expect(dialog.getByRole('button', { name: '在系统浏览器中打开' })).toBeVisible();

    await dialog.getByRole('button', { name: '关闭' }).click();
    await expect(dialog).toHaveCount(0);
  });
});
