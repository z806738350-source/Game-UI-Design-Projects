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

export async function launchApp(provider: FixtureProvider, options: { assistant?: boolean } = {}): Promise<LaunchedApp> {
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
  const electronArgs = ['.'];
  if (options.assistant) electronArgs.push(`--user-data-dir=${path.join(workspace, '.electron-user-data')}`);
  const app = await electron.launch({
    args: electronArgs,
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      KUNPO_GATEWAY_BASE_URL: provider.baseUrl,
      DESIGN_COPILOT_WORKSPACE: workspace,
      DESIGN_COPILOT_ENV_FILE: envFile,
      DESIGN_COPILOT_FORCE_DIST: 'true',
      DESIGN_COPILOT_SNAPSHOT_PROVIDER_IMAGES: 'true',
      ...(options.assistant ? { GAME_UI_ASSISTANT_ENABLED: 'true' } : {})
    }
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.app-shell', { timeout: 60_000 });
  await stubDialogs(app);
  const launched = { app, page, workspace, exportDir };
  attachFailureEvidence(launched);
  return launched;
}

// F-03 evidence requirement: every run leaves the Electron main-process output
// and renderer console in test-results/, next to Playwright's traces and
// failure screenshots, so CI failures stay reproducible.
function attachFailureEvidence(launched: LaunchedApp): void {
  const evidenceDir = path.join(REPO_ROOT, 'test-results');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const logPath = path.join(evidenceDir, `electron-${path.basename(launched.workspace)}.log`);
  const append = (channel: string, chunk: Buffer | string) => {
    try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] [${channel}] ${String(chunk)}`); } catch { /* evidence collection must never fail the test */ }
  };
  launched.app.process().stdout?.on('data', (chunk) => append('main:stdout', chunk));
  launched.app.process().stderr?.on('data', (chunk) => append('main:stderr', chunk));
  launched.page.on('console', (message) => append(`renderer:${message.type()}`, `${message.text()}\n`));
  launched.page.on('pageerror', (error) => append('renderer:pageerror', `${error.stack || error.message}\n`));
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

// 前提：`.busy-bar` detached 表示「任务结束」只在工作流视图下成立。反馈按上下文
// 隔离后，图库打开期间忙碌条根本不渲染（见 FRONTEND-DESIGN-GUIDE §6.4），因此
// 本文件所有以 busy-bar 收尾的助手（clickRun / importFonts /
// switchContinuationModeViaUi）都只能在工作流态调用；用它等待图库态发起或观察的
// 任务会立刻判定为已完成。
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
  requirement_confirmed?: boolean;
  intent_mode?: string;
  input_revisions?: Record<string, number>;
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

// 自绘下拉框交互：点击展开后点击目标选项（data-value）。
export async function chooseDropdown(root: Locator, value: string): Promise<void> {
  await root.locator('.dropdown-button').click();
  await root.locator(`.dropdown-option[data-value="${value}"]`).click();
}

// Switch the active screen through the Screen Manager UI and wait until the
// backend confirms the switch; the select change is asynchronous, so reading
// the project immediately afterwards would race the setActiveScreen IPC.
export async function switchScreen(page: Page, screenId: string): Promise<void> {
  await chooseDropdown(page.getByTestId('screen-active-select'), screenId);
  await expect.poll(async () => (await getProject(page)).screen_id, { timeout: 15_000 }).toBe(screenId);
}

// F-03 boundary rule: UI E2E may only read state through the snapshot API.
// There is deliberately no callRendererApi helper here anymore — every
// mutation must go through a UI locator so it is attributable in traces.

// Derive a changed copy of a golden asset (different bytes, same format) for
// fault injection and multi-screen inputs; test processes may create or
// tamper with local files per the UIE2E boundary rules.
export async function deriveAsset(sourcePath: string, targetPath: string): Promise<string> {
  const sharp = nodeRequire('sharp');
  await sharp(sourcePath).negate().png().toFile(targetPath);
  return targetPath;
}

export function findProjectDir(launched: LaunchedApp, markerRelativePath: string): string {
  const projectDir = fs.readdirSync(launched.workspace)
    .find((entry) => fs.existsSync(path.join(launched.workspace, entry, markerRelativePath)));
  if (!projectDir) throw new Error(`no project directory contains ${markerRelativePath}`);
  return path.join(launched.workspace, projectDir);
}

// ---------------------------------------------------------------------------
// Reusable strict-continuation pipeline steps (UIE2E happy-path building
// blocks; failure specs reuse them up to the stage under test).
// ---------------------------------------------------------------------------

export async function createStrictProject(page: Page, name: string): Promise<void> {
  await page.getByTestId('create-project-dialog').waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('.create-dialog input[placeholder*="云境计划"]').fill(name);
  await page.locator('.project-type-grid button', { hasText: '已有项目' }).click();
  await expect(page.getByTestId('create-continuation-select').locator('.dropdown-button > span')).toHaveText('严格继承（推荐）');
  await clickRun(page, 'create-project');
  await expect(page.getByTestId('stage-input')).toBeVisible();
}

export async function createNewProject(page: Page, name: string): Promise<void> {
  await page.getByTestId('create-project-dialog').waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('.create-dialog input[placeholder*="云境计划"]').fill(name);
  await page.locator('.project-type-grid button', { hasText: '新项目' }).click();
  await clickRun(page, 'create-project');
  await expect(page.getByTestId('stage-input')).toBeVisible();
}

// v1.4 §10.5：确认前必须逐条处理未审查的待确认项；回答前必须先填结论。
export async function answerUnreviewedUncertainties(page: Page, note = 'E2E 核对结论：按图中可见行为确认。'): Promise<number> {
  let handled = 0;
  const unreviewed = () => page.locator('.intent-uncertainty.is-unreviewed');
  while (await unreviewed().count()) {
    const first = unreviewed().first();
    await first.locator('textarea').fill(note);
    await first.locator('button', { hasText: '回答' }).click();
    await page.waitForTimeout(120);
    handled += 1;
  }
  return handled;
}

// structured-v2 确认入口：处理待确认项 → 确认 → 等待生成完成。
export async function confirmStructuredIntent(page: Page): Promise<void> {
  await answerUnreviewedUncertainties(page);
  // 回答只改本地草稿；存在未保存的评审修改时先保存，再过确认门禁（§10.5）。
  const saveReviewButton = page.getByTestId('intent-review-save');
  if (await saveReviewButton.count() && await saveReviewButton.isEnabled()) {
    await clickRun(page, 'intent-review-save');
  }
  await clickRun(page, 'intent-confirm');
}

export async function importWireframeAndIntent(launched: LaunchedApp): Promise<void> {
  const { app, page } = launched;
  await queueOpenFiles(app, [GOLDEN_ASSETS.wireframe]);
  await clickRun(page, 'wireframe-import');
  await clickRun(page, 'intent-draft');
  await expect(page.locator('.design-brief-card textarea')).not.toHaveValue('');
  await confirmStructuredIntent(page);
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
  await clickRun(page, 'style-generate');
  await clickRun(page, 'style-approve');
}

const FONT_ROLES = ['display', 'body', 'numeric', 'button-label', 'tab-label'];

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

export type ComponentImportOptions = {
  reuse?: 'exact' | 'nine-slice' | 'vector-token' | 'reference-locked';
  margins?: string;
  filePath?: string;
};

// One component-state import through the Component Kit Workbench UI.
export async function importComponentState(launched: LaunchedApp, family: string, state: string, options: ComponentImportOptions = {}): Promise<void> {
  const { app, page } = launched;
  const workbench = page.getByTestId('component-kit-workbench');
  await workbench.locator('label', { hasText: '组件 ID' }).locator('input').fill(family);
  await chooseDropdown(workbench.locator('label', { hasText: '类别' }), COMPONENT_CATEGORY[family]);
  await chooseDropdown(workbench.locator('label', { hasText: /^状态/ }), state);
  await chooseDropdown(workbench.locator('label', { hasText: '复用策略' }), options.reuse || 'exact');
  if (options.reuse === 'nine-slice') {
    // UIE2E-03B: nine-slice margins are configured through the workbench UI.
    await workbench.locator('label', { hasText: '9-Slice 边距' }).locator('input').fill(options.margins || '12,12,12,12');
  }
  await chooseDropdown(workbench.locator('label', { hasText: '文字策略' }), COMPONENT_TEXT_POLICY[family] || 'text-slot');
  await workbench.locator('label', { hasText: '最大缩放' }).locator('input').fill('1');
  await queueOpenFiles(app, [options.filePath || GOLDEN_ASSETS.componentAsset(family, state)]);
  await clickRun(page, 'component-import');
}

export async function importComponents(launched: LaunchedApp, overrides: Record<string, ComponentImportOptions> = {}): Promise<void> {
  const { page } = launched;
  for (const [family, states] of Object.entries(GOLDEN_ASSETS.components)) {
    for (const state of states) {
      await importComponentState(launched, family, state, overrides[family]);
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

// F-01: every binding needs an explicit state and — for text-slot families —
// an explicit font role. Controls bound to text_policy 'none' families
// (navigation, icons) have no entry here and skip the font role select.
const BINDING_FONT_ROLE_BY_CONTROL: Record<string, string> = {
  'primary-action': 'button-label',
  'secondary-action': 'button-label',
  tab: 'tab-label',
  resources: 'numeric',
  content: 'body',
  badge: 'numeric',
  row: 'body'
};

export async function selectAndApproveBindings(page: Page): Promise<void> {
  for (const [controlId, family] of Object.entries(BINDING_FAMILY_BY_CONTROL)) {
    await chooseDropdown(page.getByTestId(`binding-component-select-${controlId}`), family);
    await chooseDropdown(page.getByTestId(`binding-state-select-${controlId}`), 'default');
    const fontRole = BINDING_FONT_ROLE_BY_CONTROL[controlId];
    if (fontRole) await chooseDropdown(page.getByTestId(`binding-font-role-select-${controlId}`), fontRole);
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

// UIE2E-07E: continuation-mode switches happen through the input-stage UI,
// never through a direct saveProject renderer call.
export async function switchContinuationModeViaUi(page: Page, mode: 'existing-strict' | 'existing-guided'): Promise<void> {
  await page.getByTestId('stage-input').click();
  const select = page.getByTestId('continuation-mode-select');
  await expect(select).toBeVisible();
  await chooseDropdown(select, mode);
  await page.waitForTimeout(250);
  await page.locator('.busy-bar').waitFor({ state: 'detached', timeout: 120_000 });
  await expect(page.locator('.error-banner')).toHaveCount(0);
}

// Semantic contract edits go through the contract focus workbench UI
// (summary editor -> save this round), not through updateArtifact calls.
export async function editContractPurposeViaUi(page: Page, purpose: string): Promise<void> {
  await page.getByTestId('stage-wireframe_interpretation').click();
  await page.getByTestId('contract-open-required_controls').click();
  await page.getByTestId('contract-edit-summary').click();
  await page.getByTestId('contract-purpose-input').fill(purpose);
  await clickRun(page, 'contract-save-workbench');
}
