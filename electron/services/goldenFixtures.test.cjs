'use strict';

// Fixture E2E: validates the published real-provider golden evidence chain
// without calling any provider. Passed samples must carry a complete,
// hash-consistent lineage (inputs → semantic responses → repair chain →
// final underlay → final PNG); every sample must stay consistent with the
// golden index. Replaces the old synthetic known_issues gate tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { reviewGate } = require('./underlayCritique.cjs');

const root = path.resolve(__dirname, '..', '..');
const goldenRoot = path.join(root, 'release-evidence', 'golden-samples');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
}

function samplePaths(id) {
  const sampleRoot = path.join(goldenRoot, id);
  return {
    sampleRoot,
    manifest: path.join(sampleRoot, 'asset-manifest.json'),
    log: path.join(sampleRoot, 'evidence', 'execution-log.json'),
    workspace: path.join(sampleRoot, 'evidence', 'workspace'),
    finalPng: path.join(sampleRoot, 'final.png'),
    signoff: path.join(sampleRoot, 'designer-signoff.md')
  };
}

const index = readJson(path.join(goldenRoot, 'index.json'));
const sampleIds = Array.isArray(index.samples) && index.samples.every?.((item) => typeof item === 'string')
  ? index.samples
  : (index.samples || []).map((item) => item.id);

test('golden index lists the calibrated and reserved samples', () => {
  assert.deepEqual(sampleIds, ['functional-dense', 'visual-hero', 'existing-continuation', 'jade-shop-zh', 'frontier-campaign']);
});

for (const id of sampleIds) {
  const paths = samplePaths(id);
  const hasRun = fs.existsSync(paths.log);

  test(`${id}: golden index entry matches the execution log and signoff state`, () => {
    const entry = (index.samples || []).find((item) => (item.id || item) === id);
    assert.ok(entry, `index.json must contain ${id}`);
    const pipeline = typeof entry === 'string' ? undefined : entry.pipeline;
    const logged = hasRun ? readJson(paths.log).status : 'missing';
    if (pipeline !== undefined) assert.equal(pipeline, logged, `index pipeline status for ${id} must mirror execution-log.json`);
  });

  if (!hasRun) continue;
  const log = readJson(paths.log);
  const manifest = readJson(paths.manifest);

  test(`${id}: negative control was rejected with at least one critical issue`, () => {
    assert.ok(log.negative_control, 'execution log must record the negative control');
    assert.ok(log.negative_control.critical_count >= 1, 'negative control must surface critical issues');
    assert.equal(log.negative_control.gate_passed, false, 'negative control must not pass the review gate');
  });

  test(`${id}: input hashes in the manifest match the on-disk fixtures`, () => {
    for (const key of ['wireframe', 'known_contaminated_underlay', 'clean_underlay']) {
      const input = manifest.inputs?.[key];
      if (!input?.hash) continue;
      assert.equal(sha256(path.join(root, input.path)), input.hash, `${key} hash mismatch`);
    }
    for (const reference of manifest.inputs?.references || []) {
      assert.equal(sha256(path.join(root, reference.path)), reference.hash, 'reference hash mismatch');
    }
  });

  if (log.status !== 'pipeline-passed') continue;

  test(`${id}: passed sample carries raw semantic responses and a connected repair chain`, () => {
    assert.ok(Array.isArray(log.lineage?.semantic_responses) && log.lineage.semantic_responses.length >= 2, 'lineage must include the negative-control and repair critiques');
    for (const response of log.lineage.semantic_responses) {
      assert.match(response.hash, /^sha256:[0-9a-f]{64}$/);
      const filePath = path.join(paths.workspace, response.path);
      assert.ok(fs.existsSync(filePath), `semantic response ${response.path} must exist`);
      assert.equal(sha256(filePath), response.hash, 'semantic response hash mismatch');
    }
    for (const [index2, link] of (log.lineage?.repair_chain || []).entries()) {
      if (index2 === 0) assert.equal(link.parent_underlay_id, 'known-contaminated');
      else assert.equal(link.parent_underlay_id, log.lineage.repair_chain[index2 - 1].output_underlay_id, 'repair chain parent/child must connect');
      assert.match(link.provider_task_id || '', /^.+$/, 'repair must record the provider task id');
    }
  });

  test(`${id}: final underlay re-review passed with zero blocking issues`, () => {
    const critique = readJson(path.join(paths.workspace, 'screens', 'main', 'underlay-critique.json'));
    assert.equal(critique.result, 'passed');
    assert.equal(reviewGate(critique).blocking.length, 0);
    assert.equal(log.lineage?.final_underlay?.id, critique.source.underlay, 'lineage final underlay must match the approved critique');
  });

  test(`${id}: final PNG decodes and matches the manifest hash`, async () => {
    const metadata = await sharp(paths.finalPng).metadata();
    assert.ok(metadata.width >= 512 && metadata.height >= 512, 'final PNG must be a real composition');
    assert.equal(sha256(paths.finalPng), manifest.outputs.final_png.hash);
    assert.equal(manifest.outputs.fidelity.status, 'passed');
  });

  test(`${id}: component and font coverage satisfies the manifest requirements`, () => {
    const componentContract = readJson(path.join(paths.workspace, 'style', 'component-contract.json'));
    const families = (componentContract.families || []).map((family) => family.family_id || family.id);
    for (const family of manifest.required_component_families) assert.ok(families.includes(family), `missing component family ${family}`);
    const fontManifest = readJson(path.join(paths.workspace, 'style', 'font-manifest.json'));
    for (const role of manifest.required_font_roles) assert.ok(fontManifest.roles?.[role], `missing font role ${role}`);
    for (const coverage of manifest.font?.coverage || []) {
      for (const font of fontManifest.fonts || []) assert.ok(font.coverage?.[coverage], `font ${font.id} must cover ${coverage}`);
    }
  });
}

test('golden index status is derived consistently from sample states', () => {
  const states = sampleIds.map((id) => (fs.existsSync(samplePaths(id).log) ? readJson(samplePaths(id).log).status : 'missing'));
  const allPassed = states.every((state) => state === 'pipeline-passed');
  const anyFailed = states.some((state) => state === 'failed' || state === 'missing');
  const expected = allPassed ? (index.samples.every?.((entry) => entry.designer_signoff === 'approved') ? 'released' : 'pending-signoff') : anyFailed ? 'failed' : 'prepared';
  assert.equal(index.status, expected, `index status must be ${expected} for states ${states.join(',')}`);
});
