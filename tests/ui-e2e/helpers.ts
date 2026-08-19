// Shared UI E2E helpers: Electron launch against the fixture provider, native
// dialog stubbing (fully UI-driven imports/exports), busy-boundary waiting,
// and the reusable strict-continuation pipeline steps.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { FixtureProvider, GOLDEN_ASSETS } from './fixtureProvider';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../..');
const nodeRequire = createRequire(import.meta.url);

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  workspace: string;
  exportDir: string;
}

export async function launchApp(provider: FixtureProvider): Promise<LaunchedApp> {
  const distEntry = path.join(REPO_ROOT, 'dist', 'index.html');
  if (!fs.existsSync(distEntry)) throw new Error('dist/ is missing: run `pnpm build` before `pnpm test:ui-e2e`.');
  const requiredAssets = [
    GOLDEN_ASSETS.wireframe, GOLDEN_ASSETS.font, ...GOLDEN_ASSETS.references,
    GOLDEN_ASSETS.contaminatedUnderlay, GOLDEN_ASSETS.repairedUnderlay,
    ...Object.entries(GOLDEN_ASSETS.components).flatMap(([family, states]) => states.map((state) => GOLDEN_ASSETS.componentAsset(family, state)))
  ];
  for (const asset of requiredAssets) {
    if (!fs.existsSync(asset)) throw new Error(`golden fixture missing: ${asset} (UI E2E expects tracked golden source assets).`);
  }
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-ui-e2e-'));
  const exportDir = path.join(workspace, 'exports');
  fs.mkdirSync(exportDir, { recursive: true });
  const envFile = path.join(workspace, 'e2e.env');
  fs.writeFileSync(envFile, '# UI E2E: keep the repo .env out of the test run\n', 'utf8');
  const app = await electron.launch({
    args: ['.'],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      KUNPO_GATEWAY_BASE_URL: provider.baseUrl,
      DESIGN_COPILOT_WORKSPACE: workspace,
      DESIGN_COPILOT_ENV_FILE: envFile,
      DESIGN_COPILOT_FORCE_DIST: 'true',
      DESIGN_COPILOT_SNAPSHOT_PROVIDER_IMAGES: 'true'
    }
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell', { timeout: 60_000 });
  await stubDialogs(app);
  return { app, page, workspace, exportDir };
}

// Monkey-patch the main-process dialog module so file pickers resolve from a
// test-controlled queue; every import/export stays fully UI-driven.
export async function stubDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog, shell }) => {
    const globalScope = globalThis as { __openQueue?: string[][]; __saveQueue?: string[] };
    globalScope.__openQueue = [];
    globalScope.__saveQueue = [];
    dialog.showOpenDialog = async () => {
      const next = globalScope.__openQueue?.shift();
      return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] };
    };
    dialog.showSaveDialog = async () => {
      const next = globalScope.__saveQueue?.shift();
      return next ? { canceled: false, filePath: next } : { canceled: true, filePath: '' };
    };
    shell.showItemInFolder = () => undefined;
  });
}

export async function queueOpenFiles(app: ElectronApplication, filePaths: string[]): Promise<void> {
  // Note: app.evaluate passes the electron module as the first handler arg.
  await app.evaluate((_electron, files) => { (globalThis as { __openQueue?: string[][] }).__openQueue?.push(files); }, filePaths);
}

export async function queueSaveFile(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate((_electron, file) => { (globalThis as { __saveQueue?: string[] }).__saveQueue?.push(file); }, filePath);
}

export async function clickRun(page: Page, testId: string, options: { allowError?: boolean; settleMs?: number } = {}): Promise<void> {
  await page.getByTestId(testId).click();
  await page.waitForTimeout(250);
  await page.locator('.busy-bar').waitFor({ state: 'detached', timeout: 480_000 });
  await page.waitForTimeout(options.settleMs ?? 120);
  if (!options.allowError) await expect(page.locator('.error-banner'), `unexpected error after ${testId}`).toHaveCount(0);
}

