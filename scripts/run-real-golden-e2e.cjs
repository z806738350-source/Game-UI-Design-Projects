const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fontconfigRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'game-ui-golden-fontconfig-'));
fsSync.mkdirSync(path.join(fontconfigRoot, 'cache'), { recursive: true });
fsSync.writeFileSync(path.join(fontconfigRoot, 'fonts.conf'), `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>/System/Library/Fonts</dir><dir>/Library/Fonts</dir><cachedir>${path.join(fontconfigRoot, 'cache')}</cachedir></fontconfig>`);
process.env.FONTCONFIG_FILE = path.join(fontconfigRoot, 'fonts.conf');
process.env.XDG_CACHE_HOME = path.join(fontconfigRoot, 'cache');
process.once('exit', () => fsSync.rmSync(fontconfigRoot, { recursive: true, force: true }));
const { createDesignPipeline } = require('../electron/services/designPipeline.cjs');
const { createProjectStore } = require('../electron/services/projectStore.cjs');
const { loadKunpoConfig } = require('../electron/services/env.cjs');
const kunpoClient = require('../electron/services/kunpoClient.cjs');
const { buildUnderlayCritique, reviewGate } = require('../electron/services/underlayCritique.cjs');
const { validateArtifact } = require('../electron/services/contracts.cjs');
const { validateLayout } = require('../electron/services/layoutValidator.cjs');
const { METRIC_THRESHOLDS } = require('../electron/services/underlayReview.cjs');

const root = path.resolve(__dirname, '..');
const goldenRoot = path.join(root, 'release-evidence', 'golden-samples');
// Calibration samples (thresholds were tuned on these) come first; the two
// reserved samples were never used for calibration and only run after the
// threshold_version is frozen.
const sampleIds = ['functional-dense', 'visual-hero', 'existing-continuation', 'jade-shop-zh', 'frontier-campaign'];

function now() { return new Date().toISOString(); }

