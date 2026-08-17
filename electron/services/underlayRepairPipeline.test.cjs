const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { createProjectStore } = require('./projectStore.cjs');
const { createDesignPipeline } = require('./designPipeline.cjs');
const { writeComponentBoard, writeReviewOverlay } = require('./underlayReview.cjs');

async function runRepair(supportsInpaint) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `copilot-repair-${supportsInpaint ? 'inpaint' : 'regen'}-`));
  try {
    const projectStore = createProjectStore({ workspaceRoot: root });
    let project = await projectStore.create({ name: 'Repair', projectType: 'existing', requirement: 'Repair a contaminated underlay.' });
    const parentBytes = await sharp({ create: { width: 128, height: 64, channels: 4, background: '#f4f4f4ff' } }).png().toBuffer();
    const source = path.join(root, 'wireframe.png'); await fs.writeFile(source, parentBytes); project = await projectStore.importFile(project.id, source, 'wireframe');
    const parentRelative = 'screens/main/underlays/parent.png'; const parentPath = path.join(project.workspacePath, parentRelative);
    await fs.mkdir(path.dirname(parentPath), { recursive: true }); await fs.writeFile(parentPath, parentBytes);
    const contract = { schema_version: '2.0', id: 'underlay-contract', version: 1, status: 'approved', reserved_regions: [{ slot_id: 'primary', bbox: [0.2, 0.7, 0.6, 0.2] }] };
    await projectStore.saveArtifact(project.id, 'underlay-contract', contract);
    await projectStore.saveArtifact(project.id, 'component-contract', { schema_version: '2.0', id: 'components', version: 1, status: 'approved', families: [] });
    await projectStore.saveArtifact(project.id, 'visual-results', { schema_version: '2.0', id: 'visuals', version: 1, status: 'generated', variations: [{ id: 'parent', image_path: parentRelative }] });
    const overlay = await writeReviewOverlay(project.workspacePath, 'main', parentPath, contract);
    const board = await writeComponentBoard(project.workspacePath, 'main', { families: [] });
    await projectStore.saveArtifact(project.id, 'underlay-critique', { schema_version: '2.0', id: 'critique-parent', version: 1, status: 'reviewed', source: { underlay: 'parent', underlay_contract: contract.id }, evidence: { underlay: { path: parentRelative, width: 128, height: 64 }, annotated_overlay: overlay, component_board: board }, result: 'failed', issues: [{ issue_id: 'bad-1', severity: 'critical', type: 'button-like', slot_id: 'primary', reason: 'button residue' }], manual_waivers: [] });
    const repairedBytes = await sharp({ create: { width: 128, height: 64, channels: 4, background: '#30343aff' } }).png().toBuffer();
    let repairCall; let critiqueInputs;
    const client = {
      repairImage: async (_config, input) => { repairCall = input; return { image_url: `data:image/png;base64,${repairedBytes.toString('base64')}`, task_id: `provider-${supportsInpaint ? 'inpaint' : 'regen'}` }; },
      requestJson: async (_config, input) => { critiqueInputs = input.imagePaths; return { confidence: 0.95, suspected_ui_regions: [], text_like_regions: [], slot_checks: [{ slot_id: 'primary', subject_overlap: false, background_busyness: false, contrast_conflict: false, hard_edge_crossing: false, ui_like_contamination: { detected: false, confidence: 0 } }] }; }
    };
    const pipeline = createDesignPipeline({ projectStore, kunpoClient: client, kunpoConfig: { configured: true, imageModel: 'image-test', visionModel: 'vision-test', providerCapabilities: { supports_inpaint: supportsInpaint, max_reference_images: 6 } } });
    const result = await pipeline.repairUnderlay(project.id, { attempt: 1, maxAutomaticAttempts: 2 });
    assert.equal(repairCall.mode, supportsInpaint ? 'inpaint' : 'regenerate');
    assert.equal(Boolean(repairCall.maskPath), supportsInpaint);
    assert.equal(critiqueInputs.length, 3);
    assert.equal(result.artifacts.underlayCritique.source.underlay, 'parent-repair-v1');
    assert.equal(result.artifacts.underlayCritique.result, 'passed');
    assert.equal(result.artifacts.underlayRepairTask.status, 'completed');
    assert.equal(result.artifacts.underlayRepairTask.output.parent_underlay_id, 'parent');
    assert.equal(result.artifacts.visualResults.variations.length, 2);
    await assert.rejects(pipeline.repairUnderlay(project.id, { attempt: 3, maxAutomaticAttempts: 2 }), (error) => error.code === 'UNDERLAY_REPAIR_LIMIT');
    const blocked = await projectStore.open(project.id, { includePreviews: false });
    assert.equal(blocked.artifacts.underlayRepairTask.status, 'blocked');
    assert.equal(blocked.artifacts.underlayRepairTask.manual_review.required, true);
    assert.equal(blocked.workflow.stages.underlay_generation.status, 'blocked');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('inpaint repair produces a versioned underlay and automatically re-critiques it', () => runRepair(true));
test('regenerate repair produces a versioned underlay and automatically re-critiques it', () => runRepair(false));
