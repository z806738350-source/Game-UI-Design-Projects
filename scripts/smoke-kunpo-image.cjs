const fs = require('node:fs');
const path = require('node:path');
const { loadKunpoConfig } = require('../electron/services/env.cjs');
const { generateImage, safeConfig } = require('../electron/services/kunpoClient.cjs');

async function main() {
  const projectRoot = path.join(__dirname, '..');
  const config = loadKunpoConfig(projectRoot);
  if (!config.configured) throw new Error('Kunpo is not configured.');
  const referenceIcon = path.resolve(projectRoot, '..', 'Game UI Forge', 'public', 'icon.png');
  const imagePaths = fs.existsSync(referenceIcon) ? [referenceIcon] : [];
  const result = await generateImage(config, {
    model: config.imageModel,
    size: '1024x1024',
    imagePaths,
    prompt: 'Create a clean square game UI design-tool welcome panel inspired by the reference icon. Teal and deep slate color system, professional desktop creative software, one central project card, restrained lighting, crisp interface details, no brand names, no watermark.'
  });
  const url = new URL(result.url);
  console.log(JSON.stringify({
    ok: true,
    provider: safeConfig(config),
    taskId: result.task_id,
    resultHost: url.host,
    resultPath: url.pathname,
    trustedPermanentCdn: result.trustedPermanentCdn
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }));
  process.exitCode = 1;
});