async function sha256(filePath) {
  return `sha256:${crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex')}`;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function withFixedClock(value, action) {
  const real = Date.now;
  Date.now = () => value;
  try { return await action(); } finally { Date.now = real; }
}

function controls() {
  return [
    ['primary-action', 'Primary', 'primary'], ['navigation', 'Navigation', 'navigation'],
    ['tab', 'Items', 'navigation'], ['resources', '88880', 'information'],
    ['content', 'Golden Sample', 'information'], ['icon-a', 'Action A', 'action'],
    ['badge', 'MAX', 'information'], ['row', 'Row 01', 'information'],
    ['secondary-action', 'Save', 'secondary'], ['icon-b', 'Action B', 'action']
  ].map(([id, label, role]) => ({ id, label, role, required: true }));
}

function controlsFor(sampleId) {
  if (sampleId === 'jade-shop-zh') return [
    ['primary-action', '立即购买', 'primary'], ['navigation', '商店', 'navigation'],
    ['tab', '礼包', 'navigation'], ['resources', '¥68', 'information'],
    ['content', '今日特惠 VIP 专享', 'information'], ['icon-a', '领取', 'action'],
    ['badge', '-25%', 'information'], ['row', '限时礼包 仅剩2天', 'information'],
    ['secondary-action', '加入购物车', 'secondary'], ['icon-b', '分享', 'action']
  ].map(([id, label, role]) => ({ id, label, role, required: true }));
  if (sampleId === 'frontier-campaign') return [
    ['primary-action', 'Deploy', 'primary'], ['navigation', 'Campaign', 'navigation'],
    ['tab', 'Missions', 'navigation'], ['resources', '12,480', 'information'],
    ['content', 'Frontier Report', 'information'], ['icon-a', 'Scout', 'action'],
    ['badge', '78%', 'information'], ['row', 'Outpost 04 ready', 'information'],
    ['secondary-action', 'Recall', 'secondary'], ['icon-b', 'Signal', 'action']
  ].map(([id, label, role]) => ({ id, label, role, required: true }));
  return controls();
}

function fontRole(controlId) {
  return ({ content: 'display', row: 'body', resources: 'numeric', badge: 'numeric', tab: 'button-label', 'primary-action': 'button-label', 'secondary-action': 'button-label' })[controlId];
}

function styleContract(sampleId, referenceIds) {
  return {
    schema_version: '2.0', id: `${sampleId}-style-contract`, version: 1, status: 'approved',
    source: { reference_inventory: `${sampleId}-references`, generated_for: 'real-golden-e2e' },
    style_id: `${sampleId}-locked-style`,
    visual_identity: { theme: sampleId, fidelity: 'strict-continuation', source: 'approved-reference-pages' },
    colors: { primary: '#d6b05f', surface: '#173b46', text: '#fff7d6' },
    typography: {
      display: { size: 24, weight: 650, letter_spacing: 0.4, line_height: 1.1, fill: '#fff4c4' },
      body: { size: 15, weight: 500, letter_spacing: 0.1, line_height: 1.15, fill: '#ffffff' },
      numeric: { size: 14, weight: 700, letter_spacing: 0.2, line_height: 1.1, numeric_style: 'tabular', fill: '#fff5bd' },
      'button-label': { size: 15, weight: 700, letter_spacing: 0.3, line_height: 1.1, fill: '#ffffff' }
    },
    geometry: { corner_language: 'beveled-soft', corner_radius: 10, density: 'functional' },
    lighting: { treatment: 'restrained edge glow', light_direction: 'top-left', intensity: 0.35 },
    components: { reuse: 'exact approved assets', families: 8 },
    composition: { hierarchy: 'wireframe-locked', underlay: 'UI-free reserved regions' },
    materials: ['dark lacquer', 'brushed metal', 'soft emissive glass'],
    reference_ids: referenceIds,
    negative_style_constraints: ['no provider-rendered shared UI', 'no formal text in underlay', 'no slot-crossing subject']
  };
}

async function importReferences(store, pipeline, project, manifest, seed) {
  for (const [index, item] of manifest.inputs.references.entries()) {
    project = await withFixedClock(seed + index, () => store.importFile(project.id, path.join(root, item.path), 'reference'));
    const reference = project.reference_assets.at(-1);
    project = await store.manageReference(project.id, { id: reference.id, action: 'details', screenType: manifest.id, contains: ['layout', 'components', 'typography'], baseline: 'approved visual reference page', notes: `Golden reference ${index + 1}` });
    project = await store.manageReference(project.id, { id: reference.id, action: 'approval', approved: true });
  }
  project = await pipeline.approveArtifact(project.id, 'reference-inventory');
  return project;
}

async function importFont(pipeline, project, manifest) {
  const font = manifest.font;
  project = await pipeline.addFontAsset(project.id, path.join(root, font.path), { id: font.id, sourceType: font.license || 'SIL OFL 1.1' });
  for (const roleId of manifest.required_font_roles) {
    project = await pipeline.confirmFontUsage(project.id, {
      fontId: font.id, roleId, licenseConfirmed: true, exactConfirmed: true,
      identityCritical: true, requiredCoverage: font.coverage, confirmedBy: 'golden-e2e-license-verifier'
    });
  }
  return pipeline.approveArtifact(project.id, 'font-manifest');
}

async function importComponents(store, pipeline, project, manifest) {
  for (const item of manifest.inputs.components) {
    project = await pipeline.addComponentAsset(project.id, path.join(root, item.path), {
      componentId: item.family_id, name: item.family_id, category: item.category, state: item.state,
      reuseMode: 'exact', textPolicy: item.text_policy,
      scalePolicy: { uniform_only: true, min_scale: 1, max_scale: 1 },
      lockedProperties: ['asset_hash', 'intrinsic_size', 'state'],
      source: { type: 'privacy-safe-real-golden-asset', asset_manifest: `${manifest.id}/asset-manifest.json` }
    });
  }
  project = await store.open(project.id, { includePreviews: false });
  await store.saveArtifact(project.id, 'component-contract', {
    ...project.artifacts.componentContract,
    status: 'reviewed',
    families: project.artifacts.componentContract.families.map((family) => ({ ...family, status: 'approved' }))
  });
  return pipeline.approveArtifact(project.id, 'component-contract');
}

async function seedContracts(store, pipeline, project, manifest) {
  const requiredControls = controlsFor(manifest.id);
  const labels = requiredControls.map((item) => item.label);
  const primaryLabel = requiredControls.find((item) => item.role === 'primary')?.label || labels[0];
  const secondaryLabels = requiredControls.filter((item) => item.role === 'secondary').map((item) => item.label);
  const informationLabels = requiredControls.filter((item) => item.role === 'information').map((item) => item.label);
  const screen = {
    schema_version: '2.0', id: `${manifest.id}-screen-contract`, version: 1, status: 'reviewed', source: { wireframe: manifest.inputs.wireframe.path },
    screen_id: 'main', screen_name: manifest.id, purpose: 'Exercise the complete strict production path with real bitmap evidence.', primary_action: primaryLabel,
    secondary_actions: secondaryLabels, required_information: informationLabels, required_controls: requiredControls,
    states: ['default', 'pressed', 'disabled', 'selected'], edge_cases: ['long labels', 'dense numeric content'], data_dependencies: ['golden fixture'],
    design_constraints: { canvas: [1024, 1024], minimum_controls: 10, exact_assets: true },
    source_inventory: { requirement_functions: labels, wireframe_controls: labels, wireframe_information: informationLabels },
    coverage: { covered_items: labels, uncovered_items: [] }
  };
  const screenErrors = validateArtifact('screen-contract', screen);
  if (screenErrors.length) throw new Error(`Screen Contract seed is invalid: ${screenErrors.join('; ')}`);
  await store.saveArtifact(project.id, 'screen-contract', screen);
  project = await pipeline.approveArtifact(project.id, 'screen-contract', { screenId: 'main' });

  const layoutSeed = JSON.parse(await fs.readFile(path.join(root, `release-evidence/golden-samples/${manifest.id}/inputs/layout-seed.json`), 'utf8'));
  const bindings = {
    schema_version: '2.0', id: `${manifest.id}-component-bindings`, version: 1, status: 'reviewed', source: { screen_contract: screen.id },
    bindings: layoutSeed.slots.map((slot) => ({
      control_id: slot.control_id, component_id: slot.component_id, slot_id: slot.id, state: 'default', approved: true,
      label: requiredControls.find((item) => item.id === slot.control_id)?.label || '',
      text: requiredControls.find((item) => item.id === slot.control_id)?.label || '',
      ...(fontRole(slot.control_id) ? { font_role: fontRole(slot.control_id) } : {})
    })), coverage: {}
  };
  await store.saveArtifact(project.id, 'component-bindings', bindings);
  project = await pipeline.approveArtifact(project.id, 'component-bindings', { screenId: 'main' });

  const layout = {
    schema_version: '2.0', id: `${manifest.id}-approved-layout`, version: 1, status: 'approved', source: { wireframe: manifest.inputs.wireframe.path, bindings: bindings.id },
    screen_id: 'main', source_proposal: 'golden-layout-a', approved_by: 'golden-e2e-automation', approved_at: now(), label: 'Wireframe-locked golden layout',
    canvas_spec: project.canvas_spec, required_controls: requiredControls, slots: layoutSeed.slots, focal_regions: [{ id: 'focal-centre', bbox: [0.32, 0.2, 0.4, 0.52] }],
    manual_adjustments: [], input_revisions: { ...(project.input_revisions || {}) }
  };
  const layoutErrors = validateLayout(layout, project.artifacts.bindings, project.artifacts.componentContract, project.canvas_spec, { strict: true });
  if (layoutErrors.length) throw new Error(`Approved Layout seed is invalid: ${layoutErrors.join('; ')}`);
  await store.saveArtifact(project.id, 'layout-proposals', {
    schema_version: '2.0', id: `${manifest.id}-layout-proposals`, version: 1, status: 'approved', source: { wireframe: manifest.inputs.wireframe.path }, screen_id: 'main',
    proposals: ['a', 'b', 'c'].map((id, index) => ({ id: `golden-layout-${id}`, name: `Golden Layout ${id.toUpperCase()}`, strategy: index ? 'comparison-only' : 'wireframe-locked', visual_hierarchy: [], interaction_flow: [], tradeoffs: [], rationale: [], regions: { canvas: { label: 'Canvas', recommended_ratio: 1 } }, slots: layoutSeed.slots }))
  });
  await store.saveArtifact(project.id, 'approved-layout', layout);
  const references = project.reference_assets.map((asset) => asset.id);
  const style = styleContract(manifest.id, references);
  const styleErrors = validateArtifact('style-contract', style);
  if (styleErrors.length) throw new Error(`Style Contract seed is invalid: ${styleErrors.join('; ')}`);
  await store.saveArtifact(project.id, 'style-contract', style);
  await store.updateWorkflow(project.id, 'style_resolution', 'approved', 'style/style-contract.json');
  return store.open(project.id, { includePreviews: false });
}

async function seedBadUnderlay(store, project, manifest) {
  const relative = 'screens/main/underlays/known-contaminated-input.png';
  const target = path.join(project.workspacePath, relative);
  await fs.copyFile(path.join(root, manifest.inputs.known_contaminated_underlay.path), target);
  await store.saveArtifact(project.id, 'visual-results', {
    schema_version: '2.0', id: `${manifest.id}-visual-results`, version: 1, status: 'generated', source: { known_contamination: manifest.inputs.known_contaminated_underlay.hash },
    variations: [{ id: 'known-contaminated', strategy: 'negative-control', image_path: relative, status: 'generated', created_at: now(), canvas_spec: project.canvas_spec }]
  });
  return store.open(project.id, { includePreviews: false });
}

async function normalizeSnapshot(directory, originalRoot) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) await normalizeSnapshot(filePath, originalRoot);
    else if (entry.name.endsWith('.json')) {
      let text = await fs.readFile(filePath, 'utf8');
      text = text.split(`${originalRoot}${path.sep}`).join('');
      await fs.writeFile(filePath, text);
    }
  }
}

