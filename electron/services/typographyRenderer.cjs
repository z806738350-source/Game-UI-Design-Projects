const sharp = require('sharp');
const { ERROR_CODES, FIDELITY_ISSUE_CODES } = require('./errorCodes.cjs');
const { inspectFont } = require('./typographyAssets.cjs');

function escapeMarkup(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]);
}

function finite(value, fallback, minimum = -Infinity, maximum = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function gradientSvg(width, height, gradient = {}) {
  const from = escapeMarkup(gradient.from || gradient.start || '#ffffff');
  const to = escapeMarkup(gradient.to || gradient.end || from);
  const angle = finite(gradient.angle, 0);
  const radians = angle * Math.PI / 180;
  const x = Math.cos(radians) * 50;
  const y = Math.sin(radians) * 50;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="${50 - x}%" y1="${50 - y}%" x2="${50 + x}%" y2="${50 + y}%"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
}

async function colorize(text, typography, width, height) {
  if (typography.gradient) {
    return sharp(gradientSvg(width, height, typography.gradient)).composite([{ input: text, blend: 'dest-in' }]).png().toBuffer();
  }
  return sharp({ create: { width, height, channels: 4, background: typography.fill || '#ffffff' } }).composite([{ input: text, blend: 'dest-in' }]).png().toBuffer();
}

async function coloredMask(mask, color, width, height) {
  return sharp({ create: { width, height, channels: 4, background: color } }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

async function alphaInkBounds(buffer, width, height) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = width; let top = height; let right = -1; let bottom = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (data[(y * width + x) * info.channels + 3] === 0) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left || bottom < top) return { left: 0, top: 0, width: 0, height: 0, touches_boundary: false };
  return { left, top, width: right - left + 1, height: bottom - top + 1, touches_boundary: left === 0 || top === 0 || right === width - 1 || bottom === height - 1 };
}

async function renderGlyphs(layer, target, fontfile, family) {
  const typography = layer.typography || {};
  const size = finite(typography.size, 24, 1, 512);
  const weight = Math.round(finite(typography.weight, 400, 100, 900));
  const letterSpacing = Math.round(finite(typography.letter_spacing ?? typography.letterSpacing, 0, -20, 100) * 1024);
  const lineHeight = finite(typography.line_height ?? typography.lineHeight, 1.2, 0.5, 5);
  const spacing = Math.round(Math.max(0, size * (lineHeight - 1)));
  const numericStyle = typography.numeric_style ?? typography.numericStyle;
  const tabular = numericStyle === 'tabular' || numericStyle?.tabular === true;
  const attributes = [`font_weight="${weight}"`];
  if (letterSpacing) attributes.push(`letter_spacing="${letterSpacing}"`);
  if (tabular) attributes.push('font_features="tnum"');
  const markup = `<span ${attributes.join(' ')}>${escapeMarkup(layer.content || '')}</span>`;
  const textOptions = {
    text: markup,
    font: `${family || 'sans-serif'} ${size}`,
    width: target.width,
    align: typography.align || 'center',
    justify: typography.align === 'justify',
    spacing,
    rgba: true
  };
  if (fontfile) textOptions.fontfile = fontfile;
  const result = await sharp({ text: textOptions }).png().toBuffer({ resolveWithObject: true });
  if (!result.info.width || !result.info.height) throw new Error(`Text layer ${layer.control_id || layer.font_role} produced no pixels.`);
  if (result.info.height > target.height) throw new Error(`Text layer ${layer.control_id || layer.font_role} exceeds its target height.`);
  const fill = await colorize(result.data, typography, result.info.width, result.info.height);
  const stroke = typography.stroke || {};
  const strokeWidth = Math.round(finite(stroke.width, 0, 0, 64));
  let glyphs = fill;
  if (strokeWidth > 0) {
    const outlineMask = await sharp(result.data).dilate(strokeWidth).png().toBuffer();
    const outline = await coloredMask(outlineMask, stroke.color || '#000000', result.info.width, result.info.height);
    glyphs = await sharp({ create: { width: result.info.width, height: result.info.height, channels: 4, background: '#00000000' } }).composite([{ input: outline }, { input: fill }]).png().toBuffer();
  }
  const baselineOffset = Math.round(finite(typography.baseline_offset ?? typography.baselineOffset, 0, -target.height, target.height));
  const left = Math.max(0, Math.round((target.width - result.info.width) / 2));
  const top = Math.max(0, Math.round((target.height - result.info.height) / 2 + baselineOffset));
  const overlays = [];
  const shadow = typography.shadow || {};
  if (shadow.enabled !== false && (shadow.color || shadow.blur || shadow.offset_x || shadow.offset_y)) {
    const blur = finite(shadow.blur, 0, 0, 64);
    let shadowInput = sharp(await coloredMask(result.data, shadow.color || '#000000', result.info.width, result.info.height));
    if (blur > 0.3) shadowInput = shadowInput.blur(blur);
    overlays.push({
      input: await shadowInput.png().toBuffer(),
      left: Math.max(0, Math.min(target.width - result.info.width, left + Math.round(finite(shadow.offset_x ?? shadow.offsetX, 0)))),
      top: Math.max(0, Math.min(target.height - result.info.height, top + Math.round(finite(shadow.offset_y ?? shadow.offsetY, 0))))
    });
  }
  overlays.push({ input: glyphs, left, top });
  const input = await sharp({ create: { width: target.width, height: target.height, channels: 4, background: '#00000000' } }).composite(overlays).png().toBuffer();
  return {
    input,
    ink_bounds: await alphaInkBounds(input, target.width, target.height),
    effects: { size, weight, letter_spacing: letterSpacing / 1024, line_height: lineHeight, stroke_width: strokeWidth, gradient: Boolean(typography.gradient), shadow: overlays.length > 1, baseline_offset: baselineOffset, numeric_style: tabular ? 'tabular' : 'proportional' }
  };
}

async function renderTextLayer({ projectPath, layer, target, resolveProjectPath, hashBuffer }) {
  const final = layer.composition_mode === 'final';
  let fontfile;
  let inspected;
  let error;
  try {
    if (!layer.font_path) throw new Error('font_path is missing');
    fontfile = resolveProjectPath(projectPath, layer.font_path);
    inspected = await inspectFont(fontfile);
    if (inspected.file_hash !== layer.font_hash) throw Object.assign(new Error('Font asset hash changed.'), { code: ERROR_CODES.FONT_ASSET_HASH_MISMATCH });
    if (!inspected.family_name || !inspected.postscript_name) throw new Error('Font identity could not be parsed.');
    if (layer.font_family && layer.font_family !== inspected.family_name) throw new Error(`Font family changed from ${layer.font_family} to ${inspected.family_name}.`);
    if (layer.postscript_name && layer.postscript_name !== inspected.postscript_name) throw new Error(`Font PostScript identity changed from ${layer.postscript_name} to ${inspected.postscript_name}.`);
    if (final && (layer.font_license_status !== 'confirmed' || layer.font_license_confirmation?.confirmed !== true)) throw new Error('Font license has no explicit confirmation evidence.');
    if (final && (layer.fidelity_mode !== 'exact' || layer.exact_confirmation?.confirmed !== true)) throw new Error('Exact font usage has no explicit confirmation evidence.');
    const rendered = await renderGlyphs(layer, target, fontfile, inspected.family_name);
    return {
      input: rendered.input,
      diagnostic: {
        control_id: layer.control_id, font_role: layer.font_role, renderer: 'sharp-pango-fontfile', target_rect: target,
        requested_font: layer.font_family, actual_font_verified: true, actual_loaded_family: inspected.family_name,
        actual_postscript_name: inspected.postscript_name, font_hash: inspected.file_hash, effects: rendered.effects, ink_bounds: rendered.ink_bounds, text_overflow: rendered.ink_bounds.touches_boundary
      }
    };
  } catch (caught) {
    error = caught;
  }
  if (final) throw Object.assign(new Error(`Exact font failed to load for ${layer.font_role}: ${error.message}`), { code: ERROR_CODES.FONT_ACTUAL_LOAD_FAILED, cause_code: error.code, cause: error });
  const rendered = await renderGlyphs(layer, target, undefined, 'sans-serif');
  return {
    input: rendered.input,
    diagnostic: { control_id: layer.control_id, font_role: layer.font_role, renderer: 'sharp-pango-preview-fallback', target_rect: target, requested_font: layer.font_family || layer.font_path, actual_font_verified: false, fallback_reason: error.message, effects: rendered.effects, ink_bounds: rendered.ink_bounds, text_overflow: rendered.ink_bounds.touches_boundary }
  };
}

module.exports = { renderTextLayer };
