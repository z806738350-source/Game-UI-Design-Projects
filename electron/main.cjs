const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadKunpoConfig, saveModelConfig } = require('./services/env.cjs');
const kunpoClient = require('./services/kunpoClient.cjs');
const { createProjectStore } = require('./services/projectStore.cjs');
const { createDesignPipeline } = require('./services/designPipeline.cjs');

const isDev = process.env.VITE_DEV_SERVER_URL || !app.isPackaged;

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

  ipcMain.handle('copilot:config', async () => ({
    kunpo: kunpoClient.safeConfig(kunpoConfig),
    workspaceRoot: projectStore.workspaceRoot,
    platform: process.platform
  }));
  ipcMain.handle('copilot:config:models', async (_event, input) => {
    const saved = saveModelConfig(projectRoot, input, process.env, { modelConfigPath });
    kunpoConfig.visionModel = saved.visionModel;
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
  ipcMain.handle('copilot:projects:save', async (_event, projectId, patch) => {
    const before = await projectStore.open(projectId);
    const saved = await projectStore.saveProject(projectId, patch);
    return pipeline.invalidateFromInputChange(projectId, {
      requirement: before.requirement !== saved.requirement,
      artDirection: before.art_direction !== saved.art_direction,
      projectType: before.project_type !== saved.project_type
    });
  });
  ipcMain.handle('copilot:projects:reveal', async (_event, projectId) => {
    const project = await projectStore.resolveProject(projectId);
    shell.showItemInFolder(path.join(project.workspacePath, 'project.json'));
    return { ok: true };
  });
  ipcMain.handle('copilot:projects:import', async (_event, projectId, kind) => {
    const selection = await dialog.showOpenDialog({
      title: kind === 'wireframe' ? '选择 UE Wireframe' : '选择批准的视觉参考',
      properties: kind === 'reference' ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (selection.canceled || !selection.filePaths.length) return projectStore.open(projectId);
    const before = await projectStore.open(projectId);
    let result;
    for (const filePath of selection.filePaths) result = await projectStore.importFile(projectId, filePath, kind);
    if (!result) return before;
    await pipeline.invalidateFromInputChange(projectId, { wireframe: kind === 'wireframe', references: kind === 'reference' });
    return projectStore.open(projectId);
  });
  ipcMain.handle('copilot:projects:reference', async (_event, projectId, input) => {
    await projectStore.manageReference(projectId, input);
    await pipeline.invalidateFromInputChange(projectId, { references: true });
    return projectStore.open(projectId);
  });
  ipcMain.handle('copilot:pipeline:run', (_event, projectId, stage, input) => pipeline.runStage(projectId, stage, input));
  ipcMain.handle('copilot:input:draft-requirement', (_event, projectId) => pipeline.draftRequirement(projectId));
  ipcMain.handle('copilot:pipeline:cancel', (_event, projectId, stage) => pipeline.cancelStage(projectId, stage));
  ipcMain.handle('copilot:pipeline:approve', (_event, projectId, kind, input) => pipeline.approveArtifact(projectId, kind, input));
  ipcMain.handle('copilot:pipeline:update', (_event, projectId, kind, patch) => pipeline.updateArtifact(projectId, kind, patch));
  ipcMain.handle('copilot:visual:export', async (_event, projectId, variationId) => {
    const project = await projectStore.open(projectId);
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
