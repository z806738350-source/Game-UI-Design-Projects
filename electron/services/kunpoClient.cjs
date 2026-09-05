const fs = require('node:fs/promises');
const { ERROR_CODES, FIDELITY_ISSUE_CODES } = require('./errorCodes.cjs');
const { extractJson, normalizeArtifact, validateArtifact, coverageGateErrors, withCommonFields } = require('./contracts.cjs');
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
    // 生成期门禁：结构校验 + （screen-contract）AI 草稿必须完整覆盖
    // source_inventory；审查阶段的覆盖差异留痕不在此拦截。
    const errors = [...validateArtifact(kind, artifact), ...(kind === 'screen-contract' ? coverageGateErrors(artifact) : [])];
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

// v1.4 §7.5 Provider 纠正反馈限流：errors 才触发重试（最多 3 次），
// warnings 只随结果返回；反馈整体受字节上限保护，绝不回显 Key。
const FEEDBACK_MAX_ERRORS = 20;
const FEEDBACK_MAX_ERROR_CHARS = 300;
const FEEDBACK_MAX_REPAIR_BYTES = 64 * 1024;
const FEEDBACK_MAX_TOTAL_BYTES = 96 * 1024;

function truncateUtf8(text, maxBytes, marker = '…[truncated]') {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  return `${bytes.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/, '')}${marker}`;
}

// repairContext 去敏：任何 base64 data URL（图片载荷）不得回显进 Prompt。
function sanitizeRepairContext(value) {
  if (value === undefined || value === null || value === '') return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const redacted = text.replace(/data:[^;",\s]*;base64,[A-Za-z0-9+/=]+/g, '[redacted-image-data]');
  return truncateUtf8(redacted, FEEDBACK_MAX_REPAIR_BYTES);
}

function validationFeedback(attempt, processed) {
  const errors = (processed.errors || [])
    .slice(0, FEEDBACK_MAX_ERRORS)
    .map((error) => truncateUtf8(String(error), FEEDBACK_MAX_ERROR_CHARS, ''));
  let feedback = `\n\nAttempt ${attempt} failed validation with ${errors.length} error(s):\n${errors.map((error) => `- ${error}`).join('\n')}\n`;
  const repair = sanitizeRepairContext(processed.repairContext);
  if (repair.trim()) {
    feedback += `Repair the JSON draft below instead of regenerating it from scratch. Preserve every valid field and value.\nINVALID_DRAFT:\n${repair}\n`;
  }
  feedback += `Return one corrected complete JSON object only, with no markdown or trailing content.`;
  return truncateUtf8(feedback, FEEDBACK_MAX_TOTAL_BYTES);
}

function providerMeta(payload, config) {
  return {
    response_id: typeof payload?.id === 'string' ? payload.id : undefined,
    model: typeof payload?.model === 'string' ? payload.model : config.visionModel,
    created: payload?.created
  };
}

// v1.4 §7.5：processValue(raw) => { value, errors, warnings, repairContext }
// —— 可归一化但接触不到 Key；errors 触发纠正（最多 3 次），warnings 不重试；
// captureMeta 与 captureRaw 语义分开：meta 载荷绝不含 raw text / Key / data URL。
// 图片在任务开始时读取一次并在全部尝试内复用。
async function requestJson(config, { prompt, imagePaths = [], imageDataUrls = [], requiredStringKeys = [], captureRaw = false, captureMeta = false, processValue, failureCode, model = config.visionModel, timeoutMs = 300000 }) {
  if (!config.configured) throw new Error('Kunpo is not configured. Set a Gateway URL or local API URL + key.');
  const images = [...await Promise.all(imagePaths.filter(Boolean).map(fileDataUrl)), ...imageDataUrls];
  let feedback = '';
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const content = [{ type: 'text', text: `${prompt}${feedback}` }];
      images.forEach((url) => content.push({ type: 'image_url', image_url: { url, detail: 'high' } }));
      const { payload } = await fetchJson(`${config.baseUrl}/chat/completions`, {
        method: 'POST', headers: headers(config),
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content }],
          response_format: { type: 'json_object' },
          stream: false
        })
      }, timeoutMs);
      const text = responseText(payload);
      if (!text) throw new Error('Kunpo returned no readable text.');
      const value = extractJson(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('result must be a JSON object');
      if (processValue) {
        const processed = processValue(value) || {};
        if ((processed.errors || []).length) {
          const failure = new Error(`validation failed: ${(processed.errors || []).slice(0, 3).map((error) => truncateUtf8(String(error), 100, '')).join('; ')}`);
          failure.processed = processed;
          throw failure;
        }
        const finalValue = processed.value ?? value;
        const warnings = processed.warnings || [];
        if (captureMeta) return { capture_version: '1.0', value: finalValue, warnings, attempt, provider: providerMeta(payload, config) };
        return { value: finalValue, warnings };
      }
      const missing = requiredStringKeys.filter((key) => typeof value[key] !== 'string' || !value[key].trim());
      if (missing.length) throw new Error(`missing required text: ${missing.join(', ')}`);
      if (captureRaw) {
        return {
          capture_version: '1.0',
          value,
          raw_text: text,
          attempt,
          provider: {
            response_id: typeof payload?.id === 'string' ? payload.id : undefined,
            model: typeof payload?.model === 'string' ? payload.model : config.visionModel,
            created: payload?.created
          }
        };
      }
      if (captureMeta) return { capture_version: '1.0', value, warnings: [], attempt, provider: providerMeta(payload, config) };
      return value;
    } catch (error) {
      lastError = error;
      feedback = error.processed
        ? validationFeedback(attempt, error.processed)
        : `\n\nAttempt ${attempt} failed (${error.message}). Return one corrected complete JSON object only, with no markdown or trailing content.`;
    }
  }
  const final = new Error(`连续 3 次未返回有效内容：${lastError?.message || '未知格式错误'}`);
  if (failureCode) final.code = failureCode;
  throw final;
}

