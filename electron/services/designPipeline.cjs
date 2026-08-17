const { intentDraftPrompt, layoutPrompt, screenContractPrompt, stylePrompt, underlayCritiquePrompt, visualTask } = require('./prompts.cjs');
const { providerCapabilities } = require('./providerCapabilities.cjs');
const { buildReferencePack } = require('./referencePack.cjs');
const { validateArtifact } = require('./contracts.cjs');
const { importFontAsset } = require('./typographyAssets.cjs');
const { importComponentAsset } = require('./componentKit.cjs');
const { validateBindings, withCoverage } = require('./componentBindings.cjs');
const { validateLayout } = require('./layoutValidator.cjs');
const { downstreamArtifacts } = require('./artifactDependencies.cjs');
const { generateUnderlayContract } = require('./underlayContract.cjs');
const { writeLayoutGuide } = require('./layoutGuideRenderer.cjs');
const { buildUnderlayCritique, reviewGate } = require('./underlayCritique.cjs');
const { planRepairTask } = require('./underlayRepair.cjs');
const { createCompositionManifest } = require('./compositor.cjs');
const { finalApprovalGate, runFidelityChecks } = require('./fidelity.cjs');

function createDesignPipeline({ projectStore, kunpoClient, kunpoConfig }) {
  const cancelledVisualJobs = new Set();
  const openProject = (projectId) => projectStore.open(projectId, { includePreviews: false });

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

  async function staleArtifact(projectId, kind, artifact, reason = 'upstream_artifact_regenerated') {
    if (!artifact || artifact.status === 'stale') return;
    await projectStore.saveArtifact(projectId, kind, {
      ...artifact,
      status: 'stale',
      stale_at: new Date().toISOString(),
      stale_reason: reason
    });
  }

  function artifactValue(project, kind) {
    const keys = {
      'screen-contract': 'screenContract', 'component-bindings': 'bindings', 'layout-proposals': 'layouts',
      'approved-layout': 'approvedLayout', 'style-contract': 'styleContract', 'font-manifest': 'fontManifest',
      'component-contract': 'componentContract', 'reference-pack': 'referencePack', 'underlay-contract': 'underlayContract',
      'underlay-critique': 'underlayCritique', 'composition-manifest': 'compositionManifest', 'fidelity-report': 'fidelityReport',
      'visual-task': 'visualTask', 'visual-results': 'visualResults'
    };
    return project.artifacts[keys[kind]];
  }

  async function invalidateArtifacts(projectId, changedKind, reason = `${changedKind}_changed`) {
    const downstream = downstreamArtifacts(changedKind);
    if (!downstream.length) return;
    const root = await openProject(projectId);
    const screenIds = ['reference-inventory', 'style-contract', 'font-manifest', 'component-contract'].includes(changedKind)
      ? (root.screens || [{ id: root.screen_id }]).filter((screen) => screen.status !== 'archived').map((screen) => screen.id)
      : [root.screen_id];
    const processed = new Set();
    for (const screenId of screenIds) {
      const screenProject = await projectStore.open(projectId, { includePreviews: false, screenId });
      for (const kind of downstream) {
        const global = ['reference-inventory', 'style-contract', 'font-manifest', 'component-contract'].includes(kind);
        const key = `${kind}:${global ? 'global' : screenId}`;
        if (processed.has(key)) continue;
        processed.add(key);
        const artifact = artifactValue(screenProject, kind);
        if (artifact && artifact.status !== 'stale') await projectStore.saveArtifact(projectId, kind, { ...artifact, status: 'stale', stale_at: new Date().toISOString(), stale_reason: reason }, { screenId });
      }
    }
  }

  async function invalidateDownstream(project, stage, reason) {
    if (stage === 'wireframe_interpretation') {
      await staleArtifact(project.id, 'layout-proposals', project.artifacts.layouts, reason);
      await staleArtifact(project.id, 'approved-layout', project.artifacts.approvedLayout, reason);
      await staleArtifact(project.id, 'style-contract', project.artifacts.styleContract, reason);
      await staleArtifact(project.id, 'visual-task', project.artifacts.visualTask, reason);
      await staleArtifact(project.id, 'visual-results', project.artifacts.visualResults?.variations?.length ? project.artifacts.visualResults : null, reason);
    } else if (stage === 'layout_design') {
      await staleArtifact(project.id, 'approved-layout', project.artifacts.approvedLayout, reason);
      await staleArtifact(project.id, 'style-contract', project.artifacts.styleContract, reason);
      await staleArtifact(project.id, 'visual-task', project.artifacts.visualTask, reason);
      await staleArtifact(project.id, 'visual-results', project.artifacts.visualResults?.variations?.length ? project.artifacts.visualResults : null, reason);
    } else if (stage === 'style_resolution') {
      await staleArtifact(project.id, 'visual-task', project.artifacts.visualTask, reason);
      await staleArtifact(project.id, 'visual-results', project.artifacts.visualResults?.variations?.length ? project.artifacts.visualResults : null, reason);
    }
  }

  async function invalidateFromInputChange(projectId, changes = {}) {
    const project = await openProject(projectId);
    if (changes.requirement || changes.wireframe) {
      await staleArtifact(project.id, 'screen-contract', project.artifacts.screenContract, 'project_input_changed');
      await invalidateDownstream(project, 'wireframe_interpretation', 'project_input_changed');
      for (const stage of ['visual_exploration', 'style_resolution', 'layout_design', 'wireframe_interpretation']) {
        await projectStore.updateWorkflow(projectId, stage, 'stale', undefined, { progress: undefined });
      }
      await projectStore.updateWorkflow(projectId, 'input', project.requirement ? (project.requirement_confirmed ? 'approved' : 'reviewed') : 'draft');
    } else if (changes.artDirection || changes.projectType || changes.references) {
      await staleArtifact(project.id, 'style-contract', project.artifacts.styleContract, 'style_input_changed');
      await invalidateDownstream(project, 'style_resolution', 'style_input_changed');
      for (const stage of ['visual_exploration', 'style_resolution']) {
        await projectStore.updateWorkflow(projectId, stage, 'stale', undefined, { progress: undefined });
      }
    }
    return openProject(projectId);
  }

  async function runStageUnsafe(projectId, stage, input = {}) {
    const project = await openProject(projectId);
    // Freeze the model choices for this stage. A settings change applies to
    // the next task without mixing models inside an already-running batch.
    const stageConfig = { ...kunpoConfig };
    if (stage === 'wireframe_interpretation') {
      if (!project.wireframe_path) throw new Error('请先导入 UE Wireframe。');
      const intentConfirmed = project.requirement_confirmed ?? Boolean(project.requirement.trim());
      if (!project.requirement.trim() || !intentConfirmed) throw new Error('请先在项目输入中确认 AI 预填的设计意图，或填写自己的补充说明。');
      await projectStore.updateWorkflow(projectId, stage, 'in_progress', undefined, { keepCurrentStage: Boolean(input.stayOnInputUntilComplete) });
      await invalidateDownstream(project, stage);
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
        const bindingResult = validateBindings(project.artifacts.bindings, screen, project.artifacts.componentContract);
        if (project.artifacts.bindings?.status !== 'approved' || bindingResult.errors.length) throw Object.assign(new Error(`Strict layout requires complete approved bindings: ${bindingResult.errors.join('; ')}`), { code: 'BINDING_COVERAGE_INCOMPLETE' });
      }
      await projectStore.updateWorkflow(projectId, stage, 'in_progress');
      await invalidateDownstream(project, stage);
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
      await invalidateDownstream(project, stage);
      const capabilities = providerCapabilities(stageConfig.providerCapabilities);
      const referencePack = buildReferencePack({ assets: project.reference_assets || [], capabilities, purpose: 'style-resolution' });
      await projectStore.saveArtifact(projectId, 'reference-pack', referencePack);
      const artifact = await kunpoClient.requestArtifact(stageConfig, {
        kind: 'style-contract', prompt: stylePrompt(project, approved), imagePaths: referencePack.selected.map((asset) => asset.path),
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
      const referencePack = buildReferencePack({ assets: project.reference_assets || [], capabilities, purpose: 'underlay-generation', structureGuides });
      await projectStore.saveArtifact(projectId, 'reference-pack', referencePack);
      const tasks = strategies.map((strategy) => visualTask(project, approved, style, strategy, input.feedback, { underlayContract: project.artifacts.underlayContract }));
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
          maxReferenceImages: capabilities.max_reference_images
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

  async function draftRequirement(projectId) {
    const project = await openProject(projectId);
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
        await invalidateFromInputChange(projectId, { requirement: true });
      }
      await projectStore.updateWorkflow(projectId, 'input', 'reviewed');
      return openProject(projectId);
    } catch (error) {
      await projectStore.updateWorkflow(projectId, 'input', 'failed').catch(() => undefined);
      throw error;
    }
  }

  async function cancelStage(projectId, stage) {
    if (stage !== 'visual_exploration') throw new Error('当前步骤不支持停止。');
    cancelledVisualJobs.add(projectId);
    const project = await openProject(projectId);
    const progress = project.workflow?.stages?.visual_exploration?.progress || {};
    await projectStore.updateWorkflow(projectId, stage, 'in_progress', undefined, {
      progress: { ...progress, message: '正在停止；当前图片完成后不会继续生成' }
    });
    return openProject(projectId);
  }

  async function approveArtifact(projectId, kind, input = {}) {
    const project = await openProject(projectId);
    if (kind === 'screen-contract') {
      const current = project.artifacts.screenContract;
      if (!current) throw new Error('Screen Contract does not exist.');
      await projectStore.saveArtifact(projectId, kind, { ...current, status: 'approved', approved_at: new Date().toISOString() });
      await projectStore.updateWorkflow(projectId, 'wireframe_interpretation', 'approved', `screens/${project.screen_id}/screen-contract.json`);
    } else if (kind === 'component-bindings') {
      const current = project.artifacts.bindings;
      if (!current) throw new Error('Component Bindings do not exist.');
      const covered = withCoverage(current, project.artifacts.screenContract, project.artifacts.componentContract);
      const result = validateBindings(covered, project.artifacts.screenContract, project.artifacts.componentContract);
      if (result.errors.length) throw Object.assign(new Error(result.errors.join('; ')), { code: 'BINDING_COVERAGE_INCOMPLETE' });
      await invalidateArtifacts(projectId, 'component-bindings');
      await projectStore.saveArtifact(projectId, kind, { ...covered, status: 'approved', approved_at: new Date().toISOString() });
      await projectStore.updateWorkflow(projectId, 'component_binding', 'approved', `screens/${project.screen_id}/component-bindings.json`);
    } else if (kind === 'underlay-contract') {
      const current = project.artifacts.underlayContract;
      if (!current) throw new Error('Underlay Contract does not exist.');
      await invalidateArtifacts(projectId, 'underlay-contract');
      await projectStore.saveArtifact(projectId, kind, { ...current, status: 'approved', approved_at: new Date().toISOString() });
      await projectStore.updateWorkflow(projectId, 'underlay_specification', 'approved', `screens/${project.screen_id}/underlay-contract.json`);
    } else if (kind === 'composition-manifest') {
      const manifest = project.artifacts.compositionManifest;
      const report = project.artifacts.fidelityReport;
      if (!manifest || manifest.mode !== 'final') throw new Error('A final Composition Manifest is required.');
      const gate = finalApprovalGate(report);
      if (!gate.passed) throw Object.assign(new Error(`Final Fidelity Gate failed: ${gate.blocking.map((item) => item.message).join('; ')}`), { code: 'FIDELITY_GATE_FAILED' });
      await projectStore.saveArtifact(projectId, 'composition-manifest', { ...manifest, status: 'approved', approved_at: new Date().toISOString() });
      await projectStore.updateWorkflow(projectId, 'fidelity_review', 'approved', `screens/${project.screen_id}/composition-manifest.json`);
    } else if (kind === 'approved-layout') {
      const proposals = project.artifacts.layouts?.proposals || [];
      const selected = proposals.find((proposal) => proposal.id === input.proposalId);
      if (!selected) throw new Error('请选择一个有效的布局方案。');
      const manualAdjustments = Array.isArray(input.manualAdjustments) ? input.manualAdjustments.map(String).filter(Boolean) : [];
      if (project.artifacts.approvedLayout?.source_proposal !== selected.id || JSON.stringify(project.artifacts.approvedLayout?.manual_adjustments || []) !== JSON.stringify(manualAdjustments)) {
        await invalidateDownstream(project, 'layout_design');
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
      await projectStore.saveArtifact(projectId, kind, { ...current, status: 'approved', locked_at: new Date().toISOString() });
      await projectStore.updateWorkflow(projectId, 'style_resolution', 'approved', 'style/style-contract.json');
    } else if (kind === 'font-manifest' || kind === 'component-contract') {
      const key = kind === 'font-manifest' ? 'fontManifest' : 'componentContract';
      const stage = kind === 'font-manifest' ? 'typography_resolution' : 'component_resolution';
      const current = project.artifacts[key];
      if (!current) throw new Error(`${kind} does not exist.`);
      const approved = { ...current, status: 'approved', approved_at: new Date().toISOString() };
      const errors = validateArtifact(kind, approved);
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
    const project = await openProject(projectId);
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
    const screenContractContentChanged = kind === 'screen-contract' && screenContractContentKeys.some((key) => (
      Object.prototype.hasOwnProperty.call(patch, key)
      && JSON.stringify(patch[key]) !== JSON.stringify(definition.artifact[key])
    ));
    if (screenContractContentChanged) await invalidateDownstream(project, 'wireframe_interpretation');
    if (kind === 'style-contract') await invalidateDownstream(project, 'style_resolution');
    if (kind !== 'screen-contract' || screenContractContentChanged) await invalidateArtifacts(projectId, kind);
    const nextStatus = patch.status === 'rejected'
      ? 'rejected'
      : kind === 'screen-contract' && !screenContractContentChanged
        ? definition.artifact.status
        : 'reviewed';
    let next = {
      ...definition.artifact,
      ...patch,
      version: Number(definition.artifact.version || 1) + 1,
      status: nextStatus,
      source: { ...(definition.artifact.source || {}), edited_by: 'ui-designer' },
      edited_at: new Date().toISOString()
    };
    if (kind === 'component-bindings') next = withCoverage(next, project.artifacts.screenContract, project.artifacts.componentContract);
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
    await projectStore.saveArtifact(projectId, 'font-manifest', { ...current, version: Number(current.version || 0) + 1, status: 'reviewed', fonts, source: { ...(current.source || {}), last_import: font.id } });
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
    await projectStore.saveArtifact(projectId, 'component-contract', { ...current, version: Number(current.version || 0) + 1, status: 'reviewed', families, source: { ...(current.source || {}), last_import: `${family.id}:${stateAsset.state}` } });
    await projectStore.updateWorkflow(projectId, 'component_resolution', 'reviewed', 'style/component-contract.json');
    return openProject(projectId);
  }

  async function createUnderlayContract(projectId) {
    const project = await openProject(projectId);
    const artifact = generateUnderlayContract(project, project.artifacts.approvedLayout, project.artifacts.bindings);
    await invalidateArtifacts(projectId, 'underlay-contract');
    await projectStore.saveArtifact(projectId, 'underlay-contract', artifact);
    await projectStore.updateWorkflow(projectId, 'underlay_specification', 'reviewed', `screens/${project.screen_id}/underlay-contract.json`);
    return openProject(projectId);
  }

  async function createLayoutGuide(projectId) {
    const project = await openProject(projectId);
    if (project.artifacts.underlayContract?.status !== 'approved') throw new Error('Approve the Underlay Contract before generating its guide.');
    const resolved = await projectStore.resolveProject(projectId);
    const guide = await writeLayoutGuide(resolved.workspacePath, project.screen_id, project.artifacts.underlayContract);
    const contract = { ...project.artifacts.underlayContract, layout_guide: guide, version: Number(project.artifacts.underlayContract.version || 1) + 1 };
    await projectStore.saveArtifact(projectId, 'underlay-contract', contract);
    return openProject(projectId);
  }

  async function critiqueUnderlay(projectId, input = {}) {
    const project = await openProject(projectId);
    const contract = project.artifacts.underlayContract;
    if (contract?.status !== 'approved') throw new Error('Approved Underlay Contract is required.');
    const underlayId = input.underlayId || 'current';
    let semantic = input.semantic;
    if (!semantic) {
      const variation = (project.artifacts.visualResults?.variations || []).find((item) => item.id === underlayId);
      if (!variation?.image_url) throw new Error('Underlay image is required for automatic critique.');
      const resolved = await projectStore.resolveProject(projectId);
      const fs = require('node:fs/promises'); const path = require('node:path');
      const response = await fetch(variation.image_url);
      if (!response.ok) throw new Error(`Unable to download underlay for critique: ${response.status}`);
      const localPath = path.join(resolved.workspacePath, 'screens', project.screen_id, 'underlays', `${underlayId.replace(/[^A-Za-z0-9_-]/g, '-')}.png`);
      await fs.writeFile(localPath, Buffer.from(await response.arrayBuffer()));
      semantic = await kunpoClient.requestJson({ ...kunpoConfig, visionModel: kunpoConfig.critiqueModel || kunpoConfig.visionModel }, { prompt: underlayCritiquePrompt(contract, project.artifacts.componentContract), imagePaths: [localPath] });
    }
    const critique = buildUnderlayCritique({ screenId: project.screen_id, underlayId, contract, deterministic: input.deterministic, semantic });
    await projectStore.saveArtifact(projectId, 'underlay-critique', critique);
    const gate = reviewGate(critique);
    await projectStore.updateWorkflow(projectId, 'underlay_review', gate.passed ? 'approved' : 'blocked', `screens/${project.screen_id}/underlay-critique.json`, { blocking_issues: gate.blocking.length });
    return openProject(projectId);
  }

  async function repairUnderlay(projectId, input = {}) {
    const project = await openProject(projectId);
    if (!project.artifacts.underlayCritique) throw new Error('Underlay Critique is required.');
    const task = planRepairTask(project.artifacts.underlayCritique, providerCapabilities(kunpoConfig.providerCapabilities), input);
    await projectStore.saveArtifact(projectId, 'underlay-repair-task', task);
    await projectStore.updateWorkflow(projectId, 'underlay_generation', 'in_progress', `screens/${project.screen_id}/underlay-repair-task.json`);
    return openProject(projectId);
  }

  async function waiveUnderlayIssue(projectId, input = {}) {
    const project = await openProject(projectId);
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
    const project = await openProject(projectId);
    const variation = (project.artifacts.visualResults?.variations || []).find((item) => item.id === input.variationId) || (project.artifacts.visualResults?.variations || [])[0];
    if (!variation?.image_url) throw new Error('Select a generated underlay before composition.');
    const manifest = createCompositionManifest({
      project, underlay: { source: 'provider-result', variation_id: variation.id, image_url: variation.image_url, provider_task_id: variation.provider_task_id, critique_id: project.artifacts.underlayCritique?.id },
      layout: project.artifacts.approvedLayout, bindings: project.artifacts.bindings, componentContract: project.artifacts.componentContract,
      fontManifest: project.artifacts.fontManifest, styleContract: project.artifacts.styleContract,
      critique: project.artifacts.underlayCritique, mode: input.mode === 'final' ? 'final' : 'preview'
    });
    await projectStore.saveArtifact(projectId, 'composition-manifest', manifest);
    await projectStore.updateWorkflow(projectId, 'composition', 'reviewed', `screens/${project.screen_id}/composition-manifest.json`);
    return openProject(projectId);
  }

  async function runFidelity(projectId) {
    const project = await openProject(projectId);
    if (!project.artifacts.compositionManifest) throw new Error('Composition Manifest is required.');
    const dependencies = [project.artifacts.styleContract, project.artifacts.fontManifest, project.artifacts.componentContract, project.artifacts.screenContract, project.artifacts.bindings, project.artifacts.approvedLayout, project.artifacts.underlayContract, project.artifacts.underlayCritique, project.artifacts.compositionManifest];
    const report = runFidelityChecks({ project, manifest: project.artifacts.compositionManifest, bindings: project.artifacts.bindings, fontManifest: project.artifacts.fontManifest, critique: project.artifacts.underlayCritique, dependencies });
    await projectStore.saveArtifact(projectId, 'fidelity-report', report);
    await projectStore.updateWorkflow(projectId, 'fidelity_review', report.status === 'passed' ? 'reviewed' : 'blocked', `screens/${project.screen_id}/fidelity-report.json`, { blocking_issues: report.issues.filter((issue) => ['blocker', 'critical', 'major'].includes(issue.severity)).length });
    return openProject(projectId);
  }

  return { addComponentAsset, addFontAsset, approveArtifact, cancelStage, composeVisual, createLayoutGuide, createUnderlayContract, critiqueUnderlay, draftRequirement, invalidateArtifacts, invalidateFromInputChange, repairUnderlay, runFidelity, runStage, updateArtifact, waiveUnderlayIssue };
}

module.exports = { createDesignPipeline };
