// 图库工作区 E2E（v1.1 §11.5）：从带历史可信 CDN 结果的 fixture workspace
// 出发，验证首次回填、进入/返回无损往返、灯箱键盘操作、移除/撤销/恢复、
// 受控镜像下载与严格继承资产的下载阻断。下载不依赖真实生产 COS：spec 将
// 主进程 fetch 中的可信 CDN 主机重定向到 FixtureProvider 的 /cdn-mirror。
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider } from './fixtureProvider';
import { chooseDropdown, createNewProject, createStrictProject, findProjectDir, getProject, launchApp, queueSaveFile } from './helpers';
import type { LaunchedApp } from './helpers';

const CDN_ONE = 'https://kunpoapiimg.ziy.cc/ui-e2e/gallery-one.png';
const CDN_TWO = 'https://kunpoapiimg.ziy.cc/ui-e2e/gallery-two.png';
const CDN_STRICT = 'https://kunpoapiimg.ziy.cc/ui-e2e/gallery-strict.png';
const CDN_HISTORY = 'https://kunpoapiimg.ziy.cc/ui-e2e/gallery-history.png';

function seedVisualResults(workspacePath: string, screenId: string, variations: Array<Record<string, unknown>>): void {
  const dir = path.join(workspacePath, 'screens', screenId, 'explorations');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'results.json'),
    JSON.stringify({ schema_version: '1.0', updated_at: new Date().toISOString(), variations }, null, 2),
    'utf8'
  );
}

async function openGalleryIfClosed(page: Page): Promise<void> {
  if (await page.getByTestId('gallery-overlay').count()) return;
  await page.getByTestId('gallery-entry').click();
  await expect(page.getByTestId('gallery-overlay')).toBeVisible();
}

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;
let projectDir: string;
let screenId: string;
let explorationProjectId: string;

