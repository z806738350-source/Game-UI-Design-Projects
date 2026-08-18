const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

// SVG rasterization (Chinese contamination overlays) needs fontconfig to see
// system CJK fonts; mirror the bootstrap used by the golden E2E runner.
const fontconfigRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'game-ui-golden-fontconfig-'));
fsSync.mkdirSync(path.join(fontconfigRoot, 'cache'), { recursive: true });
fsSync.writeFileSync(path.join(fontconfigRoot, 'fonts.conf'), `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>/System/Library/Fonts</dir><dir>/Library/Fonts</dir><cachedir>${path.join(fontconfigRoot, 'cache')}</cachedir></fontconfig>`);
process.env.FONTCONFIG_FILE = path.join(fontconfigRoot, 'fonts.conf');
process.env.XDG_CACHE_HOME = path.join(fontconfigRoot, 'cache');
process.once('exit', () => fsSync.rmSync(fontconfigRoot, { recursive: true, force: true }));

const root = path.resolve(__dirname, '..');
const evidenceRoot = path.join(root, 'release-evidence', 'golden-samples');
const canvas = 1024;

const samples = [
  {
    id: 'functional-dense',
    board: 'functional-dense-board.png',
    clean: { left: 836, top: 0, width: 836, height: 941 },
    references: [
      { left: 0, top: 0, width: 836, height: 941 },
      { left: 0, top: 0, width: 836, height: 760 },
      { left: 0, top: 181, width: 836, height: 760 }
    ],
    accent: '#49d7d0', surface: '#173b46', glow: '#b4fff7', contamination: 'dense',
    font: { id: 'oxanium', path: 'release-evidence/golden-samples/_shared/fonts/Oxanium-wght.ttf', license_path: 'release-evidence/golden-samples/_shared/fonts/OFL.txt', license: 'Google Fonts / SIL OFL 1.1', coverage: ['latin'] }
  },
  {
    id: 'visual-hero',
    board: 'visual-hero-board.png',
    clean: { left: 836, top: 0, width: 836, height: 941 },
    references: [
      { left: 0, top: 0, width: 836, height: 941 },
      { left: 0, top: 0, width: 836, height: 760 },
      { left: 0, top: 181, width: 836, height: 760 }
    ],
    accent: '#e2bd78', surface: '#27223c', glow: '#fff0ba', contamination: 'hero',
    font: { id: 'oxanium', path: 'release-evidence/golden-samples/_shared/fonts/Oxanium-wght.ttf', license_path: 'release-evidence/golden-samples/_shared/fonts/OFL.txt', license: 'Google Fonts / SIL OFL 1.1', coverage: ['latin'] }
  },
  {
    id: 'existing-continuation',
    board: 'existing-continuation-board.png',
    clean: { left: 768, top: 512, width: 768, height: 512 },
    references: [
      { left: 0, top: 0, width: 768, height: 512 },
      { left: 768, top: 0, width: 768, height: 512 },
      { left: 0, top: 512, width: 768, height: 512 }
    ],
    accent: '#d6b05f', surface: '#153f3b', glow: '#fff0a8', contamination: 'continuation',
    font: { id: 'oxanium', path: 'release-evidence/golden-samples/_shared/fonts/Oxanium-wght.ttf', license_path: 'release-evidence/golden-samples/_shared/fonts/OFL.txt', license: 'Google Fonts / SIL OFL 1.1', coverage: ['latin'] }
  },
  {
    // Reserved validation sample (never used for threshold calibration).
    // Exercises the full pipeline with Simplified Chinese copy and a CJK font.
    id: 'jade-shop-zh',
    board: 'jade-shop-zh-board.png',
    clean: { left: 768, top: 0, width: 768, height: 864 },
    references: [
      { left: 0, top: 0, width: 768, height: 864 },
      { left: 0, top: 0, width: 768, height: 700 },
      { left: 0, top: 164, width: 768, height: 700 }
    ],
    accent: '#d9b45c', surface: '#173a33', glow: '#ffe9a8', contamination: 'zh-shop',
    font: { id: 'noto-sans-sc', path: 'release-evidence/golden-samples/_shared/fonts/NotoSansSC-wght.ttf', license_path: 'release-evidence/golden-samples/_shared/fonts/OFL-NotoSansSC.txt', license: 'SIL OFL 1.1 (Noto Sans SC)', coverage: ['zh_cn'] }
  },
  {
    // Reserved validation sample (never used for threshold calibration).
    id: 'frontier-campaign',
    board: 'frontier-campaign-board.png',
    clean: { left: 768, top: 0, width: 768, height: 864 },
    references: [
      { left: 0, top: 0, width: 768, height: 864 },
      { left: 0, top: 0, width: 768, height: 700 },
      { left: 0, top: 164, width: 768, height: 700 }
    ],
    accent: '#b08a5a', surface: '#232a33', glow: '#ffd9a0', contamination: 'campaign',
    font: { id: 'oxanium', path: 'release-evidence/golden-samples/_shared/fonts/Oxanium-wght.ttf', license_path: 'release-evidence/golden-samples/_shared/fonts/OFL.txt', license: 'Google Fonts / SIL OFL 1.1', coverage: ['latin'] }
  }
];

