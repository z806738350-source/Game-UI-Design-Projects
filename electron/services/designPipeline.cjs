const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { intentDraftPrompt, layoutPrompt, screenContractPrompt, stylePrompt, underlayCritiquePrompt, underlayRepairPrompt, visualTask } = require('./prompts.cjs');
const { providerCapabilities } = require('./providerCapabilities.cjs');
const { buildReferencePack } = require('./referencePack.cjs');
const { validateArtifact } = require('./contracts.cjs');
const { confirmFontUsage: confirmFontUsageContract, importFontAsset } = require('./typographyAssets.cjs');
const { importComponentAsset, importForgeManifest, validateComponentAssets } = require('./componentKit.cjs');
const { validateBindings, withCoverage } = require('./componentBindings.cjs');
const { BINDING_POLICY_VERSION } = require('./controlRolePolicy.cjs');
const { normalizeControls } = require('./screenControls.cjs');
const { validateLayout } = require('./layoutValidator.cjs');
const { changedKindsForInput, downstreamArtifacts, isGlobalChange } = require('./artifactDependencies.cjs');
const { GLOBAL_ARTIFACTS } = require('./artifactRegistry.cjs');
const { generateUnderlayContract } = require('./underlayContract.cjs');
const { writeLayoutGuide } = require('./layoutGuideRenderer.cjs');
const { buildUnderlayCritique, reviewGate } = require('./underlayCritique.cjs');
const { executeRepairTask, planRepairTask } = require('./underlayRepair.cjs');
const { computeDeterministicMetrics, hashBuffer: hashEvidence, normalizeSemanticEvidence, safePath, writeComponentBoard, writeRepairMask, writeReviewOverlay } = require('./underlayReview.cjs');
const { createCompositionManifest } = require('./compositor.cjs');
const { renderComposition, verifyCompositionOutput } = require('./compositionRenderer.cjs');
const { finalApprovalGate, runFidelityChecks } = require('./fidelity.cjs');
const { inspectFidelityEvidence } = require('./fidelityInspector.cjs');

