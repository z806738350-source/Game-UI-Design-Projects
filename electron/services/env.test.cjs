const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadKunpoConfig, parseEnv, saveModelConfig } = require('./env.cjs');

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
    saveModelConfig(root, { visionModel: 'vendor/new-vision@2026', imageModel: 'Image New' }, {
      KUNPO_VISION_MODEL: 'shell-vision', DESIGN_COPILOT_ENV_FILE: envPath
    }, { modelConfigPath });
    assert.equal(fs.readFileSync(envPath, 'utf8'), originalEnv);
    const config = loadKunpoConfig(root, { KUNPO_VISION_MODEL: 'shell-vision', DESIGN_COPILOT_ENV_FILE: envPath }, { modelConfigPath });
    assert.equal(config.visionModel, 'vendor/new-vision@2026');
    assert.equal(config.imageModel, 'Image New');
    assert.equal(config.modelSource, 'models.json');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('saveModelConfig rejects blank or unsafe model ids', () => {
  const modelConfigPath = path.join(os.tmpdir(), `invalid-models-${Date.now()}.json`);
  assert.throws(() => saveModelConfig(os.tmpdir(), { visionModel: '', imageModel: 'Image-GPT2' }, {}, { modelConfigPath }), /不能为空/);
  assert.throws(() => saveModelConfig(os.tmpdir(), { visionModel: 'valid/model', imageModel: 'bad\nINJECT=1' }, {}, { modelConfigPath }), /不能包含换行/);
});
