const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('designCopilot', {
  getConfig: () => ipcRenderer.invoke('copilot:config'),
  saveModelConfig: (input) => ipcRenderer.invoke('copilot:config:models', input),
  listProjects: () => ipcRenderer.invoke('copilot:projects:list'),
  createProject: (input) => ipcRenderer.invoke('copilot:projects:create', input),
  duplicateProject: (projectId) => ipcRenderer.invoke('copilot:projects:duplicate', projectId),
  openProject: (projectId, options) => ipcRenderer.invoke('copilot:projects:open', projectId, options),
  listScreens: (projectId) => ipcRenderer.invoke('copilot:screens:list', projectId),
  createScreen: (projectId, input) => ipcRenderer.invoke('copilot:screens:create', projectId, input),
  setActiveScreen: (projectId, screenId) => ipcRenderer.invoke('copilot:screens:active', projectId, screenId),
  updateScreen: (projectId, screenId, patch) => ipcRenderer.invoke('copilot:screens:update', projectId, screenId, patch),
  saveProject: (projectId, patch) => ipcRenderer.invoke('copilot:projects:save', projectId, patch),
  importFile: (projectId, kind) => ipcRenderer.invoke('copilot:projects:import', projectId, kind),
  manageReference: (projectId, input) => ipcRenderer.invoke('copilot:projects:reference', projectId, input),
  revealProject: (projectId) => ipcRenderer.invoke('copilot:projects:reveal', projectId),
  runStage: (projectId, stage, input) => ipcRenderer.invoke('copilot:pipeline:run', projectId, stage, input),
  draftRequirement: (projectId) => ipcRenderer.invoke('copilot:input:draft-requirement', projectId),
  cancelStage: (projectId, stage) => ipcRenderer.invoke('copilot:pipeline:cancel', projectId, stage),
  approveArtifact: (projectId, kind, input) => ipcRenderer.invoke('copilot:pipeline:approve', projectId, kind, input),
  updateArtifact: (projectId, kind, patch) => ipcRenderer.invoke('copilot:pipeline:update', projectId, kind, patch),
  exportVisual: (projectId, variationId) => ipcRenderer.invoke('copilot:visual:export', projectId, variationId)
});