async function exportEvidence({ sampleRoot, project, manifest, log, initialCritique, finalProject }) {
  const evidenceRoot = path.join(sampleRoot, 'evidence');
  await fs.rm(evidenceRoot, { recursive: true, force: true });
  await fs.mkdir(evidenceRoot, { recursive: true });
  if (project?.workspacePath) {
    const snapshot = path.join(evidenceRoot, 'workspace');
    await fs.cp(project.workspacePath, snapshot, { recursive: true });
    await normalizeSnapshot(snapshot, project.workspacePath);
  }
  if (initialCritique) await writeJson(path.join(evidenceRoot, 'initial-critique.json'), initialCritique);
  const critique = finalProject?.artifacts?.underlayCritique || project?.artifacts?.underlayCritique;
  const semanticResponses = [];
  if (log.negative_control?.raw_evidence) semanticResponses.push({ stage: 'critique-negative-control', ...log.negative_control.raw_evidence });
  for (const entry of log.stages) if (entry.critique?.raw_evidence) semanticResponses.push({ stage: entry.id, ...entry.critique.raw_evidence });
  let finalUnderlay;
  if (critique?.source?.underlay && project?.workspacePath) {
    const underlayPath = path.join(project.workspacePath, 'screens', project.screen_id || 'main', 'underlays', `${critique.source.underlay}.png`);
    finalUnderlay = { id: critique.source.underlay, hash: await sha256(underlayPath).catch(() => undefined) };
  }
  log.lineage = {
    ...(log.lineage || {}),
    model: critique?.source?.model || critique?.evidence?.model,
    critique_prompt_hash: critique?.source?.prompt_hash || critique?.evidence?.prompt_hash,
    input_hashes: {
      known_contaminated_underlay: manifest.inputs?.known_contaminated_underlay?.hash,
      wireframe: manifest.inputs?.wireframe?.hash
    },
    semantic_responses: semanticResponses,
    repair_chain: log.lineage?.repair_chain || [],
    final_underlay: finalUnderlay,
    final_png: undefined
  };
  await writeJson(path.join(evidenceRoot, 'execution-log.json'), log);
  if (finalProject?.artifacts?.compositionOutput?.path) {
    const source = path.join(finalProject.workspacePath, finalProject.artifacts.compositionOutput.path);
    await fs.copyFile(source, path.join(sampleRoot, 'final.png'));
    manifest.outputs = {
      final_png: { path: `release-evidence/golden-samples/${manifest.id}/final.png`, hash: await sha256(path.join(sampleRoot, 'final.png')) },
      critique: { id: finalProject.artifacts.underlayCritique.id, result: finalProject.artifacts.underlayCritique.result, raw_hash: finalProject.artifacts.underlayCritique.evidence.semantic_raw.hash },
      fidelity: { id: finalProject.artifacts.fidelityReport.id, status: finalProject.artifacts.fidelityReport.status, evidence_digest: finalProject.artifacts.fidelityReport.evidence_digest }
    };
  }
  manifest.acceptance = {
    provider_e2e: log.status === 'pipeline-passed' ? 'passed' : 'failed',
    negative_control_critical_detected: Boolean(log.negative_control?.critical_count),
    negative_control_auto_pass: Boolean(log.negative_control?.gate_passed),
    pipeline_gate: log.status === 'pipeline-passed' ? 'passed' : 'failed',
    designer_signoff: 'pending', formal_release: 'blocked-until-signoff'
  };
  manifest.last_run = { status: log.status, started_at: log.started_at, completed_at: log.completed_at, safe_provider: log.safe_provider };
  await writeJson(path.join(sampleRoot, 'asset-manifest.json'), manifest);
  if (log.lineage && manifest.outputs?.final_png?.hash) {
    log.lineage.final_png = manifest.outputs.final_png.hash;
    await writeJson(path.join(evidenceRoot, 'execution-log.json'), log);
  }
  await refreshGoldenIndex();
}