const sourcePrompts = {
  'functional-dense': 'Privacy-safe original game UI source board: two panels; a polished fantasy inventory/growth screen with at least ten controls, and a matching UI-free workshop environment. No brand, franchise, watermark, or real person.',
  'visual-hero': 'Privacy-safe original game UI source board: two panels; a premium sci-fantasy moonlit heroine event/gacha screen, and a matching UI-free celestial observatory environment. No brand, franchise, watermark, or real person.',
  'existing-continuation': 'Privacy-safe original strict-continuation source board: a 2x2 contact sheet containing party formation, inventory, and character growth screens that share one jade/bronze component system, plus a UI-free jade palace underlay. No brand, franchise, watermark, or real person.',
  'jade-shop-zh': 'Privacy-safe original game UI source board: two equal panels; left a polished Chinese-language fantasy game shop and gift screen with Simplified Chinese labels and at least ten controls, right the matching UI-free jade pavilion courtyard. No brand, franchise, watermark, or real person.',
  'frontier-campaign': 'Privacy-safe original game UI source board: two equal panels; left a strategy game campaign map screen with mission list, resources, and buttons, right the matching UI-free dusk frontier landscape. No brand, franchise, watermark, or real person.'
};

const families = [
  { id: 'primary-button', category: 'button', width: 180, height: 64, states: ['default', 'pressed', 'disabled'], textPolicy: 'text-slot' },
  { id: 'bottom-navigation', category: 'navigation', width: 180, height: 64, states: ['default', 'selected', 'disabled'], textPolicy: 'none' },
  { id: 'section-tab', category: 'tab', width: 180, height: 64, states: ['default', 'selected', 'disabled'], textPolicy: 'text-slot' },
  { id: 'resource-bar', category: 'resource-bar', width: 220, height: 48, states: ['default'], textPolicy: 'text-slot' },
  { id: 'content-panel', category: 'panel', width: 256, height: 128, states: ['default'], textPolicy: 'text-slot' },
  { id: 'action-icon', category: 'icon', width: 64, height: 64, states: ['default'], textPolicy: 'none' },
  { id: 'status-badge', category: 'badge', width: 96, height: 40, states: ['default'], textPolicy: 'text-slot' },
  { id: 'list-row', category: 'list-row', width: 280, height: 56, states: ['default'], textPolicy: 'text-slot' }
];

const defaultSlots = [
  ['primary-action', 'primary-button', 804, 904, 180, 64],
  ['navigation', 'bottom-navigation', 40, 904, 180, 64],
  ['tab', 'section-tab', 244, 904, 180, 64],
  ['resources', 'resource-bar', 764, 40, 220, 48],
  // Left-column controls moved onto the calm mid-wall/floor band after real
  // underlay critique showed the stained-glass windows exceed noise budgets.
  ['content', 'content-panel', 307, 40, 256, 128],
  ['icon-a', 'action-icon', 450, 200, 64, 64],
  ['badge', 'status-badge', 530, 212, 96, 40],
  ['row', 'list-row', 307, 480, 280, 56],
  ['secondary-action', 'primary-button', 344, 316, 180, 64],
  ['icon-b', 'action-icon', 548, 316, 64, 64]
];

