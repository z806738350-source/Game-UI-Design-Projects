const fs = require('node:fs');
const path = require('node:path');
const { loadKunpoConfig } = require('../electron/services/env.cjs');
const { requestArtifact, safeConfig } = require('../electron/services/kunpoClient.cjs');

async function main() {
  const projectRoot = path.join(__dirname, '..');
  const config = loadKunpoConfig(projectRoot);
  if (!config.configured) throw new Error('Kunpo is not configured.');
  const referenceIcon = path.resolve(projectRoot, '..', 'Game UI Forge', 'public', 'icon.png');
  const imagePaths = fs.existsSync(referenceIcon) ? [referenceIcon] : [];
  const artifact = await requestArtifact(config, {
    kind: 'screen-contract',
    id: 'smoke-screen-contract',
    source: { test: 'local-smoke' },
    imagePaths,
    prompt: `Return exactly one valid JSON object. Use these fields: schema_version "1.0", id "smoke-screen-contract", version 1, status "generated", source {}, screen_id "smoke", screen_name "Smoke Test", purpose "Verify the design pipeline model connection", primary_action "verify", secondary_actions [], required_information [], required_controls [], states [], edge_cases [], data_dependencies [], design_constraints {}. Do not add markdown.`
  });
  console.log(JSON.stringify({ ok: true, provider: safeConfig(config), artifact: { id: artifact.id, status: artifact.status, screen_id: artifact.screen_id }, multimodal: imagePaths.length > 0 }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }));
  process.exitCode = 1;
});