async function refreshGoldenIndex() {
  const indexPath = path.join(goldenRoot, 'index.json');
  const previous = await fs.readFile(indexPath, 'utf8').then((text) => JSON.parse(text), () => ({ schema_version: '1.0' }));
  const samples = [];
  let allPassed = true; let anyFailed = false; let allSigned = true;
  for (const id of sampleIds) {
    const sampleRoot = path.join(goldenRoot, id);
    let pipeline = 'missing';
    try { pipeline = JSON.parse(await fs.readFile(path.join(sampleRoot, 'evidence', 'execution-log.json'), 'utf8')).status || 'missing'; } catch { /* no execution log yet */ }
    let signoff = 'missing';
    try { signoff = (await fs.readFile(path.join(sampleRoot, 'designer-signoff.md'), 'utf8')).includes('Decision: APPROVED') ? 'approved' : 'pending'; } catch { /* no signoff file */ }
    samples.push({ id, pipeline, designer_signoff: signoff });
    if (pipeline !== 'pipeline-passed') { allPassed = false; if (pipeline === 'failed' || pipeline === 'missing') anyFailed = true; }
    if (signoff !== 'approved') allSigned = false;
  }
  const index = {
    ...previous,
    schema_version: previous.schema_version || '1.0',
    status: allPassed && allSigned ? 'released' : allPassed ? 'pending-signoff' : anyFailed ? 'failed' : 'prepared',
    samples,
    updated_at: now()
  };
  await writeJson(indexPath, index);
}

