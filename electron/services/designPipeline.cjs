const { intentDraftPrompt, layoutPrompt, screenContractPrompt, stylePrompt, visualTask } = require('./prompts.cjs');
const { providerCapabilities } = require('./providerCapabilities.cjs');
const { buildReferencePack } = require('./referencePack.cjs');
const { validateArtifact } = require('./contracts.cjs');
const { importFontAsset } = require('./typographyAssets.cjs');
const { importComponentAsset } = require('./componentKit.cjs');

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
      await projectStore.updateWorkflow(projectId, stage, 'in_progress');
      await invalidateDownstream(project, stage);
      const artifact = await kunpoClient.requestArtifact(stageConfig, {
        kind: 'layout-proposals', prompt: layoutPrompt(project, screen), imagePaths: [project.wireframe_path],
        id: `${project.screen_id}-layout-proposals`, source: { screen_contract: screen.id, wireframe: 'inputs/wireframe', ...inputSource(project) }
      });
      await projectStore.saveArtifact(projectId, 'layout-proposals', artifact);
      await projectStore.updateWorkflow(projectId, stage, 'reviewed', `screens/${project.screen_id}/layout-proposals.json`);
      return openProject(projectId);
    }
    if (stage === 'style_resolution') {
      const approved = project.artifacts.approvedLayout;
      if (!approved || approved.status !== 'approved') throw new Error('请先选择并批准布局方案。');
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
      cancelledVisualJobs.delete(projectId);
      await projectStore.updateWorkflow(projectId, stage, 'in_progress');
      const requestedStrategies = (input.strategies || ['conservative', 'expressive', 'innovative']).slice(0, 4);
      const previousVariations = project.artifacts.visualResults?.variations || [];
      const resumeInterrupted = project.workflow?.stages?.visual_exploration?.status === 'failed' && previousVariations.length > 0 && !input.preserveExisting;
      const strategies = resumeInterrupted
        ? requestedStrategies.filter((strategy) => !previousVariations.some((variation) => variation.strategy === strategy))
        : requestedStrategies;
      const capabilities = providerCapabilities(stageConfig.providerCapabilities);
      const structureGuides = project.continuation_mode === 'existing-strict' && project.wireframe_path
        ? [{ id: `${project.screen_id}-wireframe-guide`, path: project.wireframe_path }]
        : [];
      const referencePack = buildReferencePack({ assets: project.reference_assets || [], capabilities, purpose: 'underlay-generation', structureGuides });
      await projectStore.saveArtifact(projectId, 'reference-pack', referencePack);
      const tasks = strategies.map((strategy) => visualTask(project, approved, style, strategy, input.feedback));
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
        input_revisions: { ...(project.input_revisions || {}) }
      };
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
    const nextStatus = patch.status === 'rejected'
      ? 'rejected'
      : kind === 'screen-contract' && !screenContractContentChanged
        ? definition.artifact.status
        : 'reviewed';
    const next = {
      ...definition.artifact,
      ...patch,
      version: Number(definition.artifact.version || 1) + 1,
      status: nextStatus,
      source: { ...(definition.artifact.source || {}), edited_by: 'ui-designer' },
      edited_at: new Date().toISOString()
    };
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

  return { addComponentAsset, addFontAsset, approveArtifact, cancelStage, draftRequirement, invalidateFromInputChange, runStage, updateArtifact };
}

module.exports = { createDesignPipeline };
