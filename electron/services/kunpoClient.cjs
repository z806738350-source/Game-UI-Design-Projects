const fs = require('node:fs/promises');
const { extractJson, normalizeArtifact, validateArtifact, withCommonFields } = require('./contracts.cjs');
const { imageMetadataFromBuffer, readImageMetadata } = require('./imageMetadata.cjs');

function headers(config) {
  return {
    'content-type': 'application/json',
    ...(config.mode === 'direct' && config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
  };
}

async function fileDataUrl(filePath) {
  const metadata = await readImageMetadata(filePath);
  return `data:${metadata.mime};base64,${(await fs.readFile(filePath)).toString('base64')}`;
}

function responseText(payload) {
  const candidates = [
    payload?.choices?.[0]?.message?.content,
    payload?.data?.choices?.[0]?.message?.content,
    payload?.data?.candidates?.[0]?.content?.parts?.[0]?.text,
    payload?.candidates?.[0]?.content?.parts?.[0]?.text,
    payload?.text,
    payload?.output,
    payload?.content
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim()) || '';
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const raw = await response.text();
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = { raw }; }
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || raw || `HTTP ${response.status}`;
      throw new Error(`Kunpo request failed (${response.status}): ${String(message).slice(0, 500)}`);
    }
    return { payload, response };
  } finally {
    clearTimeout(timer);
  }
}

async function requestArtifact(config, { kind, prompt, imagePaths = [], id, source = {} }) {
  if (!config.configured) throw new Error('Kunpo is not configured. Set a Gateway URL or local API URL + key.');
  const images = await Promise.all(imagePaths.filter(Boolean).map(fileDataUrl));
  async function invoke(extraInstruction = '') {
    const content = [{ type: 'text', text: `${prompt}${extraInstruction}` }];
    images.forEach((url) => content.push({ type: 'image_url', image_url: { url, detail: 'high' } }));
    const { payload } = await fetchJson(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({
        model: config.visionModel,
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_object' },
        stream: false
      })
    }, 300000);
    const text = responseText(payload);
    if (!text) throw new Error('Kunpo returned no readable text.');
    const artifact = withCommonFields(normalizeArtifact(kind, extractJson(text)), { id, source });
    const errors = validateArtifact(kind, artifact);
    return { artifact, errors };
  }
  let feedback = '';
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await invoke(feedback);
      if (!result.errors.length) return result.artifact;
      lastError = new Error(result.errors.join('; '));
      const invalidDraft = JSON.stringify(result.artifact);
      feedback = `\n\nAttempt ${attempt} failed schema and coverage validation: ${result.errors.join('; ')}. ` +
        `Repair the JSON draft below instead of regenerating it from scratch. Preserve every valid field and value. ` +
        `For each "missing source items" error, copy every named source item verbatim into the corresponding required_controls or required_information array, ` +
        `and also into coverage.covered_items. Keep coverage.uncovered_items empty only after those copies are present. ` +
        `Return one corrected complete JSON object with no markdown or trailing content.\nINVALID_DRAFT:\n${invalidDraft}`;
    } catch (error) {
      lastError = error;
      feedback = `\n\nAttempt ${attempt} was not valid JSON (${error.message}). Return one complete JSON object only, with no markdown or trailing content.`;
    }
  }
  throw new Error(`结构化结果连续 3 次未通过自动修复：${lastError?.message || '未知格式错误'}`);
}

async function requestJson(config, { prompt, imagePaths = [], requiredStringKeys = [] }) {
  if (!config.configured) throw new Error('Kunpo is not configured. Set a Gateway URL or local API URL + key.');
  const images = await Promise.all(imagePaths.filter(Boolean).map(fileDataUrl));
  let feedback = '';
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const content = [{ type: 'text', text: `${prompt}${feedback}` }];
      images.forEach((url) => content.push({ type: 'image_url', image_url: { url, detail: 'high' } }));
      const { payload } = await fetchJson(`${config.baseUrl}/chat/completions`, {
        method: 'POST', headers: headers(config),
        body: JSON.stringify({
          model: config.visionModel,
          messages: [{ role: 'user', content }],
          response_format: { type: 'json_object' },
          stream: false
        })
      }, 300000);
      const text = responseText(payload);
      if (!text) throw new Error('Kunpo returned no readable text.');
      const value = extractJson(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('result must be a JSON object');
      const missing = requiredStringKeys.filter((key) => typeof value[key] !== 'string' || !value[key].trim());
      if (missing.length) throw new Error(`missing required text: ${missing.join(', ')}`);
      return value;
    } catch (error) {
      lastError = error;
      feedback = `\n\nAttempt ${attempt} failed (${error.message}). Return one corrected complete JSON object only, with no markdown or trailing content.`;
    }
  }
  throw new Error(`UE 预解读连续 3 次未返回有效内容：${lastError?.message || '未知格式错误'}`);
}

function nestedObjects(payload, maxDepth = 6, maxNodes = 500) {
  const items = [];
  const queue = [{ value: payload, depth: 0 }];
  while (queue.length && items.length < maxNodes) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== 'object') continue;
    items.push(value);
    if (depth >= maxDepth) continue;
    Object.values(value).forEach((child) => {
      if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
    });
  }
  return items;
}

function taskId(payload, response) {
  // Prefer explicit task ids in the response body. Some Kunpo-compatible
  // gateways also return x-request-id as a trace id, which is not pollable.
  for (const value of nestedObjects(payload)) {
    const found = value.task_id || value.taskId;
    if (found) return String(found);
  }
  if (payload?.id) return String(payload.id);
  const responseHeaders = response?.headers?.entries ? Array.from(response.headers.entries()) : [];
  for (const [key, value] of responseHeaders) {
    if (/(task|job)[-_]?id/i.test(key) && value) return value;
  }
  for (const [key, value] of responseHeaders) {
    if (/request[-_]?id/i.test(key) && value) return value;
  }
  return '';
}

