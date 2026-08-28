const fs = require('node:fs/promises');
const { ERROR_CODES, FIDELITY_ISSUE_CODES } = require('./errorCodes.cjs');
const path = require('node:path');
const sharp = require('sharp');
const { intentDraftPrompt, layoutPrompt, screenContractPrompt, stylePrompt, underlayCritiquePrompt, underlayRepairPrompt, visualTask } = require('./prompts.cjs');
const { providerCapabilities } = require('./providerCapabilities.cjs');
const { buildReferencePack } = require('./referencePack.cjs');
const { normalizeArtifact, recomputeCoverage, validateArtifact } = require('./contracts.cjs');
const { confirmFontUsage: confirmFontUsageContract, importFontAsset } = require('./typographyAssets.cjs');
const { importComponentAsset, importForgeManifest, validateComponentAssets } = require('./componentKit.cjs');
const { validateBindings, withCoverage } = require('./componentBindings.cjs');
const { BINDING_POLICY_VERSION } = require('./controlRolePolicy.cjs');
const { normalizeControls } = require('./screenControls.cjs');
const { validateLayout } = require('./layoutValidator.cjs');
const { changedKindsForInput, dependencyGraphFor, isGlobalChange } = require('./artifactDependencies.cjs');
const { profileOf } = require('./pipelineProfile.cjs');
const { GLOBAL_ARTIFACTS } = require('./artifactRegistry.cjs');
const { generateUnderlayContract } = require('./underlayContract.cjs');
const { writeLayoutGuide } = require('./layoutGuideRenderer.cjs');
const { buildUnderlayCritique, reviewGate } = require('./underlayCritique.cjs');
const { executeRepairTask, planRepairTask } = require('./underlayRepair.cjs');
const { computeDeterministicMetrics, hashBuffer: hashEvidence, normalizeSemanticEvidence, safePath, writeComponentBoard, writeRepairMask, writeReviewOverlay } = require('./underlayReview.cjs');
const { createCompositionManifest, visualBindingMismatch } = require('./compositor.cjs');
const { renderComposition, verifyCompositionOutput } = require('./compositionRenderer.cjs');
const { finalApprovalGate, runFidelityChecks } = require('./fidelity.cjs');
const { inspectFidelityEvidence } = require('./fidelityInspector.cjs');

// M4-I2：Screen Contract 的设计师可编辑字段白名单。身份与证据字段
//（id / screen_id / schema_version / version / generation_id / content_hash /
// source / source_inventory / coverage / status / approved_at / stale_at /
// stale_reason 等）一律由系统控制：通用 PATCH 携带时静默忽略。
// source_inventory 只能由 Wireframe/Requirement 重新解析更新；
// coverage 永远由后端重算。
// M4-J1（审核 §7）：可编辑集由变化分类推导——全部允许字段只有这一个
// 权威来源，写权限与失效语义不再维护两套不同步的手工名单：
// - SEMANTIC：变化按路线依赖图完整传播失效，契约降级并清除批准印记；
// - REVIEW_ONLY：仅记录审查进度，不失效任何生产 Artifact；
// - required_controls 单独按语义签名分类（仅改 label 属 label-only）。
const SCREEN_CONTRACT_SEMANTIC_KEYS = new Set([
  'screen_name', 'purpose', 'primary_action', 'secondary_actions',
  'required_information', 'states', 'edge_cases',
  'data_dependencies', 'design_constraints'
]);
const SCREEN_CONTRACT_REVIEW_ONLY_KEYS = new Set(['review_metadata']);
const SCREEN_CONTRACT_EDITABLE_KEYS = new Set([
  ...SCREEN_CONTRACT_SEMANTIC_KEYS, ...SCREEN_CONTRACT_REVIEW_ONLY_KEYS, 'required_controls'
]);