async function runSample(sampleId, sampleIndex, config) {
  const sampleRoot = path.join(goldenRoot, sampleId);
  const manifestPath = path.join(sampleRoot, 'asset-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), `game-ui-golden-${sampleId}-`));
  const store = createProjectStore({ workspaceRoot: temporaryRoot });
  const pipeline = createDesignPipeline({ projectStore: store, kunpoClient, kunpoConfig: config });
  const log = { schema_version: '1.0', sample_id: sampleId, status: 'running', started_at: now(), safe_provider: kunpoClient.safeConfig(config), threshold_version: METRIC_THRESHOLDS.version, lineage: { repair_chain: [] }, stages: [] };
  let project; let initialCritique; let finalProject;
  const stage = async (id, action) => {
    const entry = { id, started_at: now(), status: 'running' }; log.stages.push(entry);
    try { const result = await action(); entry.status = 'passed'; entry.completed_at = now(); return result; }
    catch (error) { entry.status = 'failed'; entry.completed_at = now(); entry.error = { code: error.code || 'ERROR', message: error.message }; throw error; }
  };
  try {
    project = await stage('create-project', () => withFixedClock(1_800_000_000_000 + sampleIndex, () => store.create({
      name: `Golden ${sampleId}`, projectType: 'existing', continuationMode: 'existing-strict',
      requirement: 'Produce a final game UI composition from approved real references, exact components, exact typography, and a clean UI-free underlay.',
      artDirection: `Strictly continue the approved ${sampleId} reference language.`
    })));
    project = await stage('import-wireframe', () => store.importFile(project.id, path.join(root, manifest.inputs.wireframe.path), 'wireframe'));
    project = await stage('approve-references', () => importReferences(store, pipeline, project, manifest, 1_800_000_100_000 + sampleIndex * 10));
    project = await stage('approve-font-roles', () => importFont(pipeline, project, manifest));
    project = await stage('approve-component-kit', () => importComponents(store, pipeline, project, manifest));
    project = await stage('seed-reviewed-contracts', () => seedContracts(store, pipeline, project, manifest));
    project = await stage('approve-underlay-contract', async () => {
      let next = await pipeline.createUnderlayContract(project.id, { screenId: 'main' });
      next = await pipeline.approveArtifact(project.id, 'underlay-contract', { screenId: 'main' });
      return pipeline.createLayoutGuide(project.id, { screenId: 'main' });
    });
    project = await stage('seed-negative-control', () => seedBadUnderlay(store, project, manifest));
    project = await stage('critique-negative-control', () => pipeline.critiqueUnderlay(project.id, { screenId: 'main', underlayId: 'known-contaminated' }));
    initialCritique = project.artifacts.underlayCritique;
    const initialGate = reviewGate(initialCritique);
    const criticalCount = initialCritique.issues.filter((issue) => issue.severity === 'critical').length;
    log.negative_control = { critique_id: initialCritique.id, result: initialCritique.result, gate_passed: initialGate.passed, critical_count: criticalCount, issue_count: initialCritique.issues.length, raw_evidence: initialCritique.evidence.semantic_raw };
    if (initialGate.passed || criticalCount < 1) throw Object.assign(new Error('Negative control was not rejected with at least one critical issue.'), { code: 'NEGATIVE_CONTROL_FALSE_PASS' });
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      project = await stage(`repair-and-recritique-${attempt}`, () => pipeline.repairUnderlay(project.id, { screenId: 'main', attempt, maxAutomaticAttempts: 2 }));
      const gate = reviewGate(project.artifacts.underlayCritique);
      log.stages.at(-1).critique = { id: project.artifacts.underlayCritique.id, result: project.artifacts.underlayCritique.result, blocking: gate.blocking.length, raw_evidence: project.artifacts.underlayCritique.evidence.semantic_raw };
      const task = project.artifacts.underlayRepairTask;
      log.lineage.repair_chain.push({
        attempt, mode: task?.repair_mode, parent_underlay_id: task?.source?.parent_underlay_id,
        output_underlay_id: task?.output?.underlay_id, provider_task_id: task?.output?.provider_task_id, output_hash: task?.output?.hash
      });
      if (gate.passed) break;
      if (attempt === 2) throw Object.assign(new Error(`Repair did not pass after ${attempt} real attempts.`), { code: 'REAL_REPAIR_EXHAUSTED' });
    }
    const finalUnderlayId = project.artifacts.underlayCritique.source.underlay;
    project = await stage('final-composition', () => pipeline.composeVisual(project.id, { screenId: 'main', variationId: finalUnderlayId, mode: 'final' }));
    project = await stage('pixel-fidelity', () => pipeline.runFidelity(project.id, { screenId: 'main' }));
    if (project.artifacts.fidelityReport.status !== 'passed') throw Object.assign(new Error(`Fidelity gate failed: ${project.artifacts.fidelityReport.issues.map((item) => item.message).join('; ')}`), { code: 'FIDELITY_FAILED' });
    project = await stage('approve-pipeline-output', () => pipeline.approveArtifact(project.id, 'composition-manifest', { screenId: 'main' }));
    finalProject = project;
    log.status = 'pipeline-passed'; log.completed_at = now();
    await exportEvidence({ sampleRoot, project, manifest, log, initialCritique, finalProject });
    return { sample_id: sampleId, status: log.status, final_hash: manifest.outputs?.final_png?.hash };
  } catch (error) {
    log.status = 'failed'; log.completed_at = now(); log.error = { code: error.code || 'ERROR', message: error.message, stack: String(error.stack || '').split(`${root}${path.sep}`).join('') };
    if (project?.id) project = await store.open(project.id, { includePreviews: false }).catch(() => project);
    await exportEvidence({ sampleRoot, project, manifest, log, initialCritique, finalProject }).catch(() => undefined);
    throw error;
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function resumeSample(sampleId, config, options = {}) {
  const sampleRoot = path.join(goldenRoot, sampleId);
  const evidenceWorkspace = path.join(sampleRoot, 'evidence', 'workspace');
  const manifest = JSON.parse(await fs.readFile(path.join(sampleRoot, 'asset-manifest.json'), 'utf8'));
  const previousLog = JSON.parse(await fs.readFile(path.join(sampleRoot, 'evidence', 'execution-log.json'), 'utf8'));
  const initialCritique = JSON.parse(await fs.readFile(path.join(sampleRoot, 'evidence', 'initial-critique.json'), 'utf8'));
  const storedProject = JSON.parse(await fs.readFile(path.join(evidenceWorkspace, 'project.json'), 'utf8'));
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), `game-ui-golden-resume-${sampleId}-`));
  const destination = path.join(temporaryRoot, storedProject.id);
  await fs.cp(evidenceWorkspace, destination, { recursive: true });
  const store = createProjectStore({ workspaceRoot: temporaryRoot });
  const pipeline = createDesignPipeline({ projectStore: store, kunpoClient, kunpoConfig: config });
  const log = {
    schema_version: '1.0', sample_id: sampleId, status: 'running', started_at: now(), safe_provider: kunpoClient.safeConfig(config),
    resume_source: previousLog.resume_source?.real_model_stages?.length
      ? previousLog.resume_source
      : { status: previousLog.status, completed_at: previousLog.completed_at, error: previousLog.error, real_model_stages: previousLog.stages.filter((item) => item.id.startsWith('critique-') || item.id.startsWith('repair-')) },
    negative_control: previousLog.negative_control, lineage: { repair_chain: previousLog.lineage?.repair_chain || [] }, stages: []
  };
  let project; let finalProject;
  const stage = async (id, action) => {
    const entry = { id, started_at: now(), status: 'running' }; log.stages.push(entry);
    try { const result = await action(); entry.status = 'passed'; entry.completed_at = now(); return result; }
    catch (error) { entry.status = 'failed'; entry.completed_at = now(); entry.error = { code: error.code || 'ERROR', message: error.message }; throw error; }
  };
  try {
    project = await store.open(storedProject.id, { includePreviews: false });
    const capturedUnderlayId = project.artifacts.underlayCritique.source.underlay;
    if (options.reframe) {
      project = await stage('apply-reframed-layout', async () => {
        const layoutSeed = JSON.parse(await fs.readFile(path.join(sampleRoot, 'inputs', 'layout-seed.json'), 'utf8'));
        const wireframeTarget = path.isAbsolute(project.wireframe_path) ? project.wireframe_path : path.join(project.workspacePath, project.wireframe_path);
        await fs.copyFile(path.join(sampleRoot, 'inputs', 'wireframe.png'), wireframeTarget);
        const currentLayout = project.artifacts.approvedLayout;
        const nextLayout = {
          ...currentLayout,
          id: `${sampleId}-approved-layout-reframed`, version: Number(currentLayout.version || 1) + 1,
          status: 'approved', slots: layoutSeed.slots,
          source: { ...(currentLayout.source || {}), reframed_from: currentLayout.id, reason: 'real-critique-subject-overlap' },
          approved_by: 'golden-e2e-automation', approved_at: now()
        };
        const errors = validateLayout(nextLayout, project.artifacts.bindings, project.artifacts.componentContract, project.canvas_spec, { strict: true });
        if (errors.length) throw new Error(`Reframed layout is invalid: ${errors.join('; ')}`);
        await store.saveArtifact(project.id, 'approved-layout', nextLayout);
        if (project.artifacts.layouts) {
          await store.saveArtifact(project.id, 'layout-proposals', {
            ...project.artifacts.layouts, version: Number(project.artifacts.layouts.version || 1) + 1,
            proposals: project.artifacts.layouts.proposals.map((proposal, index) => index === 0 ? { ...proposal, slots: layoutSeed.slots } : proposal)
          });
        }
        await store.updateWorkflow(project.id, 'layout_design', 'approved', 'screens/main/approved-layout.json');
        let next = await store.open(project.id, { includePreviews: false });
        next = await pipeline.createUnderlayContract(project.id, { screenId: 'main' });
        next = await pipeline.approveArtifact(project.id, 'underlay-contract', { screenId: 'main' });
        return pipeline.createLayoutGuide(project.id, { screenId: 'main' });
      });
      project = await stage('critique-reframed-underlay', () => pipeline.critiqueUnderlay(project.id, { screenId: 'main', underlayId: capturedUnderlayId }));
      const gate = reviewGate(project.artifacts.underlayCritique);
      log.stages.at(-1).critique = { id: project.artifacts.underlayCritique.id, result: project.artifacts.underlayCritique.result, blocking: gate.blocking.length, raw_evidence: project.artifacts.underlayCritique.evidence.semantic_raw };
      if (!gate.passed) throw Object.assign(new Error(`Reframed underlay still has ${gate.blocking.length} blocking issues.`), { code: 'REFRAMED_UNDERLAY_BLOCKED' });
    } else project = await stage('re-evaluate-captured-critique', async () => {
      const current = project.artifacts.underlayCritique;
      const raw = JSON.parse(await fs.readFile(path.join(project.workspacePath, current.evidence.semantic_raw.path), 'utf8'));
      const critique = buildUnderlayCritique({
        screenId: project.screen_id, underlayId: current.source.underlay,
        contract: project.artifacts.underlayContract, deterministic: current.deterministic_metrics,
        semantic: raw.normalized || raw.parsed, evidence: current.evidence, strict: true
      });
      const gate = reviewGate(critique);
      log.stages.at(-1).critique = { id: critique.id, previous_result: current.result, result: critique.result, blocking: gate.blocking.length, evidence_hash: critique.evidence.semantic_raw.hash };
      if (!gate.passed) throw Object.assign(new Error(`Captured repair evidence still has ${gate.blocking.length} blocking issues.`), { code: 'CAPTURED_REPAIR_STILL_BLOCKED' });
      await store.saveArtifact(project.id, 'underlay-critique', critique);
      await store.updateWorkflow(project.id, 'underlay_review', 'approved', `screens/${project.screen_id}/underlay-critique.json`, { blocking_issues: 0 });
      return store.open(project.id, { includePreviews: false });
    });
    const finalUnderlayId = project.artifacts.underlayCritique.source.underlay;
    project = await stage('final-composition', () => pipeline.composeVisual(project.id, { screenId: 'main', variationId: finalUnderlayId, mode: 'final' }));
    project = await stage('pixel-fidelity', () => pipeline.runFidelity(project.id, { screenId: 'main' }));
    if (project.artifacts.fidelityReport.status !== 'passed') throw Object.assign(new Error(`Fidelity gate failed: ${project.artifacts.fidelityReport.issues.map((item) => item.message).join('; ')}`), { code: 'FIDELITY_FAILED' });
    project = await stage('approve-pipeline-output', () => pipeline.approveArtifact(project.id, 'composition-manifest', { screenId: 'main' }));
    finalProject = project; log.status = 'pipeline-passed'; log.completed_at = now();
    await exportEvidence({ sampleRoot, project, manifest, log, initialCritique, finalProject });
    return { sample_id: sampleId, status: log.status, final_hash: manifest.outputs?.final_png?.hash, resumed_from_real_evidence: true };
  } catch (error) {
    log.status = 'failed'; log.completed_at = now(); log.error = { code: error.code || 'ERROR', message: error.message, stack: String(error.stack || '').split(`${root}${path.sep}`).join('') };
    if (project?.id) project = await store.open(project.id, { includePreviews: false }).catch(() => project);
    await exportEvidence({ sampleRoot, project, manifest, log, initialCritique, finalProject }).catch(() => undefined);
    throw error;
  } finally { await fs.rm(temporaryRoot, { recursive: true, force: true }); }
}

