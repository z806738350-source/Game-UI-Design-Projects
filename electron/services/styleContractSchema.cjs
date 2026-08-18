'use strict';

// Style Contract 2.0 executable-value schema.
// Rejects vague natural-language style values ("高级金色", "适当圆角", "有质感")
// and requires machine-executable numbers with defined units and bounds,
// mandatory semantic colors, concrete typography effects, and explicit
// light direction. See 整改审核与执行基线 R-04 and progress review §三.2.

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const REQUIRED_COLOR_ROLES = ['primary', 'surface', 'text'];
const REQUIRED_TYPOGRAPHY_ROLES = ['display', 'body'];
const CORNER_LANGUAGES = ['sharp', 'beveled', 'beveled-soft', 'rounded', 'notched', 'mixed'];
const DENSITY_LEVELS = ['functional', 'balanced', 'sparse', 'hero'];
const LIGHT_DIRECTIONS = ['top', 'top-left', 'top-right', 'left', 'right', 'bottom', 'bottom-left', 'bottom-right', 'ambient'];
const NUMERIC_STYLES = ['tabular', 'lining', 'oldstyle'];

// Vague modifiers that cannot be executed by a renderer or reproduced across
// screens. negative_style_constraints is exempt because it expresses
// prohibitions, not executable style values.
const VAGUE_TERM_PATTERNS = [
  { pattern: /高级感|高级|高端|轻奢/g, label: '高级/轻奢类模糊修饰' },
  { pattern: /适当|适度|适量|大致|大概|差不多/g, label: '适当/大致类模糊量词' },
  { pattern: /稍微|略微|尽量|有点/g, label: '稍微/尽量类模糊程度词' },
  { pattern: /有质感|质感十足|氛围感|精致感/g, label: '质感/氛围类模糊描述' },
  { pattern: /大气|美观|好看|舒服|舒适|百搭/g, label: '主观审美形容词' },
  { pattern: /\bpremium\b|\bhigh[- ]?end\b|\bluxurious\b/gi, label: 'premium/high-end vague modifier' },
  { pattern: /\bappropriate\b|\bsomewhat\b|\bslightly\b|\bsome kind\b|\bkind of\b|\bsort of\b/gi, label: 'appropriate/somewhat vague quantifier' },
  { pattern: /\bsubtle\b|\belegant\b|\brefined\b|\btasteful\b/gi, label: 'subtle/elegant vague adjective' },
  { pattern: /\bnice\b|\bbeautiful\b|\bgood[- ]?quality\b/gi, label: 'nice/beautiful subjective adjective' }
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function looksLikeNumberString(value) {
  return typeof value === 'string' && /^-?\d+(\.\d+)?\s*(px|em|rem|%)?$/i.test(value.trim());
}

function numberErrors(path, value, { min, max, integer = false, unit }) {
  if (looksLikeNumberString(value)) return [`${path} must be a JSON number${unit ? ` (${unit})` : ''}, not the string "${value}"`];
  if (!isFiniteNumber(value)) return [`${path} must be a finite number${unit ? ` (${unit})` : ''}`];
  if (integer && !Number.isInteger(value)) return [`${path} must be an integer${unit ? ` (${unit})` : ''}`];
  if (value < min || value > max) return [`${path} must be between ${min} and ${max}${unit ? ` ${unit}` : ''} (received ${value})`];
  return [];
}

function findVagueTerms(text) {
  const hits = new Set();
  for (const { pattern, label } of VAGUE_TERM_PATTERNS) {
    const match = String(text).match(pattern);
    if (match) hits.add(`${label}（"${match[0]}"）`);
  }
  return [...hits];
}

function scanVagueStrings(path, value, errors, exemptKeys) {
  if (typeof value === 'string') {
    for (const term of findVagueTerms(value)) errors.push(`${path} contains a vague style term: ${term}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanVagueStrings(`${path}[${index}]`, item, errors, exemptKeys));
    return;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (exemptKeys.has(key)) continue;
      scanVagueStrings(`${path}.${key}`, child, errors, exemptKeys);
    }
  }
}

function colorErrors(path, value) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) return [`${path} must be a hex color like #d6b05f (received ${JSON.stringify(value)})`];
  return [];
}

function typographyRoleErrors(path, role) {
  const errors = [];
  if (!isObject(role)) return [`${path} must be an object with executable numeric values`];
  errors.push(...numberErrors(`${path}.size`, role.size, { min: 6, max: 256, integer: true, unit: 'px' }));
  errors.push(...numberErrors(`${path}.weight`, role.weight, { min: 100, max: 900, integer: true }));
  errors.push(...numberErrors(`${path}.letter_spacing`, role.letter_spacing ?? role.letterSpacing, { min: -8, max: 64, unit: 'px' }));
  errors.push(...numberErrors(`${path}.line_height`, role.line_height ?? role.lineHeight, { min: 0.7, max: 3, unit: 'unitless ratio' }));
  errors.push(...colorErrors(`${path}.fill`, role.fill));
  if (role.numeric_style !== undefined && !NUMERIC_STYLES.includes(role.numeric_style)) errors.push(`${path}.numeric_style must be one of ${NUMERIC_STYLES.join(', ')}`);
  if (role.stroke !== undefined) {
    if (!isObject(role.stroke)) errors.push(`${path}.stroke must be an object with numeric width and hex color`);
    else {
      errors.push(...numberErrors(`${path}.stroke.width`, role.stroke.width, { min: 0, max: 32, unit: 'px' }));
      errors.push(...colorErrors(`${path}.stroke.color`, role.stroke.color));
    }
  }
  if (role.shadow !== undefined) {
    if (!isObject(role.shadow)) errors.push(`${path}.shadow must be an object with numeric blur, offset_x, offset_y, and hex color`);
    else {
      errors.push(...numberErrors(`${path}.shadow.blur`, role.shadow.blur, { min: 0, max: 64, unit: 'px' }));
      errors.push(...numberErrors(`${path}.shadow.offset_x`, role.shadow.offset_x, { min: -64, max: 64, unit: 'px' }));
      errors.push(...numberErrors(`${path}.shadow.offset_y`, role.shadow.offset_y, { min: -64, max: 64, unit: 'px' }));
      errors.push(...colorErrors(`${path}.shadow.color`, role.shadow.color));
    }
  }
  return errors;
}

function validateStyleContract(value) {
  const errors = [];
  if (!isObject(value)) return ['style contract must be an object'];

  if (!isObject(value.colors)) errors.push('colors must be an object of semantic roles to hex values');
  else {
    for (const role of REQUIRED_COLOR_ROLES) {
      if (!(role in value.colors)) errors.push(`colors.${role} is a required semantic color role`);
      else errors.push(...colorErrors(`colors.${role}`, value.colors[role]));
    }
    for (const [role, color] of Object.entries(value.colors)) {
      if (!REQUIRED_COLOR_ROLES.includes(role)) errors.push(...colorErrors(`colors.${role}`, color));
    }
  }

  if (!isObject(value.typography)) errors.push('typography must be an object of role definitions');
  else {
    for (const role of REQUIRED_TYPOGRAPHY_ROLES) {
      if (!(role in value.typography)) errors.push(`typography.${role} is a required typography role`);
    }
    for (const [role, definition] of Object.entries(value.typography)) errors.push(...typographyRoleErrors(`typography.${role}`, definition));
  }

  if (!isObject(value.geometry)) errors.push('geometry must be an object');
  else {
    if (!CORNER_LANGUAGES.includes(value.geometry.corner_language)) errors.push(`geometry.corner_language must be one of ${CORNER_LANGUAGES.join(', ')}`);
    errors.push(...numberErrors('geometry.corner_radius', value.geometry.corner_radius, { min: 0, max: 128, unit: 'px' }));
    if (!DENSITY_LEVELS.includes(value.geometry.density)) errors.push(`geometry.density must be one of ${DENSITY_LEVELS.join(', ')}`);
  }

  if (!isObject(value.lighting)) errors.push('lighting must be an object');
  else {
    if (typeof value.lighting.treatment !== 'string' || !value.lighting.treatment.trim()) errors.push('lighting.treatment must be a concrete non-empty description');
    if (!LIGHT_DIRECTIONS.includes(value.lighting.light_direction)) errors.push(`lighting.light_direction must be one of ${LIGHT_DIRECTIONS.join(', ')}`);
    if (value.lighting.intensity !== undefined) errors.push(...numberErrors('lighting.intensity', value.lighting.intensity, { min: 0, max: 1, unit: '0..1 ratio' }));
  }

  if (!isObject(value.composition) || !Object.keys(value.composition).length) errors.push('composition must be a non-empty object');
  else for (const [key, item] of Object.entries(value.composition)) {
    if (isFiniteNumber(item) && (item < 0 || item > 1)) errors.push(`composition.${key} must be between 0 and 1 when numeric (received ${item})`);
  }

  if (!isObject(value.components) || !Object.keys(value.components).length) errors.push('components must be a non-empty object describing families and states');

  if (!Array.isArray(value.materials) || !value.materials.length) errors.push('materials must be a non-empty array of concrete material descriptions');

  scanVagueStrings('style-contract', value, errors, new Set(['negative_style_constraints']));
  return errors;
}

module.exports = {
  CORNER_LANGUAGES, DENSITY_LEVELS, LIGHT_DIRECTIONS, REQUIRED_COLOR_ROLES, REQUIRED_TYPOGRAPHY_ROLES, VAGUE_TERM_PATTERNS,
  findVagueTerms, validateStyleContract
};
