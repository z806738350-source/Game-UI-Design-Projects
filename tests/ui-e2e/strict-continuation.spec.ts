// UIE2E-01/03/04/05/06: strict-continuation happy path, end to end, against
// the fixture provider. Every backend gate runs for real; only the external
// Kunpo network boundary is replaced by recorded golden-evidence responses.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FixtureProvider } from './fixtureProvider';
import {
  approveContract, approveStrictLayout, chooseDropdown, createStrictProject, generateUnderlays, getProject,
  importComponents, importFonts, importReferencesAndGenerateStyle, importWireframeAndIntent,
  launchApp, queueSaveFile, selectAndApproveBindings, clickRun,
  BINDING_FAMILY_BY_CONTROL
} from './helpers';
import type { LaunchedApp } from './helpers';

let provider: FixtureProvider;
let launched: LaunchedApp;
let page: Page;

test.describe.serial('strict continuation happy path (UIE2E-01/03/04/05/06)', () => {
  test.beforeAll(async () => {
    provider = new FixtureProvider();
    await provider.start();
    launched = await launchApp(provider);
    page = launched.page;
  });

  test.afterAll(async () => {
    await launched?.app.close();
    await provider?.stop();
  });

  test('UIE2E-01 existing projects default to strict continuation', async () => {
    await createStrictProject(page, 'E2E Strict Continuation');
    const project = await getProject(page);
    expect(project.continuation_mode).toBe('existing-strict');
    expect(project.screen_id).toBe('main');
  });

  test('wireframe import, AI intent draft, and contract approval', async () => {
    await importWireframeAndIntent(launched);
    await approveContract(page);
    const project = await getProject(page);
    expect(project.artifacts.screenContract?.status).toBe('approved');
    const controls = (project.artifacts.screenContract?.required_controls as Array<{ role: string }> ) || [];
    expect(controls.map((control) => control.role)).toContain('primary-action');
  });

  test('UIE2E-03 reference, font, and component imports under strict gates', async () => {
    await importReferencesAndGenerateStyle(launched);
    await importFonts(launched);
    await importComponents(launched);
    const project = await getProject(page);
    expect(project.artifacts.styleContract?.status).toBe('approved');
    expect(project.artifacts.fontManifest?.status).toBe('approved');
    expect(project.artifacts.componentContract?.status).toBe('approved');
    expect(Object.keys(project.artifacts.fontManifest?.roles || {})).toEqual(expect.arrayContaining(['display', 'body', 'numeric', 'button-label']));
  });

  test('UIE2E-04 explicit binding selection without implicit defaults', async () => {
    // No implicit first-family fallback: save stays disabled until every
    // required control has an explicit component choice.
    await expect(page.getByTestId('binding-save')).toBeDisabled();
    // Semantic incompatibility is surfaced in the dropdown itself.
    const primarySelect = page.getByTestId('binding-component-select-primary-action');
    await primarySelect.locator('.dropdown-button').click();
    await expect(primarySelect.locator('.dropdown-option[data-value="bottom-navigation"]')).toHaveClass(/is-disabled/);
    await expect(primarySelect.locator('.dropdown-option[data-value="primary-button"]')).not.toHaveClass(/is-disabled/);
    // F-01: choosing a family alone never confirms state or font role.
    await primarySelect.locator('.dropdown-option[data-value="primary-button"]').click();
    await expect(page.getByTestId('binding-state-select-primary-action').locator('.dropdown-button > span')).toContainText('必选');
    await expect(page.getByTestId('binding-save')).toBeDisabled();
    // An explicit state alone is still incomplete for text-slot families.
    await chooseDropdown(page.getByTestId('binding-state-select-primary-action'), 'default');
    await expect(page.getByTestId('binding-save')).toBeDisabled();
    await selectAndApproveBindings(page);
    const project = await getProject(page);
    expect(project.artifacts.bindings?.status).toBe('approved');
    const bindings = (project.artifacts.bindings?.bindings as Array<{ control_id: string; component_id: string; state?: string; font_role?: string }>) || [];
    for (const [controlId, family] of Object.entries(BINDING_FAMILY_BY_CONTROL)) {
      expect(bindings.find((binding) => binding.control_id === controlId)?.component_id, `binding for ${controlId}`).toBe(family);
    }
    // Persisted bindings carry the designer's explicit state and font role.
    const primary = bindings.find((binding) => binding.control_id === 'primary-action');
    expect(primary?.state).toBe('default');
    expect(primary?.font_role).toBe('button-label');
    expect(bindings.find((binding) => binding.control_id === 'tab')?.font_role).toBe('tab-label');
    expect(bindings.find((binding) => binding.control_id === 'row')?.font_role).toBe('body');
  });

  test('component-aware layout approval and underlay generation', async () => {
    await approveStrictLayout(page);
    await generateUnderlays(launched, provider);
    const project = await getProject(page);
    expect(project.artifacts.approvedLayout?.status).toBe('approved');
    expect((project.artifacts.visualResults?.variations as unknown[])?.length).toBe(3);
  });

  test('UIE2E-05 underlay critique blocks contamination and repair passes', async () => {
    provider.armCritiqueSequence(['contaminated', 'repaired']);
    const critiqueGate = page.getByTestId('strict-gate-critique');
    await clickRun(page, 'underlay-critique');
    await expect(critiqueGate).not.toHaveClass(/is-ready/);
    await expect(page.getByTestId('underlay-repair')).toBeEnabled();
    provider.armRepair();
    await clickRun(page, 'underlay-repair');
    await expect(critiqueGate).toHaveClass(/is-ready/);
    const project = await getProject(page);
    expect(['passed', 'passed-with-waiver']).toContain(project.artifacts.underlayCritique?.result);
  });

  test('UIE2E-06 final composition, fidelity gate, final approval, export hash', async () => {
    const finalGate = page.getByTestId('strict-gate-final-png');
    const fidelityGate = page.getByTestId('strict-gate-fidelity');
    await clickRun(page, 'composition-final');
    await expect(finalGate).toHaveClass(/is-ready/);
    await clickRun(page, 'fidelity-run');
    await expect(fidelityGate).toHaveClass(/is-ready/);

    // FINAL_APPROVAL_REQUIRED: 最终批准前导出按钮在 UI 层即被禁用，
    // 交付顺序固定为 Final PNG → Fidelity passed → Final Approval → Export。
    await expect(page.getByTestId('final-export')).toBeDisabled();
    await clickRun(page, 'final-approve');
    const approved = await getProject(page);
    expect(approved.artifacts.compositionManifest?.status).toBe('approved');
    expect(approved.artifacts.fidelityReport?.status).toBe('passed');

    const exportPath = path.join(launched.exportDir, 'final-export.png');
    await queueSaveFile(launched.app, exportPath);
    await page.getByTestId('final-export').click();
    await expect.poll(() => fs.existsSync(exportPath), { timeout: 60_000 }).toBe(true);

    const project = await getProject(page);
    const output = project.artifacts.compositionOutput as { hash?: string; mode?: string };
    expect(output.mode).toBe('final');
    const exportedHash = crypto.createHash('sha256').update(fs.readFileSync(exportPath)).digest('hex');
    expect(`sha256:${exportedHash}`).toBe(output.hash);
  });
});