async function main() {
  const config = loadKunpoConfig(root);
  if (process.argv.includes('--refresh-index')) {
    await refreshGoldenIndex();
    process.stdout.write(`${JSON.stringify({ status: 'index-refreshed' }, null, 2)}\n`);
    return;
  }
  if (!config.configured) throw new Error('Kunpo is not configured; a real provider is required for Golden E2E.');
  const resumeFlag = process.argv.indexOf('--resume');
  if (resumeFlag >= 0) {
    const id = process.argv[resumeFlag + 1];
    if (!sampleIds.includes(id)) throw new Error(`Unknown sample for --resume: ${id || '<missing>'}`);
    const result = await resumeSample(id, config);
    process.stdout.write(`${JSON.stringify({ status: 'completed', results: [result] }, null, 2)}\n`);
    return;
  }
  const reframeFlag = process.argv.indexOf('--reframe');
  if (reframeFlag >= 0) {
    const id = process.argv[reframeFlag + 1];
    if (!sampleIds.includes(id)) throw new Error(`Unknown sample for --reframe: ${id || '<missing>'}`);
    const result = await resumeSample(id, config, { reframe: true });
    process.stdout.write(`${JSON.stringify({ status: 'completed', results: [result] }, null, 2)}\n`);
    return;
  }
  const sampleFlag = process.argv.indexOf('--sample');
  const requested = process.argv.includes('--all') ? sampleIds : sampleFlag >= 0 ? [process.argv[sampleFlag + 1]] : [];
  if (!requested.length || requested.some((id) => !sampleIds.includes(id))) throw new Error(`Use --sample <${sampleIds.join('|')}> or --all.`);
  const results = [];
  for (const id of requested) {
    try {
      results.push(await runSample(id, sampleIds.indexOf(id), config));
    } catch (error) {
      if (!isTransientNetworkError(error)) throw error;
      process.stderr.write(`[golden] ${id} hit a transient network error (${error.cause?.code || error.code || error.message}); retrying the sample once.\n`);
      results.push(await runSample(id, sampleIds.indexOf(id), config));
    }
  }
  process.stdout.write(`${JSON.stringify({ status: 'completed', results }, null, 2)}\n`);
}

function isTransientNetworkError(error) {
  const code = error?.cause?.code || error?.code || '';
  if (['UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_CONNECT', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) return true;
  // Provider-side gateway hiccups (502/503/504) are transient as well.
  return /terminated|other side closed|fetch failed|network|\(50[234]\)|bad gateway|service unavailable|gateway timeout/i.test(String(error?.message || ''));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
