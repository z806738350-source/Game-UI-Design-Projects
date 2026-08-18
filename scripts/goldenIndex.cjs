'use strict';

// Shared derivation for release-evidence/golden-samples/index.json. The
// fixture E2E gate replays exactly these rules, so prepare and the runner
// must write the index through the same code path.
const fs = require('node:fs/promises');
const path = require('node:path');

async function deriveSampleStates(goldenRoot, sampleIds) {
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
  const status = allPassed && allSigned ? 'released' : allPassed ? 'pending-signoff' : anyFailed ? 'failed' : 'prepared';
  return { samples, status };
}

module.exports = { deriveSampleStates };