export async function expectErrorBanner(page: Page, fragment: string | RegExp): Promise<void> {
  const banner = page.locator('.error-banner');
  await expect(banner).toBeVisible();
  if (typeof fragment === 'string') await expect(banner).toContainText(fragment, { timeout: 15_000 });
  else await expect.poll(async () => (await banner.textContent()) || '').toMatch(fragment);
}

export async function closeErrorBanner(page: Page): Promise<void> {
  await page.locator('.error-banner button[aria-label="关闭错误"]').click();
  await expect(page.locator('.error-banner')).toHaveCount(0);
}

type ProjectSnapshot = {
  id: string;
  screen_id: string;
  continuation_mode: string;
  requirement: string;
  artifacts: Record<string, { status?: string; version?: number; [key: string]: unknown } | undefined>;
  screens?: Array<{ id: string; name: string; status?: string }>;
  reference_assets?: Array<{ id: string; approved?: boolean }>;
};

export function getProject(page: Page, name?: string): Promise<ProjectSnapshot> {
  return page.evaluate(async (wantedName) => {
    const api = (window as unknown as { designCopilot: { listProjects: () => Promise<Array<{ id: string; name: string }>>; openProject: (id: string) => Promise<unknown> } }).designCopilot;
    const projects = await api.listProjects();
    const target = wantedName ? projects.find((item) => item.name === wantedName) : projects[0];
    if (!target) throw new Error(`project not found: ${wantedName || '(first)'}`);
    return api.openProject(target.id) as Promise<ProjectSnapshot>;
  }, name);
}

export function callRendererApi<T = unknown>(page: Page, expression: string): Promise<T> {
  return page.evaluate(`(async () => { const api = window.designCopilot; return ${expression}; })()`);
}

// ---------------------------------------------------------------------------
// Reusable strict-continuation pipeline steps (UIE2E happy-path building
// blocks; failure specs reuse them up to the stage under test).
// ---------------------------------------------------------------------------

export async function createStrictProject(page: Page, name: string): Promise<void> {
  await page.getByTestId('create-project-dialog').waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('.create-dialog input[placeholder*="云境计划"]').fill(name);
  await page.locator('.project-type-grid button', { hasText: '已有项目' }).click();
  await expect(page.locator('.create-dialog select')).toHaveValue('existing-strict');
  await clickRun(page, 'create-project');
  await expect(page.getByTestId('stage-input')).toBeVisible();
}

export async function importWireframeAndIntent(launched: LaunchedApp): Promise<void> {
  const { app, page } = launched;
  await queueOpenFiles(app, [GOLDEN_ASSETS.wireframe]);
  await clickRun(page, 'wireframe-import');
  await clickRun(page, 'intent-draft');
  await expect(page.locator('.design-brief-card textarea')).not.toHaveValue('');
  await clickRun(page, 'intent-confirm');
}

export async function approveContract(page: Page): Promise<void> {
  await page.getByTestId('stage-wireframe_interpretation').click();
  await expect(page.locator('.contract-overview')).toBeVisible();
  await clickRun(page, 'contract-approve');
}

export async function importReferencesAndGenerateStyle(launched: LaunchedApp): Promise<void> {
  const { app, page } = launched;
  await page.getByTestId('stage-style_resolution').click();
  await queueOpenFiles(app, [...GOLDEN_ASSETS.references]);
  await clickRun(page, 'reference-import');
  const approveButtons = page.locator('.reference-workbench article nav button[title="批准参考图"]');
  for (let index = 0; index < GOLDEN_ASSETS.references.length; index += 1) {
    await approveButtons.first().click();
    await page.waitForTimeout(150);
  }
  await clickRun(page, 'reference-approve');
  await clickRun(page, 'style-generate');
  await clickRun(page, 'style-approve');
}

const FONT_ROLES = ['display', 'body', 'numeric', 'button-label'];

