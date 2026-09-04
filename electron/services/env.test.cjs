const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assistantEnabled, loadKunpoConfig, parseEnv, saveModelConfig } = require('./env.cjs');

test('parseEnv handles quoted values and comments', () => {
  assert.deepEqual(parseEnv('A="hello world"\nB=value # note\n'), { A: 'hello world', B: 'value' });
});

test('saveModelConfig keeps model choices outside .env and makes them win after restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-env-'));
  const envPath = path.join(root, '.env');
  const modelConfigPath = path.join(root, 'user-data', 'models.json');
  const originalEnv = '# keep this comment\nKUNPO_API_KEY=secret-value\nKUNPO_VISION_MODEL=old-vision\n';
  fs.writeFileSync(envPath, originalEnv, 'utf8');
  try {
    saveModelConfig(root, { assistantModel: 'vendor/text-assistant', visionModel: 'vendor/new-vision@2026', imageModel: 'Image New' }, {
      KUNPO_VISION_MODEL: 'shell-vision', DESIGN_COPILOT_ENV_FILE: envPath
    }, { modelConfigPath });
    assert.equal(fs.readFileSync(envPath, 'utf8'), originalEnv);
    const config = loadKunpoConfig(root, { KUNPO_VISION_MODEL: 'shell-vision', DESIGN_COPILOT_ENV_FILE: envPath }, { modelConfigPath });
    assert.equal(config.visionModel, 'vendor/new-vision@2026');
    assert.equal(config.assistantModel, 'vendor/text-assistant');
    assert.equal(config.imageModel, 'Image New');
    assert.equal(config.modelSource, 'models.json');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('old model config falls back to the effective vision model for the assistant', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-env-fallback-'));
  const modelConfigPath = path.join(root, 'models.json');
  fs.writeFileSync(modelConfigPath, JSON.stringify({ schema_version: '1.0', visionModel: 'vendor/legacy-vision', imageModel: 'legacy-image' }), 'utf8');
  try {
    const config = loadKunpoConfig(root, {}, { modelConfigPath });
    assert.equal(config.assistantModel, 'vendor/legacy-vision');
    assert.equal(config.modelSource, 'models.json');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('legacy settings save preserves explicit assistant and critique models', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-env-preserve-'));
  const modelConfigPath = path.join(root, 'models.json');
  fs.writeFileSync(modelConfigPath, JSON.stringify({ assistantModel: 'assistant-kept', visionModel: 'vision-old', critiqueModel: 'critique-kept', imageModel: 'image-old' }), 'utf8');
  try {
    const saved = saveModelConfig(root, { visionModel: 'vision-new', imageModel: 'image-new' }, {}, { modelConfigPath });
    assert.equal(saved.assistantModel, 'assistant-kept');
    assert.equal(saved.critiqueModel, 'critique-kept');
    assert.equal(saved.visionModel, 'vision-new');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('assistant feature flag accepts only the explicit literal true', () => {
  assert.equal(assistantEnabled({ GAME_UI_ASSISTANT_ENABLED: 'true' }), true);
  for (const value of [undefined, '', '1', 'TRUE', 'yes', 'false']) {
    assert.equal(assistantEnabled({ GAME_UI_ASSISTANT_ENABLED: value }), false);
  }
});

test('saveModelConfig rejects blank or unsafe model ids', () => {
  const modelConfigPath = path.join(os.tmpdir(), `invalid-models-${Date.now()}.json`);
  assert.throws(() => saveModelConfig(os.tmpdir(), { visionModel: '', imageModel: 'Image-GPT2' }, {}, { modelConfigPath }), /不能为空/);
  assert.throws(() => saveModelConfig(os.tmpdir(), { visionModel: 'valid/model', imageModel: 'bad\nINJECT=1' }, {}, { modelConfigPath }), /不能包含换行/);
});