function taskStatus(payload) {
  for (const value of nestedObjects(payload)) {
    const found = value.status || value.task_status || value.taskStatus || value.state || value.phase;
    if (typeof found === 'string') return found.toLowerCase();
  }
  return '';
}

function validImageValue(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  if (value.startsWith('data:image/')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? value : '';
  } catch { return ''; }
}

function isTrustedKunpoCdnUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'kunpoapiimg.ziy.cc'
      && !url.search
      && !url.hash
      && /\.(png|jpe?g|webp)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function validateGeneratedCanvas(url, requestedSize) {
  const [expectedWidth, expectedHeight] = String(requestedSize || '').split('x').map(Number);
  if (!expectedWidth || !expectedHeight) return null;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const metadata = imageMetadataFromBuffer(Buffer.from(await response.arrayBuffer()));
      if (!metadata) throw new Error('无法识别生成图片尺寸');
      const expectedRatio = expectedWidth / expectedHeight;
      const actualRatio = metadata.width / metadata.height;
      if (Math.abs(expectedRatio - actualRatio) / expectedRatio > 0.03) {
        throw new Error(`生成结果比例为 ${metadata.width}:${metadata.height}，目标比例为 ${expectedWidth}:${expectedHeight}`);
      }
      return metadata;
    } catch (error) {
      lastError = error;
      if (/生成结果比例/.test(error.message)) break;
      await wait(700 * (attempt + 1));
    }
  }
  throw new Error(`成图尺寸验收失败：${lastError?.message || '无法读取图片'}`);
}

async function permanentImageResult(url, id, requestedSize) {
  if (!isTrustedKunpoCdnUrl(url)) {
    throw new Error('Kunpo returned an image URL that is not a trusted permanent CDN asset. The result was not persisted.');
  }
  const metadata = await validateGeneratedCanvas(url, requestedSize);
  return {
    url,
    task_id: id,
    status: 'succeeded',
    storageMode: 'provider_cdn',
    storageProvider: 'kunpo',
    storageDurability: 'provider_managed',
    remoteOnly: true,
    trustedPermanentCdn: true,
    width: metadata?.width,
    height: metadata?.height
  };
}

function imageUrl(payload) {
  const direct = [
    payload?.data?.result_url, payload?.data?.resultUrl, payload?.result_url, payload?.resultUrl,
    payload?.data?.data?.Response?.ResultImages?.[0]?.Url,
    payload?.data?.Response?.ResultImages?.[0]?.Url,
    payload?.Response?.ResultImages?.[0]?.Url
  ];
  for (const candidate of direct) {
    const valid = validImageValue(candidate);
    if (valid) return valid;
  }
  for (const value of nestedObjects(payload)) {
    for (const key of ['url', 'image_url', 'fileUrl', 'file_url', 'image', 'b64_json']) {
      const valid = validImageValue(value[key]);
      if (valid) return valid;
    }
  }
  return '';
}

async function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function generateImage(config, { prompt, imagePaths = [], size = '1536x864', model }) {
  if (!config.configured) throw new Error('Kunpo is not configured.');
  const selectedModel = model || config.imageModel;
  const references = await Promise.all(imagePaths.filter(Boolean).slice(0, 6).map(fileDataUrl));
  const body = { model: selectedModel, prompt, size };
  if (selectedModel === 'Image-GPT2') body.output_format = 'png';
  else body.metadata = { quality: 'medium' };
  if (references.length === 1) body.image = references[0];
  else if (references.length > 1) body.images = references;
  const submitted = await fetchJson(`${config.baseUrl}/images/tasks`, {
    method: 'POST', headers: headers(config), body: JSON.stringify(body)
  }, 120000);
  const immediate = imageUrl(submitted.payload);
  if (immediate) return permanentImageResult(immediate, taskId(submitted.payload, submitted.response), size);
  const id = taskId(submitted.payload, submitted.response);
  if (!id) throw new Error('Kunpo image submission returned no task id.');
  const failed = new Set(['failed', 'fail', 'error', 'cancelled', 'canceled', 'idle']);
  const started = Date.now();
  let transientErrors = 0;
  while (Date.now() - started < 1200000) {
    await wait(2000);
    try {
      const polled = await fetchJson(`${config.baseUrl}/images/tasks/${encodeURIComponent(id)}`, {
        method: 'GET', headers: headers(config)
      }, 30000);
      transientErrors = 0;
      const url = imageUrl(polled.payload);
      if (url) return permanentImageResult(url, id, size);
      const status = taskStatus(polled.payload);
      if (failed.has(status)) throw new Error(`Kunpo image task failed: ${status}`);
      if (['success', 'succeeded', 'completed'].includes(status)) throw new Error('Kunpo image task completed without an image URL.');
    } catch (error) {
      transientErrors += 1;
      if (transientErrors >= 3 || /task failed|completed without/i.test(error.message)) throw error;
    }
  }
  throw new Error(`Kunpo image task ${id} timed out after 20 minutes.`);
}

function safeConfig(config) {
  return {
    configured: config.configured,
    mode: config.mode,
    envSource: config.envSource,
    modelSource: config.modelSource,
    visionModel: config.visionModel,
    imageModel: config.imageModel
  };
}

module.exports = { generateImage, isTrustedKunpoCdnUrl, requestArtifact, requestJson, safeConfig, taskId };
