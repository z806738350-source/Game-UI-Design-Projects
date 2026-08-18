const test = require('node:test');
const assert = require('node:assert/strict');
const { validateArtifact, withCommonFields } = require('./contracts.cjs');
const { findVagueTerms, validateStyleContract } = require('./styleContractSchema.cjs');

function executableStyleContract(overrides = {}) {
  return withCommonFields({
    style_id: 'golden-locked-style',
    visual_identity: { theme: 'functional-dense', mood: ['disciplined'], keywords: ['dark lacquer'] },
    colors: { primary: '#d6b05f', surface: '#173b46', text: '#fff7d6', danger: '#c0392b' },
    typography: {
      display: { size: 24, weight: 650, letter_spacing: 0.4, line_height: 1.1, fill: '#fff4c4', stroke: { width: 2, color: '#3a2b12' } },
      body: { size: 15, weight: 500, letter_spacing: 0.1, line_height: 1.15, fill: '#ffffff', shadow: { blur: 2, offset_x: 0, offset_y: 1, color: '#000000' } },
      numeric: { size: 14, weight: 700, letter_spacing: 0.2, line_height: 1.1, numeric_style: 'tabular', fill: '#fff5bd' }
    },
    geometry: { corner_language: 'beveled-soft', corner_radius: 10, density: 'functional' },
    lighting: { treatment: 'restrained edge glow', light_direction: 'top-left', intensity: 0.35 },
    components: { button: { states: ['selected', 'disabled'] }, panel: { states: ['default'] } },
    composition: { hierarchy: 'wireframe-locked', information_density: 0.8 },
    materials: ['dark lacquer', 'brushed metal', 'soft emissive glass'],
    reference_ids: ['ref-1'],
    negative_style_constraints: ['no provider-rendered shared UI', 'no slightly busy slot backgrounds'],
    ...overrides
  }, { id: 'style-contract-1', source: {} });
}

test('executable style contract with numeric values, semantic colors, and light direction passes', () => {
  assert.deepEqual(validateArtifact('style-contract', executableStyleContract()), []);
});

test('vague style terms like 高级金色, 适当圆角, 有质感 are rejected', () => {
  const vagueMaterial = executableStyleContract({ materials: ['高级金色', 'brushed metal'] });
  const errors = validateArtifact('style-contract', vagueMaterial);
  assert.ok(errors.some((error) => error.includes('materials[0]') && error.includes('vague')), errors.join('; '));
  const vagueGeometry = executableStyleContract({ geometry: { corner_language: 'rounded', corner_radius: 8, density: 'functional', note: '适当圆角' } });
  assert.ok(validateArtifact('style-contract', vagueGeometry).some((error) => error.includes('vague')));
  const vagueEnglish = executableStyleContract({ lighting: { treatment: 'subtle premium glow', light_direction: 'top' } });
  assert.ok(validateArtifact('style-contract', vagueEnglish).some((error) => error.includes('vague')));
  assert.ok(findVagueTerms('整体有质感，稍微大气一些').length >= 2);
});

test('negative_style_constraints may phrase prohibitions without tripping the vague-term blacklist', () => {
  const contract = executableStyleContract({ negative_style_constraints: ['no slightly overlapping subjects', '避免稍微模糊的剪影'] });
  assert.deepEqual(validateStyleContract(contract).filter((error) => error.includes('negative_style_constraints')), []);
});

test('numeric fields reject unitless strings, missing values, and out-of-range values', () => {
  const stringSize = executableStyleContract();
  stringSize.typography.display.size = '14px';
  assert.ok(validateStyleContract(stringSize).some((error) => error.includes('typography.display.size') && error.includes('not the string')));
  const missingWeight = executableStyleContract();
  delete missingWeight.typography.body.weight;
  assert.ok(validateStyleContract(missingWeight).some((error) => error.includes('typography.body.weight')));
  const outOfRange = executableStyleContract();
  outOfRange.typography.display.size = 999;
  outOfRange.typography.body.line_height = 5;
  outOfRange.geometry.corner_radius = 400;
  const errors = validateStyleContract(outOfRange);
  assert.ok(errors.some((error) => error.includes('typography.display.size must be between 6 and 256')));
  assert.ok(errors.some((error) => error.includes('typography.body.line_height must be between 0.7 and 3')));
  assert.ok(errors.some((error) => error.includes('geometry.corner_radius must be between 0 and 128')));
});

test('required semantic colors and valid hex values are enforced', () => {
  const missingRole = executableStyleContract();
  delete missingRole.colors.text;
  assert.ok(validateStyleContract(missingRole).some((error) => error.includes('colors.text is a required semantic color role')));
  const badHex = executableStyleContract();
  badHex.colors.primary = 'gold';
  assert.ok(validateStyleContract(badHex).some((error) => error.includes('colors.primary must be a hex color')));
});

test('explicit light direction is mandatory and typography effects must be numeric', () => {
  const noLightDirection = executableStyleContract();
  delete noLightDirection.lighting.light_direction;
  assert.ok(validateStyleContract(noLightDirection).some((error) => error.includes('lighting.light_direction must be one of')));
  const vagueStroke = executableStyleContract();
  vagueStroke.typography.display.stroke = { color: '#3a2b12' };
  assert.ok(validateStyleContract(vagueStroke).some((error) => error.includes('typography.display.stroke.width')));
  const vagueShadow = executableStyleContract();
  vagueShadow.typography.body.shadow = { blur: 'a little', offset_x: 0, offset_y: 1, color: '#000000' };
  assert.ok(validateStyleContract(vagueShadow).some((error) => error.includes('typography.body.shadow.blur')));
});
