const fs = require('node:fs');
const path = require('node:path');

function parseEnv(text) {
  const values = {};
  String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) return;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[match[1]] = value;
  });
  return values;
}

function existingEnvPath(projectRoot, processEnv = process.env) {
  const candidates = [
    processEnv.DESIGN_COPILOT_ENV_FILE,
    path.join(projectRoot, '.env'),
    path.resolve(projectRoot, '..', 'Game UI Forge', '.env')
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || path.join(projectRoot, '.env');
}

function validateModelName(value, label) {
  const name = String(value || '').trim();
  if (!name) throw new Error(`${label}不能为空。`);
  if (name.length > 200) throw new Error(`${label}不能超过 200 个字符。`);
  if (/[\u0000-\u001f\u007f]/u.test(name)) throw new Error(`${label}不能包含换行或控制字符。`);
  return name;
}

function resolveModelConfigPath(projectRoot, processEnv = process.env, options = {}) {
  return options.modelConfigPath
    || processEnv.DESIGN_COPILOT_MODEL_CONFIG
    || path.join(projectRoot, '.design-copilot', 'models.json');
}

function readModelConfig(modelConfigPath) {
  try {
    const value = JSON.parse(fs.readFileSync(modelConfigPath, 'utf8'));
    if (!value || typeof value !== 'object') return {};
    return {
      assistantModel: typeof value.assistantModel === 'string' ? value.assistantModel.trim() : '',
      visionModel: typeof value.visionModel === 'string' ? value.visionModel.trim() : '',
      critiqueModel: typeof value.critiqueModel === 'string' ? value.critiqueModel.trim() : '',
      imageModel: typeof value.imageModel === 'string' ? value.imageModel.trim() : ''
    };
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
}

function saveModelConfig(projectRoot, input, processEnv = process.env, options = {}) {
  const modelConfigPath = resolveModelConfigPath(projectRoot, processEnv, options);
  const current = readModelConfig(modelConfigPath);
  const visionModel = input?.visionModel !== undefined ? input.visionModel : current.visionModel;
  const value = {
    schema_version: '1.1',
    assistantModel: validateModelName(input?.assistantModel !== undefined ? input.assistantModel : current.assistantModel || visionModel, '助手文本模型'),
    visionModel: validateModelName(visionModel, '视觉理解模型'),
    critiqueModel: validateModelName(input?.critiqueModel !== undefined ? input.critiqueModel : current.critiqueModel || visionModel, '视觉审查模型'),
    imageModel: validateModelName(input?.imageModel !== undefined ? input.imageModel : current.imageModel, '图像模型'),
    updated_at: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(modelConfigPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${modelConfigPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, modelConfigPath);
  return { modelConfigPath, ...value };
}

function loadKunpoConfig(projectRoot, processEnv = process.env, options = {}) {
  const envPath = existingEnvPath(projectRoot, processEnv);
  const modelConfigPath = resolveModelConfigPath(projectRoot, processEnv, options);
  const modelConfig = readModelConfig(modelConfigPath);
  let fileValues = {};
  try {
    fileValues = parseEnv(fs.readFileSync(envPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const pick = (...names) => {
    for (const name of names) {
      const value = String(processEnv[name] || fileValues[name] || '').trim();
      if (value) return value;
    }
    return '';
  };
  const gatewayBaseUrl = pick('KUNPO_GATEWAY_BASE_URL');
  const directBaseUrl = pick('KUNPO_API_BASE_URL', 'KUNPO_API_URL');
  const apiKey = pick('KUNPO_API_KEY');
  const baseUrl = (gatewayBaseUrl || directBaseUrl).replace(/\/+$/, '');
  const mode = gatewayBaseUrl ? 'gateway' : directBaseUrl ? 'direct' : 'unconfigured';
  return {
    baseUrl,
    apiKey,
    mode,
    configured: Boolean(baseUrl && (mode === 'gateway' || apiKey)),
    envSource: path.basename(envPath),
    modelSource: modelConfig.assistantModel || modelConfig.visionModel || modelConfig.critiqueModel || modelConfig.imageModel ? path.basename(modelConfigPath) : path.basename(envPath),
    assistantModel: modelConfig.assistantModel || modelConfig.visionModel || String(processEnv.KUNPO_VISION_MODEL || fileValues.KUNPO_VISION_MODEL || '').trim() || 'google/gemini-3.1-flash-lite',
    visionModel: modelConfig.visionModel || String(processEnv.KUNPO_VISION_MODEL || fileValues.KUNPO_VISION_MODEL || '').trim() || 'google/gemini-3.1-flash-lite',
    critiqueModel: modelConfig.critiqueModel || String(processEnv.KUNPO_CRITIQUE_MODEL || fileValues.KUNPO_CRITIQUE_MODEL || '').trim() || modelConfig.visionModel || String(processEnv.KUNPO_VISION_MODEL || fileValues.KUNPO_VISION_MODEL || '').trim() || 'google/gemini-3.1-flash-lite',
    imageModel: modelConfig.imageModel || String(processEnv.KUNPO_IMAGE_MODEL || fileValues.KUNPO_IMAGE_MODEL || '').trim() || 'Image-GPT2'
  };
}

function assistantEnabled(processEnv = process.env) {
  return processEnv.GAME_UI_ASSISTANT_ENABLED === 'true';
}

module.exports = { assistantEnabled, loadKunpoConfig, parseEnv, readModelConfig, resolveModelConfigPath, saveModelConfig, validateModelName };