test.describe('gallery workspace (§11.5)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    provider = new FixtureProvider();
    await provider.start();
    launched = await launchApp(provider);
    page = launched.page;
    // 新项目路线为 exploration：回填资产允许下载（§7.5 门禁按登记快照判定）。
    await createNewProject(page, 'E2E 图库探索');
    const snapshot = await getProject(page, 'E2E 图库探索') as { id: string; screen_id: string };
    screenId = snapshot.screen_id;
    explorationProjectId = snapshot.id;
    projectDir = findProjectDir(launched, 'project.json');
    // 历史可信 CDN 结果：首次打开图库时由回填/对账登记（§6.2/§6.3）。
    seedVisualResults(projectDir, screenId, [
      { id: 'variation-a', image_url: CDN_ONE, strategy: 'conservative', output_width: 1920, output_height: 1080, created_at: '2026-08-31T10:00:00.000Z' },
      { id: 'variation-b', image_url: CDN_TWO, strategy: 'bold', output_width: 1080, output_height: 1920, created_at: '2026-08-30T10:00:00.000Z' }
    ]);
  });

  test.afterAll(async () => {
    await launched?.app.close();
    await provider?.stop();
  });

  test('首次打开完成回填，入口选中且再次点击不退出', async () => {
    const entry = page.getByTestId('gallery-entry');
    await entry.click();
    await expect(page.getByTestId('gallery-overlay')).toBeVisible();
    await expect(entry).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('gallery-card')).toHaveCount(2, { timeout: 30_000 });
    // 再次点击图库按钮是 no-op，不得产生含糊的 Toggle 行为。
    await entry.click();
    await expect(page.getByTestId('gallery-overlay')).toHaveCount(1);
    await expect(page.getByTestId('gallery-card')).toHaveCount(2);

    // §6.7 规范回归：筛选下拉必须是自绘列表框，原生 select 的展开列表是系统菜单。
    await expect(page.locator('.gallery-filters select')).toHaveCount(0);
    const orientation = page.getByTestId('gallery-filter-orientation');
    await orientation.getByRole('combobox').click();
    await expect(orientation.locator('.dropdown-menu')).toBeVisible();
    await expect(orientation.locator('.dropdown-option[data-value="portrait"]')).toBeVisible();
    // Escape 只收起列表，不得连带关闭整个图库工作区。
    await page.keyboard.press('Escape');
    await expect(orientation.locator('.dropdown-menu')).toHaveCount(0);
    await expect(page.getByTestId('gallery-overlay')).toBeVisible();
    await expect(page.getByTestId('gallery-card')).toHaveCount(2);
  });

  test('灯箱方向键切换，Escape 关闭并把焦点还给打开它的卡片', async () => {
    await openGalleryIfClosed(page);
    const previews = page.getByRole('button', { name: /查看大图/ });
    await previews.first().click();
    const lightbox = page.getByTestId('gallery-lightbox');
    await expect(lightbox.getByText('1 / 2')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(lightbox.getByText('2 / 2')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(lightbox.getByText('1 / 2')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
    const focusLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || '');
    expect(focusLabel).toContain('查看大图');
  });

  test('移除后可撤销；已移除范围提供恢复，且不删除云端文件', async () => {
    await openGalleryIfClosed(page);
    const toast = page.getByTestId('gallery-undo-toast');
    await page.getByTestId('gallery-card').first().getByRole('button', { name: '移除' }).click();
    await expect(toast).toContainText('云端文件不会被删除');
    await expect(page.getByTestId('gallery-card')).toHaveCount(1);
    // 5 秒内撤销：资产回到全部图片。
    await page.getByTestId('gallery-undo').click();
    await expect(page.getByTestId('gallery-card')).toHaveCount(2);

    // 再次移除后进入已移除范围恢复。
    await page.getByTestId('gallery-card').first().getByRole('button', { name: '移除' }).click();
    await expect(page.getByTestId('gallery-card')).toHaveCount(1);
    await page.getByRole('button', { name: '已移除' }).click();
    await expect(page.getByTestId('gallery-card')).toHaveCount(1, { timeout: 30_000 });
    await page.getByTestId('gallery-card').first().getByRole('button', { name: '恢复' }).click();
    await expect(toast).toContainText('已恢复');
    await page.getByRole('button', { name: '全部图片' }).click();
    await expect(page.getByTestId('gallery-card')).toHaveCount(2, { timeout: 30_000 });
    // 反馈按上下文隔离：撤销提示属于图库上下文，返回工作流即清除，不得遮挡工作流按钮。
    await page.getByTestId('gallery-back').click();
    await expect(page.getByTestId('gallery-undo-toast')).toHaveCount(0);
  });

  test('返回工作流：原项目与阶段保留，焦点回到图库入口', async () => {
    await openGalleryIfClosed(page);
    await page.getByTestId('gallery-back').click();
    await expect(page.getByTestId('gallery-overlay')).toHaveCount(0);
    await expect(page.getByTestId('stage-input')).toHaveClass(/is-active/);
    const snapshot = await getProject(page, 'E2E 图库探索');
    expect(snapshot.screen_id).toBe(screenId);
    const focusTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') || '');
    expect(focusTestId).toBe('gallery-entry');
  });

  test('通知层几何：工作流态让出左侧轨道，图库态满幅覆盖', async () => {
    // .overlay-bar 高度为 0（不占文档流），Playwright 会判定不可见，
    // 因此几何一律用 getBoundingClientRect 直接量。
    if (await page.getByTestId('gallery-overlay').count()) {
      await page.getByTestId('gallery-back').click();
      await expect(page.getByTestId('gallery-overlay')).toHaveCount(0);
    }
    // 工作流态：提示条只允许覆盖右侧工作区，左边界必须等于轨道右缘。
    const workflow = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const bar = rect('.overlay-bar');
      return { barLeft: bar.left, railRight: rect('.stage-rail').right, mainLeft: rect('.main-workspace').left };
    });
    expect(workflow.barLeft).toBeCloseTo(workflow.railRight, 0);
    expect(workflow.barLeft).toBeCloseTo(workflow.mainLeft, 0);

    // 图库态：整屏覆盖，撤销提示按裁定保持满幅。
    await openGalleryIfClosed(page);
    const gallery = await page.evaluate(() => {
      const bar = document.querySelector('.overlay-bar')!.getBoundingClientRect();
      return { barLeft: bar.left, barWidth: bar.width, viewportWidth: window.innerWidth };
    });
    expect(gallery.barLeft).toBe(0);
    expect(gallery.barWidth).toBeCloseTo(gallery.viewportWidth, 0);
  });

  test('可下载路线通过受控镜像下载原图', async () => {
    await openGalleryIfClosed(page);
    // 把主进程 fetch 的可信 CDN 主机重定向到 fixture 镜像（§11.5：不依赖真实生产 COS）。
    await launched.app.evaluate((_electron, baseUrl) => {
      const original = globalThis.fetch;
      (globalThis as Record<string, unknown>).fetch = ((input: unknown, init?: unknown) =>
        original(String(input).replace('https://kunpoapiimg.ziy.cc', `${baseUrl}/cdn-mirror`), init as RequestInit)) as typeof fetch;
    }, provider.baseUrl);
    const target = path.join(launched.exportDir, 'gallery-download.png');
    await queueSaveFile(launched.app, target);
    await page.getByTestId('gallery-card').first().getByRole('button', { name: '下载原图' }).click();
    await expect(page.getByTestId('gallery-undo-toast')).toContainText('原图已保存', { timeout: 30_000 });
    expect(fs.existsSync(target)).toBeTruthy();
    expect(fs.statSync(target).size).toBeGreaterThan(0);
    expect(provider.requests.some((request) => request.kind === 'cdn-mirror')).toBeTruthy();
  });

  test('严格继承资产显示受控交付，点击说明原因且不发起下载', async () => {
    // 返回工作流创建第二个项目（严格继承），再回到图库验证门禁。
    await page.getByTestId('gallery-back').click();
    await expect(page.getByTestId('gallery-overlay')).toHaveCount(0);
    // 非空工作区不会自动弹出新建对话框，需先点顶栏入口（§11.5）。
    await page.locator('.project-switcher button', { hasText: '新项目' }).click();
    await createStrictProject(page, 'E2E 严格项目');
    const strict = await getProject(page, 'E2E 严格项目') as { id: string; screen_id: string; workspacePath: string };
    seedVisualResults(strict.workspacePath, strict.screen_id, [
      { id: 'variation-s', image_url: CDN_STRICT, strategy: 'conservative', output_width: 1920, output_height: 1080, created_at: '2026-08-29T10:00:00.000Z' }
    ]);
    await page.getByTestId('gallery-entry').click();
    await expect(page.getByTestId('gallery-overlay')).toBeVisible();
    await chooseDropdown(page.getByTestId('gallery-filter-project'), strict.id);
    await expect(page.getByTestId('gallery-card')).toHaveCount(1, { timeout: 30_000 });
    const blockedButton = page.getByTestId('gallery-card').first().getByRole('button', { name: '受控交付' });
    await expect(blockedButton).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('gallery-card').first().getByRole('button', { name: '下载原图' })).toHaveCount(0);
    // aria-disabled 仅为语义标注，按钮仍可点击以说明原因；force 跳过可用性检查。
    await blockedButton.click({ force: true });
    const banner = page.locator('.error-banner');
    await expect(banner).toContainText('严格继承');
    // 错误横幅在全局反馈层（z-90）会盖住图库筛选栏，关闭它再交给后续测试。
    await page.getByRole('button', { name: '关闭错误' }).click();
    await expect(banner).toHaveCount(0);
  });

  test('fail-closed 历史资产经逐张豁免后放行下载', async () => {
    // 向探索项目写入一条历史快照：无生成时路线证据 → 对账按 fail-closed 登记。
    const historyDir = path.join(projectDir, 'workflow', 'history');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(historyDir, 'visual-results-waive.json'), JSON.stringify({
      schema_version: '1.0', id: `${screenId}-visual-results`, version: 1, status: 'generated', source: {},
      variations: [{ id: `${screenId}-waive-history`, image_url: CDN_HISTORY, strategy: 'conservative', output_width: 1920, output_height: 1080, created_at: '2026-08-28T10:00:00.000Z' }]
    }, null, 2), 'utf8');
    const historyPath = path.join(projectDir, 'workflow', 'artifact-history.json');
    const history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) as Array<Record<string, unknown>> : [];
    history.unshift({ kind: 'visual-results', id: `${screenId}-visual-results`, version: 1, status: 'generated', saved_at: '2026-08-28T10:05:00.000Z', snapshot: 'workflow/history/visual-results-waive.json' });
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');

    await openGalleryIfClosed(page);
    await chooseDropdown(page.getByTestId('gallery-filter-project'), explorationProjectId);
    await expect(page.getByTestId('gallery-card')).toHaveCount(3, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: '受控交付' })).toHaveCount(1);

    await page.getByRole('button', { name: '受控交付' }).click({ force: true });
    const dialog = page.getByTestId('gallery-waiver-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('历史快照');
    const confirm = dialog.getByRole('button', { name: '确认按当前项目路线下载' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('豁免理由').fill('该历史方案已确认复用，需要导出原图归档。');
    await expect(confirm).toBeEnabled();

    // 豁免确认后立即走下载：沿用受控镜像与排队保存路径（§11.5）。
    const target = path.join(launched.exportDir, 'gallery-waiver-download.png');
    await queueSaveFile(launched.app, target);
    await confirm.click();
    // 断言本次下载的文件名：通用「原图已保存」提示可能残留自上一个测试。
    await expect(page.getByTestId('gallery-undo-toast')).toContainText('gallery-waiver-download.png', { timeout: 30_000 });
    expect(fs.existsSync(target)).toBeTruthy();
    expect(fs.statSync(target).size).toBeGreaterThan(0);
    await expect(dialog).toHaveCount(0);
    // 豁免留痕就地写回：卡片翻转为可下载，视图内不再有受控交付。
    await expect(page.getByRole('button', { name: '受控交付' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '下载原图' })).toHaveCount(3);
  });
});
