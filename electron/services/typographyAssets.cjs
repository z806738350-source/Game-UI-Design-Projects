const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ensureDir } = require('./jsonStore.cjs');

function decodeName(buffer, platformId) {
  if (platformId === 0 || platformId === 3) {
    let result = '';
    for (let index = 0; index + 1 < buffer.length; index += 2) result += String.fromCharCode(buffer.readUInt16BE(index));
    return result.replace(/\0/g, '').trim();
  }
  return buffer.toString('latin1').replace(/\0/g, '').trim();
}

function fontTables(buffer) {
  if (buffer.length < 12) throw new Error('Font file is incomplete.');
  const count = buffer.readUInt16BE(4);
  const tables = {};
  for (let index = 0; index < count; index += 1) {
    const offset = 12 + index * 16;
    if (offset + 16 > buffer.length) break;
    const tag = buffer.toString('ascii', offset, offset + 4);
    const start = buffer.readUInt32BE(offset + 8);
    const length = buffer.readUInt32BE(offset + 12);
    if (start + length <= buffer.length) tables[tag] = { start, length };
  }
  return tables;
}

function parseNames(buffer, table) {
  if (!table || table.start + 6 > buffer.length) return {};
  const count = buffer.readUInt16BE(table.start + 2);
  const strings = table.start + buffer.readUInt16BE(table.start + 4);
  const values = {};
  for (let index = 0; index < count; index += 1) {
    const record = table.start + 6 + index * 12;
    if (record + 12 > buffer.length) break;
    const platform = buffer.readUInt16BE(record);
    const language = buffer.readUInt16BE(record + 4);
    const nameId = buffer.readUInt16BE(record + 6);
    const length = buffer.readUInt16BE(record + 8);
    const offset = strings + buffer.readUInt16BE(record + 10);
    if (![1, 6].includes(nameId) || offset + length > buffer.length) continue;
    const decoded = decodeName(buffer.subarray(offset, offset + length), platform);
    if (decoded && (!values[nameId] || language === 0x409)) values[nameId] = decoded;
  }
  return { family_name: values[1] || '', postscript_name: values[6] || '' };
}

function cmapCoverage(buffer, table) {
  const coverage = { zh_cn: false, latin: false, digits: false, symbols: false };
  if (!table || table.start + 4 > buffer.length) return coverage;
  const targets = { zh_cn: [0x4e00, 0x9fff], latin: [0x41, 0x7a], digits: [0x30, 0x39], symbols: [0x20, 0x2f] };
  const count = buffer.readUInt16BE(table.start + 2);
  const ranges = [];
  for (let index = 0; index < count; index += 1) {
    const record = table.start + 4 + index * 8;
    if (record + 8 > buffer.length) break;
    const offset = table.start + buffer.readUInt32BE(record + 4);
    if (offset + 2 > buffer.length) continue;
    const format = buffer.readUInt16BE(offset);
    if (format === 4 && offset + 16 <= buffer.length) {
      const segCount = buffer.readUInt16BE(offset + 6) / 2;
      const endBase = offset + 14;
      const startBase = endBase + segCount * 2 + 2;
      for (let segment = 0; segment < segCount; segment += 1) ranges.push([buffer.readUInt16BE(startBase + segment * 2), buffer.readUInt16BE(endBase + segment * 2)]);
    } else if (format === 12 && offset + 16 <= buffer.length) {
      const groups = buffer.readUInt32BE(offset + 12);
      for (let group = 0; group < groups && offset + 16 + group * 12 + 8 <= buffer.length; group += 1) ranges.push([buffer.readUInt32BE(offset + 16 + group * 12), buffer.readUInt32BE(offset + 20 + group * 12)]);
    }
  }
  for (const [key, target] of Object.entries(targets)) coverage[key] = ranges.some(([start, end]) => start <= target[1] && end >= target[0]);
  return coverage;
}

async function inspectFont(filePath) {
  const buffer = await fs.readFile(filePath);
  const tables = fontTables(buffer);
  const names = parseNames(buffer, tables.name);
  return { ...names, file_hash: `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`, coverage: cmapCoverage(buffer, tables.cmap), byte_length: buffer.length };
}

async function importFontAsset(projectPath, sourcePath, input = {}) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (!['.otf', '.ttf', '.woff', '.woff2'].includes(extension)) throw new Error('Only OTF, TTF, WOFF, and WOFF2 fonts are supported.');
  const id = String(input.id || path.basename(sourcePath, extension)).replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase();
  const targetDir = path.join(projectPath, 'style', 'fonts');
  await ensureDir(targetDir);
  const targetPath = path.join(targetDir, `${id}${extension}`);
  await fs.copyFile(sourcePath, targetPath);
  const inspected = await inspectFont(targetPath);
  return {
    id, family_name: inspected.family_name || input.familyName || id, postscript_name: inspected.postscript_name || input.postscriptName || '',
    source_type: input.sourceType || 'user-provided', local_path: `style/fonts/${id}${extension}`,
    file_hash: inspected.file_hash, byte_length: inspected.byte_length,
    license_status: input.licenseStatus || 'unresolved', coverage: inspected.coverage
  };
}

function validateFontManifest(manifest, { strict = false } = {}) {
  const errors = [];
  const fonts = Array.isArray(manifest?.fonts) ? manifest.fonts : [];
  const byId = new Map(fonts.map((font) => [font.id, font]));
  if (!fonts.length) errors.push('fonts must contain at least one asset');
  for (const font of fonts) {
    if (!font.id || !font.local_path || !/^sha256:[a-f0-9]{64}$/i.test(font.file_hash || '')) errors.push(`font ${font.id || '<unknown>'} is missing asset identity`);
    if (font.license_status !== 'confirmed') errors.push(`font ${font.id || '<unknown>'} license is not confirmed`);
  }
  for (const [roleId, role] of Object.entries(manifest?.roles || {})) {
    const font = byId.get(role.font_id);
    if (!font) errors.push(`role ${roleId} references missing font ${role.font_id || '<none>'}`);
    if (strict && role.identity_critical && role.fidelity_mode !== 'exact') errors.push(`identity-critical role ${roleId} must use exact fidelity`);
    for (const coverage of role.required_coverage || []) if (!font?.coverage?.[coverage]) errors.push(`font ${role.font_id} lacks ${coverage} coverage required by ${roleId}`);
  }
  return errors;
}

module.exports = { cmapCoverage, importFontAsset, inspectFont, validateFontManifest };