function createDesignPipeline({ projectStore, kunpoClient, kunpoConfig }) {
  const cancelledVisualJobs = new Set();
  const openProject = (projectId, screenId) => projectStore.open(projectId, { includePreviews: false, ...(screenId ? { screenId } : {}) });
  async function openScreen(projectId, screenId) {
    if (!String(screenId || '').trim()) throw Object.assign(new Error('screenId is required for screen-scoped pipeline operations.'), { code: 'SCREEN_ID_REQUIRED' });
    const registry = await projectStore.listScreens(projectId);
    const screen = registry.screens.find((item) => item.id === screenId && item.status !== 'archived');
    if (!screen) throw Object.assign(new Error(`Screen not found or archived: ${screenId}`), { code: 'SCREEN_NOT_FOUND' });
    if (registry.active_screen_id !== screenId) throw Object.assign(new Error(`Screen context mismatch: activate ${screenId} before running its pipeline.`), { code: 'SCREEN_CONTEXT_MISMATCH' });
    return openProject(projectId, screenId);
  }

  async function materializeUnderlay(project, resolved, variation) {
    if (!variation) throw new Error('Underlay variation is required.');
    const safeId = String(variation.id).replace(/[^A-Za-z0-9_-]/g, '-');
    const relative = `screens/${project.screen_id}/underlays/${safeId}.png`;
    const target = safePath(resolved.workspacePath, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    let bytes;
    if (variation.image_path) bytes = await fs.readFile(safePath(resolved.workspacePath, variation.image_path));
    else if (variation.image_url) {
      const response = await fetch(variation.image_url);
      if (!response.ok) throw new Error(`Unable to download underlay evidence: ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    } else throw new Error('Underlay image is required.');
    const normalized = await sharp(bytes).png().toBuffer({ resolveWithObject: true });
    await fs.writeFile(target, normalized.data);
    return { path: relative, absolute_path: target, hash: hashEvidence(normalized.data), width: normalized.info.width, height: normalized.info.height };
  }

  async function persistCritiqueResponse(project, resolved, underlayId, input) {
    const safeId = String(underlayId).replace(/[^A-Za-z0-9_-]/g, '-');
    const relative = `screens/${project.screen_id}/reviews/${safeId}-semantic-response.json`;
    const target = safePath(resolved.workspacePath, relative);
    const payload = {
      schema_version: '1.0',
      source: {
        underlay_id: underlayId,
        prompt_hash: input.promptHash,
        model: input.model,
        input_hashes: input.inputHashes
      },
      provider: input.envelope?.provider || { model: input.model },
      attempt: input.envelope?.attempt || 1,
      raw_text: input.envelope?.raw_text || JSON.stringify(input.semantic),
      parsed: input.semantic,
      normalized: input.normalizedSemantic,
      captured_at: new Date().toISOString()
    };
    const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    return { path: relative, hash: hashEvidence(bytes), byte_length: bytes.length, media_type: 'application/json' };
  }

  function inputSource(project) {
    return { input_revisions: { ...(project.input_revisions || {}) }, canvas_spec: project.canvas_spec };
  }

  function styleQualityChecks(project, artifact) {
    const functionalLoad = (project.artifacts.screenContract?.required_controls?.length || 0) + (project.artifacts.screenContract?.required_information?.length || 0);
    const composition = JSON.stringify(artifact.composition || {});
    const claimsLowDensity = /低密度|稀疏|宽松|大间距|大量留白|留白法则|呼吸感|low\s*density|large\s*spacing|spacious/i.test(composition);
    const warnings = [];
    if (functionalLoad >= 10 && claimsLowDensity) warnings.push(`页面包含 ${functionalLoad} 项必要控件/信息，但风格规范要求低密度或大间距；视觉生成时必须优先保证功能完整，并采用分组或抽屉承载。`);
    return { functional_load: functionalLoad, warnings };
  }

  function artifactValue(project, kind) {
    const keys = {
      'screen-contract': 'screenContract', 'component-bindings': 'bindings', 'layout-proposals': 'layouts',
      'approved-layout': 'approvedLayout', 'style-contract': 'styleContract', 'font-manifest': 'fontManifest',
      'component-contract': 'componentContract', 'reference-pack': 'referencePack', 'underlay-contract': 'underlayContract',
      'reference-inventory': 'referenceInventory',
      'underlay-critique': 'underlayCritique', 'composition-manifest': 'compositionManifest', 'composition-output': 'compositionOutput', 'fidelity-report': 'fidelityReport',
      'visual-task': 'visualTask', 'visual-results': 'visualResults'
    };
    return project.artifacts[keys[kind]];
  }

  const artifactStages = {
    'reference-inventory': 'reference_analysis', 'reference-pack': 'reference_analysis',
    'style-contract': 'style_resolution', 'font-manifest': 'typography_resolution', 'component-contract': 'component_resolution',
    'screen-contract': 'wireframe_interpretation', 'component-bindings': 'component_binding',
    'layout-proposals': 'layout_design', 'approved-layout': 'layout_design',
    'underlay-contract': 'underlay_specification', 'visual-task': 'visual_exploration', 'visual-results': 'visual_exploration',
    'underlay-critique': 'underlay_review', 'composition-manifest': 'composition', 'composition-output': 'composition',
    'fidelity-report': 'fidelity_review'
  };

  async function invalidateArtifacts(projectId, changedKind, reason = `${changedKind}_changed`, options = {}) {
    const downstream = downstreamArtifacts(changedKind);
    if (!downstream.length) return { changed_kind: changedKind, affected_screens: [], stale_artifacts: [] };
    const root = await openProject(projectId);
    const screenIds = isGlobalChange(changedKind)
      ? (root.screens || [{ id: root.screen_id }]).filter((screen) => screen.status !== 'archived').map((screen) => screen.id)
      : [options.screenId || root.screen_id];
    const processed = new Set();
    const staleArtifacts = [];
    for (const screenId of screenIds) {
      const screenProject = await projectStore.open(projectId, { includePreviews: false, screenId });
      for (const kind of downstream) {
        const global = Boolean(GLOBAL_ARTIFACTS[kind]);
        const key = `${kind}:${global ? 'global' : screenId}`;
        if (processed.has(key)) continue;
        processed.add(key);
        const artifact = artifactValue(screenProject, kind);
        if (artifact && artifact.status !== 'stale') {
          await projectStore.saveArtifact(projectId, kind, { ...artifact, status: 'stale', stale_at: new Date().toISOString(), stale_reason: reason }, { screenId });
          const stage = artifactStages[kind];
          if (stage) await projectStore.updateWorkflow(projectId, stage, 'stale', undefined, { screenId, progress: undefined });
          staleArtifacts.push({ kind, scope: global ? 'global' : 'screen', ...(global ? {} : { screen_id: screenId }) });
        }
      }
    }
    return { changed_kind: changedKind, affected_screens: screenIds, stale_artifacts: staleArtifacts };
  }

  async function invalidateFromInputChange(projectId, changes = {}) {
    const project = await openProject(projectId);
    const changedKinds = changedKindsForInput(changes);
    const effects = [];
    for (const changedKind of changedKinds) {
      effects.push(await invalidateArtifacts(projectId, changedKind, `${changedKind}_changed`, { screenId: changes.screenId || project.screen_id }));
    }
    if (changes.requirement || changes.wireframe) {
      await projectStore.updateWorkflow(projectId, 'input', project.requirement ? (project.requirement_confirmed ? 'approved' : 'reviewed') : 'draft', undefined, { screenId: changes.screenId || project.screen_id });
    }
    const refreshed = await openProject(projectId, changes.screenId || project.screen_id);
    refreshed.invalidation = { changed_kinds: changedKinds, effects };
    return refreshed;
  }

  async function runStageUnsafe(projectId, stage, input = {}) {
    const project = await openScreen(projectId, input.screenId);
    // Freeze the model choices for this stage. A settings change applies to
    // the next task without mixing models inside an already-running batch.
    const stageConfig = { ...kunpoConfig };
    if (stage === 'wireframe_interpretation') {
      if (!project.wireframe_path) throw new Error('请先导入 UE Wireframe。');
      const intentConfirmed = project.requirement_confirmed ?? Boolean(project.requirement.trim());
      if (!project.requirement.trim() || !intentConfirmed) throw new Error('请先在项目输入中确认 AI 预填的设计意图，或填写自己的补充说明。');
      await projectStore.updateWorkflow(projectId, stage, 'in_progress', undefined, { keepCurrentStage: Boolean(input.stayOnInputUntilComplete) });
      await invalidateArtifacts(projectId, 'screen-contract', 'screen_contract_regenerated', { screenId: project.screen_id });
      const artifact = await kunpoClient.requestArtifact(stageConfig, {
        kind: 'screen-contract', prompt: screenContractPrompt(project), imagePaths: [project.wireframe_path],
        id: `${project.screen_id}-screen-contract`, source: { requirement: 'inputs/requirement.md', wireframe: 'inputs/wireframe', ...inputSource(project) }
      });
      await projectStore.saveArtifact(projectId, 'screen-contract', artifact);
      await projectStore.updateWorkflow(projectId, stage, 'reviewed', `screens/${project.screen_id}/screen-contract.json`);
      return openProject(projectId);
    }
    if (stage === 'layout_design') {
      const screen = project.artifacts.screenContract;
      if (!screen || screen.status !== 'approved') throw new Error('请先批准 Functional Screen Contract。');
      const strict = project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation';
      if (strict) {
        if (project.artifacts.fontManifest?.status !== 'approved') throw Object.assign(new Error('Strict layout requires an approved Font Manifest.'), { code: 'FONT_MANIFEST_REQUIRED' });
        if (project.artifacts.componentContract?.status !== 'approved') throw Object.assign(new Error('Strict layout requires an approved Component Contract.'), { code: 'COMPONENT_CONTRACT_REQUIRED' });
        const bindingResult = validateBindings(project.artifacts.bindings, screen, project.artifacts.componentContract, project.artifacts.fontManifest, { strict });
        if (project.artifacts.bindings?.status !== 'approved' || bindingResult.errors.length) throw Object.assign(new Error(`Strict layout requires complete approved bindings: ${bindingResult.errors.join('; ')}`), { code: 'BINDING_COVERAGE_INCOMPLETE' });
      }
      await projectStore.updateWorkflow(projectId, stage, 'in_progress');
      await invalidateArtifacts(projectId, 'layout-proposals', 'layout_proposals_regenerated', { screenId: project.screen_id });
      const artifact = await kunpoClient.requestArtifact(stageConfig, {
        kind: 'layout-proposals', prompt: layoutPrompt(project, screen, { fontManifest: project.artifacts.fontManifest, componentContract: project.artifacts.componentContract, bindings: project.artifacts.bindings }), imagePaths: [project.wireframe_path],
        id: `${project.screen_id}-layout-proposals`, source: { screen_contract: screen.id, wireframe: 'inputs/wireframe', ...inputSource(project) }
      });
      await projectStore.saveArtifact(projectId, 'layout-proposals', artifact);
      await projectStore.updateWorkflow(projectId, stage, 'reviewed', `screens/${project.screen_id}/layout-proposals.json`);
      return openProject(projectId);
    }
    if (stage === 'style_resolution') {
      const strict = project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation';
      const approved = strict ? (project.artifacts.approvedLayout?.status === 'approved' ? project.artifacts.approvedLayout : project.artifacts.screenContract) : project.artifacts.approvedLayout;
      if (!approved || approved.status !== 'approved') throw new Error(strict ? '请先批准 Functional Screen Contract。' : '请先选择并批准布局方案。');
      if (project.project_type === 'existing' && !(project.reference_paths || []).length) throw new Error('旧项目风格重建至少需要一张已批准参考页。');
      await projectStore.updateWorkflow(projectId, stage, 'in_progress');
      await invalidateArtifacts(projectId, 'style-contract', 'style_contract_regenerated');
      const capabilities = providerCapabilities(stageConfig.providerCapabilities);
      const referencePack = buildReferencePack({ assets: project.reference_assets || [], capabilities, purpose: 'style-resolution', omissionsConfirmed: input.confirmReferenceOmissions === true });
      await projectStore.saveArtifact(projectId, 'reference-pack', referencePack);
      if (referencePack.requires_omission_confirmation) throw Object.assign(new Error(`参考图超过服务容量：已选择 ${referencePack.selected.length} 张，省略 ${referencePack.omitted.length} 张。请在 Reference Workbench 确认省略项后重试。`), { code: 'REFERENCE_OMISSIONS_CONFIRMATION_REQUIRED' });
      const artifact = await kunpoClient.requestArtifact(stageConfig, {
        kind: 'style-contract', prompt: stylePrompt(project, approved, referencePack), imagePaths: referencePack.selected.map((asset) => asset.path),
        id: `${project.id}-style-contract`, source: { approved_layout: approved.id, references: (project.reference_assets || []).map(({ id, name, role }) => ({ id, name, role })), ...inputSource(project) }
      });
      artifact.quality_checks = styleQualityChecks(project, artifact);
      await projectStore.saveArtifact(projectId, 'style-contract', artifact);
      await projectStore.updateWorkflow(projectId, stage, 'reviewed', 'style/style-contract.json');
      return openProject(projectId);
    }
    if (stage === 'visual_exploration') {
      const approved = project.artifacts.approvedLayout;
      const style = project.artifacts.styleContract;
      if (!approved || approved.status !== 'approved') throw new Error('布局尚未批准。');
      if (!style || style.status !== 'approved') throw new Error('Style Contract 尚未批准和锁定。');
      if (!project.canvas_spec?.generation_size) throw new Error('UE 线框稿缺少可用的画布尺寸，请重新导入 PNG、JPG 或 WebP。');
      const strictProduction = project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation';
      if (strictProduction && (project.artifacts.underlayContract?.status !== 'approved' || !project.artifacts.underlayContract?.layout_guide?.path)) {
        throw Object.assign(new Error('Strict underlay generation requires an approved Underlay Contract and generated Layout Guide.'), { code: 'UNDERLAY_SPEC_REQUIRED' });
      }
      cancelledVisualJobs.delete(projectId);
      await projectStore.updateWorkflow(projectId, stage, 'in_progress');
      const requestedStrategies = (input.strategies || ['conservative', 'expressive', 'innovative']).slice(0, 4);
      const previousVariations = project.artifacts.visualResults?.variations || [];
      const resumeInterrupted = project.workflow?.stages?.visual_exploration?.status === 'failed' && previousVariations.length > 0 && !input.preserveExisting;
      const strategies = resumeInterrupted
        ? requestedStrategies.filter((strategy) => !previousVariations.some((variation) => variation.strategy === strategy))
        : requestedStrategies;
      const capabilities = providerCapabilities(stageConfig.providerCapabilities);
      const resolvedProject = await projectStore.resolveProject(projectId);
      const guideRelativePath = project.artifacts.underlayContract?.layout_guide?.path;
      const structureGuides = strictProduction && guideRelativePath
        ? [{ id: `${project.screen_id}-underlay-layout-guide`, path: require('node:path').join(resolvedProject.workspacePath, guideRelativePath) }]
        : [];
      const referencePack = buildReferencePack({ assets: project.reference_assets || [], capabilities, purpose: 'underlay-generation', structureGuides, omissionsConfirmed: input.confirmReferenceOmissions === true });
      await projectStore.saveArtifact(projectId, 'reference-pack', referencePack);
      if (referencePack.requires_omission_confirmation) throw Object.assign(new Error(`参考图超过服务容量：已选择 ${referencePack.selected.length} 张，省略 ${referencePack.omitted.length} 张。请确认省略项后重试。`), { code: 'REFERENCE_OMISSIONS_CONFIRMATION_REQUIRED' });
      const tasks = strategies.map((strategy) => visualTask(project, approved, style, strategy, input.feedback, { underlayContract: project.artifacts.underlayContract, referencePack }));
      await projectStore.saveArtifact(projectId, 'visual-task', {
        schema_version: '1.0', id: `${project.screen_id}-visual-tasks`, version: 1, status: 'approved',
        source: { approved_layout: approved.id, style_contract: style.id, ...inputSource(project) }, tasks
      });
      const references = referencePack.selected.map((asset) => asset.path);
      const preserved = resumeInterrupted
        ? previousVariations
        : input.preserveExisting ? previousVariations.filter((variation) => !strategies.includes(variation.strategy)) : [];
      const variations = [...preserved];
      await projectStore.updateWorkflow(projectId, stage, 'in_progress', undefined, {
        progress: { completed: 0, total: tasks.length, message: '正在准备视觉任务' }
      });
      for (const task of tasks) {
        if (cancelledVisualJobs.has(projectId)) break;
        const result = await kunpoClient.generateImage(stageConfig, {
          prompt: task.prompt, imagePaths: references, size: project.canvas_spec.generation_size, model: input.model,
          maxReferenceImages: capabilities.max_reference_images,
          // E2E fixture providers cannot mint trusted permanent CDN assets;
          // this opt-in flag materializes provider results inline immediately.
          // Production keeps the default remote-only trusted-CDN behavior.
          snapshotTransient: process.env.DESIGN_COPILOT_SNAPSHOT_PROVIDER_IMAGES === 'true'
        });
        variations.push({
          id: task.task_id, strategy: task.variation_strategy, image_url: result.url,
          provider_task_id: result.task_id, layout_version: approved.id, style_version: style.id,
          layout_name: approved.label || approved.proposal?.name || approved.id,
          style_name: style.visual_identity?.theme || style.style_id || style.id,
          canvas_spec: project.canvas_spec,
          target_size: project.canvas_spec.generation_size,
          output_width: result.width,
          output_height: result.height,
          created_at: new Date().toISOString(), status: 'generated',
          storageMode: result.storageMode,
          storageProvider: result.storageProvider,
          storageDurability: result.storageDurability,
          remoteOnly: result.remoteOnly
        });
        await projectStore.saveArtifact(projectId, 'visual-results', {
          schema_version: '1.0', id: `${project.screen_id}-visual-results`, version: 1, status: 'generated',
          source: { visual_tasks: `${project.screen_id}-visual-tasks`, ...inputSource(project) }, variations
        });
        await projectStore.updateWorkflow(projectId, stage, 'in_progress', undefined, {
          progress: { completed: variations.length - preserved.length, total: tasks.length, message: `已完成 ${variations.length - preserved.length}/${tasks.length} 个方向` }
        });
      }
      const wasCancelled = cancelledVisualJobs.delete(projectId);
      await projectStore.updateWorkflow(projectId, stage, 'reviewed', `screens/${project.screen_id}/explorations/results.json`, {
        progress: { completed: variations.length - preserved.length, total: tasks.length, message: wasCancelled ? '已停止剩余任务，已完成结果可以继续评审' : '视觉方向已生成，等待评审' }
      });
      return openProject(projectId);
    }
    throw new Error(`Unknown stage: ${stage}`);
  }

  async function runStage(projectId, stage, input = {}) {
    try {
      return await runStageUnsafe(projectId, stage, input);
    } catch (error) {
      await projectStore.updateWorkflow(projectId, stage, 'failed', undefined, { keepCurrentStage: Boolean(input.stayOnInputUntilComplete) }).catch(() => undefined);
      throw error;
    }
  }

  async function draftRequirement(projectId, input = {}) {
    const project = await openScreen(projectId, input.screenId);
    if (!project.wireframe_path) throw new Error('请先导入 UE Wireframe。');
    await projectStore.updateWorkflow(projectId, 'input', 'in_progress');
    try {
      const analysis = await kunpoClient.requestJson({ ...kunpoConfig }, {
        prompt: intentDraftPrompt(project),
        imagePaths: [project.wireframe_path],
        requiredStringKeys: ['requirement_draft']
      });
      await projectStore.saveProject(projectId, {
        requirement: analysis.requirement_draft.trim(),
        requirementSource: 'ai',
        requirementConfirmed: false,
        intentAnalysis: { ...analysis, generated_at: new Date().toISOString() }
      });
      if (project.requirement !== analysis.requirement_draft.trim()) {
        await invalidateFromInputChange(projectId, { requirement: true, screenId: project.screen_id });
      }
      await projectStore.updateWorkflow(projectId, 'input', 'reviewed');
      return openProject(projectId);
    } catch (error) {
      await projectStore.updateWorkflow(projectId, 'input', 'failed').catch(() => undefined);
      throw error;
    }
  }

  async function cancelStage(projectId, stage, input = {}) {
    if (stage !== 'visual_exploration') throw new Error('当前步骤不支持停止。');
    cancelledVisualJobs.add(projectId);
    const project = await openScreen(projectId, input.screenId);
    const progress = project.workflow?.stages?.visual_exploration?.progress || {};
    await projectStore.updateWorkflow(projectId, stage, 'in_progress', undefined, {
      progress: { ...progress, message: '正在停止；当前图片完成后不会继续生成' }
    });
    return openProject(projectId);
  }

  async function approveArtifact(projectId, kind, input = {}) {
    const project = ['reference-inventory', 'style-contract', 'font-manifest', 'component-contract'].includes(kind)
      ? await openProject(projectId) : await openScreen(projectId, input.screenId);
    if (kind === 'reference-inventory') {
      const current = project.artifacts.referenceInventory;
      if (!current) throw new Error('Reference Inventory does not exist.');
      const approved = (current.assets || []).filter((asset) => asset.approved === true);
      if (!approved.length) throw Object.assign(new Error('Reference Inventory requires at least one approved image.'), { code: 'REFERENCE_INVENTORY_EMPTY' });
      await invalidateArtifacts(projectId, 'reference-inventory');
      await projectStore.saveArtifact(projectId, kind, { ...current, status: 'approved', approved_at: new Date().toISOString() });
      await projectStore.updateWorkflow(projectId, 'reference_analysis', 'approved', 'style/reference-inventory.json');
    } else if (kind === 'screen-contract') {
      const current = project.artifacts.screenContract;
      if (!current) throw new Error('Screen Contract does not exist.');
      await projectStore.saveArtifact(projectId, kind, { ...current, status: 'approved', approved_at: new Date().toISOString() });
      await projectStore.updateWorkflow(projectId, 'wireframe_interpretation', 'approved', `screens/${project.screen_id}/screen-contract.json`);
    } else if (kind === 'component-bindings') {
      const current = project.artifacts.bindings;
      if (!current) throw new Error('Component Bindings do not exist.');
      const strictBindings = project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation';
      const covered = withCoverage(current, project.artifacts.screenContract, project.artifacts.componentContract, project.artifacts.fontManifest, { strict: strictBindings });
      const result = validateBindings(covered, project.artifacts.screenContract, project.artifacts.componentContract, project.artifacts.fontManifest, { strict: strictBindings });
      if (result.errors.length) throw Object.assign(new Error(result.errors.join('; ')), { code: 'BINDING_COVERAGE_INCOMPLETE' });
      // Approval is a backend fact: stamp each binding and record the policy
      // version; client-supplied approved flags are never trusted.
      covered.bindings = (covered.bindings || []).map((binding) => ({ ...binding, approved: true }));
      const approvedAt = new Date().toISOString();
      await invalidateArtifacts(projectId, 'component-bindings');
      await projectStore.saveArtifact(projectId, kind, {
        ...covered, status: 'approved', approved_at: approvedAt,
        approval: { approved_at: approvedAt, approved_by: 'ui-designer', validation_version: BINDING_POLICY_VERSION }
      });
      await projectStore.updateWorkflow(projectId, 'component_binding', 'approved', `screens/${project.screen_id}/component-bindings.json`);
    } else if (kind === 'underlay-contract') {
      const current = project.artifacts.underlayContract;
      if (!current) throw new Error('Underlay Contract does not exist.');
      await invalidateArtifacts(projectId, 'underlay-contract');
      await projectStore.saveArtifact(projectId, kind, { ...current, status: 'approved', approved_at: new Date().toISOString() });
      await projectStore.updateWorkflow(projectId, 'underlay_specification', 'approved', `screens/${project.screen_id}/underlay-contract.json`);
    } else if (kind === 'composition-manifest') {
      const manifest = project.artifacts.compositionManifest;
      const output = project.artifacts.compositionOutput;
      const report = project.artifacts.fidelityReport;
      if (!manifest || manifest.mode !== 'final') throw new Error('A final Composition Manifest is required.');
      const resolved = await projectStore.resolveProject(projectId);
      const outputVerification = await verifyCompositionOutput(resolved.workspacePath, output, { requireFinal: true });
      if (!outputVerification.passed || manifest.output?.hash !== output?.hash || manifest.output?.path !== output?.path) {
        const messages = outputVerification.issues.map((item) => item.message);
        if (manifest.output?.hash !== output?.hash || manifest.output?.path !== output?.path) messages.push('Composition Manifest does not reference the current output.');
        throw Object.assign(new Error(`Composition Output Gate failed: ${messages.join('; ')}`), { code: 'COMPOSITION_OUTPUT_INVALID' });
      }
      if (report?.source?.composition_output !== output.id || report?.source?.composition_manifest_version !== manifest.version || report?.source?.composition_output_version !== output.version || report?.source?.composition_output_hash !== output.hash || report?.output?.hash !== output.hash) {
        throw Object.assign(new Error('Final Fidelity Report does not verify the current Composition Output.'), { code: 'FIDELITY_OUTPUT_STALE' });
      }
      const currentInspection = await inspectFidelityEvidence({ projectPath: resolved.workspacePath, project, manifest, output });
      if (!currentInspection.passed) throw Object.assign(new Error(`Current pixel evidence failed: ${currentInspection.issues.map((item) => item.message).join('; ')}`), { code: 'FIDELITY_CURRENT_EVIDENCE_FAILED' });
      const gate = finalApprovalGate(report, { evidenceDigest: currentInspection.evidence_digest });
      if (!gate.passed) throw Object.assign(new Error(`Final Fidelity Gate failed: ${gate.blocking.map((item) => item.message).join('; ')}`), { code: 'FIDELITY_GATE_FAILED' });
      await projectStore.saveArtifact(projectId, 'composition-manifest', { ...manifest, status: 'approved', approved_at: new Date().toISOString() });
      await projectStore.updateWorkflow(projectId, 'fidelity_review', 'approved', `screens/${project.screen_id}/composition-manifest.json`);
    } else if (kind === 'approved-layout') {
      const proposals = project.artifacts.layouts?.proposals || [];
      const selected = proposals.find((proposal) => proposal.id === input.proposalId);
      if (!selected) throw new Error('请选择一个有效的布局方案。');
      const manualAdjustments = Array.isArray(input.manualAdjustments) ? input.manualAdjustments.map(String).filter(Boolean) : [];
      if (project.artifacts.approvedLayout?.source_proposal !== selected.id || JSON.stringify(project.artifacts.approvedLayout?.manual_adjustments || []) !== JSON.stringify(manualAdjustments)) {
        await invalidateArtifacts(projectId, 'approved-layout', 'approved_layout_changed', { screenId: project.screen_id });
      }
      const artifact = {
        schema_version: '1.0', id: `${project.screen_id}-approved-layout-v1`, version: 1, status: 'approved',
        source: { layout_proposals: project.artifacts.layouts.id, source_proposal: selected.id },
        screen_id: project.screen_id, source_proposal: selected.id, approved_by: 'ui-designer',
        approved_at: new Date().toISOString(), manual_adjustments: manualAdjustments,
        label: selected.name || selected.id,
        canvas_spec: project.canvas_spec,
        required_controls: project.artifacts.screenContract?.required_controls || [], proposal: selected,
        slots: selected.slots || [],
        input_revisions: { ...(project.input_revisions || {}) }
      };
      const layoutErrors = validateLayout(artifact, project.artifacts.bindings, project.artifacts.componentContract, project.canvas_spec, { strict: project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation' });
      if (layoutErrors.length) throw Object.assign(new Error(layoutErrors.join('; ')), { code: 'LAYOUT_CONSTRAINT_VIOLATION' });
      await projectStore.saveArtifact(projectId, 'approved-layout', artifact);
      await projectStore.updateWorkflow(projectId, 'layout_design', 'approved', `screens/${project.screen_id}/approved-layout.json`);
    } else if (kind === 'style-contract') {
      const current = project.artifacts.styleContract;
      if (!current) throw new Error('Style Contract does not exist.');
      const approved = { ...current, status: 'approved', locked_at: new Date().toISOString() };
      const errors = validateArtifact(kind, approved);
      if (errors.length) throw Object.assign(new Error(`Style Contract 尚不可执行，不能锁定：${errors.join('; ')}`), { code: 'STYLE_CONTRACT_INVALID' });
      await projectStore.saveArtifact(projectId, kind, approved);
      await projectStore.updateWorkflow(projectId, 'style_resolution', 'approved', 'style/style-contract.json');
    } else if (kind === 'font-manifest' || kind === 'component-contract') {
      const key = kind === 'font-manifest' ? 'fontManifest' : 'componentContract';
      const stage = kind === 'font-manifest' ? 'typography_resolution' : 'component_resolution';
      const current = project.artifacts[key];
      if (!current) throw new Error(`${kind} does not exist.`);
      const approved = { ...current, status: 'approved', approved_at: new Date().toISOString() };
      const errors = validateArtifact(kind, approved);
      if (kind === 'component-contract') {
        const resolved = await projectStore.resolveProject(projectId);
        errors.push(...await validateComponentAssets(resolved.workspacePath, approved));
      }
      if (errors.length) {
        const error = new Error(errors.join('; '));
        error.code = kind === 'font-manifest' ? 'FONT_MANIFEST_INVALID' : 'COMPONENT_CONTRACT_INVALID';
        throw error;
      }
      await projectStore.saveArtifact(projectId, kind, approved);
      await projectStore.updateWorkflow(projectId, stage, 'approved', `style/${kind}.json`);
    } else if (kind === 'visual-results') {
      const current = project.artifacts.visualResults;
      const selectedIds = Array.isArray(input.selectedIds) ? input.selectedIds : [];
      const validIds = new Set((current?.variations || []).map((variation) => variation.id));
      if (!current?.variations?.length) throw new Error('尚无可评审的视觉方向。');
      if (!selectedIds.length || selectedIds.some((id) => !validIds.has(id))) throw new Error('请选择有效的视觉方向。');
      const mode = input.mode === 'combine' ? 'combine' : 'selected';
      if (mode === 'combine' && selectedIds.length < 2) throw new Error('组合方向至少需要选择两个方案。');
      await projectStore.saveArtifact(projectId, 'visual-results', {
        ...current,
        version: Number(current.version || 1) + 1,
        status: 'approved',
        review: {
          mode,
          selected_variation_ids: selectedIds,
          notes: String(input.notes || '').trim(),
          approved_by: 'ui-designer',
          approved_at: new Date().toISOString()
        }
      });
      await projectStore.updateWorkflow(projectId, 'visual_exploration', 'approved', `screens/${project.screen_id}/explorations/results.json`);
    } else {
      throw new Error(`Unknown approval kind: ${kind}`);
    }
    return openProject(projectId);
  }

  async function updateArtifact(projectId, kind, patch = {}) {
    const { screenId, ...artifactPatch } = patch;
    if (kind === 'component-bindings') {
      // Approval is a backend fact stamped by approveArtifact; ignore any
      // client-supplied approved/approval values instead of trusting them.
      delete artifactPatch.approval;
      if (Array.isArray(artifactPatch.bindings)) artifactPatch.bindings = artifactPatch.bindings.map(({ approved, ...binding }) => ({ ...binding, approved: false }));
    }
    const project = ['style-contract', 'font-manifest', 'component-contract'].includes(kind)
      ? await openProject(projectId) : await openScreen(projectId, screenId);
    if (kind === 'composition-manifest' || kind === 'fidelity-report') throw Object.assign(new Error(`${kind} is generated evidence and cannot be edited.`), { code: 'GENERATED_EVIDENCE_READ_ONLY' });
    if (kind === 'font-manifest' && (Object.prototype.hasOwnProperty.call(patch, 'fonts') || Object.prototype.hasOwnProperty.call(patch, 'roles'))) {
      throw Object.assign(new Error('Font files, authorization, and exact roles must be changed through the dedicated import and confirmation actions.'), { code: 'FONT_CONFIRMATION_ACTION_REQUIRED' });
    }
    const definitions = {
      'screen-contract': { artifact: project.artifacts.screenContract, stage: 'wireframe_interpretation' },
      'style-contract': { artifact: project.artifacts.styleContract, stage: 'style_resolution' },
      'font-manifest': { artifact: project.artifacts.fontManifest, stage: 'typography_resolution' },
      'component-contract': { artifact: project.artifacts.componentContract, stage: 'component_resolution' },
      'component-bindings': { artifact: project.artifacts.bindings || { schema_version: '2.0', id: `${project.screen_id}-component-bindings`, version: 0, status: 'draft', source: {}, bindings: [], coverage: {} }, stage: 'component_binding' },
      'underlay-contract': { artifact: project.artifacts.underlayContract, stage: 'underlay_specification' },
      'composition-manifest': { artifact: project.artifacts.compositionManifest, stage: 'composition' },
      'fidelity-report': { artifact: project.artifacts.fidelityReport, stage: 'fidelity_review' },
      'visual-results': { artifact: project.artifacts.visualResults, stage: 'visual_exploration' }
    };
    const definition = definitions[kind];
    if (!definition?.artifact) throw new Error('当前 Artifact 不存在。');
    const screenContractContentKeys = ['screen_name', 'purpose', 'primary_action', 'required_controls', 'required_information', 'states', 'edge_cases'];
    // Label-only edits must not invalidate bindings; role/required/id edits must.
    const controlsSemanticSignature = (items) => JSON.stringify(normalizeControls(items || []).map(({ id, role, required }) => ({ id, role, required })));
    const screenContractContentChanged = kind === 'screen-contract' && screenContractContentKeys.some((key) => {
      if (!Object.prototype.hasOwnProperty.call(artifactPatch, key)) return false;
      if (key === 'required_controls') return controlsSemanticSignature(artifactPatch[key]) !== controlsSemanticSignature(definition.artifact[key]);
      return JSON.stringify(artifactPatch[key]) !== JSON.stringify(definition.artifact[key]);
    });
    if (kind !== 'screen-contract' || screenContractContentChanged) await invalidateArtifacts(projectId, kind, `${kind}_changed`, { screenId: project.screen_id });
    const nextStatus = artifactPatch.status === 'rejected'
      ? 'rejected'
      : kind === 'screen-contract' && !screenContractContentChanged
        ? definition.artifact.status
        : 'reviewed';
    let next = {
      ...definition.artifact,
      ...artifactPatch,
      version: Number(definition.artifact.version || 1) + 1,
      status: nextStatus,
      source: { ...(definition.artifact.source || {}), edited_by: 'ui-designer' },
      edited_at: new Date().toISOString()
    };
    if (kind === 'component-bindings') {
      // Editing demotes the artifact to reviewed; drop any stale approval
      // stamp from the previous version so approval remains a current fact.
      delete next.approval;
      delete next.approved_at;
      next = withCoverage(next, project.artifacts.screenContract, project.artifacts.componentContract, project.artifacts.fontManifest, { strict: project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation' });
    }
    await projectStore.saveArtifact(projectId, kind, next);
    await projectStore.updateWorkflow(projectId, definition.stage, next.status, undefined, {
      progress: undefined
    });
    return openProject(projectId);
  }

  async function addFontAsset(projectId, sourcePath, input = {}) {
    const resolved = await projectStore.resolveProject(projectId);
    const project = await openProject(projectId);
    const font = await importFontAsset(resolved.workspacePath, sourcePath, input);
    const current = project.artifacts.fontManifest || { schema_version: '2.0', id: 'project-font-manifest', version: 0, status: 'draft', source: {}, fonts: [], roles: {} };
    const fonts = [...(current.fonts || []).filter((item) => item.id !== font.id), font];
    await invalidateArtifacts(projectId, 'font-manifest', 'font_asset_imported');
    await projectStore.saveArtifact(projectId, 'font-manifest', { ...current, version: Number(current.version || 0) + 1, status: 'reviewed', fonts, source: { ...(current.source || {}), last_import: font.id } });
    await projectStore.updateWorkflow(projectId, 'typography_resolution', 'reviewed', 'style/font-manifest.json');
    return openProject(projectId);
  }

  async function confirmFontUsage(projectId, input = {}) {
    const project = await openProject(projectId);
    const current = project.artifacts.fontManifest;
    if (!current) throw new Error('Import a font before confirming its usage.');
    const confirmed = confirmFontUsageContract(current, input, {
      confirmedBy: String(input.confirmedBy || 'ui-designer').trim() || 'ui-designer'
    });
    await invalidateArtifacts(projectId, 'font-manifest', 'font_usage_confirmed');
    await projectStore.saveArtifact(projectId, 'font-manifest', {
      ...confirmed,
      version: Number(current.version || 0) + 1,
      status: 'reviewed',
      source: { ...(current.source || {}), last_confirmation: `${input.fontId}:${input.roleId}` }
    });
    await projectStore.updateWorkflow(projectId, 'typography_resolution', 'reviewed', 'style/font-manifest.json');
    return openProject(projectId);
  }

  async function addComponentAsset(projectId, sourcePath, input = {}) {
    const resolved = await projectStore.resolveProject(projectId);
    const project = await openProject(projectId);
    const stateAsset = await importComponentAsset(resolved.workspacePath, sourcePath, input);
    const current = project.artifacts.componentContract || { schema_version: '2.0', id: 'project-component-contract', version: 0, status: 'draft', source: {}, families: [] };
    const previous = (current.families || []).find((family) => family.id === input.componentId);
    const family = {
      id: input.componentId, name: input.name || previous?.name || input.componentId, category: input.category || previous?.category || 'page-specific',
      status: 'reviewed', source: input.source || previous?.source || { type: 'exact-asset' },
      reuse_mode: input.reuseMode || previous?.reuse_mode || 'exact', text_policy: input.textPolicy || previous?.text_policy || 'none',
      intrinsic_size: stateAsset.intrinsic_size || previous?.intrinsic_size,
      scale_policy: input.scalePolicy || previous?.scale_policy || { uniform_only: true, min_scale: 1, max_scale: 1 },
      ...(input.slice || previous?.slice ? { slice: input.slice || previous.slice } : {}),
      locked_properties: input.lockedProperties || previous?.locked_properties || [],
      states: { ...(previous?.states || {}), [stateAsset.state]: stateAsset }
    };
    const families = [...(current.families || []).filter((item) => item.id !== family.id), family];
    await invalidateArtifacts(projectId, 'component-contract', 'component_asset_imported');
    await projectStore.saveArtifact(projectId, 'component-contract', { ...current, version: Number(current.version || 0) + 1, status: 'reviewed', families, source: { ...(current.source || {}), last_import: `${family.id}:${stateAsset.state}` } });
    await projectStore.updateWorkflow(projectId, 'component_resolution', 'reviewed', 'style/component-contract.json');
    return openProject(projectId);
  }

  async function addForgeManifest(projectId, manifestPath) {
    const resolved = await projectStore.resolveProject(projectId);
    const project = await openProject(projectId);
    const imported = await importForgeManifest(resolved.workspacePath, manifestPath);
    const current = project.artifacts.componentContract || { schema_version: '2.0', id: 'project-component-contract', version: 0, status: 'draft', source: {}, families: [] };
    const ids = new Set(imported.map((family) => family.id));
    const families = [...(current.families || []).filter((family) => !ids.has(family.id)), ...imported];
    await invalidateArtifacts(projectId, 'component-contract', 'forge_manifest_imported');
    await projectStore.saveArtifact(projectId, 'component-contract', { ...current, version: Number(current.version || 0) + 1, status: 'reviewed', families, source: { ...(current.source || {}), forge_manifest: path.basename(manifestPath) } });
    await projectStore.updateWorkflow(projectId, 'component_resolution', 'reviewed', 'style/component-contract.json');
    return openProject(projectId);
  }

  async function createUnderlayContract(projectId, input = {}) {
    const project = await openScreen(projectId, input.screenId);
    const artifact = generateUnderlayContract(project, project.artifacts.approvedLayout, project.artifacts.bindings);
    await invalidateArtifacts(projectId, 'underlay-contract');
    await projectStore.saveArtifact(projectId, 'underlay-contract', artifact);
    await projectStore.updateWorkflow(projectId, 'underlay_specification', 'reviewed', `screens/${project.screen_id}/underlay-contract.json`);
    return openProject(projectId);
  }

  async function createLayoutGuide(projectId, input = {}) {
    const project = await openScreen(projectId, input.screenId);
    if (project.artifacts.underlayContract?.status !== 'approved') throw new Error('Approve the Underlay Contract before generating its guide.');
    const resolved = await projectStore.resolveProject(projectId);
    const guide = await writeLayoutGuide(resolved.workspacePath, project.screen_id, project.artifacts.underlayContract);
    const contract = { ...project.artifacts.underlayContract, layout_guide: guide, version: Number(project.artifacts.underlayContract.version || 1) + 1 };
    await projectStore.saveArtifact(projectId, 'underlay-contract', contract);
    return openProject(projectId);
  }

  async function critiqueUnderlay(projectId, input = {}) {
    const project = await openScreen(projectId, input.screenId);
    const contract = project.artifacts.underlayContract;
    if (contract?.status !== 'approved') throw new Error('Approved Underlay Contract is required.');
    const underlayId = input.underlayId || 'current';
    const variation = (project.artifacts.visualResults?.variations || []).find((item) => item.id === underlayId);
    const resolved = await projectStore.resolveProject(projectId);
    const underlay = await materializeUnderlay(project, resolved, variation);
    const deterministic = await computeDeterministicMetrics(underlay.absolute_path, contract);
    const overlayInput = await writeReviewOverlay(resolved.workspacePath, project.screen_id, underlay.absolute_path, contract, {}, `${underlayId.replace(/[^A-Za-z0-9_-]/g, '-')}-review-input.png`);
    const componentBoard = await writeComponentBoard(resolved.workspacePath, project.screen_id, project.artifacts.componentContract);
    const prompt = underlayCritiquePrompt(contract, project.artifacts.componentContract);
    const model = kunpoConfig.critiqueModel || kunpoConfig.visionModel;
    const semanticEnvelope = await kunpoClient.requestJson({ ...kunpoConfig, visionModel: model }, {
      prompt,
      imagePaths: [underlay.absolute_path, safePath(resolved.workspacePath, overlayInput.path), safePath(resolved.workspacePath, componentBoard.path)],
      captureRaw: true
    });
    const captured = semanticEnvelope?.capture_version === '1.0';
    const rawSemantic = captured ? semanticEnvelope.value : semanticEnvelope;
    const semantic = normalizeSemanticEvidence(rawSemantic, underlay.width, underlay.height);
    const promptHash = hashEvidence(Buffer.from(prompt));
    const semanticRaw = await persistCritiqueResponse(project, resolved, underlayId, {
      semantic: rawSemantic,
      normalizedSemantic: semantic,
      envelope: captured ? semanticEnvelope : undefined,
      promptHash,
      model,
      inputHashes: {
        underlay: underlay.hash,
        overlay: overlayInput.hash,
        component_board: componentBoard.hash
      }
    });
    const annotatedOverlay = await writeReviewOverlay(resolved.workspacePath, project.screen_id, underlay.absolute_path, contract, semantic, `${underlayId.replace(/[^A-Za-z0-9_-]/g, '-')}-review-overlay.png`);
    const evidence = { underlay, overlay: overlayInput, annotated_overlay: annotatedOverlay, component_board: componentBoard, semantic_raw: semanticRaw, prompt_hash: promptHash, model };
    const critique = buildUnderlayCritique({ screenId: project.screen_id, underlayId, contract, deterministic, semantic, evidence, strict: true });
    await invalidateArtifacts(projectId, 'underlay-critique', 'underlay_recritiqued');
    await projectStore.saveArtifact(projectId, 'underlay-critique', critique);
    const gate = reviewGate(critique);
    await projectStore.updateWorkflow(projectId, 'underlay_review', gate.passed ? 'approved' : 'blocked', `screens/${project.screen_id}/underlay-critique.json`, { blocking_issues: gate.blocking.length });
    return openProject(projectId);
  }

  async function repairUnderlay(projectId, input = {}) {
    const project = await openScreen(projectId, input.screenId);
    if (!project.artifacts.underlayCritique) throw new Error('Underlay Critique is required.');
    const critique = project.artifacts.underlayCritique;
    const capabilities = providerCapabilities(kunpoConfig.providerCapabilities);
    let task;
    try { task = planRepairTask(critique, capabilities, input); }
    catch (error) {
      if (error.code === 'UNDERLAY_REPAIR_LIMIT') {
        const blocked = { schema_version: '2.0', id: `${critique.id}-repair-blocked`, version: 1, status: 'blocked', source: { critique: critique.id }, attempt: Number(input.attempt || 1), max_automatic_attempts: Number(input.maxAutomaticAttempts || 2), manual_review: { required: true, reason: error.message } };
        await projectStore.saveArtifact(projectId, 'underlay-repair-task', blocked);
        await projectStore.updateWorkflow(projectId, 'underlay_generation', 'blocked', `screens/${project.screen_id}/underlay-repair-task.json`, { manual_review: true });
      }
      throw error;
    }
    await projectStore.saveArtifact(projectId, 'underlay-repair-task', { ...task, status: 'in_progress', started_at: new Date().toISOString() });
    await projectStore.updateWorkflow(projectId, 'underlay_generation', 'in_progress', `screens/${project.screen_id}/underlay-repair-task.json`);
    const resolved = await projectStore.resolveProject(projectId);
    try {
      const sourcePath = safePath(resolved.workspacePath, critique.evidence?.underlay?.path);
      const overlayPath = safePath(resolved.workspacePath, critique.evidence?.annotated_overlay?.path || critique.evidence?.overlay?.path);
      const componentBoardPath = safePath(resolved.workspacePath, critique.evidence?.component_board?.path);
      const mask = task.repair_mode === 'inpaint' ? await writeRepairMask(resolved.workspacePath, project.screen_id, task, project.artifacts.underlayContract, critique.evidence.underlay.width, critique.evidence.underlay.height) : null;
      const prompt = underlayRepairPrompt(task, project.artifacts.underlayContract, critique);
      const result = await executeRepairTask({ task, contract: project.artifacts.underlayContract, critique, capabilities, providerClient: kunpoClient, providerConfig: kunpoConfig, sourcePath, overlayPath, componentBoardPath, maskPath: mask ? safePath(resolved.workspacePath, mask.path) : undefined, size: project.canvas_spec.generation_size, prompt });
      const repairedId = `${critique.source.underlay}-repair-v${task.attempt}`;
      const repaired = await materializeUnderlay(project, resolved, { id: repairedId, image_url: result.image_url });
      const currentResults = project.artifacts.visualResults;
      const variation = { id: repairedId, strategy: 'underlay-repair', ...(result.storageMode === 'inline_snapshot' ? {} : { image_url: result.image_url }), image_path: repaired.path, provider_task_id: result.task_id, parent_underlay_id: critique.source.underlay, repair_task_id: task.id, repair_mode: task.repair_mode, storage_mode: result.storageMode, status: 'generated', created_at: new Date().toISOString(), canvas_spec: project.canvas_spec };
      await invalidateArtifacts(projectId, 'underlay-critique', 'underlay_repaired');
      await projectStore.saveArtifact(projectId, 'visual-results', { ...currentResults, version: Number(currentResults.version || 1) + 1, status: 'generated', variations: [...(currentResults.variations || []), variation] });
      await projectStore.saveArtifact(projectId, 'underlay-repair-task', { ...task, status: 'completed', completed_at: new Date().toISOString(), output: { underlay_id: repairedId, path: repaired.path, hash: repaired.hash, provider_task_id: result.task_id, parent_underlay_id: critique.source.underlay } });
      await projectStore.updateWorkflow(projectId, 'underlay_generation', 'reviewed', `screens/${project.screen_id}/underlay-repair-task.json`);
      return critiqueUnderlay(projectId, { screenId: project.screen_id, underlayId: repairedId });
    } catch (error) {
      await projectStore.saveArtifact(projectId, 'underlay-repair-task', { ...task, status: 'failed', failed_at: new Date().toISOString(), error: { code: error.code || 'UNDERLAY_REPAIR_FAILED', message: error.message }, manual_review: { required: true } }).catch(() => undefined);
      await projectStore.updateWorkflow(projectId, 'underlay_generation', 'blocked', `screens/${project.screen_id}/underlay-repair-task.json`, { manual_review: true }).catch(() => undefined);
      throw error;
    }
  }

  async function waiveUnderlayIssue(projectId, input = {}) {
    const project = await openScreen(projectId, input.screenId);
    const critique = project.artifacts.underlayCritique;
    if (!critique) throw new Error('Underlay Critique is required.');
    const reason = String(input.reason || '').trim();
    if (reason.length < 10) throw new Error('Waiver reason must contain at least 10 characters.');
    const issueId = String(input.issueId || '');
    const issues = (critique.issues || []).map((item, index) => ({ ...item, issue_id: item.issue_id || `issue-${index + 1}` }));
    if (!issues.some((item) => item.issue_id === issueId)) throw new Error(`Critique issue not found: ${issueId}`);
    const next = { ...critique, issues, version: Number(critique.version || 1) + 1, manual_waivers: [...(critique.manual_waivers || []).filter((item) => item.issue_id !== issueId), { issue_id: issueId, reason, approved_by: 'ui-designer', approved_at: new Date().toISOString() }] };
    const gate = reviewGate(next);
    next.result = gate.passed ? 'passed-with-waiver' : 'failed';
    await projectStore.saveArtifact(projectId, 'underlay-critique', next);
    await projectStore.updateWorkflow(projectId, 'underlay_review', gate.passed ? 'approved' : 'blocked', `screens/${project.screen_id}/underlay-critique.json`, { blocking_issues: gate.blocking.length });
    return openProject(projectId);
  }

  async function composeVisual(projectId, input = {}) {
    const project = await openScreen(projectId, input.screenId);
    const resolved = await projectStore.resolveProject(projectId);
    const variation = (project.artifacts.visualResults?.variations || []).find((item) => item.id === input.variationId) || (project.artifacts.visualResults?.variations || [])[0];
    if (!variation?.image_url && !variation?.image_path) throw new Error('Select a generated underlay before composition.');
    const mode = input.mode === 'final' ? 'final' : 'preview';
    const version = Math.max(Number(project.artifacts.compositionManifest?.version || 0), Number(project.artifacts.compositionOutput?.version || 0)) + 1;
    const manifest = createCompositionManifest({
      project, underlay: { source: 'provider-result', variation_id: variation.id, ...(variation.image_path ? { path: variation.image_path } : { image_url: variation.image_url }), provider_task_id: variation.provider_task_id, critique_id: project.artifacts.underlayCritique?.id },
      layout: project.artifacts.approvedLayout, bindings: project.artifacts.bindings, componentContract: project.artifacts.componentContract,
      fontManifest: project.artifacts.fontManifest, styleContract: project.artifacts.styleContract,
      critique: project.artifacts.underlayCritique, mode, version
    });
    const output = await renderComposition({
      manifest,
      projectPath: resolved.workspacePath,
      outputPath: `screens/${project.screen_id}/compositions/${mode}-v${version}.png`
    });
    const completed = {
      ...manifest,
      status: 'generated',
      renderer: { ...manifest.renderer, version: output.renderer_version },
      output: { artifact_id: output.id, path: output.path, hash: output.hash, width: output.width, height: output.height }
    };
    await projectStore.saveArtifact(projectId, 'composition-manifest', completed);
    await projectStore.saveArtifact(projectId, 'composition-output', output);
    await projectStore.updateWorkflow(projectId, 'composition', 'reviewed', `screens/${project.screen_id}/composition-output.json`, { png_path: output.path, png_hash: output.hash });
    return openProject(projectId);
  }

  async function runFidelity(projectId, input = {}) {
    const project = await openScreen(projectId, input.screenId);
    if (!project.artifacts.compositionManifest) throw new Error('Composition Manifest is required.');
    const resolved = await projectStore.resolveProject(projectId);
    const outputVerification = await verifyCompositionOutput(resolved.workspacePath, project.artifacts.compositionOutput, { requireFinal: project.artifacts.compositionManifest.mode === 'final' });
    const inspection = await inspectFidelityEvidence({ projectPath: resolved.workspacePath, project, manifest: project.artifacts.compositionManifest, output: project.artifacts.compositionOutput });
    const dependencies = [project.artifacts.styleContract, project.artifacts.fontManifest, project.artifacts.componentContract, project.artifacts.screenContract, project.artifacts.bindings, project.artifacts.approvedLayout, project.artifacts.underlayContract, project.artifacts.underlayCritique, project.artifacts.compositionManifest, project.artifacts.compositionOutput];
    const report = runFidelityChecks({ project, manifest: project.artifacts.compositionManifest, output: project.artifacts.compositionOutput, outputVerification, inspection, bindings: project.artifacts.bindings, fontManifest: project.artifacts.fontManifest, critique: project.artifacts.underlayCritique, dependencies });
    report.version = Number(project.artifacts.fidelityReport?.version || 0) + 1;
    report.checked_at = new Date().toISOString();
    await projectStore.saveArtifact(projectId, 'fidelity-report', report);
    await projectStore.updateWorkflow(projectId, 'fidelity_review', report.status === 'passed' ? 'reviewed' : 'blocked', `screens/${project.screen_id}/fidelity-report.json`, { blocking_issues: report.issues.filter((issue) => ['blocker', 'critical', 'major'].includes(issue.severity)).length });
    return openProject(projectId);
  }

  return { addComponentAsset, addFontAsset, addForgeManifest, approveArtifact, cancelStage, composeVisual, confirmFontUsage, createLayoutGuide, createUnderlayContract, critiqueUnderlay, draftRequirement, invalidateArtifacts, invalidateFromInputChange, repairUnderlay, runFidelity, runStage, updateArtifact, waiveUnderlayIssue };
}

module.exports = { createDesignPipeline };
