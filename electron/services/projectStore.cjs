const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ensureDir, readJson, writeJson } = require('./jsonStore.cjs');
const { readImageMetadata } = require('./imageMetadata.cjs');
const { artifactRelativePath, GLOBAL_ARTIFACTS, SCREEN_ARTIFACTS } = require('./artifactRegistry.cjs');
const { migrateProjectV2 } = require('./migrations.cjs');

function nextRevisions(project, keys) {
  const revisions = { requirement: 0, wireframe: 0, art_direction: 0, references: 0, ...(project.input_revisions || {}) };
  keys.forEach((key) => { revisions[key] = Number(revisions[key] || 0) + 1; });
  return revisions;
}

async function imagePreview(filePath, mime) {
  const bytes = await fs.readFile(filePath).catch(() => null);
  return bytes ? `data:${mime};base64,${bytes.toString('base64')}` : undefined;
}

function slugify(value) {
  const slug = String(value || '').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `project-${Date.now()}`;
}

function defaultWorkflow(projectId) {
  const screenStages = {
    screen_definition: { status: 'draft' }, component_binding: { status: 'draft' }, layout_design: { status: 'draft' },
    underlay_specification: { status: 'draft' }, underlay_generation: { status: 'draft' }, underlay_review: { status: 'draft' },
    composition: { status: 'draft' }, fidelity_review: { status: 'draft' }, visual_exploration: { status: 'draft' }
  };
  return {
    schema_version: '2.0',
    project_id: projectId,
    active_screen_id: 'main',
    current_stage: 'input',
    stages: {
      input: { status: 'draft' },
      wireframe_interpretation: { status: 'draft' },
      layout_design: { status: 'draft' },
      style_resolution: { status: 'draft' },
      visual_exploration: { status: 'draft' }
    },
    global_stages: { input: { status: 'draft' }, reference_analysis: { status: 'draft' }, style_resolution: { status: 'draft' }, typography_resolution: { status: 'draft' }, component_resolution: { status: 'draft' } },
    screen_stages: { main: screenStages },
    updated_at: new Date().toISOString()
  };
}

