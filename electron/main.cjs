const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { ERROR_CODES } = require('./services/errorCodes.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadKunpoConfig, saveModelConfig } = require('./services/env.cjs');
const kunpoClient = require('./services/kunpoClient.cjs');
const { createProjectStore } = require('./services/projectStore.cjs');
const { createDesignPipeline } = require('./services/designPipeline.cjs');
const { createFlowStateRepair } = require('./services/flowStateRepair.cjs');
const { assertFinalApprovalForExport, exportCompositionOutput, hashBuffer, resolveProjectPath, verifyCompositionOutput } = require('./services/compositionRenderer.cjs');

// UI E2E runs the packaged renderer (dist/) from an unpackaged checkout via
// DESIGN_COPILOT_FORCE_DIST; a dev server URL always wins for local dev.
const isDev = process.env.VITE_DEV_SERVER_URL ? true : process.env.DESIGN_COPILOT_FORCE_DIST === 'true' ? false : !app.isPackaged;

function createWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    title: 'Game UI Design Copilot',
    backgroundColor: '#eef4f8',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (isDev) {
    const rendererUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5174';
    let recoveryTimer;
    let recoveryDelay = 350;
    const recoverRenderer = () => {
      if (recoveryTimer || window.isDestroyed()) return;
      recoveryTimer = setTimeout(async () => {
        recoveryTimer = undefined;
        if (window.isDestroyed()) return;
        try { await window.loadURL(rendererUrl); }
        catch {
          recoveryDelay = Math.min(recoveryDelay * 2, 4000);
          recoverRenderer();
        }
      }, recoveryDelay);
    };
    window.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame) recoverRenderer();
    });
    window.webContents.on('render-process-gone', recoverRenderer);
    window.webContents.on('did-finish-load', () => {
      recoveryDelay = 350;
      clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
    });
    window.on('closed', () => clearTimeout(recoveryTimer));
    window.loadURL(rendererUrl).catch(() => recoverRenderer());
  } else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function registerIpc() {
  const projectRoot = path.join(__dirname, '..');
  const modelConfigPath = path.join(app.getPath('userData'), 'models.json');
  const kunpoConfig = loadKunpoConfig(projectRoot, process.env, { modelConfigPath });
  const projectStore = createProjectStore();
  const pipeline = createDesignPipeline({ projectStore, kunpoClient, kunpoConfig });
  const flowStateRepair = createFlowStateRepair({ projectStore });

  ipcMain.handle('copilot:config', async () => ({
    kunpo: kunpoClient.safeConfig(kunpoConfig),
    workspaceRoot: projectStore.workspaceRoot,
    platform: process.platform
  }));
  ipcMain.handle('copilot:config:models', async (_event, input) => {
    const saved = saveModelConfig(projectRoot, input, process.env, { modelConfigPath });
    kunpoConfig.visionModel = saved.visionModel;
    kunpoConfig.critiqueModel = saved.critiqueModel;
    kunpoConfig.imageModel = saved.imageModel;
    kunpoConfig.modelSource = path.basename(saved.modelConfigPath);
    return {
      kunpo: kunpoClient.safeConfig(kunpoConfig),
      workspaceRoot: projectStore.workspaceRoot,
      platform: process.platform
    };
  });
  ipcMain.handle('copilot:projects:list', () => projectStore.list());
  ipcMain.handle('copilot:projects:create', (_event, input) => projectStore.create(input));
  ipcMain.handle('copilot:projects:duplicate', (_event, projectId) => projectStore.duplicate(projectId));
  ipcMain.handle('copilot:projects:open', (_event, projectId, options) => projectStore.open(projectId, options));
  ipcMain.handle('copilot:screens:list', (_event, projectId) => projectStore.listScreens(projectId));
  ipcMain.handle('copilot:screens:create', (_event, projectId, input) => projectStore.createScreen(projectId, input));
  ipcMain.handle('copilot:screens:duplicate', (_event, projectId, screenId, input) => projectStore.duplicateScreen(projectId, screenId, input));
  ipcMain.handle('copilot:screens:active', (_event, projectId, screenId) => projectStore.setActiveScreen(projectId, screenId));
  ipcMain.handle('copilot:screens:update', (_event, projectId, screenId, patch) => projectStore.updateScreen(projectId, screenId, patch));
  ipcMain.handle('copilot:projects:save', async (_event, projectId, patch) => {
    const before = await projectStore.open(projectId, { screenId: patch.screenId });
    const saved = await projectStore.saveProject(projectId, patch);
    return pipeline.invalidateFromInputChange(projectId, {
      requirement: before.requirement !== saved.requirement,
      artDirection: before.art_direction !== saved.art_direction,
      projectType: before.project_type !== saved.project_type,
      continuationMode: before.continuation_mode !== saved.continuation_mode,
      screenId: patch.screenId || saved.screen_id
    });
  });
  ipcMain.handle('copilot:projects:reveal', async (_event, projectId) => {
    const project = await projectStore.resolveProject(projectId);
    shell.showItemInFolder(path.join(project.workspacePath, 'project.json'));
    return { ok: true };
  });
  // 顶栏「使用说明书」入口：用系统默认浏览器打开随仓库分发的单文件 HTML 说明书
  ipcMain.handle('copilot:guide:open', async () => {
    const guidePath = path.join(__dirname, '..', 'docs', 'user', 'quick-start-guide.html');
    const exists = await fs.access(guidePath).then(() => true).catch(() => false);
    if (!exists) return { ok: false };
    const openError = await shell.openPath(guidePath);
    return { ok: !openError };
  });
  ipcMain.handle('copilot:projects:import', async (_event, projectId, kind, screenId) => {
    const selection = await dialog.showOpenDialog({
      title: kind === 'wireframe' ? '选择 UE Wireframe' : '选择批准的视觉参考',
      properties: kind === 'reference' ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (selection.canceled || !selection.filePaths.length) return projectStore.open(projectId, { screenId });
    const before = await projectStore.open(projectId, { screenId });
    let result;
    for (const filePath of selection.filePaths) result = await projectStore.importFile(projectId, filePath, kind, { screenId });
    if (!result) return before;
    await pipeline.invalidateFromInputChange(projectId, { wireframe: kind === 'wireframe', references: kind === 'reference', screenId: screenId || result.screen_id });
    return projectStore.open(projectId, { screenId });
  });
  ipcMain.handle('copilot:projects:reference', async (_event, projectId, input) => {
    await projectStore.manageReference(projectId, input);
    await pipeline.invalidateFromInputChange(projectId, { references: true });
    return projectStore.open(projectId);
  });
  ipcMain.handle('copilot:fonts:import', async (_event, projectId, input) => {
    const selection = await dialog.showOpenDialog({ title: '选择字体资产', properties: ['openFile'], filters: [{ name: 'Fonts', extensions: ['otf', 'ttf'] }] });
    if (selection.canceled || !selection.filePaths[0]) return projectStore.open(projectId);
    return pipeline.addFontAsset(projectId, selection.filePaths[0], input);
  });
  ipcMain.handle('copilot:fonts:confirm', (_event, projectId, input) => pipeline.confirmFontUsage(projectId, input));
  ipcMain.handle('copilot:fonts:bytes', async (_event, projectId, fontId) => {
    const project = await projectStore.open(projectId, { includePreviews: false });
    const font = (project.artifacts.fontManifest?.fonts || []).find((item) => item.id === fontId);
    if (!font) throw new Error(`Font not found: ${fontId}`);
    let bytes;
    try {
      bytes = await fs.readFile(resolveProjectPath(project.workspacePath, font.local_path));
    } catch (cause) {
      throw Object.assign(new Error(`${ERROR_CODES.FONT_ACTUAL_LOAD_FAILED}: Font asset cannot be read for ${fontId}: ${cause.message}`), { code: ERROR_CODES.FONT_ACTUAL_LOAD_FAILED, cause });
    }
    if (hashBuffer(bytes) !== font.file_hash) throw Object.assign(new Error(`${ERROR_CODES.FONT_ASSET_HASH_MISMATCH}: Font asset hash changed: ${fontId}`), { code: ERROR_CODES.FONT_ASSET_HASH_MISMATCH });
    return bytes;
  });
  ipcMain.handle('copilot:components:import', async (_event, projectId, input) => {
    const selection = await dialog.showOpenDialog({ title: '选择组件资产', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }] });
    if (selection.canceled || !selection.filePaths[0]) return projectStore.open(projectId);
    return pipeline.addComponentAsset(projectId, selection.filePaths[0], input);
  });
  ipcMain.handle('copilot:components:forge-import', async (_event, projectId) => {
    const selection = await dialog.showOpenDialog({ title: '选择 Game UI Forge Manifest', properties: ['openFile'], filters: [{ name: 'JSON Manifest', extensions: ['json'] }] });
    if (selection.canceled || !selection.filePaths[0]) return projectStore.open(projectId);
    return pipeline.addForgeManifest(projectId, selection.filePaths[0]);
  });
  ipcMain.handle('copilot:pipeline:run', (_event, projectId, stage, input) => pipeline.runStage(projectId, stage, input));
  ipcMain.handle('copilot:input:draft-requirement', (_event, projectId, input) => pipeline.draftRequirement(projectId, input));
  ipcMain.handle('copilot:pipeline:cancel', (_event, projectId, stage, input) => pipeline.cancelStage(projectId, stage, input));
  ipcMain.handle('copilot:pipeline:approve', (_event, projectId, kind, input) => pipeline.approveArtifact(projectId, kind, input));
  ipcMain.handle('copilot:pipeline:repair-route-cycle', async (_event, projectId, input) => {
    // 修复返回统一为刷新后的项目；审计细节写入项目内修复台账。
    await flowStateRepair.repairRouteCycle(projectId, input);
    return projectStore.open(projectId, { includePreviews: false, screenId: input?.screenId });
  });
  ipcMain.handle('copilot:pipeline:update', (_event, projectId, kind, patch) => pipeline.updateArtifact(projectId, kind, patch));
  ipcMain.handle('copilot:underlay:contract', (_event, projectId, input) => pipeline.createUnderlayContract(projectId, input));
  ipcMain.handle('copilot:underlay:guide', (_event, projectId, input) => pipeline.createLayoutGuide(projectId, input));
  ipcMain.handle('copilot:underlay:critique', (_event, projectId, input) => pipeline.critiqueUnderlay(projectId, input));
  ipcMain.handle('copilot:underlay:repair', (_event, projectId, input) => pipeline.repairUnderlay(projectId, input));
  ipcMain.handle('copilot:underlay:waiver', (_event, projectId, input) => pipeline.waiveUnderlayIssue(projectId, input));
  ipcMain.handle('copilot:underlay:manual-review', (_event, projectId, input) => pipeline.approveUnderlayManualReview(projectId, input));
  ipcMain.handle('copilot:composition:create', (_event, projectId, input) => pipeline.composeVisual(projectId, input));
  ipcMain.handle('copilot:fidelity:run', (_event, projectId, input) => pipeline.runFidelity(projectId, input));
  ipcMain.handle('copilot:visual:export', async (_event, projectId, variationId) => {
    const project = await projectStore.open(projectId);
    const strict = project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation';
    if (strict) {
      const output = project.artifacts.compositionOutput;
      // Exporting the final PNG requires a passing fidelity report that was
      // computed against exactly this manifest/output pair; a failed or stale
      // fidelity gate blocks the export (UIE2E-07C).
      const fidelity = project.artifacts.fidelityReport;
      const fidelityFresh = Boolean(fidelity && fidelity.status === 'passed'
        && fidelity.source?.composition_manifest_version === project.artifacts.compositionManifest?.version
        && fidelity.source?.composition_output_hash === output?.hash);
      if (!fidelityFresh) throw Object.assign(new Error('无法导出最终成图：需要先通过针对当前合成结果的 Final Fidelity 检查。'), { code: ERROR_CODES.FINAL_EXPORT_BLOCKED });
      // 交付边界：最终批准（Composition Manifest approved）必须先于导出，
      // 避免未签核产物被当作正式交付外流。
      assertFinalApprovalForExport(project);
      const verification = await verifyCompositionOutput(project.workspacePath, output, { requireFinal: true });
      if (!verification.passed) throw Object.assign(new Error(`无法导出最终成图：${verification.issues.map((item) => item.message).join('；')}`), { code: ERROR_CODES.FINAL_EXPORT_BLOCKED });
      const selection = await dialog.showSaveDialog({
        title: '导出最终合成 PNG',
        defaultPath: `${project.name}-${project.screen_id}-final.png`,
        filters: [{ name: 'PNG Image', extensions: ['png'] }]
      });
      if (selection.canceled || !selection.filePath) return { ok: false };
      const exported = await exportCompositionOutput(project.workspacePath, output, selection.filePath);
      shell.showItemInFolder(selection.filePath);
      return exported;
    }
    const variation = (project.artifacts.visualResults?.variations || []).find((item) => item.id === variationId);
    if (!variation?.image_url) throw new Error('未找到可导出的视觉方案。');
    const selection = await dialog.showSaveDialog({
      title: '导出视觉方案',
      defaultPath: `${project.name}-${variation.strategy || variation.id}.png`,
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    });
    if (selection.canceled || !selection.filePath) return { ok: false };
    const response = await fetch(variation.image_url);
    if (!response.ok) throw new Error(`下载视觉方案失败：${response.status}`);
    await fs.writeFile(selection.filePath, Buffer.from(await response.arrayBuffer()));
    shell.showItemInFolder(selection.filePath);
    return { ok: true, filePath: selection.filePath };
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