const visualHeroSlots = [
  // Re-picked on the calm regions shared by the clean input and the captured
  // repair output after real critique flagged the old content slot (color 0.54).
  ['primary-action', 'primary-button', 360, 328, 180, 64],
  ['navigation', 'bottom-navigation', 184, 88, 180, 64],
  ['tab', 'section-tab', 712, 808, 180, 64],
  ['resources', 'resource-bar', 648, 472, 220, 48],
  ['content', 'content-panel', 632, 328, 256, 128],
  ['icon-a', 'action-icon', 824, 232, 64, 64],
  ['badge', 'status-badge', 808, 56, 96, 40],
  ['row', 'list-row', 328, 456, 280, 56],
  ['secondary-action', 'primary-button', 40, 952, 180, 64],
  ['icon-b', 'action-icon', 712, 88, 64, 64]
];

// Reserved samples: slots picked on the calmest regions of each clean
// underlay via underlay-metrics-v1 (worst slot score 0.69 / 0.10).
const existingContinuationSlots = [
  // Re-picked on the calm regions shared by the clean input and the captured
  // repair output of this sample's own board (max slot score 0.32).
  ['primary-action', 'primary-button', 824, 56, 180, 64],
  ['navigation', 'bottom-navigation', 552, 312, 180, 64],
  ['tab', 'section-tab', 280, 328, 180, 64],
  ['resources', 'resource-bar', 8, 872, 220, 48],
  ['content', 'content-panel', 232, 40, 256, 128],
  ['icon-a', 'action-icon', 152, 72, 64, 64],
  ['badge', 'status-badge', 520, 248, 96, 40],
  ['row', 'list-row', 152, 952, 280, 56],
  ['secondary-action', 'primary-button', 328, 872, 180, 64],
  ['icon-b', 'action-icon', 216, 216, 64, 64]
];

const jadeShopZhSlots = [
  ['primary-action', 'primary-button', 120, 920, 180, 64],
  ['navigation', 'bottom-navigation', 88, 424, 180, 64],
  ['tab', 'section-tab', 728, 8, 180, 64],
  ['resources', 'resource-bar', 344, 24, 220, 48],
  ['content', 'content-panel', 728, 808, 256, 128],
  ['icon-a', 'action-icon', 488, 152, 64, 64],
  ['badge', 'status-badge', 632, 968, 96, 40],
  ['row', 'list-row', 328, 888, 280, 56],
  ['secondary-action', 'primary-button', 504, 792, 180, 64],
  ['icon-b', 'action-icon', 216, 840, 64, 64]
];

const frontierCampaignSlots = [
  ['primary-action', 'primary-button', 8, 200, 180, 64],
  ['navigation', 'bottom-navigation', 488, 8, 180, 64],
  ['tab', 'section-tab', 824, 88, 180, 64],
  ['resources', 'resource-bar', 392, 200, 220, 48],
  ['content', 'content-panel', 56, 40, 256, 128],
  ['icon-a', 'action-icon', 200, 184, 64, 64],
  ['badge', 'status-badge', 344, 8, 96, 40],
  ['row', 'list-row', 680, 8, 280, 56],
  ['secondary-action', 'primary-button', 40, 952, 180, 64],
  ['icon-b', 'action-icon', 936, 232, 64, 64]
];

function slotsFor(sample) {
  if (sample.id === 'visual-hero') return visualHeroSlots;
  if (sample.id === 'existing-continuation') return existingContinuationSlots;
  if (sample.id === 'jade-shop-zh') return jadeShopZhSlots;
  if (sample.id === 'frontier-campaign') return frontierCampaignSlots;
  return defaultSlots;
}

function svgEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function componentSvg(sample, family, state) {
  const disabled = state === 'disabled';
  const active = state === 'pressed' || state === 'selected';
  const opacity = disabled ? 0.35 : 1;
  const fill = active ? sample.accent : sample.surface;
  const stroke = disabled ? '#7b8490' : sample.accent;
  const { width, height, id } = family;
  const radius = Math.min(14, height / 4);
  const ornament = family.category === 'icon'
    ? `<path d="M${width / 2} 13 L${width - 13} ${height / 2} L${width / 2} ${height - 13} L13 ${height / 2} Z" fill="none" stroke="${sample.glow}" stroke-width="3"/>`
    : `<path d="M12 ${height / 2} H${width - 12}" stroke="${sample.glow}" stroke-opacity=".45"/><circle cx="16" cy="${height / 2}" r="3" fill="${sample.glow}"/><circle cx="${width - 16}" cy="${height / 2}" r="3" fill="${sample.glow}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><filter id="g"><feGaussianBlur stdDeviation="3"/></filter></defs>
    <g opacity="${opacity}">
      <rect x="3" y="3" width="${width - 6}" height="${height - 6}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
      <rect x="7" y="7" width="${width - 14}" height="${height - 14}" rx="${Math.max(2, radius - 4)}" fill="none" stroke="${sample.glow}" stroke-opacity=".28"/>
      ${ornament}
    </g>
    <title>${svgEscape(id)} ${svgEscape(state)}</title>
  </svg>`;
}

