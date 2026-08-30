const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { ensureDir, readJson, writeJson } = require('./jsonStore.cjs');
const { readImageMetadata } = require('./imageMetadata.cjs');
const { artifactRelativePath, CLONE_FIELD_SCHEMA, GLOBAL_ARTIFACTS, SCREEN_ARTIFACTS } = require('./artifactRegistry.cjs');
const { ERROR_CODES } = require('./errorCodes.cjs');
const { migrateProjectV2 } = require('./migrations.cjs');
const { recomputeCoverage } = require('./contracts.cjs');

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

  // v1.4 §8 Intent hooks：由 intentStateStore 通过 __attachIntentStore 注入。
  // 全部在调用方已持有的项目写锁内执行（或像 heal 一样幂等无锁），因此这
  // 里的实现绝不能再排队 withProjectWriteLock，否则自等待。该命名空间仅进程
  // 内部使用，不得经 IPC/preload/HTTP 暴露给 Renderer。
  const intentHooks = { heal: null, projectTypeChanged: null, wireframeReplaced: null, assertProjectCloneable: null, sanitizeProjectClone: null, assertScreenCloneable: null, sanitizeScreenClone: null };

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
    // v1.4 §8.7 读取时自愈：幂等、只向前补齐、绝不回滚权威、绝不复活确认，
    // 半状态永不向用户 Fail-Closed。legacy 屏幕（无 intent 字段）直接跳过。
    let screenInput = storedScreenInput || {
      ...baseScreenInput(project, screenId), requirement: project.requirement || '',
      requirement_source: project.requirement_source || (project.requirement ? 'user' : 'none'),
      requirement_confirmed: project.requirement_confirmed ?? Boolean(project.requirement),
      wireframe_path: project.wireframe_path, wireframe_name: project.wireframe_name,
      wireframe_metadata: project.wireframe_metadata, canvas_spec: project.canvas_spec,
      input_revisions: project.input_revisions
    };
    if (storedScreenInput && intentHooks.heal) {
      screenInput = (await intentHooks.heal(projectPath, screenId, screenInput)) || screenInput;
    }
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
    // 设计师权威语义：快照不得透传契约体内存储的旧 coverage——每次 open 按
    // 当前 source_inventory 重算覆盖差异（哪些来源条目本轮未保留）作为留痕
    // 信息，供工作台如实展示；不再作为批准门禁。
    const honestScreenContract = screenContract && typeof screenContract === 'object' && !Array.isArray(screenContract)
      ? { ...screenContract, coverage: recomputeCoverage(screenContract) }
      : screenContract;
    const screens = await readJson(path.join(projectPath, 'screens', 'index.json'), { active_screen_id: screenId, screens: [] });
    return {
      ...project,
      requirement: screenInput.requirement || '',
      requirement_source: screenInput.requirement_source || 'none',
      requirement_confirmed: Boolean(screenInput.requirement_confirmed),
      intent_mode: screenInput.intent_mode,
      intent_analysis: screenInput.intent_analysis,
      intent_review: screenInput.intent_review,
      intent_generation: screenInput.intent_generation,
      intent_context: screenInput.intent_context,
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
      artifacts: { referenceInventory, screenContract: honestScreenContract, bindings, layouts, approvedLayout, referencePack, underlayContract, underlayCritique, underlayRepairTask, compositionManifest, compositionOutput, fidelityReport, styleContract, fontManifest, componentContract: hydratedComponentContract, visualTask, visualResults }
    };
  }

  async function open(projectId, options) {
    const project = await resolveProject(projectId);
    return hydrate(project.workspacePath, options);
  }

  // v1.4 §8.2：structured-v2 屏幕的 requirement 是后端 renderer 的确定性投影，
  // 普通 PATCH 中的 requirement / requirementSource / requirementConfirmed /
  // intentAnalysis 一律忽略（UI 只读展示，降级需显式动作）；Project Type 修改则必须
  // 在同锁内委托 intentStateStore 执行 §8.14 完整 freshness 转换。调用方必须已持有
  // 项目写锁（公开入口在导出边界包装）。
  async function saveProjectUnsafe(projectId, patch = {}) {
    const project = await resolveProject(projectId);
    const screenId = patch.screenId || project.active_screen_id || project.screen_id || 'main';
    const storedScreenInput = await readJson(screenInputPath(project.workspacePath, screenId), null);
    const currentInput = storedScreenInput || { ...baseScreenInput(project, screenId), requirement: project.requirement || '', requirement_source: project.requirement_source, requirement_confirmed: project.requirement_confirmed, intent_analysis: project.intent_analysis, input_revisions: project.input_revisions };
    const structured = currentInput.intent_mode === 'structured-v2';
    const requirement = structured
      ? currentInput.requirement
      : (typeof patch.requirement === 'string' ? patch.requirement : currentInput.requirement);
    const projectType = patch.projectType === 'existing' ? 'existing' : patch.projectType === 'new' ? 'new' : project.project_type;
    const requestedMode = ['exploration', 'existing-strict', 'existing-guided', 'locked-continuation'].includes(patch.continuationMode)
      ? patch.continuationMode
      : project.continuation_mode;
    const continuationMode = projectType === 'existing'
      ? (requestedMode === 'existing-guided' ? 'existing-guided' : 'existing-strict')
      : (requestedMode === 'locked-continuation' ? 'locked-continuation' : 'exploration');
    const artDirection = typeof patch.artDirection === 'string' ? patch.artDirection : project.art_direction;
    const requirementChanged = requirement !== currentInput.requirement;
    const requirementSource = structured
      ? currentInput.requirement_source
      : (['none', 'user', 'ai'].includes(patch.requirementSource)
        ? patch.requirementSource
        : requirementChanged ? (requirement ? 'user' : 'none') : currentInput.requirement_source);
    const requirementConfirmed = structured
      ? currentInput.requirement_confirmed
      : (typeof patch.requirementConfirmed === 'boolean'
        ? patch.requirementConfirmed
        : requirementChanged ? false : currentInput.requirement_confirmed);
    const revisionKeys = [];
    if (requirementChanged) revisionKeys.push('requirement');
    if (artDirection !== project.art_direction || projectType !== project.project_type) revisionKeys.push('art_direction');
    const next = {
      ...project,
      name: typeof patch.name === 'string' ? patch.name.trim() || project.name : project.name,
      requirement,
      requirement_source: requirement ? (requirementSource || 'user') : 'none',
      requirement_confirmed: requirement ? Boolean(requirementConfirmed) : false,
      intent_analysis: structured || !(patch.intentAnalysis && typeof patch.intentAnalysis === 'object')
        ? (currentInput.intent_analysis ?? project.intent_analysis)
        : patch.intentAnalysis,
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
    // v1.4 §8.14：Project Type 参与 Intent Prompt 且写入 analysis source_revision，
    // 变更必须在同一项目锁内完成完整 freshness 转换（标 stale、取消确认、重算 Context）。
    if (projectType !== project.project_type) await intentHooks.projectTypeChanged?.(projectId, screenId);
    return hydrate(project.workspacePath, { screenId });
  }

  // v1.4 §8.13：UE 替换的 Intent freshness 转换唯一实现在 intentStateStore；
  // 同锁内委托，保证 wireframe revision 、取消确认与下游标 stale 不被拆开。
  // 调用方必须已持有项目写锁；锁内一律使用 unsafe 原语避免自等待。
  async function importFileUnsafe(projectId, sourcePath, kind, options = {}) {
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
      await saveArtifactUnsafe(projectId, 'reference-inventory', inventoryFromAssets(nextProject.reference_assets, previous));
    }
    if (key === 'wireframe') await intentHooks.wireframeReplaced?.(projectId, screenId);
    return hydrate(project.workspacePath, { screenId });
  }

  // AUD-07：参考图管理必须先检测真实变化——聚焦后离开输入框、移动到原位置、
  // 重复设置同角色、重复批准相同状态都是 no-op：不写 project.json、不 bump
  // input_revisions、不写 Reference Inventory，调用方据此决定是否失效下游。
  async function manageReferenceUnsafe(projectId, input = {}) {
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
    await saveArtifactUnsafe(projectId, 'reference-inventory', inventoryFromAssets(assets, previous));
    return { project: await hydrate(project.workspacePath), changed: true };
  }

  // 调用方必须已持有项目写锁；版本语义（AUD-10）不变。
  async function saveArtifactUnsafe(projectId, kind, artifact, options = {}) {
    const project = await resolveProject(projectId);
    const screenId = options.screenId || project.active_screen_id || project.screen_id || 'main';
    const artifactPath = path.join(project.workspacePath, artifactRelativePath(kind, screenId));
    const previous = await readJson(artifactPath, null);
    // AUD-10：版本只能由存储层产生（nextVersion = previousVersion + 1），
    // 模型或调用方传入的 version 一律忽略（含首次保存：首版固定 V1）；
    // 同时由存储层盖 generation_id / content_hash / updated_at，保证历史不
    // 出现重复 V1、React 依赖与证据链版本识别不撞号。
    const version = previous ? Number(previous.version || 0) + 1 : 1;
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

  // 调用方必须已持有项目写锁（供锁内复合操作使用）；公开入口在导出边界包装。
  async function updateWorkflowUnsafe(projectId, stage, status, output, details = {}) {
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

  // v1.4 §4.5 Project Duplicate：先取得源项目同一写锁（导出边界包装），锁内重新检查
  // Intent 运行态（任一 Screen 有 running generation 即 Fail-Closed）；副本不复制活动
  // request/process ID，generation 归零，ready candidate 转 stale。
  async function duplicateUnsafe(projectId) {
    const project = await resolveProject(projectId);
    await intentHooks.assertProjectCloneable?.(project.workspacePath);
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
    await intentHooks.sanitizeProjectClone?.(destination);
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
  // AUD-13：不再扩大通用 key 白名单猜测——Artifact 的重写 key 集由
  // artifactRegistry 的 CLONE_FIELD_SCHEMA 逐类声明（生产管线真实字段）；
  // 下方 COMMON 集仅供无类型上下文的结构（workflow stage 条目）使用。
  const CLONE_COMMON_REF_KEYS = new Set(['underlay', 'variation_id', 'critique_id', 'layout', 'style', 'composition_manifest', 'composition_output', 'screen_contract', 'component_bindings', 'underlay_contract', 'visual_results', 'visual_task', 'reference_pack', 'approved_layout', 'layout_proposals', 'fidelity_report', 'source_proposal', 'selected_variation_ids']);
  function cloneReferenceKeys(kind) {
    return new Set([...CLONE_COMMON_REF_KEYS, ...(CLONE_FIELD_SCHEMA[kind]?.references || [])]);
  }
  function rewriteScreenClone(node, sourceId, targetId, referenceKeys, parentKey = '', renames = new Map()) {
    if (Array.isArray(node)) {
      // AUD-13：进入数组后 key 上下文会丢失；引用类数组（如
      // selected_variation_ids）内的字符串元素也是 ID，必须同样重写。
      return node.map((item) => {
        const rewritten = rewriteScreenClone(item, sourceId, targetId, referenceKeys, parentKey, renames);
        if (typeof rewritten === 'string' && referenceKeys.has(parentKey) && rewritten.startsWith(`${sourceId}-`)) {
          return `${targetId}-${rewritten.slice(sourceId.length + 1)}`;
        }
        return rewritten;
      });
    }
    if (node && typeof node === 'object') {
      const next = {};
      for (const [key, value] of Object.entries(node)) {
        let rewritten = rewriteScreenClone(value, sourceId, targetId, referenceKeys, key, renames);
        if (typeof rewritten === 'string') {
          if (key === 'screen_id' && rewritten === sourceId) rewritten = targetId;
          else if (rewritten.startsWith(`${sourceId}-`) && (key === 'id' || referenceKeys.has(key))) rewritten = `${targetId}-${rewritten.slice(sourceId.length + 1)}`;
          else if (rewritten.includes(`screens/${sourceId}/`)) rewritten = rewritten.split(`screens/${sourceId}/`).join(`screens/${targetId}/`);
          // M4-I1：物理文件已按目标前缀重命名，路径字符串里的旧 basename
          // 必须同步替换，否则 path 指向不存在的文件。
          for (const [oldName, newName] of renames) {
            if (rewritten.includes(oldName)) rewritten = rewritten.split(oldName).join(newName);
          }
        }
        next[key] = rewritten;
      }
      return next;
    }
    return node;
  }

  // M4-I1：副本里以原 Screen 前缀命名的物理文件（底图、语义证据等以
  // Screen 作用域 ID 命名的文件）必须重命名为目标前缀；映射表交给
  // rewriter，保证 JSON 路径字符串与物理文件同步。
  async function renameClonedFiles(directory, sourceId, targetId, renames) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { await renameClonedFiles(full, sourceId, targetId, renames); continue; }
      if (!entry.name.startsWith(`${sourceId}-`)) continue;
      const renamed = `${targetId}-${entry.name.slice(sourceId.length + 1)}`;
      await fs.rename(full, path.join(directory, renamed));
      renames.set(entry.name, renamed);
    }
  }

  // M4-J2（M4-I 复审 §8）：证据文件大小上限——防止被篡改项目指向超大/
  // 特殊文件造成读取资源消耗。
  const CLONE_EVIDENCE_MAX_BYTES = 64 * 1024 * 1024;
  // M4-K1（M4-J 复审 SEC-MAJOR-01）：单次 Clone 的证据遍历资源预算。
  // 合法 Artifact 的证据记录仅寥寥数个、嵌套很浅，预算留有数量级余量；
  // 被篡改项目提交的大量重复/深层/超量记录会在预算处显式失败并触发
  // Clone 整体回滚，杜绝同文件反复读取哈希形成的 I/O 与 CPU 放大。
  const CLONE_TRAVERSAL_MAX_DEPTH = 64;
  const CLONE_TRAVERSAL_MAX_NODES = 2048;
  const CLONE_EVIDENCE_MAX_RECORDS = 512;
  const CLONE_EVIDENCE_MAX_UNIQUE_BYTES = 256 * 1024 * 1024;

  // M4-K1：每次 Clone 一个遍历上下文——记录数与唯一字节按整次 Clone
  // 累计，文件缓存按真实路径去重；节点计数在每个 Artifact 重算前归零。
  function createCloneTraversalContext() {
    return { records: 0, uniqueBytes: 0, nodes: 0, fileCache: new Map() };
  }

  // M4-J2（M4-I 复审 §8）：证据路径安全解析。不再信任任意 { path, hash }
  // 对直接 path.join 读取：解析后的路径必须严格位于克隆目标 Screen 目录内
  //（先字符串 containment，再对真实路径做 realpath containment 防 symlink
  // 逃逸），且必须是普通文件、不超过大小上限；任何不满足都显式失败，
  // 由 duplicateScreen 的回滚把 Clone 作为整体原子操作处理。
  async function resolveClonedEvidencePath(workspacePath, scopeDir, relative) {
    if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative)) {
      throw new Error(`Clone evidence path is not a workspace-relative path: ${relative}`);
    }
    const scopeResolved = path.resolve(scopeDir);
    const resolved = path.resolve(workspacePath, relative);
    if (resolved !== scopeResolved && !resolved.startsWith(`${scopeResolved}${path.sep}`)) {
      throw new Error(`Clone evidence path escapes the cloned screen directory: ${relative}`);
    }
    const real = await fs.realpath(resolved).catch(() => null);
    if (!real) throw new Error(`Clone evidence path does not exist: ${relative}`);
    const realScope = await fs.realpath(scopeResolved).catch(() => null);
    if (!realScope || (real !== realScope && !real.startsWith(`${realScope}${path.sep}`))) {
      throw new Error(`Clone evidence path escapes via symlink: ${relative}`);
    }
    const stat = await fs.stat(real);
    if (!stat.isFile()) throw new Error(`Clone evidence path is not a regular file: ${relative}`);
    if (stat.size > CLONE_EVIDENCE_MAX_BYTES) {
      throw new Error(`Clone evidence file exceeds the ${CLONE_EVIDENCE_MAX_BYTES} byte limit: ${relative}`);
    }
    // M4-L（审核 §3.3）：一并返回大小，供累计预算在读取前预检。
    return { real, size: stat.size };
  }

  // M4-I1：Clone 会改写证据文件内容（如 semantic-response 的
  // source.underlay_id），Artifact 内冻结的 hash/byte_length 不再代表当前
  // 字节。深遍历重写结果，对所有「path + sha256 hash」记录按实际文件重算，
  // 保证文件/路径/哈希/长度四向一致；未改字节的文件重算结果不变。
  // M4-J2：读取前经 resolveClonedEvidencePath 安全解析；非法证据路径显式
  // 抛出，Clone 因此整体失败并回滚。
  // M4-K1：遍历受资源预算约束（深度/节点/记录/累计字节），相同真实路径
  // 只读取哈希一次、重复记录复用缓存结果——被篡改项目用成千上万条重复
  // { path, hash } 记录放大 I/O 的路线在此关闭。
  async function recomputeClonedEvidence(workspacePath, scopeDir, node, context, depth = 0) {
    if (depth > CLONE_TRAVERSAL_MAX_DEPTH) {
      throw new Error(`Clone evidence traversal exceeded the depth budget of ${CLONE_TRAVERSAL_MAX_DEPTH}`);
    }
    if (Array.isArray(node)) {
      context.nodes += 1;
      if (context.nodes > CLONE_TRAVERSAL_MAX_NODES) {
        throw new Error(`Clone evidence traversal exceeded the node budget of ${CLONE_TRAVERSAL_MAX_NODES}`);
      }
      for (const item of node) await recomputeClonedEvidence(workspacePath, scopeDir, item, context, depth + 1);
      return node;
    }
    if (node && typeof node === 'object') {
      context.nodes += 1;
      if (context.nodes > CLONE_TRAVERSAL_MAX_NODES) {
        throw new Error(`Clone evidence traversal exceeded the node budget of ${CLONE_TRAVERSAL_MAX_NODES}`);
      }
      for (const value of Object.values(node)) await recomputeClonedEvidence(workspacePath, scopeDir, value, context, depth + 1);
      if (typeof node.path === 'string' && typeof node.hash === 'string' && node.hash.startsWith('sha256:')) {
        context.records += 1;
        if (context.records > CLONE_EVIDENCE_MAX_RECORDS) {
          throw new Error(`Clone exceeded the evidence record budget of ${CLONE_EVIDENCE_MAX_RECORDS}`);
        }
        const resolved = await resolveClonedEvidencePath(workspacePath, scopeDir, node.path);
        const cached = context.fileCache.get(resolved.real);
        if (cached) {
          node.hash = cached.hash;
          if (typeof node.byte_length === 'number') node.byte_length = cached.byteLength;
          return node;
        }
        // M4-L（审核 §3.3）：读取前预检累计预算，超限文件不再被完整读入。
        if (context.uniqueBytes + resolved.size > CLONE_EVIDENCE_MAX_UNIQUE_BYTES) {
          throw new Error(`Clone exceeded the cumulative evidence byte budget of ${CLONE_EVIDENCE_MAX_UNIQUE_BYTES}`);
        }
        const bytes = await fs.readFile(resolved.real);
        context.uniqueBytes += bytes.length;
        const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
        context.fileCache.set(resolved.real, { hash, byteLength: bytes.length });
        node.hash = hash;
        if (typeof node.byte_length === 'number') node.byte_length = bytes.length;
      }
    }
    return node;
  }

  async function migrateClonedScreenArtifacts(workspacePath, sourceId, targetId, renames) {
    // M4-K1：整次 Clone 共用一个遍历上下文——证据记录数与唯一字节跨
    // Artifact 累计，同一路径全局去重；节点预算按单个 Artifact 归零。
    const traversal = createCloneTraversalContext();
    // AUD-13：reviews/ 下的 semantic-response 是 Critique 证据链文件，不在
    // SCREEN_ARTIFACTS 注册表内但随目录整体复制；source.underlay_id 同样
    // 是 Screen 作用域 ID，必须与 Artifact 同一套 rewriter 重写。
    // M4-I1：先重写证据文件——其字节被改写，随后 Artifact 的证据哈希
    // 重算必须以改写后的实际文件为准。
    const reviewsDir = path.join(workspacePath, 'screens', targetId, 'reviews');
    const reviewEntries = await fs.readdir(reviewsDir).catch(() => []);
    for (const name of reviewEntries) {
      const filePath = path.join(reviewsDir, renames.get(name) || name);
      const evidence = await readJson(filePath, null);
      if (!evidence || typeof evidence !== 'object') continue;
      await writeJson(filePath, rewriteScreenClone(evidence, sourceId, targetId, new Set([...CLONE_COMMON_REF_KEYS, 'underlay_id']), '', renames));
    }
    for (const [kind, relative] of Object.entries(SCREEN_ARTIFACTS)) {
      const filePath = path.join(workspacePath, 'screens', targetId, relative);
      const artifact = await readJson(filePath, null);
      if (!artifact || typeof artifact !== 'object') continue;
      let cloned = rewriteScreenClone(artifact, sourceId, targetId, cloneReferenceKeys(kind), '', renames);
      traversal.nodes = 0;
      await recomputeClonedEvidence(workspacePath, path.join(workspacePath, 'screens', targetId), cloned, traversal);
      // 已批准/已通过事实不继承：副本中 approved 与 passed（Fidelity）一律
      // 降级为 reviewed，证据身份已重写，必须重新确认或重跑（产品策略）。
      if (cloned.status === 'approved' || cloned.status === 'passed') {
        cloned = { ...cloned, status: 'reviewed' };
        delete cloned.approved_at;
        delete cloned.approval;
      }
      await writeJson(filePath, cloned);
    }
  }

  // M4-K2（M4-J 复审 SEC-P1-02）：迁移前全树 symlink 策略——复制后的目标
  // 树不允许包含任何 symlink（目录或文件）。否则迁移期的 readdir/readJson/
  // writeJson 会在 Evidence Resolver 之前跟随链接，把写入带到树外；发现即
  // 显式失败，由事务回滚整体处理。
  async function rejectClonedTreeSymlinks(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Clone target tree contains a symlink, which is not allowed: ${full}`);
      }
      if (entry.isDirectory()) await rejectClonedTreeSymlinks(full);
    }
  }

  // M4-K2（审核者 §8.4 终稿）：回滚自身也失败时的结构化错误——携带事务
  // 身份、双方 Screen、原始失败步骤、回滚失败步骤、已完成步骤、全部相关
  // 路径与可确定执行的人工恢复顺序；不做启动期自动恢复（降为后续硬化项）。
  function cloneRollbackIncompleteError(details) {
    const manualActions = [
      `删除残留目标 Screen 目录：${details.target_dir}`,
      details.rollback_failures.some((failure) => failure.includes('workflow/state.json')) && details.workflow_backup
        ? `从备份还原 workflow/state.json：${details.workflow_backup}` : null,
      details.rollback_failures.some((failure) => failure.includes('screens/index.json')) && details.registry_backup
        ? `从备份还原 screens/index.json：${details.registry_backup}` : null,
      `核对事务诊断记录（best-effort，可能未写成功）：${details.transaction_dir}/clone-context.json`
    ].filter(Boolean);
    const message = `Clone 事务回滚不完整（事务 ${details.transaction_id}）：原始失败于「${details.failed_step}」，回滚失败于「${details.rollback_failures.join('；')}」。人工恢复顺序：${manualActions.map((action, index) => `${index + 1}) ${action}`).join(' ')}`;
    return Object.assign(new Error(message), {
      code: ERROR_CODES.CLONE_ROLLBACK_INCOMPLETE,
      transaction_id: details.transaction_id,
      project_id: details.project_id,
      source_screen_id: details.source_screen_id,
      target_screen_id: details.target_screen_id,
      failed_step: details.failed_step,
      rollback_failures: details.rollback_failures,
      completed_steps: details.completed_steps,
      target_dir: details.target_dir,
      screen_registry_path: details.registry_path,
      workflow_state_path: details.workflow_path,
      registry_backup_path: details.registry_backup,
      workflow_backup_path: details.workflow_backup,
      transaction_dir: details.transaction_dir,
      manual_actions: manualActions
    });
  }

  // M4-K2（Fail-Closed 检测）：克隆出来的 Screen 在 registry 有条目、
  // workflow 却没有对应 stage，只能是回滚不完整的双重故障残留。识别即阻断
  //（切换/再复制/管线操作都不得继续），给出同一份恢复说明；只检测，不做
  // 启动期自动修复。非克隆（无 duplicated_from_screen_id）的 Screen 不受影响。
  async function assertClonedScreenConsistent(workspacePath, registry, screenId) {
    const entry = registry.screens.find((screen) => screen.id === screenId);
    if (!entry || !entry.duplicated_from_screen_id) return;
    const state = await readJson(path.join(workspacePath, 'workflow', 'state.json'), null);
    if (state?.screen_stages?.[screenId]) return;
    throw Object.assign(new Error(`检测到 Clone 不一致状态：Screen ${screenId} 在 registry 有条目但 workflow 无对应 stage（疑似 Clone 双重故障残留）。恢复方式：检查 workflow/transactions/ 下的 clone-* 事务备份，还原 screens/index.json 与 workflow/state.json，或删除该 Screen 的残留目录与 registry 条目。`), {
      code: ERROR_CODES.CLONE_ROLLBACK_INCOMPLETE,
      target_screen_id: screenId,
      failed_step: 'consistency-check'
    });
  }

  async function duplicateScreen(projectId, screenId, input = {}) {
    const project = await resolveProject(projectId);
    const registry = await listScreens(projectId);
    const source = registry.screens.find((screen) => screen.id === screenId && screen.status !== 'archived');
    if (!source) throw new Error(`Screen not found or archived: ${screenId}`);
    const id = slugify(input.id || input.name || `${screenId}-copy`);
    const existing = registry.screens.find((screen) => screen.id === id);
    if (existing) {
      // M4-K2 Fail-Closed：已存在条目若缺 workflow stage，属于双重故障残留，
      // 先给出结构化恢复指引，而不是让“Screen already exists”掩盖它。
      await assertClonedScreenConsistent(project.workspacePath, registry, id);
      throw new Error(`Screen already exists: ${id}`);
    }
    // M4 收尾（M4-L 复审 §8.4）：竞态守卫——源 Screen 有阶段正在生成时，
    // 复制会拿到不同时间点的 Artifact 组合（半新半旧），阻断复制并给出
    // 明确文案；生成结束后复制照常可用。
    const statePath = path.join(project.workspacePath, 'workflow', 'state.json');
    const preState = await readJson(statePath, defaultWorkflow(projectId));
    const inProgressStages = Object.entries(preState.screen_stages?.[screenId] || {})
      .filter(([, stageEntry]) => stageEntry?.status === 'in_progress')
      .map(([stage]) => stage);
    if (inProgressStages.length) {
      throw new Error(`Screen ${screenId} 正在生成中（${inProgressStages.join('、')} 阶段运行中），请等待生成完成后再复制。`);
    }
    // v1.4 §4.5 Screen Duplicate：额外检查源 Screen 的 Intent 运行态（不能只检查
    // Workflow stage 的 in_progress）；进行中的 adopt/restore 复合操作由同一项目写锁天然排除。
    await intentHooks.assertScreenCloneable?.(project.workspacePath, screenId);
    const now = new Date().toISOString();
    const targetDir = path.join(project.workspacePath, 'screens', id);
    const indexPath = path.join(project.workspacePath, 'screens', 'index.json');
    // M4-J2：registry 中不存在的同名目录只能是上次失败 Clone 的残留，
    // 先清理，保证重试不会合并到残留目录。
    if (await fs.stat(targetDir).catch(() => null)) await fs.rm(targetDir, { recursive: true, force: true });
    // M4-K2（审核者 §8.4 终稿）：Clone 是全事务——目录、Workflow、Registry
    // 任一写入失败都自动回滚（还原备份 + 删除目录）；回滚前先把原始
    // index/state 字节备份到事务目录；发布顺序为目录→Workflow→Registry，
    // Registry 是最后发布点，把「已发布但未完成」的窗口压到最小。
    const transactionId = randomUUID();
    const transactionDir = path.join(project.workspacePath, 'workflow', 'transactions', `clone-${transactionId}`);
    const registryBackupPath = path.join(transactionDir, 'screens-index.before.json');
    const workflowBackupPath = path.join(transactionDir, 'workflow-state.before.json');
    const tx = { backupsCreated: false, workflowWriteAttempted: false, registryWriteAttempted: false, step: 'copy-target-directory', completed: [] };
    const entry = { id, name: String(input.name || `${source.name} · 副本`), status: 'active', input_mode: 'own', duplicated_from_screen_id: screenId, created_at: now, updated_at: now };
    const renames = new Map();
    try {
      await fs.cp(path.join(project.workspacePath, 'screens', screenId), targetDir, { recursive: true });
      tx.completed.push('target-directory-copied');
      tx.step = 'reject-symlinks';
      await rejectClonedTreeSymlinks(targetDir);
      tx.completed.push('symlink-policy-checked');
      tx.step = 'rename-screen-prefixed-files';
      // M4-I1：先重命名带原 Screen 前缀的物理文件，后续所有 JSON 重写共享
      // 映射表，路径字符串与物理文件名保持一致。
      await renameClonedFiles(targetDir, screenId, id, renames);
      tx.step = 'migrate-artifacts';
      await migrateClonedScreenArtifacts(project.workspacePath, screenId, id, renames);
      tx.step = 'write-inputs';
      // AUD-13：inputs.json 内的 wireframe_path 等路径指向原 Screen 目录，
      // 副本必须重写到自己的目录（provenance 字段在其后覆盖，不受影响）。
      const copiedInput = rewriteScreenClone(await readJson(screenInputPath(project.workspacePath, id), baseScreenInput(project, id)), screenId, id, CLONE_COMMON_REF_KEYS, '', renames);
      await writeJson(screenInputPath(project.workspacePath, id), { ...copiedInput, screen_id: id, input_mode: 'own', duplicated_from_screen_id: screenId, updated_at: now });
      // v1.4 §4.5：副本取消确认、generation 归零、candidate 转 stale，不可直接采用。
      await intentHooks.sanitizeScreenClone?.(project.workspacePath, id);
      tx.completed.push('artifacts-migrated');
      tx.step = 'prepare-transaction-backups';
      // P1-09：副本 workflow 继承原 Screen 进度，但 approved 阶段同步降级为
      // reviewed，与 Artifact 降级策略保持一致。
      // AUD-13：stage 的 output 等路径字段直接从原 Screen 复制会指向原目录，
      // 必须与 Artifact 同一套 rewriter 统一改写。
      const state = await readJson(statePath, defaultWorkflow(projectId));
      const clonedStages = Object.fromEntries(Object.entries(state.screen_stages?.[screenId] || defaultWorkflow(projectId).screen_stages.main).map(([stage, stageEntry]) => {
        if (!stageEntry) return [stage, stageEntry];
        let rewritten = rewriteScreenClone(stageEntry, screenId, id, CLONE_COMMON_REF_KEYS, '', renames);
        if (rewritten.status === 'approved' || rewritten.status === 'passed') rewritten = { ...rewritten, status: 'reviewed' };
        return [stage, rewritten];
      }));
      const newState = { ...state, screen_stages: { ...(state.screen_stages || {}), [id]: clonedStages }, updated_at: now };
      const newRegistry = { ...registry, screens: [...registry.screens, entry] };
      // 回滚依据：原始字节备份与事务上下文先落盘，再动共享文件。
      await fs.mkdir(transactionDir, { recursive: true });
      await fs.writeFile(registryBackupPath, await fs.readFile(indexPath));
      await fs.writeFile(workflowBackupPath, await fs.readFile(statePath));
      await writeJson(path.join(transactionDir, 'clone-context.json'), {
        status: 'in-progress', transaction_id: transactionId, project_id: projectId,
        source_screen_id: screenId, target_screen_id: id, started_at: now,
        completed_steps: tx.completed
      });
      tx.backupsCreated = true;
      tx.completed.push('transaction-backups-written');
      // 发布：先 Workflow，最后 Registry（发布点）。
      tx.step = 'workflow-update';
      tx.workflowWriteAttempted = true;
      await writeJson(statePath, newState);
      tx.completed.push('workflow-updated');
      tx.step = 'registry-publish';
      tx.registryWriteAttempted = true;
      await writeJson(indexPath, newRegistry);
      tx.completed.push('registry-published');
      // 成功：事务目录完成使命即删除，仅回滚失败时才保留。
      await fs.rm(transactionDir, { recursive: true, force: true });
      return entry;
    } catch (error) {
      const rollbackFailures = [];
      // M4-L（审核 §7）：按存在性清理而非依赖布尔标志——fs.cp 中途失败
      // 留下的部分复制目录也必须在首次失败时立即删除。
      if (await fs.stat(targetDir).catch(() => null)) {
        await fs.rm(targetDir, { recursive: true, force: true }).catch((rollbackError) => rollbackFailures.push(`remove target directory: ${rollbackError.message}`));
      }
      if (tx.backupsCreated) {
        if (tx.workflowWriteAttempted) {
          await fs.copyFile(workflowBackupPath, statePath).catch((rollbackError) => rollbackFailures.push(`restore workflow/state.json: ${rollbackError.message}`));
        }
        if (tx.registryWriteAttempted) {
          await fs.copyFile(registryBackupPath, indexPath).catch((rollbackError) => rollbackFailures.push(`restore screens/index.json: ${rollbackError.message}`));
        }
      }
      if (rollbackFailures.length) {
        // 双重故障：回滚自身失败。诊断记录 best-effort——写不下也不影响
        // 结构化错误携带全部恢复信息；不做启动期自动恢复。
        await writeJson(path.join(transactionDir, 'clone-context.json'), {
          status: 'rollback-incomplete', transaction_id: transactionId, project_id: projectId,
          source_screen_id: screenId, target_screen_id: id, completed_steps: tx.completed,
          failed_step: tx.step, rollback_failures: rollbackFailures,
          backups: { screen_registry: registryBackupPath, workflow_state: workflowBackupPath }
        }).catch(() => {});
        throw cloneRollbackIncompleteError({
          transaction_id: transactionId, project_id: projectId,
          source_screen_id: screenId, target_screen_id: id,
          failed_step: tx.step, rollback_failures: rollbackFailures, completed_steps: tx.completed,
          target_dir: targetDir, registry_path: indexPath, workflow_path: statePath,
          registry_backup: registryBackupPath, workflow_backup: workflowBackupPath,
          transaction_dir: transactionDir
        });
      }
      // 正常回滚成功：清理事务目录，原样抛出主操作错误。
      if (tx.backupsCreated) await fs.rm(transactionDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async function setActiveScreen(projectId, screenId) {
    const project = await resolveProject(projectId);
    const registry = await listScreens(projectId);
    const screen = registry.screens.find((item) => item.id === screenId && item.status !== 'archived');
    if (!screen) throw new Error(`Screen not found or archived: ${screenId}`);
    // M4-K2 Fail-Closed：切换 Screen 时识别 Clone 双重故障残留并阻断。
    await assertClonedScreenConsistent(project.workspacePath, registry, screenId);
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

  async function assertClonedScreenConsistentFor(projectId, screenId) {
    const project = await resolveProject(projectId);
    const registry = await listScreens(projectId);
    await assertClonedScreenConsistent(project.workspacePath, registry, screenId);
  }

  // M4-L（M4-K 复审 §6）：项目级写锁——所有会写 `screens/index.json` 或
  // `workflow/state.json` 的操作（创建/复制/切换/更新 Screen、Workflow
  // 更新）在导出边界统一串行化。Web 多会话下，两个并发 Clone 不再基于
  // 同一旧快照互相覆盖（丢失更新），失败事务的回滚也不会覆盖另一事务
  // 已发布的结果。本产品为单进程部署（桌面主进程 / Web 服务各自一个
  // store 实例），进程内锁即可覆盖全部会话；锁按项目隔离，跨项目不互斥。
  // 内部实现之间是直接函数调用（不经导出边界），因此不存在重入死锁。
  const projectWriteLocks = new Map();
  function withProjectWriteLock(projectId, operation) {
    const previous = projectWriteLocks.get(projectId) || Promise.resolve();
    const run = previous.catch(() => {}).then(() => operation());
    const tail = run.catch(() => {});
    projectWriteLocks.set(projectId, tail);
    // M4 收尾（M4-L 复审 §8.2）：尾部完成且没有更新的操作排队时删除条目，
    // 避免长期运行下 Map 无界增长；引用相等判定保证不误删已排在后面的
    // 新尾部。
    tail.finally(() => {
      if (projectWriteLocks.get(projectId) === tail) projectWriteLocks.delete(projectId);
    });
    return run;
  }

  // v1.4 §8.8：写锁接线——所有会写项目文件的变更在导出边界统一串行化；锁内复合操作只能调用 *Unsafe 原语，公开方法在锁内调用会自等待。
  function attachIntentStore(intentStore) {
    intentHooks.heal = intentStore.healScreenIntentState || null;
    intentHooks.projectTypeChanged = intentStore.applyProjectTypeChangeUnsafe || null;
    intentHooks.wireframeReplaced = intentStore.applyWireframeReplacementUnsafe || null;
    intentHooks.assertProjectCloneable = intentStore.assertProjectCloneable || null;
    intentHooks.sanitizeProjectClone = intentStore.sanitizeProjectClone || null;
    intentHooks.assertScreenCloneable = intentStore.assertScreenCloneable || null;
    intentHooks.sanitizeScreenClone = intentStore.sanitizeScreenClone || null;
  }

  return { workspaceRoot, artifactKinds: [...Object.keys(GLOBAL_ARTIFACTS), ...Object.keys(SCREEN_ARTIFACTS)], list, create, duplicate: (projectId) => withProjectWriteLock(projectId, () => duplicateUnsafe(projectId)), open, saveProject: (...args) => withProjectWriteLock(args[0], () => saveProjectUnsafe(...args)), importFile: (...args) => withProjectWriteLock(args[0], () => importFileUnsafe(...args)), manageReference: (...args) => withProjectWriteLock(args[0], () => manageReferenceUnsafe(...args)), saveArtifact: (...args) => withProjectWriteLock(args[0], () => saveArtifactUnsafe(...args)), updateWorkflow: (...args) => withProjectWriteLock(args[0], () => updateWorkflowUnsafe(...args)), resolveProject, hydrate, listScreens, createScreen: (projectId, input) => withProjectWriteLock(projectId, () => createScreen(projectId, input)), duplicateScreen: (projectId, screenId, input) => withProjectWriteLock(projectId, () => duplicateScreen(projectId, screenId, input)), setActiveScreen: (projectId, screenId) => withProjectWriteLock(projectId, () => setActiveScreen(projectId, screenId)), updateScreen: (projectId, screenId, patch) => withProjectWriteLock(projectId, () => updateScreen(projectId, screenId, patch)), assertClonedScreenConsistent: assertClonedScreenConsistentFor, __attachIntentStore: attachIntentStore, __unsafe: { withProjectWriteLock, saveProjectUnsafe, importFileUnsafe, manageReferenceUnsafe, saveArtifactUnsafe, updateWorkflowUnsafe } };
}

module.exports = { createProjectStore };