async function requestAssistant(config, { prompt, imageDataUrls = [], validateAction }) {
  const envelope = await requestJson(config, {
    prompt,
    imageDataUrls,
    model: config.assistantModel || config.visionModel,
    timeoutMs: 120000,
    failureCode: ERROR_CODES.ASSISTANT_RESPONSE_INVALID,
    processValue(value) {
      const errors = [];
      const reply = typeof value.reply === 'string' ? value.reply.trim() : '';
      if (!reply || reply.length > 20_000) errors.push('reply must be a non-empty string of at most 20000 characters');
      let proposedAction = null;
      if (value.proposed_action != null) {
        const candidate = value.proposed_action;
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) errors.push('proposed_action must be null or an object');
        else if (typeof candidate.name !== 'string' || !candidate.name.trim() || typeof candidate.args !== 'object' || !candidate.args || Array.isArray(candidate.args)) errors.push('proposed_action requires name and object args');
        else proposedAction = { name: candidate.name.trim(), reason: typeof candidate.reason === 'string' ? candidate.reason.trim().slice(0, 1_000) : '', args: candidate.args };
      }
      if (proposedAction && validateAction) errors.push(...validateAction(proposedAction));
      return { value: { reply, proposed_action: proposedAction }, errors, warnings: [], repairContext: value };
    }
  });
  return envelope.value;
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
  if (!isTrustedKunpoCdnUrl(url)) throw new Error('Kunpo returned an image URL that is not a trusted permanent CDN asset. The result was not persisted.');
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

function kunpoCdnLocation(url) {
  if (String(url).startsWith('data:image/')) return { kind: 'inline-data' };
  try {
    const parsed = new URL(url);
    return { kind: 'remote', protocol: parsed.protocol, hostname: parsed.hostname, pathname: parsed.pathname, has_query: Boolean(parsed.search), has_hash: Boolean(parsed.hash) };
  } catch { return { kind: 'invalid' }; }
}

// Exact hosts observed as Kunpo provider delivery locations. Only these may be
// snapshotted; lookalike suffixes (e.g. host + '.evil.test') are rejected by
// the strict equality check.
const SNAPSHOT_HOSTS = new Set(['kunpoapiimg.ziy.cc', 'vcg-prod-1258344699.cos.ap-guangzhou.tencentcos.cn']);

function isSnapshotHost(location) {
  return location.kind === 'remote' && location.protocol === 'https:' && SNAPSHOT_HOSTS.has(location.hostname);
}