function wireframeSvg(sample) {
  const rects = slotsFor(sample).map(([id, , x, y, width, height], index) => `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="#26313d" stroke="${sample.accent}" stroke-width="2"/>
    <text x="${x + 9}" y="${y + Math.min(height - 10, 25)}" fill="#f5f7fa" font-family="Arial,sans-serif" font-size="14">${index + 1}. ${svgEscape(id)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <rect width="1024" height="1024" fill="#111820"/>
    <rect x="24" y="24" width="976" height="976" rx="24" fill="none" stroke="#586675" stroke-width="2" stroke-dasharray="8 8"/>
    <text x="40" y="420" fill="#8d9baa" font-family="Arial,sans-serif" font-size="30">${svgEscape(sample.id)} functional wireframe</text>
    <text x="40" y="460" fill="#607080" font-family="Arial,sans-serif" font-size="18">1024 × 1024 · ten required controls</text>
    ${rects}
  </svg>`;
}

function contaminationSvg(sample) {
  const common = `<style>.t{font-family:'PingFang SC',Arial,sans-serif;font-weight:700;fill:${sample.glow}}</style>`;
  if (sample.contamination === 'dense') return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${common}
    <g><rect x="34" y="28" width="280" height="390" rx="16" fill="#071419" fill-opacity=".92" stroke="${sample.accent}" stroke-width="5"/>
    <text class="t" x="60" y="85" font-size="32">INVENTORY 9999</text>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="58" y="${112 + i * 52}" width="230" height="38" rx="8" fill="${sample.surface}" stroke="${sample.glow}" stroke-width="2"/><text class="t" x="72" y="${138 + i * 52}" font-size="18">ITEM ${i + 1} × ${12 + i}</text>`).join('')}
    <rect x="760" y="32" width="224" height="60" rx="10" fill="#061419" stroke="${sample.accent}" stroke-width="4"/><text class="t" x="785" y="72" font-size="25">GOLD 88,880</text></g></svg>`;
  if (sample.contamination === 'hero') return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${common}
    <g><rect x="335" y="115" width="354" height="668" rx="24" fill="#171125" fill-opacity=".92" stroke="${sample.accent}" stroke-width="7"/>
    <circle cx="512" cy="320" r="118" fill="#55447a" stroke="${sample.glow}" stroke-width="5"/>
    <path d="M420 700 L512 410 L604 700 Z" fill="#8f7ab4" stroke="${sample.glow}" stroke-width="5"/>
    <text class="t" x="397" y="758" font-size="34">LIMITED HERO</text>
    <rect x="804" y="900" width="180" height="64" rx="12" fill="${sample.surface}" stroke="${sample.glow}" stroke-width="5"/><text class="t" x="838" y="942" font-size="26">DRAW ×10</text></g></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${common}
    <g><rect x="24" y="886" width="976" height="104" rx="18" fill="#092b29" fill-opacity=".96" stroke="${sample.accent}" stroke-width="6"/>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="${48 + i * 185}" y="906" width="160" height="64" rx="12" fill="${i === 2 ? sample.accent : sample.surface}" stroke="${sample.glow}" stroke-width="3"/><text class="t" x="${72 + i * 185}" y="946" font-size="22">MENU ${i + 1}</text>`).join('')}
    <rect x="32" y="32" width="276" height="144" rx="16" fill="#092b29" fill-opacity=".95" stroke="${sample.accent}" stroke-width="5"/><text class="t" x="58" y="92" font-size="28">POWER 999,999</text><text class="t" x="58" y="136" font-size="22">LV. MAX</text></g></svg>`;
}

function reservedContaminationSvg(sample) {
  const common = `<style>.t{font-family:'PingFang SC',Arial,sans-serif;font-weight:700;fill:${sample.glow}}</style>`;
  if (sample.contamination === 'zh-shop') return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${common}
    <g><rect x="34" y="28" width="300" height="400" rx="16" fill="#0d1f1a" fill-opacity=".93" stroke="${sample.accent}" stroke-width="5"/>
    <text class="t" x="60" y="90" font-size="34">今日特惠</text>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="58" y="${118 + i * 56}" width="246" height="42" rx="8" fill="${sample.surface}" stroke="${sample.glow}" stroke-width="2"/><text class="t" x="72" y="${146 + i * 56}" font-size="19">限时礼包 ¥${68 + i * 30} ×${i + 1}</text>`).join('')}
    <rect x="736" y="32" width="252" height="60" rx="10" fill="#0d1f1a" stroke="${sample.accent}" stroke-width="4"/><text class="t" x="760" y="72" font-size="25">金币 88,880</text>
    <rect x="700" y="880" width="280" height="72" rx="12" fill="${sample.surface}" stroke="${sample.glow}" stroke-width="5"/><text class="t" x="742" y="926" font-size="28">立即购买 -25%</text></g></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${common}
    <g><rect x="34" y="28" width="300" height="380" rx="16" fill="#101720" fill-opacity=".93" stroke="${sample.accent}" stroke-width="5"/>
    <text class="t" x="60" y="88" font-size="30">MISSIONS 12/20</text>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="58" y="${114 + i * 54}" width="246" height="40" rx="8" fill="${sample.surface}" stroke="${sample.glow}" stroke-width="2"/><text class="t" x="72" y="${141 + i * 54}" font-size="18">OUTPOST 0${i + 1} · ${40 + i * 12}%</text>`).join('')}
    <rect x="736" y="32" width="252" height="60" rx="10" fill="#101720" stroke="${sample.accent}" stroke-width="4"/><text class="t" x="760" y="72" font-size="25">SUPPLY 12,480</text>
    <rect x="700" y="880" width="280" height="72" rx="12" fill="${sample.surface}" stroke="${sample.glow}" stroke-width="5"/><text class="t" x="770" y="926" font-size="28">DEPLOY</text></g></svg>`;
}

async function sha256(filePath) {
  return `sha256:${crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex')}`;
}

async function writePng(filePath, input) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await sharp(input).png().toFile(filePath);
  return { path: path.relative(root, filePath), hash: await sha256(filePath) };
}

async function cropBoard(boardPath, crop, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(boardPath).extract(crop).resize(canvas, canvas, { fit: 'cover', position: 'centre' }).png().toFile(outputPath);
  return { path: path.relative(root, outputPath), hash: await sha256(outputPath) };
}

