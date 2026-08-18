// One-shot helper: generates the privacy-safe two-panel source boards for the
// reserved validation samples (jade-shop-zh, frontier-campaign) via the real
// provider and stores them under release-evidence/golden-samples/_sources/.
// The boards stay out of Git; only derived inputs and evidence are tracked.

const fs = require('node:fs/promises');
const path = require('node:path');
const { loadKunpoConfig } = require('../electron/services/env.cjs');
const kunpoClient = require('../electron/services/kunpoClient.cjs');

const root = path.resolve(__dirname, '..');
const sourcesRoot = path.join(root, 'release-evidence', 'golden-samples', '_sources');

const boards = [
  {
    id: 'jade-shop-zh',
    prompt: 'Privacy-safe original game UI source board: two equal panels side by side, left panel a polished Chinese-language fantasy game shop and gift screen with Simplified Chinese labels, gold and jade palette, at least ten controls; right panel the matching UI-free jade pavilion courtyard environment with calm stone walls and floor, no text, no buttons, no UI. No brand, franchise, watermark, or real person.'
  },
  {
    id: 'frontier-campaign',
    prompt: 'Privacy-safe original game UI source board: two equal panels side by side, left panel a strategy game campaign map screen with mission list, resource counters and buttons in muted bronze and slate palette; right panel the matching UI-free dusk frontier landscape with calm open terrain and low detail, no text, no buttons, no UI. No brand, franchise, watermark, or real person.'
  }
];

async function main() {
  const config = loadKunpoConfig(root);
  if (!config.configured) throw new Error('Kunpo is not configured.');
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const selected = requested.length ? boards.filter((board) => requested.includes(board.id)) : boards;
  if (!selected.length) throw new Error(`Unknown board ids: ${requested.join(', ')}`);
  await fs.mkdir(sourcesRoot, { recursive: true });
  for (const board of selected) {
    const result = await kunpoClient.generateImage(config, { prompt: board.prompt, size: '1536x864' });
    const response = await fetch(result.url);
    if (!response.ok) throw new Error(`Failed to download board for ${board.id}: HTTP ${response.status}`);
    const target = path.join(sourcesRoot, `${board.id}-board.png`);
    await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
    process.stdout.write(`${board.id}: saved ${target} (task ${result.task_id})\n`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