async function transientImageSnapshot(url, id, requestedSize) {
  const location = kunpoCdnLocation(url);
  let bytes;
  if (location.kind === 'inline-data') {
    const match = String(url).match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) throw Object.assign(new Error('Kunpo returned an unsupported inline image payload.'), { code: ERROR_CODES.TRANSIENT_IMAGE_UNSUPPORTED });
    bytes = Buffer.from(match[2], 'base64');
  } else if (isSnapshotHost(location)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    let response;
    try {
      response = await fetch(url, { redirect: 'error', signal: controller.signal });
    } catch (error) {
      throw Object.assign(new Error(`Unable to snapshot the transient Kunpo image (${error?.name === 'AbortError' ? 'timeout after 120s' : error?.message || 'fetch failed'}).`), { code: ERROR_CODES.TRANSIENT_IMAGE_DOWNLOAD_FAILED });
    } finally { clearTimeout(timer); }
    if (!response.ok) throw Object.assign(new Error(`Unable to snapshot the transient Kunpo image (HTTP ${response.status}).`), { code: ERROR_CODES.TRANSIENT_IMAGE_DOWNLOAD_FAILED });
    const contentType = String(response.headers.get('content-type') || '');
    if (!/^image\/(png|jpe?g|webp)/i.test(contentType)) throw Object.assign(new Error(`Transient Kunpo image response declared an unexpected content type (${contentType || 'none'}).`), { code: ERROR_CODES.TRANSIENT_IMAGE_UNSUPPORTED });
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 25 * 1024 * 1024) throw Object.assign(new Error('Transient Kunpo image exceeds the 25MB snapshot limit.'), { code: ERROR_CODES.TRANSIENT_IMAGE_SIZE_INVALID });
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    const error = new Error(`Kunpo returned an untrusted image location (${JSON.stringify(location)}). The result was not fetched or persisted.`);
    error.code = ERROR_CODES.UNTRUSTED_IMAGE_LOCATION;
    throw error;
  }
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw Object.assign(new Error('Transient Kunpo image is empty or exceeds the 25MB snapshot limit.'), { code: ERROR_CODES.TRANSIENT_IMAGE_SIZE_INVALID });
  const metadata = imageMetadataFromBuffer(bytes);
  if (!metadata) throw Object.assign(new Error('Transient Kunpo image is not a supported PNG, JPEG, or WebP bitmap.'), { code: ERROR_CODES.TRANSIENT_IMAGE_DECODE_FAILED });
  const [expectedWidth, expectedHeight] = String(requestedSize || '').split('x').map(Number);
  if (expectedWidth && expectedHeight) {
    const expectedRatio = expectedWidth / expectedHeight; const actualRatio = metadata.width / metadata.height;
    if (Math.abs(expectedRatio - actualRatio) / expectedRatio > 0.03) throw Object.assign(new Error(`生成结果比例为 ${metadata.width}:${metadata.height}，目标比例为 ${expectedWidth}:${expectedHeight}`), { code: ERROR_CODES.TRANSIENT_IMAGE_RATIO_MISMATCH });
  }
  return {
    url: `data:${metadata.mime};base64,${bytes.toString('base64')}`,
    task_id: id,
    status: 'succeeded',
    storageMode: 'inline_snapshot', storageProvider: 'local-materialization', storageDurability: 'materialize-immediately',
    remoteOnly: false, trustedPermanentCdn: false, width: metadata.width, height: metadata.height,
    source_location: location
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

async function generateImage(config, { prompt, imagePaths = [], size = '1536x864', model, maxReferenceImages = 6, operation = 'generate', maskPath, snapshotTransient = false }) {
  if (!config.configured) throw new Error('Kunpo is not configured.');
  const selectedModel = model || config.imageModel;
  const paths = imagePaths.filter(Boolean);
  if (paths.length > maxReferenceImages) {
    const error = new Error(`Reference pack contains ${paths.length} images but provider limit is ${maxReferenceImages}. Build an explicit reference pack and review omitted assets.`);
    error.code = ERROR_CODES.REFERENCE_CAPACITY_EXCEEDED;
    throw error;
  }
  const references = await Promise.all(paths.map(fileDataUrl));
  const body = { model: selectedModel, prompt, size };
  if (selectedModel === 'Image-GPT2') body.output_format = 'png';
  else body.metadata = { quality: 'medium' };
  if (operation === 'inpaint') {
    if (!references[0] || !maskPath) throw new Error('Inpaint requires a parent image and mask.');
    body.operation = 'inpaint'; body.image = references[0]; body.mask = await fileDataUrl(maskPath);
    if (references.length > 1) body.reference_images = references.slice(1);
  } else if (references.length === 1) body.image = references[0];
  else if (references.length > 1) body.images = references;
  const submitted = await fetchJson(`${config.baseUrl}/images/tasks`, {
    method: 'POST', headers: headers(config), body: JSON.stringify(body)
  }, 120000);
  const immediate = imageUrl(submitted.payload);
  if (immediate) return isTrustedKunpoCdnUrl(immediate)
    ? permanentImageResult(immediate, taskId(submitted.payload, submitted.response), size)
    : snapshotTransient
      ? transientImageSnapshot(immediate, taskId(submitted.payload, submitted.response), size)
      : permanentImageResult(immediate, taskId(submitted.payload, submitted.response), size);
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
      if (url) return isTrustedKunpoCdnUrl(url)
        ? permanentImageResult(url, id, size)
        : snapshotTransient ? transientImageSnapshot(url, id, size) : permanentImageResult(url, id, size);
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

async function repairImage(config, input) {
  const mode = input.mode === 'inpaint' ? 'inpaint' : 'regenerate';
  if (mode === 'inpaint' && !input.maskPath) throw new Error('Inpaint repair requires a real mask file.');
  return generateImage(config, {
    prompt: input.prompt,
    imagePaths: [input.sourcePath, input.overlayPath, input.componentBoardPath].filter(Boolean),
    size: input.size,
    model: input.model,
    maxReferenceImages: input.maxReferenceImages,
    operation: mode === 'inpaint' ? 'inpaint' : 'generate',
    maskPath: input.maskPath,
    snapshotTransient: true
  });
}

function safeConfig(config) {
  return {
    configured: config.configured,
    mode: config.mode,
    envSource: config.envSource,
    modelSource: config.modelSource,
    assistantModel: config.assistantModel || config.visionModel,
    visionModel: config.visionModel,
    critiqueModel: config.critiqueModel,
    imageModel: config.imageModel
  };
}

module.exports = { generateImage, isTrustedKunpoCdnUrl, repairImage, requestArtifact, requestAssistant, requestJson, safeConfig, taskId };