async function prepareSample(sample) {
  const boardPath = path.join(evidenceRoot, '_sources', sample.board);
  const sampleRoot = path.join(evidenceRoot, sample.id);
  // Only regenerate the reproducible inputs; published evidence (evidence/,
  // attempts/, final.png) and designer sign-off records must survive re-prep.
  const previousManifest = await fs.readFile(path.join(sampleRoot, 'asset-manifest.json'), 'utf8')
    .then((raw) => JSON.parse(raw), () => null);
  await fs.rm(path.join(sampleRoot, 'inputs'), { recursive: true, force: true });
  await fs.rm(path.join(sampleRoot, 'asset-manifest.json'), { force: true });
  await fs.mkdir(path.join(sampleRoot, 'inputs', 'references'), { recursive: true });
  const references = [];
  for (const [index, crop] of sample.references.entries()) {
    references.push(await cropBoard(boardPath, crop, path.join(sampleRoot, 'inputs', 'references', `reference-${index + 1}.png`)));
  }
  const clean = await cropBoard(boardPath, sample.clean, path.join(sampleRoot, 'inputs', 'clean-underlay.png'));
  const wireframe = await writePng(path.join(sampleRoot, 'inputs', 'wireframe.png'), Buffer.from(wireframeSvg(sample)));
  const badPath = path.join(sampleRoot, 'inputs', 'known-contaminated-underlay.png');
  const overlaySvg = ['zh-shop', 'campaign'].includes(sample.contamination) ? reservedContaminationSvg(sample) : contaminationSvg(sample);
  await sharp(path.join(sampleRoot, 'inputs', 'clean-underlay.png')).composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }]).png().toFile(badPath);
  const contaminated = { path: path.relative(root, badPath), hash: await sha256(badPath) };
  const componentAssets = [];
  for (const family of families) {
    for (const state of family.states) {
      const target = path.join(sampleRoot, 'inputs', 'components', family.id, `${state}.png`);
      const written = await writePng(target, Buffer.from(componentSvg(sample, family, state)));
      componentAssets.push({ family_id: family.id, category: family.category, state, width: family.width, height: family.height, text_policy: family.textPolicy, ...written });
    }
  }
  const layoutSeed = {
    schema_version: '2.0', canvas: [canvas, canvas],
    slots: slotsFor(sample).map(([id, componentId, x, y, width, height], index) => ({
      id: `slot-${id}`, control_id: id, component_id: componentId,
      rect: { x: x / canvas, y: y / canvas, width: width / canvas, height: height / canvas },
      anchor: 'top-left', resize_mode: 'exact', z_index: 20 + index,
      underlay_policy: { keep_clear: true, preferred_treatment: 'low-detail', detail_level: 'low', contrast_role: 'surface-behind-ui', visual_noise_budget: 0.18 }
    }))
  };
  await fs.writeFile(path.join(sampleRoot, 'inputs', 'layout-seed.json'), `${JSON.stringify(layoutSeed, null, 2)}\n`);
  const board = { path: path.relative(root, boardPath), hash: await sha256(boardPath) };
  const manifest = {
    schema_version: '1.0', id: sample.id, status: 'prepared', canvas: [canvas, canvas],
    provenance: {
      source_board: board, source_prompt: sourcePrompts[sample.id],
      generation_mode: 'OpenAI built-in image generation', privacy: 'original synthetic artwork; no personal data, real person, franchise, logo, or watermark requested',
      prepared_by: 'scripts/prepare-real-golden-assets.cjs'
    },
    inputs: { references, clean_underlay: clean, wireframe, known_contaminated_underlay: contaminated, components: componentAssets },
    font: { id: sample.font.id, path: sample.font.path, license_path: sample.font.license_path, license: sample.font.license, coverage: sample.font.coverage },
    required_font_roles: ['display', 'body', 'numeric', 'button-label'],
    required_component_families: families.map((family) => family.id),
    acceptance: { provider_e2e: 'pending', designer_signoff: 'pending', formal_release: 'blocked-until-signoff' }
  };
  // A re-prepare must never drop the published run outputs recorded by the
  // previous successful E2E export.
  if (previousManifest?.outputs) manifest.outputs = previousManifest.outputs;
  if (previousManifest?.last_run) manifest.last_run = previousManifest.last_run;
  if (previousManifest?.layout_revision) manifest.layout_revision = previousManifest.layout_revision;
  await fs.writeFile(path.join(sampleRoot, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const signoffPath = path.join(sampleRoot, 'designer-signoff.md');
  const signoffExists = await fs.access(signoffPath).then(() => true, () => false);
  if (!signoffExists) await fs.writeFile(signoffPath, `# ${sample.id} UI designer sign-off\n\nStatus: PENDING\n\n| Criterion | Score (1–5) | Notes |\n| --- | ---: | --- |\n| Component fidelity |  |  |\n| Typography fidelity |  |  |\n| Underlay cleanliness |  |  |\n| Overall quality |  |  |\n\nRequired: every score ≥ 4, no unresolved blocker/critical/major issue, signer name, and date.\n\nSigner:  \nDate:  \nDecision: PENDING\n`);
  return manifest;
}

async function main() {
  const fontPath = path.join(evidenceRoot, '_shared', 'fonts', 'Oxanium-wght.ttf');
  const licensePath = path.join(evidenceRoot, '_shared', 'fonts', 'OFL.txt');
  await fs.access(fontPath); await fs.access(licensePath);
  const sampleFlag = process.argv.indexOf('--sample');
  const selected = sampleFlag >= 0 ? samples.filter((sample) => sample.id === process.argv[sampleFlag + 1]) : samples;
  if (!selected.length) throw new Error(`Unknown sample: ${process.argv[sampleFlag + 1] || '<missing>'}`);
  if (process.argv.includes('--layout-only')) {
    for (const sample of selected) {
      const sampleRoot = path.join(evidenceRoot, sample.id);
      const wireframe = await writePng(path.join(sampleRoot, 'inputs', 'wireframe.png'), Buffer.from(wireframeSvg(sample)));
      const layoutSeed = {
        schema_version: '2.0', canvas: [canvas, canvas],
        slots: slotsFor(sample).map(([id, componentId, x, y, width, height], index) => ({
          id: `slot-${id}`, control_id: id, component_id: componentId,
          rect: { x: x / canvas, y: y / canvas, width: width / canvas, height: height / canvas },
          anchor: 'top-left', resize_mode: 'exact', z_index: 20 + index,
          underlay_policy: { keep_clear: true, preferred_treatment: 'low-detail', detail_level: 'low', contrast_role: 'surface-behind-ui', visual_noise_budget: 0.18 }
        }))
      };
      await fs.writeFile(path.join(sampleRoot, 'inputs', 'layout-seed.json'), `${JSON.stringify(layoutSeed, null, 2)}\n`);
      const manifestPath = path.join(sampleRoot, 'asset-manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      manifest.inputs.wireframe = wireframe;
      manifest.layout_revision = { reason: `${sample.id}: move controls out of high-contrast background regions flagged by real underlay critique.`, prepared_by: 'scripts/prepare-real-golden-assets.cjs --layout-only' };
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify({ status: 'layout-updated', samples: selected.map((sample) => sample.id) }, null, 2)}\n`);
    return;
  }
  const prepared = [];
  for (const sample of selected) prepared.push(await prepareSample(sample));
  const indexPath = path.join(evidenceRoot, 'index.json');
  const previous = await fs.readFile(indexPath, 'utf8').then((text) => JSON.parse(text), () => null);
  const mergedIds = [...new Set([...(previous?.samples || []).map((item) => item.id || item), ...prepared.map((sample) => sample.id)])];
  const index = {
    schema_version: '1.0', status: 'prepared', samples: mergedIds,
    shared_font: { path: path.relative(root, fontPath), hash: await sha256(fontPath), license_path: path.relative(root, licensePath), license_hash: await sha256(licensePath) },
    zh_font: { path: 'release-evidence/golden-samples/_shared/fonts/NotoSansSC-wght.ttf', hash: await sha256(path.join(evidenceRoot, '_shared', 'fonts', 'NotoSansSC-wght.ttf')), license_path: 'release-evidence/golden-samples/_shared/fonts/OFL-NotoSansSC.txt', license_hash: await sha256(path.join(evidenceRoot, '_shared', 'fonts', 'OFL-NotoSansSC.txt')) }
  };
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