function createProjectStore(options = {}) {
  const workspaceRoot = options.workspaceRoot || process.env.DESIGN_COPILOT_WORKSPACE || path.join(os.homedir(), 'Game UI Design Projects');

  async function list() {
    await ensureDir(workspaceRoot);
    const entries = await fs.readdir(workspaceRoot, { withFileTypes: true }).catch(() => []);
    const projects = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const projectPath = path.join(workspaceRoot, entry.name);
      const project = await readJson(path.join(projectPath, 'project.json'), null);
      return project ? { ...project, workspacePath: projectPath } : null;
    }));
    return projects.filter(Boolean).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  async function readArtifactHistory(projectPath) {
    return readJson(path.join(projectPath, 'workflow', 'artifact-history.json'), []);
  }

  async function create(input = {}) {
    const name = String(input.name || '未命名游戏 UI 项目').trim();
    const id = `${slugify(name)}-${Date.now().toString(36)}`;
    const projectPath = path.join(workspaceRoot, id);
    const now = new Date().toISOString();
    await Promise.all([
      ensureDir(path.join(projectPath, 'inputs')),
      ensureDir(path.join(projectPath, 'screens', 'main', 'explorations')),
      ensureDir(path.join(projectPath, 'screens', 'main', 'underlays')),
      ensureDir(path.join(projectPath, 'screens', 'main', 'compositions')),
      ensureDir(path.join(projectPath, 'style', 'references')),
      ensureDir(path.join(projectPath, 'style', 'fonts')),
      ensureDir(path.join(projectPath, 'style', 'components')),
      ensureDir(path.join(projectPath, 'workflow'))
    ]);
    const project = {
      schema_version: '2.0',
      id,
      name,
      screen_id: 'main',
      project_type: input.projectType === 'existing' ? 'existing' : 'new',
      continuation_mode: input.projectType === 'existing'
        ? (input.continuationMode === 'existing-guided' ? 'existing-guided' : 'existing-strict')
        : 'exploration',
      art_direction: String(input.artDirection || '').trim(),
      requirement: String(input.requirement || '').trim(),
      requirement_source: String(input.requirement || '').trim() ? 'user' : 'none',
      requirement_confirmed: Boolean(String(input.requirement || '').trim()),
      input_revisions: { requirement: 0, wireframe: 0, art_direction: 0, references: 0 },
      reference_assets: [],
      status: 'draft',
      created_at: now,
      updated_at: now
    };
    await fs.writeFile(path.join(projectPath, 'inputs', 'requirement.md'), `${project.requirement}\n`, 'utf8');
    await writeJson(path.join(projectPath, 'project.json'), project);
    await writeJson(path.join(projectPath, 'screens', 'index.json'), { schema_version: '2.0', active_screen_id: 'main', screens: [{ id: 'main', name: '主页面', status: 'active', created_at: now, updated_at: now }] });
    await writeJson(path.join(projectPath, 'workflow', 'state.json'), defaultWorkflow(id));
    return hydrate(projectPath);
  }

  async function resolveProject(projectId) {
    const projects = await list();
    const project = projects.find((item) => item.id === projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return project;
  }

  async function hydrate(projectPath, options = {}) {
    await migrateProjectV2(projectPath);
    const includePreviews = options.includePreviews !== false;
    const project = await readJson(path.join(projectPath, 'project.json'), null);
    if (!project) throw new Error('Invalid project folder.');
    const screenId = options.screenId || project.active_screen_id || project.screen_id || 'main';
    const screenPath = path.join(projectPath, 'screens', screenId);
    const [workflow, screenContract, bindings, layouts, approvedLayout, underlayContract, underlayCritique, underlayRepairTask, compositionManifest, fidelityReport, styleContract, fontManifest, componentContract, visualTask, visualResults, artifactHistory] = await Promise.all([
      readJson(path.join(projectPath, 'workflow', 'state.json'), defaultWorkflow(project.id)),
      readJson(path.join(screenPath, 'screen-contract.json'), null),
      readJson(path.join(screenPath, 'component-bindings.json'), null),
      readJson(path.join(screenPath, 'layout-proposals.json'), null),
      readJson(path.join(screenPath, 'approved-layout.json'), null),
      readJson(path.join(screenPath, 'underlay-contract.json'), null),
      readJson(path.join(screenPath, 'underlay-critique.json'), null),
      readJson(path.join(screenPath, 'underlay-repair-task.json'), null),
      readJson(path.join(screenPath, 'composition-manifest.json'), null),
      readJson(path.join(screenPath, 'fidelity-report.json'), null),
      readJson(path.join(projectPath, 'style', 'style-contract.json'), null),
      readJson(path.join(projectPath, 'style', 'font-manifest.json'), null),
      readJson(path.join(projectPath, 'style', 'component-contract.json'), null),
      readJson(path.join(screenPath, 'visual-task.json'), null),
      readJson(path.join(screenPath, 'explorations', 'results.json'), { variations: [] }),
      readArtifactHistory(projectPath)
    ]);
    let wireframe_preview;
    let wireframe_metadata = project.wireframe_metadata;
    if (project.wireframe_path) {
      wireframe_metadata ||= await readImageMetadata(project.wireframe_path).catch(() => null);
      if (wireframe_metadata && includePreviews) wireframe_preview = await imagePreview(project.wireframe_path, wireframe_metadata.mime);
    }
    const storedReferences = project.reference_assets?.length
      ? project.reference_assets
      : (project.reference_paths || []).map((referencePath, index) => ({
          id: `legacy-reference-${index + 1}`,
          path: referencePath,
          name: path.basename(referencePath),
          role: index === 0 ? 'primary' : 'supporting'
        }));
    const reference_assets = await Promise.all(storedReferences.map(async (asset, index) => {
      const metadata = asset.metadata || await readImageMetadata(asset.path).catch(() => null);
      return {
        ...asset,
        order: index,
        metadata,
        preview: metadata && includePreviews ? await imagePreview(asset.path, metadata.mime) : undefined
      };
    }));
    const screens = await readJson(path.join(projectPath, 'screens', 'index.json'), { active_screen_id: screenId, screens: [] });
    return {
      ...project,
      screen_id: screenId,
      active_screen_id: screenId,
      screens: screens.screens || [],
      workspacePath: projectPath,
      wireframe_preview,
      wireframe_metadata,
      canvas_spec: wireframe_metadata?.canvas_spec || project.canvas_spec,
      reference_assets,
      reference_paths: reference_assets.map((asset) => asset.path),
      workflow,
      artifactHistory,
      artifacts: { screenContract, bindings, layouts, approvedLayout, underlayContract, underlayCritique, underlayRepairTask, compositionManifest, fidelityReport, styleContract, fontManifest, componentContract, visualTask, visualResults }
    };
  }

  async function open(projectId, options) {
    const project = await resolveProject(projectId);
    return hydrate(project.workspacePath, options);
  }

  async function saveProject(projectId, patch = {}) {
    const project = await resolveProject(projectId);
    const requirement = typeof patch.requirement === 'string' ? patch.requirement : project.requirement;
    const projectType = patch.projectType === 'existing' ? 'existing' : patch.projectType === 'new' ? 'new' : project.project_type;
    const requestedMode = ['exploration', 'existing-strict', 'existing-guided', 'locked-continuation'].includes(patch.continuationMode)
      ? patch.continuationMode
      : project.continuation_mode;
    const continuationMode = projectType === 'existing'
      ? (requestedMode === 'existing-guided' ? 'existing-guided' : 'existing-strict')
      : (requestedMode === 'locked-continuation' ? 'locked-continuation' : 'exploration');
    const artDirection = typeof patch.artDirection === 'string' ? patch.artDirection : project.art_direction;
    const requirementChanged = requirement !== project.requirement;
    const requirementSource = ['none', 'user', 'ai'].includes(patch.requirementSource)
      ? patch.requirementSource
      : requirementChanged ? (requirement ? 'user' : 'none') : project.requirement_source;
    const requirementConfirmed = typeof patch.requirementConfirmed === 'boolean'
      ? patch.requirementConfirmed
      : requirementChanged ? false : project.requirement_confirmed;
    const revisionKeys = [];
    if (requirement !== project.requirement) revisionKeys.push('requirement');
    if (artDirection !== project.art_direction || projectType !== project.project_type) revisionKeys.push('art_direction');
    const next = {
      ...project,
      name: typeof patch.name === 'string' ? patch.name.trim() || project.name : project.name,
      requirement,
      requirement_source: requirement ? (requirementSource || 'user') : 'none',
      requirement_confirmed: requirement ? Boolean(requirementConfirmed) : false,
      intent_analysis: patch.intentAnalysis && typeof patch.intentAnalysis === 'object' ? patch.intentAnalysis : project.intent_analysis,
      project_type: projectType,
      continuation_mode: continuationMode,
      art_direction: artDirection,
      input_revisions: nextRevisions(project, revisionKeys),
      status: patch.status === 'archived' ? 'archived' : patch.status === 'draft' ? 'draft' : project.status,
      updated_at: new Date().toISOString()
    };
    delete next.workspacePath;
    await writeJson(path.join(project.workspacePath, 'project.json'), next);
    await fs.writeFile(path.join(project.workspacePath, 'inputs', 'requirement.md'), `${next.requirement}\n`, 'utf8');
    return hydrate(project.workspacePath);
  }

  async function importFile(projectId, sourcePath, kind) {
    const project = await resolveProject(projectId);
    const metadata = await readImageMetadata(sourcePath);
    const extension = metadata.format === 'jpeg' ? '.jpg' : `.${metadata.format}`;
    const safeName = kind === 'wireframe' ? `wireframe${extension}` : `${Date.now().toString(36)}${extension}`;
    const targetDir = kind === 'wireframe'
      ? path.join(project.workspacePath, 'inputs')
      : path.join(project.workspacePath, 'style', 'references');
    await ensureDir(targetDir);
    const targetPath = path.join(targetDir, safeName);
    await fs.copyFile(sourcePath, targetPath);
    const key = kind === 'wireframe' ? 'wireframe' : 'reference';
    const nextProject = await readJson(path.join(project.workspacePath, 'project.json'), {});
    if (key === 'wireframe') {
      nextProject.wireframe_path = targetPath;
      nextProject.wireframe_name = path.basename(sourcePath);
      nextProject.wireframe_metadata = metadata;
      nextProject.canvas_spec = metadata.canvas_spec;
      nextProject.input_revisions = nextRevisions(nextProject, ['wireframe']);
    }
    else {
      const assets = nextProject.reference_assets || (nextProject.reference_paths || []).map((referencePath, index) => ({
        id: `legacy-reference-${index + 1}`, path: referencePath, name: path.basename(referencePath), role: index === 0 ? 'primary' : 'supporting'
      }));
      assets.push({
        id: `reference-${Date.now().toString(36)}-${assets.length + 1}`,
        path: targetPath,
        name: path.basename(sourcePath),
        role: assets.length ? 'supporting' : 'primary',
        metadata
      });
      nextProject.reference_assets = assets;
      nextProject.reference_paths = assets.map((asset) => asset.path);
      nextProject.input_revisions = nextRevisions(nextProject, ['references']);
    }
    nextProject.updated_at = new Date().toISOString();
    await writeJson(path.join(project.workspacePath, 'project.json'), nextProject);
    return hydrate(project.workspacePath);
  }

  async function manageReference(projectId, input = {}) {
    const project = await resolveProject(projectId);
    const nextProject = await readJson(path.join(project.workspacePath, 'project.json'), {});
    let assets = nextProject.reference_assets?.length
      ? [...nextProject.reference_assets]
      : (nextProject.reference_paths || []).map((referencePath, index) => ({
          id: `legacy-reference-${index + 1}`, path: referencePath, name: path.basename(referencePath), role: index === 0 ? 'primary' : 'supporting'
        }));
    const index = assets.findIndex((asset) => asset.id === input.id);
    if (index < 0) throw new Error('未找到该参考图。');
    if (input.action === 'remove') assets.splice(index, 1);
    else if (input.action === 'move') {
      const target = Math.max(0, Math.min(assets.length - 1, index + (input.direction === 'up' ? -1 : 1)));
      [assets[index], assets[target]] = [assets[target], assets[index]];
    } else if (input.action === 'role') {
      const role = ['primary', 'component', 'material', 'composition', 'supporting'].includes(input.role) ? input.role : 'supporting';
      if (role === 'primary') assets = assets.map((asset) => ({ ...asset, role: asset.id === input.id ? 'primary' : asset.role === 'primary' ? 'supporting' : asset.role }));
      else assets[index] = { ...assets[index], role };
    } else throw new Error('未知的参考图操作。');
    nextProject.reference_assets = assets;
    nextProject.reference_paths = assets.map((asset) => asset.path);
    nextProject.input_revisions = nextRevisions(nextProject, ['references']);
    nextProject.updated_at = new Date().toISOString();
    await writeJson(path.join(project.workspacePath, 'project.json'), nextProject);
    return hydrate(project.workspacePath);
  }

  async function saveArtifact(projectId, kind, artifact, options = {}) {
    const project = await resolveProject(projectId);
    const screenId = options.screenId || project.active_screen_id || project.screen_id || 'main';
    const artifactPath = path.join(project.workspacePath, artifactRelativePath(kind, screenId));
    const previous = await readJson(artifactPath, null);
    if (previous) {
      const historyDir = path.join(project.workspacePath, 'workflow', 'history');
      await ensureDir(historyDir);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await writeJson(path.join(historyDir, `${kind}-${stamp}.json`), previous);
      const historyPath = path.join(project.workspacePath, 'workflow', 'artifact-history.json');
      const history = await readJson(historyPath, []);
      history.unshift({
        kind,
        id: previous.id,
        version: previous.version || 1,
        status: previous.status || 'draft',
        saved_at: new Date().toISOString(),
        snapshot: `workflow/history/${kind}-${stamp}.json`
      });
      await writeJson(historyPath, history.slice(0, 100));
    }
    await writeJson(artifactPath, artifact);
    return artifact;
  }

  async function updateWorkflow(projectId, stage, status, output, details = {}) {
    const project = await resolveProject(projectId);
    const statePath = path.join(project.workspacePath, 'workflow', 'state.json');
    const state = await readJson(statePath, defaultWorkflow(projectId));
    const { keepCurrentStage = false, ...stageDetails } = details;
    const screenId = project.active_screen_id || project.screen_id || 'main';
    const globalStage = ['input', 'reference_analysis', 'style_resolution', 'typography_resolution', 'component_resolution'].includes(stage);
    const next = {
      ...state,
      current_stage: keepCurrentStage ? state.current_stage : stage,
      stages: {
        ...state.stages,
        [stage]: { status, ...(output ? { output } : {}), ...stageDetails, updated_at: new Date().toISOString() }
      },
      global_stages: globalStage ? { ...(state.global_stages || {}), [stage]: { status, ...(output ? { output } : {}), ...stageDetails, updated_at: new Date().toISOString() } } : state.global_stages,
      screen_stages: globalStage ? state.screen_stages : { ...(state.screen_stages || {}), [screenId]: { ...(state.screen_stages?.[screenId] || {}), [stage]: { status, ...(output ? { output } : {}), ...stageDetails, updated_at: new Date().toISOString() } } },
      updated_at: new Date().toISOString()
    };
    await writeJson(statePath, next);
    return next;
  }

  async function duplicate(projectId) {
    const project = await resolveProject(projectId);
    const name = `${project.name} · 副本`;
    const id = `${slugify(name)}-${Date.now().toString(36)}`;
    const destination = path.join(workspaceRoot, id);
    await fs.cp(project.workspacePath, destination, { recursive: true });
    const copy = await readJson(path.join(destination, 'project.json'), {});
    const now = new Date().toISOString();
    const wireframePath = copy.wireframe_path
      ? path.join(destination, 'inputs', path.basename(copy.wireframe_path))
      : undefined;
    const referencePaths = (copy.reference_paths || []).map((referencePath) =>
      path.join(destination, 'style', 'references', path.basename(referencePath))
    );
    const referenceAssets = (copy.reference_assets || []).map((asset) => ({
      ...asset,
      path: path.join(destination, 'style', 'references', path.basename(asset.path))
    }));
    await writeJson(path.join(destination, 'project.json'), {
      ...copy,
      id,
      name,
      status: 'draft',
      ...(wireframePath ? { wireframe_path: wireframePath } : {}),
      reference_paths: referencePaths,
      reference_assets: referenceAssets,
      created_at: now,
      updated_at: now
    });
    const workflowPath = path.join(destination, 'workflow', 'state.json');
    const workflow = await readJson(workflowPath, defaultWorkflow(id));
    await writeJson(workflowPath, { ...workflow, project_id: id, updated_at: now });
    return hydrate(destination);
  }

  async function listScreens(projectId) {
    const project = await resolveProject(projectId);
    await migrateProjectV2(project.workspacePath);
    return readJson(path.join(project.workspacePath, 'screens', 'index.json'), { active_screen_id: 'main', screens: [] });
  }

  async function createScreen(projectId, input = {}) {
    const project = await resolveProject(projectId);
    const registry = await listScreens(projectId);
    const id = slugify(input.id || input.name || `screen-${registry.screens.length + 1}`);
    if (registry.screens.some((screen) => screen.id === id)) throw new Error(`Screen already exists: ${id}`);
    const now = new Date().toISOString();
    const entry = { id, name: String(input.name || id), status: 'active', created_at: now, updated_at: now };
    await ensureDir(path.join(project.workspacePath, 'screens', id, 'explorations'));
    await ensureDir(path.join(project.workspacePath, 'screens', id, 'underlays'));
    await ensureDir(path.join(project.workspacePath, 'screens', id, 'compositions'));
    await writeJson(path.join(project.workspacePath, 'screens', 'index.json'), { ...registry, screens: [...registry.screens, entry] });
    const statePath = path.join(project.workspacePath, 'workflow', 'state.json');
    const state = await readJson(statePath, defaultWorkflow(projectId));
    await writeJson(statePath, { ...state, screen_stages: { ...(state.screen_stages || {}), [id]: defaultWorkflow(projectId).screen_stages.main }, updated_at: now });
    return entry;
  }

  async function setActiveScreen(projectId, screenId) {
    const project = await resolveProject(projectId);
    const registry = await listScreens(projectId);
    const screen = registry.screens.find((item) => item.id === screenId && item.status !== 'archived');
    if (!screen) throw new Error(`Screen not found or archived: ${screenId}`);
    const now = new Date().toISOString();
    await writeJson(path.join(project.workspacePath, 'screens', 'index.json'), { ...registry, active_screen_id: screenId });
    const stored = await readJson(path.join(project.workspacePath, 'project.json'), {});
    await writeJson(path.join(project.workspacePath, 'project.json'), { ...stored, active_screen_id: screenId, screen_id: screenId, updated_at: now });
    const statePath = path.join(project.workspacePath, 'workflow', 'state.json');
    const state = await readJson(statePath, defaultWorkflow(projectId));
    await writeJson(statePath, { ...state, active_screen_id: screenId, updated_at: now });
    return hydrate(project.workspacePath, { screenId });
  }

  async function updateScreen(projectId, screenId, patch = {}) {
    const project = await resolveProject(projectId);
    const registry = await listScreens(projectId);
    const index = registry.screens.findIndex((screen) => screen.id === screenId);
    if (index < 0) throw new Error(`Screen not found: ${screenId}`);
    const screens = [...registry.screens];
    screens[index] = { ...screens[index], ...(typeof patch.name === 'string' ? { name: patch.name.trim() || screens[index].name } : {}), ...(patch.status === 'archived' ? { status: 'archived' } : {}), updated_at: new Date().toISOString() };
    if (screens[index].status === 'archived' && registry.active_screen_id === screenId) throw new Error('Cannot archive the active screen. Switch screens first.');
    await writeJson(path.join(project.workspacePath, 'screens', 'index.json'), { ...registry, screens });
    return screens[index];
  }

  return { workspaceRoot, artifactKinds: [...Object.keys(GLOBAL_ARTIFACTS), ...Object.keys(SCREEN_ARTIFACTS)], list, create, duplicate, open, saveProject, importFile, manageReference, saveArtifact, updateWorkflow, resolveProject, hydrate, listScreens, createScreen, setActiveScreen, updateScreen };
}

module.exports = { createProjectStore };