export async function importFonts(launched: LaunchedApp): Promise<void> {
  const { app, page } = launched;
  const workbench = page.getByTestId('typography-workbench');
  await workbench.locator('label', { hasText: '字体 ID' }).locator('input').fill('oxanium');
  await workbench.getByTestId('font-coverage').fill('latin');
  await workbench.locator('label', { hasText: '我确认有权在本项目中使用' }).locator('input[type="checkbox"]').check();
  await workbench.locator('label', { hasText: '该角色必须精确使用此字体' }).locator('input[type="checkbox"]').check();
  await queueOpenFiles(app, [GOLDEN_ASSETS.font]);
  await workbench.locator('button', { hasText: '选择字体' }).click();
  await page.locator('.busy-bar').waitFor({ state: 'detached', timeout: 300_000 });
  await expect(page.locator('.error-banner')).toHaveCount(0);
  for (const role of FONT_ROLES) {
    await workbench.locator('label', { hasText: '语义角色' }).locator('input').fill(role);
    await clickRun(page, 'font-confirm');
  }
  await clickRun(page, 'font-approve');
}

const COMPONENT_CATEGORY: Record<string, string> = {
  'primary-button': 'button',
  'bottom-navigation': 'navigation',
  'section-tab': 'tab',
  'resource-bar': 'resource-bar',
  'content-panel': 'content-panel',
  'action-icon': 'icon',
  'status-badge': 'status-badge',
  'list-row': 'list-row'
};

// Mirrors the golden component contract: icons and navigation bake no text
// slot, so the compositor must not render labels for those controls.
const COMPONENT_TEXT_POLICY: Record<string, string> = {
  'bottom-navigation': 'none',
  'action-icon': 'none'
};

export async function importComponents(launched: LaunchedApp): Promise<void> {
  const { app, page } = launched;
  const workbench = page.getByTestId('component-kit-workbench');
  for (const [family, states] of Object.entries(GOLDEN_ASSETS.components)) {
    for (const state of states) {
      await workbench.locator('label', { hasText: '组件 ID' }).locator('input').fill(family);
      await workbench.locator('label', { hasText: '类别' }).locator('select').selectOption(COMPONENT_CATEGORY[family]);
      await workbench.locator('label', { hasText: /^状态/ }).locator('select').selectOption(state);
      await workbench.locator('label', { hasText: '文字策略' }).locator('select').selectOption(COMPONENT_TEXT_POLICY[family] || 'text-slot');
      await workbench.locator('label', { hasText: '最大缩放' }).locator('input').fill('1');
      await queueOpenFiles(app, [GOLDEN_ASSETS.componentAsset(family, state)]);
      await clickRun(page, 'component-import');
    }
  }
  await clickRun(page, 'component-approve');
}

export const BINDING_FAMILY_BY_CONTROL: Record<string, string> = {
  'primary-action': 'primary-button',
  'secondary-action': 'primary-button',
  navigation: 'bottom-navigation',
  tab: 'section-tab',
  resources: 'resource-bar',
  content: 'content-panel',
  'icon-a': 'action-icon',
  'icon-b': 'action-icon',
  badge: 'status-badge',
  row: 'list-row'
};

export async function selectAndApproveBindings(page: Page): Promise<void> {
  for (const [controlId, family] of Object.entries(BINDING_FAMILY_BY_CONTROL)) {
    await page.getByTestId(`binding-component-select-${controlId}`).locator('select').first().selectOption(family);
  }
  await clickRun(page, 'binding-save');
  await clickRun(page, 'binding-approve');
}

export async function approveStrictLayout(page: Page): Promise<void> {
  await clickRun(page, 'strict-layout-generate');
  await expect(page.locator('.proposal-tabs')).toBeVisible();
  await clickRun(page, 'layout-approve');
}

export async function generateUnderlays(launched: LaunchedApp, provider: FixtureProvider): Promise<void> {
  const { page } = launched;
  await clickRun(page, 'underlay-prepare');
  provider.armUnderlayGeneration();
  await clickRun(page, 'underlay-generate');
  await expect(page.locator('.visual-grid .visual-card')).toHaveCount(3, { timeout: 300_000 });
}