function createDesignPipeline({ projectStore, kunpoClient, kunpoConfig }) {
  const cancelledVisualJobs = new Set();
  // AUD-04：取消标记按“项目 + Screen”建键：取消某个 Screen 的生成不得误伤
  // 同项目其他 Screen 的任务（Web 多会话/并行任务下的串线防线）。
  // P1-02：该键仍不能隔离同 Screen 的两个并行任务（Web 多标签页/直接 API）；
  // 引入独立 job_id 取消键的并发硬化见 Issue #50 跟踪。
  const visualCancelKey = (projectId, screenId) => `${projectId}:${screenId || 'main'}`;
  const openProject = (projectId, screenId) => projectStore.open(projectId, { includePreviews: false, ...(screenId ? { screenId } : {}) });
  async function openScreen(projectId, screenId) {
    if (!String(screenId || '').trim()) throw Object.assign(new Error('screenId is required for screen-scoped pipeline operations.'), { code: ERROR_CODES.SCREEN_ID_REQUIRED });
    const registry = await projectStore.listScreens(projectId);
    const screen = registry.screens.find((item) => item.id === screenId && item.status !== 'archived');
    if (!screen) throw Object.assign(new Error(`Screen not found or archived: ${screenId}`), { code: ERROR_CODES.SCREEN_NOT_FOUND });
    if (registry.active_screen_id !== screenId) throw Object.assign(new Error(`Screen context mismatch: activate ${screenId} before running its pipeline.`), { code: ERROR_CODES.SCREEN_CONTEXT_MISMATCH });
    // M4-K2 Fail-Closed：Clone 双重故障残留（有条目但无 workflow stage）
    // 不得继续任何管线操作；只检测并给出恢复指引，不自动修复。
    await projectStore.assertClonedScreenConsistent(projectId, screenId);
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
    const root = await openProject(projectId);
    // 依赖图按路线计算：exploration/guided 中 Style 变化绝不回指 Layout，
    // strict 中 Layout 变化不回指 Style，从根上消除 Layout—Style 循环。
    const profile = profileOf(root);
    const graph = dependencyGraphFor(profile);
    if (!(graph[changedKind] || []).length) return { changed_kind: changedKind, profile, affected_screens: [], stale_artifacts: [] };
    const screenIds = (root.screens || [{ id: root.screen_id }]).filter((screen) => screen.status !== 'archived').map((screen) => screen.id);
    // 节点级 Scope 感知 BFS：Global→Screen 展开到所有未归档 Screen；
    // Screen→Global 只处理一次；Screen→Screen 保持同一 Screen；
    // Screen→Global→Screen 之后再 fan-out 回所有未归档 Screen。
    // 去重键：global:<kind> / screen:<screenId>:<kind>。
    const seed = isGlobalChange(changedKind)
      ? { kind: changedKind, scope: 'global' }
      : { kind: changedKind, scope: 'screen', screenId: options.screenId || root.screen_id };
    const nodeKey = (node) => node.scope === 'global' ? `global:${node.kind}` : `screen:${node.screenId}:${node.kind}`;
    const expanded = new Set([nodeKey(seed)]);
    const queue = [seed];
    const screenCache = new Map();
    const screenProjectFor = async (screenId) => {
      if (!screenCache.has(screenId)) screenCache.set(screenId, await projectStore.open(projectId, { includePreviews: false, screenId }));
      return screenCache.get(screenId);
    };
    const staleArtifacts = [];
    const affectedScreens = new Set();
    while (queue.length) {
      const node = queue.shift();
      for (const nextKind of graph[node.kind] || []) {
        const targets = [];
        if (GLOBAL_ARTIFACTS[nextKind]) targets.push({ kind: nextKind, scope: 'global' });
        else if (node.scope === 'global') for (const screenId of screenIds) targets.push({ kind: nextKind, scope: 'screen', screenId });
        else targets.push({ kind: nextKind, scope: 'screen', screenId: node.screenId });
        for (const target of targets) {
          const key = nodeKey(target);
          if (expanded.has(key)) continue;
          expanded.add(key);
          queue.push(target);
          const global = target.scope === 'global';
          const snapshot = global ? root : await screenProjectFor(target.screenId);
          const artifact = artifactValue(snapshot, target.kind);
          if (artifact && artifact.status !== 'stale') {
            await projectStore.saveArtifact(projectId, target.kind, { ...artifact, status: 'stale', stale_at: new Date().toISOString(), stale_reason: reason }, global ? {} : { screenId: target.screenId });
            const stage = artifactStages[target.kind];
            if (stage) await projectStore.updateWorkflow(projectId, stage, 'stale', undefined, { screenId: global ? options.screenId || root.screen_id : target.screenId, progress: undefined });
            staleArtifacts.push({ kind: target.kind, scope: global ? 'global' : 'screen', ...(global ? {} : { screen_id: target.screenId }) });
            if (!global) affectedScreens.add(target.screenId);
          }
        }
      }
    }
    return { changed_kind: changedKind, profile, affected_screens: [...affectedScreens], stale_artifacts: staleArtifacts };
  }

  // AUD-02：路线切换重置集合。模式切换时新模式图不含旧路线专属资产，只按
  // 新图失效会残留旧严格链的 approved 事实（切回时复活）；因此模式变化
  // 无条件把两条路线的全部生产链资产置 stale，并以 route_profile_changed
  // 记录原因。Screen Contract / 输入 / 参考资产跨路线仍有效，不重置。
  const ROUTE_SWITCH_RESET_KINDS = Object.freeze([
    'style-contract', 'font-manifest', 'component-contract', 'component-bindings',
    'layout-proposals', 'approved-layout', 'underlay-contract', 'visual-task',
    'visual-results', 'underlay-critique', 'composition-manifest', 'composition-output', 'fidelity-report'
  ]);

  async function invalidateForRouteSwitch(projectId, options = {}) {
    const root = await openProject(projectId);
    const screenIds = (root.screens || [{ id: root.screen_id }]).filter((screen) => screen.status !== 'archived').map((screen) => screen.id);
    const staleArtifacts = [];
    const affectedScreens = new Set();
    for (const kind of ROUTE_SWITCH_RESET_KINDS) {
      const targets = GLOBAL_ARTIFACTS[kind]
        ? [{ kind, global: true }]
        : screenIds.map((screenId) => ({ kind, global: false, screenId }));
      for (const target of targets) {
        const snapshot = target.global ? root : await projectStore.open(projectId, { includePreviews: false, screenId: target.screenId });
        const artifact = artifactValue(snapshot, target.kind);
        if (artifact && artifact.status !== 'stale') {
          await projectStore.saveArtifact(projectId, target.kind, { ...artifact, status: 'stale', stale_at: new Date().toISOString(), stale_reason: 'route_profile_changed' }, target.global ? {} : { screenId: target.screenId });
          const stage = artifactStages[target.kind];
          if (stage) await projectStore.updateWorkflow(projectId, stage, 'stale', undefined, { screenId: target.global ? options.screenId || root.screen_id : target.screenId, progress: undefined });
          staleArtifacts.push({ kind: target.kind, scope: target.global ? 'global' : 'screen', ...(target.global ? {} : { screen_id: target.screenId }) });
          if (!target.global) affectedScreens.add(target.screenId);
        }
      }
    }
    return {
      changed_kind: 'input-continuation-mode',
      profile: profileOf(root),
      ...(options.previousMode ? { previous_profile: options.previousMode } : {}),
      affected_screens: [...affectedScreens],
      stale_artifacts: staleArtifacts
    };
  }

  async function invalidateFromInputChange(projectId, changes = {}) {
    const project = await openProject(projectId);
    const changedKinds = changedKindsForInput(changes);
    const effects = [];
    for (const changedKind of changedKinds) {
      // AUD-02：模式切换不走普通下游失效（此时模式已落盘，只会算出新图），
      // 改用旧∪新路线的固定重置集合，确保旧路线事实不残留。
      if (changedKind === 'input-continuation-mode') {
        effects.push(await invalidateForRouteSwitch(projectId, { screenId: changes.screenId || project.screen_id, previousMode: changes.previousContinuationMode }));
        continue;
      }
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
      // 事务安全：先调模型、成功后才失效下游；失败的尝试不得让
      // 现有可用链路变 stale。
      const artifact = await kunpoClient.requestArtifact(stageConfig, {
        kind: 'screen-contract', prompt: screenContractPrompt(project), imagePaths: [project.wireframe_path],
        id: `${project.screen_id}-screen-contract`, source: { requirement: 'inputs/requirement.md', wireframe: 'inputs/wireframe', ...inputSource(project) }
      });
      await invalidateArtifacts(projectId, 'screen-contract', 'screen_contract_regenerated', { screenId: project.screen_id });
      await projectStore.saveArtifact(projectId, 'screen-contract', artifact);
      await projectStore.updateWorkflow(projectId, stage, 'reviewed', `screens/${project.screen_id}/screen-contract.json`);
      return openProject(projectId);
    }
    if (stage === 'layout_design') {
      const screen = project.artifacts.screenContract;
      if (!screen || screen.status !== 'approved') throw new Error('请先批准 Functional Screen Contract。');
      const strict = project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation';
      if (strict) {
        if (project.artifacts.fontManifest?.status !== 'approved') throw Object.assign(new Error('Strict layout requires an approved Font Manifest.'), { code: ERROR_CODES.FONT_MANIFEST_REQUIRED });
        if (project.artifacts.componentContract?.status !== 'approved') throw Object.assign(new Error('Strict layout requires an approved Component Contract.'), { code: ERROR_CODES.COMPONENT_CONTRACT_REQUIRED });
        const bindingResult = validateBindings(project.artifacts.bindings, screen, project.artifacts.componentContract, project.artifacts.fontManifest, { strict });
        if (project.artifacts.bindings?.status !== 'approved' || bindingResult.errors.length) throw Object.assign(new Error(`Strict layout requires complete approved bindings: ${bindingResult.errors.join('; ')}`), { code: ERROR_CODES.BINDING_COVERAGE_INCOMPLETE });
      }
      await projectStore.updateWorkflow(projectId, stage, 'in_progress');
      // 事务安全：模型成功返回后才失效下游。
      const artifact = await kunpoClient.requestArtifact(stageConfig, {
        kind: 'layout-proposals', prompt: layoutPrompt(project, screen, { fontManifest: project.artifacts.fontManifest, componentContract: project.artifacts.componentContract, bindings: project.artifacts.bindings }), imagePaths: [project.wireframe_path],
        id: `${project.screen_id}-layout-proposals`, source: { screen_contract: screen.id, wireframe: 'inputs/wireframe', ...inputSource(project) }
      });
      await invalidateArtifacts(projectId, 'layout-proposals', 'layout_proposals_regenerated', { screenId: project.screen_id });
      await projectStore.saveArtifact(projectId, 'layout-proposals', artifact);
      await projectStore.updateWorkflow(projectId, stage, 'reviewed', `screens/${project.screen_id}/layout-proposals.json`);
      return openProject(projectId);
    }
    if (stage === 'style_resolution') {
      // Style basis is route-specific and never falls back to a downstream
      // artifact: strict locks from the approved Functional Screen Contract,
      // exploration/guided lock from the approved layout. Reading an approved
      // layout as strict style input recreates the Layout—Style cycle.
      const profile = profileOf(project);
      const styleBasis = profile === 'strict' ? project.artifacts.screenContract : project.artifacts.approvedLayout;
      if (!styleBasis || styleBasis.status !== 'approved') throw new Error(profile === 'strict' ? '请先批准 Functional Screen Contract。' : '请先选择并批准布局方案。');
      if (project.project_type === 'existing' && !(project.reference_paths || []).length) throw new Error('旧项目风格重建至少需要一张已批准参考页。');
      await projectStore.updateWorkflow(projectId, stage, 'in_progress');
      const capabilities = providerCapabilities(stageConfig.providerCapabilities);
      const referencePack = buildReferencePack({ assets: project.reference_assets || [], capabilities, purpose: 'style-resolution', omissionsConfirmed: input.confirmReferenceOmissions === true });
      if (referencePack.requires_omission_confirmation) {
        await projectStore.saveArtifact(projectId, 'reference-pack', referencePack);
        throw Object.assign(new Error(`参考图超过服务容量：已选择 ${referencePack.selected.length} 张，省略 ${referencePack.omitted.length} 张。请在 Reference Workbench 确认省略项后重试。`), { code: ERROR_CODES.REFERENCE_OMISSIONS_CONFIRMATION_REQUIRED });
      }
      // 事务安全：先调模型并附加质量检查，成功后才写 Pack、失效下游、
      // 落盘新规范；失败重试不会丢失当前可用链路。
      const artifact = await kunpoClient.requestArtifact(stageConfig, {
        kind: 'style-contract', prompt: stylePrompt(project, styleBasis, referencePack), imagePaths: referencePack.selected.map((asset) => asset.path),
        id: `${project.id}-style-contract`,
        source: { style_basis: { kind: profile === 'strict' ? 'screen-contract' : 'approved-layout', id: styleBasis.id, screen_id: project.screen_id }, references: (project.reference_assets || []).map(({ id, name, role }) => ({ id, name, role })), ...inputSource(project) }
      });
      artifact.quality_checks = styleQualityChecks(project, artifact);
      await projectStore.saveArtifact(projectId, 'reference-pack', referencePack);
      await invalidateArtifacts(projectId, 'style-contract', 'style_contract_regenerated');
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
        throw Object.assign(new Error('Strict underlay generation requires an approved Underlay Contract and generated Layout Guide.'), { code: ERROR_CODES.UNDERLAY_SPEC_REQUIRED });
      }
      cancelledVisualJobs.delete(visualCancelKey(projectId, project.screen_id));
      // AUD-04：本阶段全部工作流写回绑定任务发起时的 Screen（input.screenId），
      // 用户在生成中途切换 Screen 不得改变状态落点。
      await projectStore.updateWorkflow(projectId, stage, 'in_progress', undefined, { screenId: input.screenId });
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
      const probePack = buildReferencePack({ assets: project.reference_assets || [], capabilities, purpose: 'underlay-generation', structureGuides, omissionsConfirmed: false });
      // 省略确认绑定当前 Pack 的 hash：参考图或容量变化后 hash 改变，
      // 旧确认自动失效，必须重新确认，避免容量门禁被一次性确认永久绕过。
      const omissionsConfirmed = probePack.omitted.length > 0 && input.confirmReferenceOmissions === true && input.referencePackHash === probePack.pack_hash;
      const referencePack = omissionsConfirmed ? buildReferencePack({ assets: project.reference_assets || [], capabilities, purpose: 'underlay-generation', structureGuides, omissionsConfirmed: true }) : probePack;
      await projectStore.saveArtifact(projectId, 'reference-pack', referencePack);
      if (!omissionsConfirmed && probePack.omitted.length > 0) throw Object.assign(new Error(`参考图超过服务容量：已选择 ${probePack.selected.length} 张，省略 ${probePack.omitted.length} 张。请在视觉探索页核对省略清单后点击“确认省略项并生成”。`), { code: ERROR_CODES.REFERENCE_OMISSIONS_CONFIRMATION_REQUIRED });
      // AUD-10：同一轮生成共用一个稳定 generation 戳，保证同轮 Task/Variation
      // ID 可追溯且与上一轮不撞号。
      const generationStamp = new Date().toISOString().replace(/[:.]/g, '-');
      const tasks = strategies.map((strategy) => visualTask(project, approved, style, strategy, input.feedback, { underlayContract: project.artifacts.underlayContract, referencePack, generationStamp }));
      await projectStore.saveArtifact(projectId, 'visual-task', {
        schema_version: '1.0', id: `${project.screen_id}-visual-tasks`, version: 1, status: 'approved',
        source: { approved_layout: approved.id, style_contract: style.id, ...inputSource(project) }, tasks
      });
      const references = referencePack.selected.map((asset) => asset.path);
      const preserved = resumeInterrupted
        ? previousVariations
        : input.preserveExisting ? previousVariations.filter((variation) => !strategies.includes(variation.strategy)) : [];
      const variations = [...preserved];
      // P0-05：重新生成即取代旧证据（与合成重试同语义）：即使后续
      // 生图失败，旧的审查/合成/保真链也不得继续被信任。
      await invalidateArtifacts(projectId, 'visual-results', 'visual_results_regenerated', { screenId: project.screen_id });
      await projectStore.updateWorkflow(projectId, stage, 'in_progress', undefined, {
        screenId: input.screenId,
        progress: { completed: 0, total: tasks.length, message: '正在准备视觉任务' }
      });
      for (const task of tasks) {
        if (cancelledVisualJobs.has(visualCancelKey(projectId, project.screen_id))) break;
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
          screenId: input.screenId,
          progress: { completed: variations.length - preserved.length, total: tasks.length, message: `已完成 ${variations.length - preserved.length}/${tasks.length} 个方向` }
        });
      }
      const wasCancelled = cancelledVisualJobs.delete(visualCancelKey(projectId, project.screen_id));
      await projectStore.updateWorkflow(projectId, stage, 'reviewed', `screens/${project.screen_id}/explorations/results.json`, {
        screenId: input.screenId,
        progress: { completed: variations.length - preserved.length, total: tasks.length, message: wasCancelled ? '已停止剩余任务，已完成结果可以继续评审' : '视觉方向已生成，等待评审' }
      });
      return openProject(projectId, project.screen_id);
    }
    throw new Error(`Unknown stage: ${stage}`);
  }

  async function runStage(projectId, stage, input = {}) {
    try {
      return await runStageUnsafe(projectId, stage, input);
    } catch (error) {
      // AUD-04：失败状态写回任务发起时的 Screen，不依赖项目当前 active
      // screen（用户可能已在等待期间切走）。
      await projectStore.updateWorkflow(projectId, stage, 'failed', undefined, { keepCurrentStage: Boolean(input.stayOnInputUntilComplete), screenId: input.screenId }).catch(() => undefined);
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
    const project = await openScreen(projectId, input.screenId);
    cancelledVisualJobs.add(visualCancelKey(projectId, project.screen_id));
    const progress = project.workflow?.stages?.visual_exploration?.progress || {};
    await projectStore.updateWorkflow(projectId, stage, 'in_progress', undefined, {
      screenId: project.screen_id,
      progress: { ...progress, message: '正在停止；当前图片完成后不会继续生成' }
    });
    return openProject(projectId, project.screen_id);
  }

  // 批准新鲜度门禁：内容无法对着新上游做确定性重验的 Artifact，stale
  // 后必须重新生成才能批准；普通编辑不会清除 stale（见 updateArtifact）。
  // 字体/组件/绑定/参考清单四类资产的恢复路径就是重新批准：批准时重跑
  // 完整确定性校验（批准动作本身即 deterministic revalidation），且不存在
  // 独立的“重新生成”步骤；因此允许从 stale 直接重批。
  const REVALIDATABLE_ON_APPROVAL = new Set(['font-manifest', 'component-contract', 'component-bindings', 'reference-inventory']);
  function assertApprovableFreshness(kind, current) {
    if (current?.status === 'stale' && !REVALIDATABLE_ON_APPROVAL.has(kind)) {
      throw Object.assign(new Error(`${kind} 已因上游变化失效（${current.stale_reason || '未知原因'}），必须重新生成后才能批准。`), { code: ERROR_CODES.STALE_REAPPROVAL_BLOCKED });
    }
  }

  // P0-06：来源修订重验。即使失效传播被绕过，批准时也要对着当前输入
  // 修订再检查一次：对着旧输入生成的产物不得被批准为新事实。
  function assertSourceRevisionsFresh(kind, current, project) {
    const recorded = current?.source?.input_revisions;
    if (!recorded) return;
    if (JSON.stringify(recorded) !== JSON.stringify(project.input_revisions || {})) {
      throw Object.assign(new Error(`${kind} 的输入修订已变化，必须重新生成后才能批准。`), { code: ERROR_CODES.STALE_REAPPROVAL_BLOCKED });
    }
  }

  async function approveArtifact(projectId, kind, input = {}) {
    const project = ['reference-inventory', 'style-contract', 'font-manifest', 'component-contract'].includes(kind)
      ? await openProject(projectId) : await openScreen(projectId, input.screenId);
    if (kind === 'reference-inventory') {
      const current = project.artifacts.referenceInventory;
      if (!current) throw new Error('Reference Inventory does not exist.');
      assertApprovableFreshness(kind, current);
      const approved = (current.assets || []).filter((asset) => asset.approved === true);
      if (!approved.length) throw Object.assign(new Error('Reference Inventory requires at least one approved image.'), { code: ERROR_CODES.REFERENCE_INVENTORY_EMPTY });
      // P2-03：批准是幂等操作——清单内容未变时重复批准不得 stale 下游，
      // 只有参考内容（资产/批准/角色/顺序）变化才传播。
      const inventorySignature = JSON.stringify((current.assets || []).map((asset) => ({ id: asset.id, approved: asset.approved === true, role: asset.role || '' })));
      if (current.status === 'approved' && current.approval?.signature === inventorySignature) return openProject(projectId);
      await invalidateArtifacts(projectId, 'reference-inventory');
      await projectStore.saveArtifact(projectId, kind, { ...current, status: 'approved', approved_at: new Date().toISOString(), approval: { ...(current.approval || {}), signature: inventorySignature } });
      await projectStore.updateWorkflow(projectId, 'reference_analysis', 'approved', 'style/reference-inventory.json');
    } else if (kind === 'screen-contract') {
      const current = project.artifacts.screenContract;
      if (!current) throw new Error('Screen Contract does not exist.');
      assertApprovableFreshness(kind, current);
      assertSourceRevisionsFresh(kind, current, project);
      // 设计师权威语义：批准即完整确定性结构重验——归一化全部字段、按当前
      // source_inventory 重算 coverage（留痕信息，非门禁）、重跑控件/角色/
      // required 校验；覆盖差异不拦截批准，设计师审查调整结果为准确答案，
      // AI 清单超集约束仅作用于生成期（kunpoClient 草稿修复）。
      const normalized = normalizeArtifact('screen-contract', current);
      const revalidated = { ...normalized, coverage: recomputeCoverage(normalized) };
      const approvalErrors = validateArtifact('screen-contract', revalidated);
      if (approvalErrors.length) {
        throw Object.assign(new Error(`Screen Contract 无法批准：${approvalErrors.join('；')}`), { code: ERROR_CODES.SCREEN_CONTRACT_APPROVAL_INVALID });
      }
      await projectStore.saveArtifact(projectId, kind, { ...revalidated, status: 'approved', approved_at: new Date().toISOString() });
      await projectStore.updateWorkflow(projectId, 'wireframe_interpretation', 'approved', `screens/${project.screen_id}/screen-contract.json`);
    } else if (kind === 'component-bindings') {
      const current = project.artifacts.bindings;
      if (!current) throw new Error('Component Bindings do not exist.');
      const strictBindings = project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation';
      const covered = withCoverage(current, project.artifacts.screenContract, project.artifacts.componentContract, project.artifacts.fontManifest, { strict: strictBindings });
      const result = validateBindings(covered, project.artifacts.screenContract, project.artifacts.componentContract, project.artifacts.fontManifest, { strict: strictBindings });
      if (result.errors.length) throw Object.assign(new Error(result.errors.join('; ')), { code: ERROR_CODES.BINDING_COVERAGE_INCOMPLETE });
      // Approval is a backend fact: stamp each binding and record the policy
      // version; client-supplied approved flags are never trusted.
      covered.bindings = (covered.bindings || []).map((binding) => ({ ...binding, approved: true }));
      // P2-03：绑定内容、来源与策略版本均未变时重复批准为 no-op，不
      // stale 下游；编辑会先降级为 reviewed 并移除 approval，不会命中。
      const bindingsSignature = JSON.stringify(covered.bindings.map(({ control_id, component_id, state, font_role, slot_id }) => ({ control_id, component_id, state, font_role: font_role || '', slot_id })));
      if (current.status === 'approved' && current.approval?.validation_version === BINDING_POLICY_VERSION && current.approval?.signature === bindingsSignature) return openProject(projectId);
      const approvedAt = new Date().toISOString();
      await invalidateArtifacts(projectId, 'component-bindings');
      await projectStore.saveArtifact(projectId, kind, {
        ...covered, status: 'approved', approved_at: approvedAt,
        approval: { approved_at: approvedAt, approved_by: 'ui-designer', validation_version: BINDING_POLICY_VERSION, signature: bindingsSignature }
      });
      await projectStore.updateWorkflow(projectId, 'component_binding', 'approved', `screens/${project.screen_id}/component-bindings.json`);
    } else if (kind === 'underlay-contract') {
      const current = project.artifacts.underlayContract;
      if (!current) throw new Error('Underlay Contract does not exist.');
      assertApprovableFreshness(kind, current);
      // P2-03：同版本重复批准为 no-op，不得 stale 下游；重新生成/编辑会
      // 先改变状态或版本，不会命中此短路。
      if (current.status === 'approved') return openProject(projectId);
      await invalidateArtifacts(projectId, 'underlay-contract');
      await projectStore.saveArtifact(projectId, kind, { ...current, status: 'approved', approved_at: new Date().toISOString() });
      await projectStore.updateWorkflow(projectId, 'underlay_specification', 'approved', `screens/${project.screen_id}/underlay-contract.json`);
    } else if (kind === 'composition-manifest') {
      const manifest = project.artifacts.compositionManifest;
      const output = project.artifacts.compositionOutput;
      const report = project.artifacts.fidelityReport;
      if (!manifest || manifest.mode !== 'final') throw new Error('A final Composition Manifest is required.');
      assertApprovableFreshness(kind, manifest);
      // P0-05：最终批准重验交付链：Manifest 必须仍对应当前 Visual
      // Results 评审，视觉变化后旧交付链不得继续放行。
      const bindingMismatch = visualBindingMismatch(manifest, project.artifacts.visualResults);
      if (bindingMismatch) {
        throw Object.assign(new Error(`Composition Manifest 已不对应当前视觉评审：${bindingMismatch}。请重新合成最终 PNG 并重走保真与批准。`), { code: ERROR_CODES.VISUAL_RESULTS_BINDING_STALE });
      }
      const resolved = await projectStore.resolveProject(projectId);
      const outputVerification = await verifyCompositionOutput(resolved.workspacePath, output, { requireFinal: true });
      if (!outputVerification.passed || manifest.output?.hash !== output?.hash || manifest.output?.path !== output?.path) {
        const messages = outputVerification.issues.map((item) => item.message);
        if (manifest.output?.hash !== output?.hash || manifest.output?.path !== output?.path) messages.push('Composition Manifest does not reference the current output.');
        throw Object.assign(new Error(`Composition Output Gate failed: ${messages.join('; ')}`), { code: ERROR_CODES.COMPOSITION_OUTPUT_INVALID });
      }
      if (report?.source?.composition_output !== output.id || report?.source?.composition_manifest_version !== manifest.version || report?.source?.composition_output_version !== output.version || report?.source?.composition_output_hash !== output.hash || report?.output?.hash !== output.hash) {
        throw Object.assign(new Error('Final Fidelity Report does not verify the current Composition Output.'), { code: ERROR_CODES.FIDELITY_OUTPUT_STALE });
      }
      const currentInspection = await inspectFidelityEvidence({ projectPath: resolved.workspacePath, project, manifest, output });
      if (!currentInspection.passed) throw Object.assign(new Error(`Current pixel evidence failed: ${currentInspection.issues.map((item) => item.message).join('; ')}`), { code: ERROR_CODES.FIDELITY_CURRENT_EVIDENCE_FAILED });
      const gate = finalApprovalGate(report, { evidenceDigest: currentInspection.evidence_digest });
      if (!gate.passed) throw Object.assign(new Error(`Final Fidelity Gate failed: ${gate.blocking.map((item) => item.message).join('; ')}`), { code: ERROR_CODES.FIDELITY_GATE_FAILED });
      await projectStore.saveArtifact(projectId, 'composition-manifest', { ...manifest, status: 'approved', approved_at: new Date().toISOString() });
      await projectStore.updateWorkflow(projectId, 'fidelity_review', 'approved', `screens/${project.screen_id}/composition-manifest.json`);
    } else if (kind === 'approved-layout') {
      // stale 提案不能再次批准（fix-plan 2.5）：必须先重新生成。
      if (project.artifacts.layouts?.status === 'stale') {
        throw Object.assign(new Error('布局提案已失效，请先重新生成布局提案。'), { code: ERROR_CODES.STALE_REAPPROVAL_BLOCKED });
      }
      const proposals = project.artifacts.layouts?.proposals || [];
      const selected = proposals.find((proposal) => proposal.id === input.proposalId);
      if (!selected) throw new Error('请选择一个有效的布局方案。');
      const manualAdjustments = Array.isArray(input.manualAdjustments) ? input.manualAdjustments.map(String).filter(Boolean) : [];
      if (project.artifacts.approvedLayout?.source_proposal !== selected.id || JSON.stringify(project.artifacts.approvedLayout?.manual_adjustments || []) !== JSON.stringify(manualAdjustments)) {
        await invalidateArtifacts(projectId, 'approved-layout', 'approved_layout_changed', { screenId: project.screen_id });
      }
      // AUD-10：ID 内嵌的版本必须与存储层即将分配的单调版本一致
      //（previous + 1），不得永远写死 -v1。
      const nextLayoutVersion = Number(project.artifacts.approvedLayout?.version || 0) + 1;
      const artifact = {
        schema_version: '1.0', id: `${project.screen_id}-approved-layout-v${nextLayoutVersion}`, version: nextLayoutVersion, status: 'approved',
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
      if (layoutErrors.length) throw Object.assign(new Error(layoutErrors.join('; ')), { code: ERROR_CODES.LAYOUT_CONSTRAINT_VIOLATION });
      await projectStore.saveArtifact(projectId, 'approved-layout', artifact);
      await projectStore.updateWorkflow(projectId, 'layout_design', 'approved', `screens/${project.screen_id}/approved-layout.json`);
    } else if (kind === 'style-contract') {
      const current = project.artifacts.styleContract;
      if (!current) throw new Error('Style Contract does not exist.');
      assertApprovableFreshness(kind, current);
      assertSourceRevisionsFresh(kind, current, project);
      // 风格基线新鲜度：锁定的规范必须建立在当前已批准的路线基线之上。
      const basis = profileOf(project) === 'strict' ? project.artifacts.screenContract : project.artifacts.approvedLayout;
      const recordedBasis = current.source?.style_basis;
      if (!basis || basis.status !== 'approved' || (recordedBasis?.id && recordedBasis.id !== basis.id)) {
        throw Object.assign(new Error('风格基线已变化，请重新解析风格后再锁定。'), { code: ERROR_CODES.STALE_REAPPROVAL_BLOCKED });
      }
      const approved = { ...current, status: 'approved', locked_at: new Date().toISOString() };
      const errors = validateArtifact(kind, approved);
      if (errors.length) throw Object.assign(new Error(`Style Contract 尚不可执行，不能锁定：${errors.join('; ')}`), { code: ERROR_CODES.STYLE_CONTRACT_INVALID });
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
      // P2-03：评审决策未变时重复批准为 no-op：不得升版本，更不得失效
      // 生产链——否则重复点击会打断仍然有效的合成/保真证据链。
      if (current.status === 'approved' && current.review?.mode === mode && JSON.stringify(current.review?.selected_variation_ids || []) === JSON.stringify(selectedIds) && String(current.review?.notes || '') === String(input.notes || '').trim()) return openProject(projectId);
      // P0-05：评审决策变化属于 visual-results 变化事件：先失效生产链
      // （合成/保真/最终批准），再写入新评审，旧交付链不得继续放行。
      await invalidateArtifacts(projectId, 'visual-results', 'visual_review_changed', { screenId: project.screen_id });
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
    if (kind === 'screen-contract') {
      // M4-I2（设计师权威边界）：系统身份与证据字段由系统控制，通用 PATCH
      // 试图改写时静默忽略——UI 的全量保存携带值不变的系统字段，不受影响；
      // source_inventory 只能由重新解析动作更新，coverage 永远由后端重算。
      for (const key of Object.keys(artifactPatch)) {
        if (!SCREEN_CONTRACT_EDITABLE_KEYS.has(key)) delete artifactPatch[key];
      }
      // M4-J1（审核 §10）：no-op 判定在下方 openScreen 上下文校验之后执行，
      // 仅含系统字段的伪造请求同样要经过 Screen 存在性与 Active 校验。
    }
    if (kind === 'component-bindings') {
      // Approval is a backend fact stamped by approveArtifact; ignore any
      // client-supplied approved/approval values instead of trusting them.
      delete artifactPatch.approval;
      if (Array.isArray(artifactPatch.bindings)) artifactPatch.bindings = artifactPatch.bindings.map(({ approved, ...binding }) => ({ ...binding, approved: false }));
    }
    const project = ['style-contract', 'font-manifest', 'component-contract'].includes(kind)
      ? await openProject(projectId) : await openScreen(projectId, screenId);
    if (kind === 'composition-manifest' || kind === 'fidelity-report') throw Object.assign(new Error(`${kind} is generated evidence and cannot be edited.`), { code: ERROR_CODES.GENERATED_EVIDENCE_READ_ONLY });
    if (kind === 'font-manifest' && (Object.prototype.hasOwnProperty.call(patch, 'fonts') || Object.prototype.hasOwnProperty.call(patch, 'roles'))) {
      throw Object.assign(new Error('Font files, authorization, and exact roles must be changed through the dedicated import and confirmation actions.'), { code: ERROR_CODES.FONT_CONFIRMATION_ACTION_REQUIRED });
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
    // M4-J1（审核 §7）：Screen Contract 变化四类显式分类——唯一权威来源：
    // semantic（含 secondary_actions / data_dependencies / design_constraints
    // 等全部语义键）按路线依赖图完整传播失效并清除批准印记；label-only
    //（required_controls 仅 label 变化）只失效文字/合成链；review-only
    //（仅审查元数据）不失效任何生产 Artifact；noop（规范化后完全无变化）
    // 不升版本、不写文件、不动 Workflow。
    let screenContractChangeClass = null;
    if (kind === 'screen-contract') {
      // 审核 §10：仅含系统字段的非法 PATCH 在 Screen 上下文校验（上方
      // openScreen）之后整体 no-op，不得改变任何 Artifact 与 Workflow 状态。
      if (!Object.keys(artifactPatch).length) return project;
      const baseline = normalizeArtifact('screen-contract', definition.artifact);
      const candidate = normalizeArtifact('screen-contract', { ...definition.artifact, ...artifactPatch });
      const semanticSignature = (items) => JSON.stringify(normalizeControls(items || []).map(({ id, role, required }) => ({ id, role, required })));
      const cosmeticSignature = (items) => JSON.stringify(normalizeControls(items || []).map(({ id, label }) => ({ id, label })));
      const nextControls = artifactPatch.required_controls ?? baseline.required_controls;
      const semanticChanged = [...SCREEN_CONTRACT_SEMANTIC_KEYS].some((key) => JSON.stringify(candidate[key] ?? null) !== JSON.stringify(baseline[key] ?? null))
        || semanticSignature(nextControls) !== semanticSignature(baseline.required_controls);
      const labelsChanged = semanticSignature(nextControls) === semanticSignature(baseline.required_controls)
        && cosmeticSignature(nextControls) !== cosmeticSignature(baseline.required_controls);
      const reviewChanged = Object.prototype.hasOwnProperty.call(artifactPatch, 'review_metadata')
        && JSON.stringify(candidate.review_metadata ?? null) !== JSON.stringify(baseline.review_metadata ?? null);
      screenContractChangeClass = semanticChanged ? 'semantic' : labelsChanged ? 'label-only' : reviewChanged ? 'review-only' : 'noop';
      if (screenContractChangeClass === 'noop') return project;
    }
    // 编辑不是洗回路径：stale Artifact 被编辑后仍保持 stale，必须通过
    // 重新生成（或允许重验的资产重批）恢复；否则 stale 会被普通编辑
    // 静默清除，绕过新鲜度门禁。
    const nextStatus = artifactPatch.status === 'rejected'
      ? 'rejected'
      : kind === 'screen-contract' && (screenContractChangeClass === 'label-only' || screenContractChangeClass === 'review-only')
        ? definition.artifact.status
        : definition.artifact.status === 'stale' ? 'stale' : 'reviewed';
    let next = {
      ...definition.artifact,
      ...artifactPatch,
      version: Number(definition.artifact.version || 1) + 1,
      status: nextStatus,
      source: { ...(definition.artifact.source || {}), edited_by: 'ui-designer' },
      edited_at: new Date().toISOString()
    };
    if (kind === 'screen-contract') {
      // 设计师权威语义：保存一律归一化 + 重算 coverage（留痕信息，非门禁）+
      // 结构重验；畸形编辑在失效下游之前被拒（失败原子性）。AI 清单超集
      // 约束仅作用于生成期，审查阶段以设计师调整结果为准确答案。
      const normalized = normalizeArtifact('screen-contract', next);
      const revalidated = { ...normalized, coverage: recomputeCoverage(normalized) };
      const editErrors = validateArtifact('screen-contract', revalidated);
      if (editErrors.length) {
        throw Object.assign(new Error(`Screen Contract 无法保存该编辑：${editErrors.join('；')}`), { code: ERROR_CODES.SCREEN_CONTRACT_APPROVAL_INVALID });
      }
      next = { ...revalidated, status: next.status, version: next.version, source: next.source, edited_at: next.edited_at, approved_at: next.approved_at };
    }
    if (next.status !== 'stale') {
      delete next.stale_at;
      delete next.stale_reason;
    }
    if (kind === 'screen-contract' && screenContractChangeClass === 'semantic') {
      // M4-J1：语义编辑使旧批准事实失效——降级后的契约不得残留
      // approved_at/approval，批准必须是当前事实。
      delete next.approved_at;
      delete next.approval;
    }
    if (kind !== 'screen-contract' || screenContractChangeClass === 'semantic') await invalidateArtifacts(projectId, kind, `${kind}_changed`, { screenId: project.screen_id });
    else if (screenContractChangeClass === 'label-only') {
      // AUD-09：label-only 编辑不失效 Binding（控件语义未变），但已产出的
      // 文字层/合成/保真事实仍写着旧文案，必须沿 manifest→output→fidelity
      // 失效，逼使交付链用新 label 重建。M4-H3：移到重验通过之后，非法编辑
      // 不得触碰交付链；invalidateArtifacts 不置 stale 种子自身，Manifest
      // 本体（携带旧文案的 text 层）须显式失效。
      const currentManifest = project.artifacts.compositionManifest;
      if (currentManifest && currentManifest.status !== 'stale') {
        await projectStore.saveArtifact(projectId, 'composition-manifest', { ...currentManifest, status: 'stale', stale_at: new Date().toISOString(), stale_reason: 'screen_contract_label_changed' }, { screenId: project.screen_id });
        await projectStore.updateWorkflow(projectId, 'composition', 'stale', undefined, { screenId: project.screen_id, progress: undefined });
      }
      await invalidateArtifacts(projectId, 'composition-manifest', 'screen_contract_label_changed', { screenId: project.screen_id });
    }
    // M4-J1（审核 §9）：review-only 只记录审查进度，不失效任何生产
    // Artifact——此前误落 label-only 分支，只勾选审查确认就会迫使
    // Composition/Output/Fidelity 整链重跑，与 review_metadata 的定位不符。
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
    const critique = buildUnderlayCritique({ screenId: project.screen_id, underlayId, contract, deterministic, semantic, evidence, strict: true, visualResultsId: project.artifacts.visualResults?.id, visualResultsVersion: project.artifacts.visualResults?.version });
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
      // P0-05：修复新增 variation 同样是 visual-results 内容变化事件。
      await invalidateArtifacts(projectId, 'visual-results', 'visual_results_repaired', { screenId: project.screen_id });
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

  // P0-03：人工复核是独立完成动作，只处理“要求人工复核”的 Critique；
  // 它解除 manual-review 阻断，但绝不把未豁免的阻断问题洗成通过。
  async function approveUnderlayManualReview(projectId, input = {}) {
    const project = await openScreen(projectId, input.screenId);
    const critique = project.artifacts.underlayCritique;
    if (!critique) throw new Error('Underlay Critique is required.');
    if (critique.manual_review?.approved === true) throw Object.assign(new Error('本次审查的人工复核已完成。'), { code: ERROR_CODES.UNDERLAY_MANUAL_REVIEW_NOT_REQUIRED });
    if (critique.manual_review?.required !== true) throw Object.assign(new Error('本次审查未要求人工复核。'), { code: ERROR_CODES.UNDERLAY_MANUAL_REVIEW_NOT_REQUIRED });
    const conclusion = String(input.conclusion || '').trim();
    const reason = String(input.reason || '').trim();
    if (!conclusion) throw new Error('人工复核结论不能为空。');
    if (reason.length < 10) throw new Error('人工复核理由必须不少于 10 个字符，说明判断依据。');
    const next = {
      ...critique,
      version: Number(critique.version || 1) + 1,
      manual_review: { ...critique.manual_review, approved: true, approved_by: 'ui-designer', approved_at: new Date().toISOString(), conclusion, reason }
    };
    const gate = reviewGate(next);
    next.result = gate.passed ? ((critique.manual_waivers || []).length ? 'passed-with-waiver' : 'passed') : 'failed';
    await projectStore.saveArtifact(projectId, 'underlay-critique', next);
    await projectStore.updateWorkflow(projectId, 'underlay_review', gate.passed ? 'approved' : 'blocked', `screens/${project.screen_id}/underlay-critique.json`, { blocking_issues: gate.blocking.length });
    return openProject(projectId);
  }

  async function composeVisual(projectId, input = {}) {
    const project = await openScreen(projectId, input.screenId);
    const resolved = await projectStore.resolveProject(projectId);
    const variations = project.artifacts.visualResults?.variations || [];
    // P0-04：不再静默回退第一张：未指定或未知的 variationId 必须直接暴露，
    // 否则 A 的审查证据会被静默用于合成 B。
    const variation = variations.find((item) => item.id === input.variationId);
    if (!variation) throw Object.assign(new Error('未指定要合成的底图或该方向不存在，请先在视觉探索页选择一个有效方向。'), { code: ERROR_CODES.VISUAL_VARIATION_NOT_FOUND });
    if (!variation.image_url && !variation.image_path) throw new Error('Select a generated underlay before composition.');
    // P0-04：证据链匹配门禁：审查对象必须与待合成底图一致，否则
    // “A Underlay 的 Critique 批准 B Underlay”。校验必须在失效旧
    // 证据之前：失败的尝试不得把仍然有效的链路变 stale。
    const critique = project.artifacts.underlayCritique;
    const strictProduction = project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation';
    if (strictProduction && (!critique || critique.source?.underlay !== variation.id)) {
      throw Object.assign(new Error(`当前选中底图尚未审查：审查对象是 ${critique?.source?.underlay || '（无）'}，请先对 ${variation.id} 执行污染审查。`), { code: ERROR_CODES.UNDERLAY_EVIDENCE_MISMATCH });
    }
    if (strictProduction) {
      // AUD-05：证据链重验不只看 ID——stale 结论、像素 hash、Visual Results
      // 版本任一项对不上都不得放行，否则同 ID 重新生成后旧 passed 会继续生效。
      if (critique.status === 'stale') {
        throw Object.assign(new Error(`底图审查已失效（${critique.stale_reason || '上游变化'}），请先对 ${variation.id} 重新执行污染审查。`), { code: ERROR_CODES.UNDERLAY_EVIDENCE_STALE });
      }
      const currentVisualVersion = Number(project.artifacts.visualResults?.version || 0);
      if (Number(critique.source?.visual_results_version) !== currentVisualVersion) {
        throw Object.assign(new Error(`审查证据绑定的是 Visual Results V${critique.source?.visual_results_version ?? '（无）'}，当前已是 V${currentVisualVersion}；请重新审查后再合成。`), { code: ERROR_CODES.UNDERLAY_EVIDENCE_MISMATCH });
      }
      const currentUnderlay = await materializeUnderlay(project, resolved, variation);
      if (critique.source?.underlay_hash !== currentUnderlay.hash) {
        throw Object.assign(new Error(`底图像素已变化（审查 hash 与当前文件不一致），审查证据不再可信；请对 ${variation.id} 重新执行污染审查。`), { code: ERROR_CODES.UNDERLAY_EVIDENCE_MISMATCH });
      }
    }
    const mode = input.mode === 'final' ? 'final' : 'preview';
    // A regeneration attempt supersedes the previous evidence even when the
    // render itself fails: downstream fidelity/approval gates must not keep
    // trusting a composition that is being rebuilt (UIE2E-07B/07C).
    const reason = `${mode}_composition_regenerated`;
    await invalidateArtifacts(projectId, 'composition-manifest', reason, { screenId: project.screen_id });
    const previousManifest = project.artifacts.compositionManifest;
    if (previousManifest && previousManifest.status !== 'stale') {
      await projectStore.saveArtifact(projectId, 'composition-manifest', { ...previousManifest, status: 'stale', stale_at: new Date().toISOString(), stale_reason: reason }, { screenId: project.screen_id });
    }
    // AUD-10：文件名版本必须与存储层即将分配给 Manifest 的单调版本
    //（previous + 1）一致；若前面的 stale 回写已把磁盘版本 +1，这里要
    // 一并计入，否则落盘版本与文件名/证据链记录撞不上。
    const version = Number(project.artifacts.compositionManifest?.version || 0) + 1 + (previousManifest && previousManifest.status !== 'stale' ? 1 : 0);
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

  return { addComponentAsset, addFontAsset, addForgeManifest, approveArtifact, approveUnderlayManualReview, cancelStage, composeVisual, confirmFontUsage, createLayoutGuide, createUnderlayContract, critiqueUnderlay, draftRequirement, invalidateArtifacts, invalidateFromInputChange, repairUnderlay, runFidelity, runStage, updateArtifact, waiveUnderlayIssue };
}

module.exports = { createDesignPipeline };
