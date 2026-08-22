const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
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

function screenInputPath(projectPath, screenId) {
  return path.join(projectPath, 'screens', screenId, 'inputs.json');
}

function baseScreenInput(project, screenId) {
  return {
    schema_version: '2.0', screen_id: screenId, input_mode: 'own',
    requirement: '', requirement_source: 'none', requirement_confirmed: false,
    input_revisions: { requirement: 0, wireframe: 0 }
  };
}

function inventoryFromAssets(assets, previous = null) {
  const now = new Date().toISOString();
  return {
    schema_version: '2.0', id: 'project-reference-inventory',
    version: Number(previous?.version || 0) + 1, status: 'reviewed',
    source: { managed_by: 'reference-workbench' }, updated_at: now,
    assets: (assets || []).map((asset, index) => ({
      ...asset, order: index, approved: asset.approved === true,
      screen_type: String(asset.screen_type || 'unspecified'),
      contains: Array.isArray(asset.contains) ? asset.contains : [],
      baseline: String(asset.baseline || ''), notes: String(asset.notes || '')
    }))
  };
}

function createProjectStore(options = {}) {
  const workspaceRoot = options.workspaceRoot || process.env.DESIGN_COPILOT_WORKSPACE || path.join(os.homedir(), 'Game UI Design Projects');

  async function list() {
    await ensureDir(workspaceRoot);
    const entries = await fs.readdir(workspaceRoot, { withFileTypes: true }).catch(() => []);
    const projects = await Promise.all(entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map(async (entry) => {
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
      ensureDir(path.join(projectPath, 'screens', 'main', 'inputs')),
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
    await writeJson(screenInputPath(projectPath, 'main'), {
      ...baseScreenInput(project, 'main'), requirement: project.requirement,
      requirement_source: project.requirement_source, requirement_confirmed: project.requirement_confirmed
    });
    await writeJson(path.join(projectPath, 'screens', 'index.json'), { schema_version: '2.0', active_screen_id: 'main', screens: [{ id: 'main', name: '主页面', status: 'active', input_mode: 'own', created_at: now, updated_at: now }] });
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
    const storedScreenInput = await readJson(screenInputPath(projectPath, screenId), null);
    const screenInput = storedScreenInput || {
      ...baseScreenInput(project, screenId), requirement: project.requirement || '',
      requirement_source: project.requirement_source || (project.requirement ? 'user' : 'none'),
      requirement_confirmed: project.requirement_confirmed ?? Boolean(project.requirement),
      wireframe_path: project.wireframe_path, wireframe_name: project.wireframe_name,
      wireframe_metadata: project.wireframe_metadata, canvas_spec: project.canvas_spec,
      input_revisions: project.input_revisions
    };
    const [workflow, referenceInventory, screenContract, bindings, layouts, approvedLayout, referencePack, underlayContract, underlayCritique, underlayRepairTask, compositionManifest, compositionOutput, fidelityReport, styleContract, fontManifest, componentContract, visualTask, visualResults, artifactHistory] = await Promise.all([
      readJson(path.join(projectPath, 'workflow', 'state.json'), defaultWorkflow(project.id)),
      readJson(path.join(projectPath, 'style', 'reference-inventory.json'), null),
      readJson(path.join(screenPath, 'screen-contract.json'), null),
      readJson(path.join(screenPath, 'component-bindings.json'), null),
      readJson(path.join(screenPath, 'layout-proposals.json'), null),
      readJson(path.join(screenPath, 'approved-layout.json'), null),
      readJson(path.join(screenPath, 'reference-pack.json'), null),
      readJson(path.join(screenPath, 'underlay-contract.json'), null),
      readJson(path.join(screenPath, 'underlay-critique.json'), null),
      readJson(path.join(screenPath, 'underlay-repair-task.json'), null),
      readJson(path.join(screenPath, 'composition-manifest.json'), null),
      readJson(path.join(screenPath, 'composition-output.json'), null),
      readJson(path.join(screenPath, 'fidelity-report.json'), null),
      readJson(path.join(projectPath, 'style', 'style-contract.json'), null),
      readJson(path.join(projectPath, 'style', 'font-manifest.json'), null),
      readJson(path.join(projectPath, 'style', 'component-contract.json'), null),
      readJson(path.join(screenPath, 'visual-task.json'), null),
      readJson(path.join(screenPath, 'explorations', 'results.json'), { variations: [] }),
      readArtifactHistory(projectPath)
    ]);
    let wireframe_preview;
    let wireframe_metadata = screenInput.wireframe_metadata;
    if (screenInput.wireframe_path) {
      wireframe_metadata ||= await readImageMetadata(screenInput.wireframe_path).catch(() => null);
      if (wireframe_metadata && includePreviews) wireframe_preview = await imagePreview(screenInput.wireframe_path, wireframe_metadata.mime);
    }
    const storedReferences = referenceInventory?.assets?.length
      ? referenceInventory.assets
      : project.reference_assets?.length ? project.reference_assets
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
    const hydratedComponentContract = componentContract && includePreviews ? {
      ...componentContract,
      families: await Promise.all((componentContract.families || []).map(async (family) => ({
        ...family,
        states: Object.fromEntries(await Promise.all(Object.entries(family.states || {}).map(async ([stateId, state]) => {
          const assetPath = path.resolve(projectPath, String(state.asset_path || ''));
          const safe = assetPath.startsWith(`${path.resolve(projectPath)}${path.sep}`);
          const preview = safe ? await imagePreview(assetPath, state.mime || 'image/png').catch(() => undefined) : undefined;
          return [stateId, { ...state, preview }];
        })))
      })))
    } : componentContract;
    const screens = await readJson(path.join(projectPath, 'screens', 'index.json'), { active_screen_id: screenId, screens: [] });
    return {
      ...project,
      requirement: screenInput.requirement || '',
      requirement_source: screenInput.requirement_source || 'none',
      requirement_confirmed: Boolean(screenInput.requirement_confirmed),
      intent_analysis: screenInput.intent_analysis,
      input_revisions: { ...(project.input_revisions || {}), ...(screenInput.input_revisions || {}) },
      wireframe_path: screenInput.wireframe_path,
      wireframe_name: screenInput.wireframe_name,
      screen_id: screenId,
      active_screen_id: screenId,
      screens: screens.screens || [],
      workspacePath: projectPath,
      wireframe_preview,
      wireframe_metadata,
      canvas_spec: wireframe_metadata?.canvas_spec || screenInput.canvas_spec,
      reference_assets,
      reference_paths: reference_assets.map((asset) => asset.path),
      workflow,
      artifactHistory,
      artifacts: { referenceInventory, screenContract, bindings, layouts, approvedLayout, referencePack, underlayContract, underlayCritique, underlayRepairTask, compositionManifest, compositionOutput, fidelityReport, styleContract, fontManifest, componentContract: hydratedComponentContract, visualTask, visualResults }
    };
  }

  async function open(projectId, options) {
    const project = await resolveProject(projectId);
    return hydrate(project.workspacePath, options);
  }

  async function saveProject(projectId, patch = {}) {
    const project = await resolveProject(projectId);
    const screenId = patch.screenId || project.active_screen_id || project.screen_id || 'main';
    const storedScreenInput = await readJson(screenInputPath(project.workspacePath, screenId), null);
    const currentInput = storedScreenInput || { ...baseScreenInput(project, screenId), requirement: project.requirement || '', requirement_source: project.requirement_source, requirement_confirmed: project.requirement_confirmed, intent_analysis: project.intent_analysis, input_revisions: project.input_revisions };
    const requirement = typeof patch.requirement === 'string' ? patch.requirement : currentInput.requirement;
    const projectType = patch.projectType === 'existing' ? 'existing' : patch.projectType === 'new' ? 'new' : project.project_type;
    const requestedMode = ['exploration', 'existing-strict', 'existing-guided', 'locked-continuation'].includes(patch.continuationMode)
      ? patch.continuationMode
      : project.continuation_mode;
    const continuationMode = projectType === 'existing'
      ? (requestedMode === 'existing-guided' ? 'existing-guided' : 'existing-strict')
      : (requestedMode === 'locked-continuation' ? 'locked-continuation' : 'exploration');
    const artDirection = typeof patch.artDirection === 'string' ? patch.artDirection : project.art_direction;
    const requirementChanged = requirement !== currentInput.requirement;
    const requirementSource = ['none', 'user', 'ai'].includes(patch.requirementSource)
      ? patch.requirementSource
      : requirementChanged ? (requirement ? 'user' : 'none') : currentInput.requirement_source;
    const requirementConfirmed = typeof patch.requirementConfirmed === 'boolean'
      ? patch.requirementConfirmed
      : requirementChanged ? false : currentInput.requirement_confirmed;
    const revisionKeys = [];
    if (requirementChanged) revisionKeys.push('requirement');
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
    const nextScreenInput = {
      ...currentInput, requirement, requirement_source: next.requirement_source,
      requirement_confirmed: next.requirement_confirmed, intent_analysis: next.intent_analysis,
      input_revisions: nextRevisions(currentInput, requirementChanged ? ['requirement'] : []), updated_at: next.updated_at
    };
    await writeJson(screenInputPath(project.workspacePath, screenId), nextScreenInput);
    await ensureDir(path.join(project.workspacePath, 'screens', screenId, 'inputs'));
    await fs.writeFile(path.join(project.workspacePath, 'screens', screenId, 'inputs', 'requirement.md'), `${requirement}\n`, 'utf8');
    return hydrate(project.workspacePath, { screenId });
  }

  async function importFile(projectId, sourcePath, kind, options = {}) {
    const project = await resolveProject(projectId);
    const screenId = options.screenId || project.active_screen_id || project.screen_id || 'main';
    const metadata = await readImageMetadata(sourcePath);
    const extension = metadata.format === 'jpeg' ? '.jpg' : `.${metadata.format}`;
    const safeName = kind === 'wireframe' ? `wireframe${extension}` : `${Date.now().toString(36)}${extension}`;
    const targetDir = kind === 'wireframe'
      ? path.join(project.workspacePath, 'screens', screenId, 'inputs')
      : path.join(project.workspacePath, 'style', 'references');
    await ensureDir(targetDir);
    const targetPath = path.join(targetDir, safeName);
    await fs.copyFile(sourcePath, targetPath);
    const key = kind === 'wireframe' ? 'wireframe' : 'reference';
    const nextProject = await readJson(path.join(project.workspacePath, 'project.json'), {});
    if (key === 'wireframe') {
      const currentInput = await readJson(screenInputPath(project.workspacePath, screenId), baseScreenInput(nextProject, screenId));
      await writeJson(screenInputPath(project.workspacePath, screenId), {
        ...currentInput, wireframe_path: targetPath, wireframe_name: path.basename(sourcePath),
        wireframe_metadata: metadata, canvas_spec: metadata.canvas_spec,
        input_revisions: nextRevisions(currentInput, ['wireframe']), updated_at: new Date().toISOString()
      });
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
        approved: false, screen_type: 'unspecified', contains: [], baseline: '', notes: '',
        metadata
      });
      nextProject.reference_assets = assets;
      nextProject.reference_paths = assets.map((asset) => asset.path);
      nextProject.input_revisions = nextRevisions(nextProject, ['references']);
    }
    nextProject.updated_at = new Date().toISOString();
    await writeJson(path.join(project.workspacePath, 'project.json'), nextProject);
    if (key === 'reference') {
      const previous = await readJson(path.join(project.workspacePath, 'style', 'reference-inventory.json'), null);
      await saveArtifact(projectId, 'reference-inventory', inventoryFromAssets(nextProject.reference_assets, previous));
    }
    return hydrate(project.workspacePath, { screenId });
  }

  // AUD-07：参考图管理必须先检测真实变化——聚焦后离开输入框、移动到原位置、
  // 重复设置同角色、重复批准相同状态都是 no-op：不写 project.json、不 bump
  // input_revisions、不写 Reference Inventory，调用方据此决定是否失效下游。
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
    const current = assets[index];
    let changed = true;
    if (input.action === 'remove') changed = true;
    else if (input.action === 'move') {
      const target = Math.max(0, Math.min(assets.length - 1, index + (input.direction === 'up' ? -1 : 1)));
      changed = target !== index;
    } else if (input.action === 'role') {
      const role = ['primary', 'component', 'material', 'composition', 'supporting'].includes(input.role) ? input.role : 'supporting';
      const nextAssets = role === 'primary' ? assets.map((asset) => ({ ...asset, role: asset.id === input.id ? 'primary' : asset.role === 'primary' ? 'supporting' : asset.role })) : assets.map((asset, position) => position === index ? { ...asset, role } : asset);
      changed = nextAssets.some((asset, position) => asset.role !== assets[position].role);
    } else if (input.action === 'details') {
      const nextScreenType = typeof input.screenType === 'string' ? (input.screenType.trim() || 'unspecified') : (current.screen_type || 'unspecified');
      const nextContains = Array.isArray(input.contains) ? input.contains.map(String).map((item) => item.trim()).filter(Boolean) : (current.contains || []);
      const nextBaseline = typeof input.baseline === 'string' ? input.baseline.trim() : (current.baseline || '');
      const nextNotes = typeof input.notes === 'string' ? input.notes.trim() : (current.notes || '');
      changed = nextScreenType !== (current.screen_type || 'unspecified')
        || JSON.stringify(nextContains) !== JSON.stringify(current.contains || [])
        || nextBaseline !== (current.baseline || '')
        || nextNotes !== (current.notes || '');
    } else if (input.action === 'approval') {
      changed = Boolean(current.approved) !== (input.approved === true);
    } else throw new Error('未知的参考图操作。');
    if (!changed) return { project: await hydrate(project.workspacePath), changed: false };
    if (input.action === 'remove') assets.splice(index, 1);
    else if (input.action === 'move') {
      const target = Math.max(0, Math.min(assets.length - 1, index + (input.direction === 'up' ? -1 : 1)));
      [assets[index], assets[target]] = [assets[target], assets[index]];
    } else if (input.action === 'role') {
      const role = ['primary', 'component', 'material', 'composition', 'supporting'].includes(input.role) ? input.role : 'supporting';
      if (role === 'primary') assets = assets.map((asset) => ({ ...asset, role: asset.id === input.id ? 'primary' : asset.role === 'primary' ? 'supporting' : asset.role }));
      else assets[index] = { ...assets[index], role };
    } else if (input.action === 'details') {
      assets[index] = {
        ...assets[index],
        ...(typeof input.screenType === 'string' ? { screen_type: input.screenType.trim() || 'unspecified' } : {}),
        ...(Array.isArray(input.contains) ? { contains: input.contains.map(String).map((item) => item.trim()).filter(Boolean) } : {}),
        ...(typeof input.baseline === 'string' ? { baseline: input.baseline.trim() } : {}),
        ...(typeof input.notes === 'string' ? { notes: input.notes.trim() } : {})
      };
    } else if (input.action === 'approval') {
      assets[index] = { ...assets[index], approved: input.approved === true };
    }
    nextProject.reference_assets = assets;
    nextProject.reference_paths = assets.map((asset) => asset.path);
    nextProject.input_revisions = nextRevisions(nextProject, ['references']);
    nextProject.updated_at = new Date().toISOString();
    await writeJson(path.join(project.workspacePath, 'project.json'), nextProject);
    const previous = await readJson(path.join(project.workspacePath, 'style', 'reference-inventory.json'), null);
    await saveArtifact(projectId, 'reference-inventory', inventoryFromAssets(assets, previous));
    return { project: await hydrate(project.workspacePath), changed: true };
  }

  async function saveArtifact(projectId, kind, artifact, options = {}) {
    const project = await resolveProject(projectId);
    const screenId = options.screenId || project.active_screen_id || project.screen_id || 'main';
    const artifactPath = path.join(project.workspacePath, artifactRelativePath(kind, screenId));
    const previous = await readJson(artifactPath, null);
    // AUD-10：版本只能由存储层产生（nextVersion = previousVersion + 1），
    // 模型或调用方传入的 version 一律忽略；同时由存储层盖 generation_id /
    // content_hash / updated_at，保证历史不出现重复 V1、React 依赖与
    // 证据链版本识别不撞号。
    const version = previous ? Number(previous.version || 1) + 1 : Math.max(1, Number(artifact.version) || 1);
    const { version: _incomingVersion, generation_id: _incomingGeneration, content_hash: _incomingHash, updated_at: _incomingStamp, ...contentFields } = artifact;
    const contentHash = createHash('sha256').update(JSON.stringify(contentFields)).digest('hex');
    const stored = { ...artifact, version, generation_id: randomUUID(), content_hash: contentHash, updated_at: new Date().toISOString() };
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
    await writeJson(artifactPath, stored);
    return stored;
  }

  async function updateWorkflow(projectId, stage, status, output, details = {}) {
    const project = await resolveProject(projectId);
    const statePath = path.join(project.workspacePath, 'workflow', 'state.json');
    const state = await readJson(statePath, defaultWorkflow(projectId));
    const { keepCurrentStage = false, screenId: requestedScreenId, ...stageDetails } = details;
    const screenId = requestedScreenId || project.active_screen_id || project.screen_id || 'main';
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
    const inventoryPath = path.join(destination, 'style', 'reference-inventory.json');
    const inventory = await readJson(inventoryPath, null);
    if (inventory) {
      const assetsById = new Map(referenceAssets.map((asset) => [asset.id, asset]));
      await writeJson(inventoryPath, {
        ...inventory,
        assets: (inventory.assets || []).map((asset) => ({ ...asset, path: assetsById.get(asset.id)?.path || asset.path })),
        updated_at: now
      });
    }
    const screenRegistry = await readJson(path.join(destination, 'screens', 'index.json'), { screens: [] });
    for (const screen of screenRegistry.screens || []) {
      const inputPath = screenInputPath(destination, screen.id);
      const screenInput = await readJson(inputPath, null);
      if (!screenInput) continue;
      const rewrite = (value) => typeof value === 'string' && value.startsWith(project.workspacePath)
        ? path.join(destination, path.relative(project.workspacePath, value)) : value;
      await writeJson(inputPath, { ...screenInput, wireframe_path: rewrite(screenInput.wireframe_path), updated_at: now });
    }
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
    const entry = { id, name: String(input.name || id), status: 'active', input_mode: input.inheritFromScreenId ? 'inherited' : 'own', ...(input.inheritFromScreenId ? { inherited_from_screen_id: input.inheritFromScreenId } : {}), created_at: now, updated_at: now };
    await ensureDir(path.join(project.workspacePath, 'screens', id, 'explorations'));
    await ensureDir(path.join(project.workspacePath, 'screens', id, 'underlays'));
    await ensureDir(path.join(project.workspacePath, 'screens', id, 'compositions'));
    await ensureDir(path.join(project.workspacePath, 'screens', id, 'inputs'));
    const inherited = input.inheritFromScreenId ? await readJson(screenInputPath(project.workspacePath, input.inheritFromScreenId), null) : null;
    await writeJson(screenInputPath(project.workspacePath, id), inherited
      ? { ...inherited, screen_id: id, input_mode: 'inherited', inherited_from_screen_id: input.inheritFromScreenId, updated_at: now }
      : { ...baseScreenInput(project, id), updated_at: now });
    await writeJson(path.join(project.workspacePath, 'screens', 'index.json'), { ...registry, screens: [...registry.screens, entry] });
    const statePath = path.join(project.workspacePath, 'workflow', 'state.json');
    const state = await readJson(statePath, defaultWorkflow(projectId));
    await writeJson(statePath, { ...state, screen_stages: { ...(state.screen_stages || {}), [id]: defaultWorkflow(projectId).screen_stages.main }, updated_at: now });
    return entry;
  }

  // P1-09：复制 Screen 专用 clone migration。直接 fs.cp 会让副本 Artifact
  // 的 id、screen_id 与 source 引用全部属于原 Screen：与原页 id 冲突、
  // lineage 指错、历史混在一起。这里逐文件重写身份：
  // - screen_id 字段重写为新 Screen；
  // - 以原 Screen id 为前缀的 Artifact id / source 引用重写为新前缀；
  // - 引用数组（如 selected_variation_ids）内的字符串元素同样重写；
  // - 路径中的 screens/<原 id>/ 重写为新目录；
  // - 已批准事实不继承：副本中 approved Artifact 降级为 reviewed，
  //   需用户重新确认（产品策略）。
  const CLONE_SOURCE_REF_KEYS = new Set(['underlay', 'variation_id', 'critique_id', 'layout', 'style', 'composition_manifest', 'composition_output', 'screen_contract', 'component_bindings', 'underlay_contract', 'visual_results', 'visual_task', 'reference_pack', 'approved_layout', 'layout_proposals', 'fidelity_report', 'source_proposal', 'selected_variation_ids']);
  function rewriteScreenClone(node, sourceId, targetId, parentKey = '') {
    if (Array.isArray(node)) {
      // AUD-13：进入数组后 key 上下文会丢失；引用类数组（如
      // selected_variation_ids）内的字符串元素也是 ID，必须同样重写。
      return node.map((item) => {
        const rewritten = rewriteScreenClone(item, sourceId, targetId, parentKey);
        if (typeof rewritten === 'string' && CLONE_SOURCE_REF_KEYS.has(parentKey) && rewritten.startsWith(`${sourceId}-`)) {
          return `${targetId}-${rewritten.slice(sourceId.length + 1)}`;
        }
        return rewritten;
      });
    }
    if (node && typeof node === 'object') {
      const next = {};
      for (const [key, value] of Object.entries(node)) {
        let rewritten = rewriteScreenClone(value, sourceId, targetId, key);
        if (typeof rewritten === 'string') {
          if (key === 'screen_id' && rewritten === sourceId) rewritten = targetId;
          else if (rewritten.startsWith(`${sourceId}-`) && (key === 'id' || CLONE_SOURCE_REF_KEYS.has(key))) rewritten = `${targetId}-${rewritten.slice(sourceId.length + 1)}`;
          else if (rewritten.includes(`screens/${sourceId}/`)) rewritten = rewritten.split(`screens/${sourceId}/`).join(`screens/${targetId}/`);
        }
        next[key] = rewritten;
      }
      return next;
    }
    return node;
  }

  async function migrateClonedScreenArtifacts(workspacePath, sourceId, targetId) {
    for (const relative of Object.values(SCREEN_ARTIFACTS)) {
      const filePath = path.join(workspacePath, 'screens', targetId, relative);
      const artifact = await readJson(filePath, null);
      if (!artifact || typeof artifact !== 'object') continue;
      let cloned = rewriteScreenClone(artifact, sourceId, targetId);
      if (cloned.status === 'approved') {
        cloned = { ...cloned, status: 'reviewed' };
        delete cloned.approved_at;
        delete cloned.approval;
      }
      await writeJson(filePath, cloned);
    }
  }

  async function duplicateScreen(projectId, screenId, input = {}) {
    const project = await resolveProject(projectId);
    const registry = await listScreens(projectId);
    const source = registry.screens.find((screen) => screen.id === screenId && screen.status !== 'archived');
    if (!source) throw new Error(`Screen not found or archived: ${screenId}`);
    const id = slugify(input.id || input.name || `${screenId}-copy`);
    if (registry.screens.some((screen) => screen.id === id)) throw new Error(`Screen already exists: ${id}`);
    const now = new Date().toISOString();
    await fs.cp(path.join(project.workspacePath, 'screens', screenId), path.join(project.workspacePath, 'screens', id), { recursive: true });
    await migrateClonedScreenArtifacts(project.workspacePath, screenId, id);
    const copiedInput = await readJson(screenInputPath(project.workspacePath, id), baseScreenInput(project, id));
    await writeJson(screenInputPath(project.workspacePath, id), { ...copiedInput, screen_id: id, input_mode: 'own', duplicated_from_screen_id: screenId, updated_at: now });
    const entry = { id, name: String(input.name || `${source.name} · 副本`), status: 'active', input_mode: 'own', duplicated_from_screen_id: screenId, created_at: now, updated_at: now };
    await writeJson(path.join(project.workspacePath, 'screens', 'index.json'), { ...registry, screens: [...registry.screens, entry] });
    const statePath = path.join(project.workspacePath, 'workflow', 'state.json');
    const state = await readJson(statePath, defaultWorkflow(projectId));
    // P1-09：副本 workflow 继承原 Screen 进度，但 approved 阶段同步降级为
    // reviewed，与 Artifact 降级策略保持一致。
    // AUD-13：stage 的 output 等路径字段直接从原 Screen 复制会指向原目录，
    // 必须与 Artifact 同一套 rewriter 统一改写。
    const clonedStages = Object.fromEntries(Object.entries(state.screen_stages?.[screenId] || defaultWorkflow(projectId).screen_stages.main).map(([stage, stageEntry]) => {
      if (!stageEntry) return [stage, stageEntry];
      let rewritten = rewriteScreenClone(stageEntry, screenId, id);
      if (rewritten.status === 'approved') rewritten = { ...rewritten, status: 'reviewed' };
      return [stage, rewritten];
    }));
    await writeJson(statePath, { ...state, screen_stages: { ...(state.screen_stages || {}), [id]: clonedStages }, updated_at: now });
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

  return { workspaceRoot, artifactKinds: [...Object.keys(GLOBAL_ARTIFACTS), ...Object.keys(SCREEN_ARTIFACTS)], list, create, duplicate, open, saveProject, importFile, manageReference, saveArtifact, updateWorkflow, resolveProject, hydrate, listScreens, createScreen, duplicateScreen, setActiveScreen, updateScreen };
}

module.exports = { createProjectStore };
