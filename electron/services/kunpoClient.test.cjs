const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { generateImage, isTrustedKunpoCdnUrl, repairImage, requestArtifact, requestJson, taskId } = require('./kunpoClient.cjs');

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

test('taskId prefers body task_id over request trace header', () => {
  const response = { headers: new Headers({ 'x-request-id': 'trace-not-pollable' }) };
  assert.equal(taskId({ task_id: 'image-task-123' }, response), 'image-task-123');
});

test('taskId accepts explicit task header when body has no task id', () => {
  const response = { headers: new Headers({ 'x-task-id': 'image-task-456', 'x-request-id': 'trace-id' }) };
  assert.equal(taskId({ status: 'submitted' }, response), 'image-task-456');
});

test('permanent CDN validation rejects lookalike hosts and signed URLs', () => {
  assert.equal(isTrustedKunpoCdnUrl('https://kunpoapiimg.ziy.cc/images/output/test.png'), true);
  assert.equal(isTrustedKunpoCdnUrl('https://kunpoapiimg.ziy.cc.evil.test/test.png'), false);
  assert.equal(isTrustedKunpoCdnUrl('https://kunpoapiimg.ziy.cc/test.png?token=temporary'), false);
});

test('requestArtifact retries malformed JSON and returns a covered contract', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    const content = calls === 1 ? '{"broken":' : JSON.stringify({
      screen_id: 'main', screen_name: '阵容', purpose: '编成队伍', primary_action: '保存阵容',
      secondary_actions: [], required_information: ['战力'], required_controls: ['保存阵容'], states: [], edge_cases: [], data_dependencies: [],
      design_constraints: {}, source_inventory: { requirement_functions: ['保存阵容'], wireframe_controls: [], wireframe_information: ['战力'] },
      coverage: { covered_items: ['保存阵容', '战力'], uncovered_items: [] }
    });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const artifact = await requestArtifact({ configured: true, baseUrl: 'https://example.test', visionModel: 'vision', mode: 'gateway' }, {
      kind: 'screen-contract', prompt: 'test', id: 'main-contract', source: {}
    });
    assert.equal(calls, 2);
    assert.equal(artifact.screen_name, '阵容');
  } finally {
    global.fetch = originalFetch;
  }
});

test('requestArtifact repairs the previous structured draft instead of asking for a fresh regeneration', async () => {
  const originalFetch = global.fetch;
  const requestPrompts = [];
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    requestPrompts.push(body.messages[0].content[0].text);
    const content = JSON.stringify({
      screen_id: 'main', screen_name: '阵容', purpose: '编成队伍', primary_action: '保存阵容',
      secondary_actions: [], required_information: ['战力'],
      required_controls: calls === 1 ? ['保存阵容'] : ['保存阵容', '选择5名角色'],
      states: [], edge_cases: [], data_dependencies: [], design_constraints: {},
      source_inventory: { requirement_functions: ['保存阵容', '选择5名角色'], wireframe_controls: [], wireframe_information: ['战力'] },
      coverage: { covered_items: calls === 1 ? ['保存阵容', '战力'] : ['保存阵容', '选择5名角色', '战力'], uncovered_items: [] }
    });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const artifact = await requestArtifact({ configured: true, baseUrl: 'https://example.test', visionModel: 'vision', mode: 'gateway' }, {
      kind: 'screen-contract', prompt: 'test', id: 'main-contract', source: {}
    });
    assert.equal(calls, 2);
    assert.match(requestPrompts[1], /INVALID_DRAFT/);
    assert.match(requestPrompts[1], /选择5名角色/);
    assert.deepEqual(artifact.required_controls.map((control) => control.label), ['保存阵容', '选择5名角色']);
    assert.deepEqual(artifact.required_controls.map((control) => control.migrated_from_label), ['保存阵容', '选择5名角色']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('generateImage verifies the returned bitmap matches the requested portrait ratio', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).endsWith('/images/tasks')) {
      return new Response(JSON.stringify({ result_url: 'https://kunpoapiimg.ziy.cc/output/portrait.png', task_id: 'portrait' }), { status: 200 });
    }
    return new Response(pngHeader(864, 1536), { status: 200, headers: { 'content-type': 'image/png' } });
  };
  try {
    const result = await generateImage({ configured: true, baseUrl: 'https://example.test', imageModel: 'Image-GPT2', mode: 'gateway' }, {
      prompt: 'portrait', size: '864x1536'
    });
    assert.equal(result.width, 864);
    assert.equal(result.height, 1536);
  } finally {
    global.fetch = originalFetch;
  }
});

test('repairImage submits distinct inpaint and regenerate payloads with real evidence files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-provider-repair-'));
  const originalFetch = global.fetch; const bodies = [];
  try {
    const files = {};
    for (const name of ['source.png', 'overlay.png', 'board.png', 'mask.png']) { files[name] = path.join(root, name); await fs.writeFile(files[name], pngHeader(128, 64)); }
    global.fetch = async (url, options) => {
      if (String(url).endsWith('/images/tasks')) { const body = JSON.parse(options.body); bodies.push(body); return new Response(JSON.stringify({ result_url: `https://kunpoapiimg.ziy.cc/output/${bodies.length}.png`, task_id: `repair-${bodies.length}` }), { status: 200 }); }
      return new Response(pngHeader(128, 64), { status: 200, headers: { 'content-type': 'image/png' } });
    };
    const config = { configured: true, baseUrl: 'https://example.test', imageModel: 'Image-GPT2', mode: 'gateway' };
    await repairImage(config, { mode: 'inpaint', prompt: 'repair', sourcePath: files['source.png'], overlayPath: files['overlay.png'], componentBoardPath: files['board.png'], maskPath: files['mask.png'], size: '128x64', maxReferenceImages: 6 });
    await repairImage(config, { mode: 'regenerate', prompt: 'repair', sourcePath: files['source.png'], overlayPath: files['overlay.png'], componentBoardPath: files['board.png'], size: '128x64', maxReferenceImages: 6 });
    assert.equal(bodies[0].operation, 'inpaint'); assert.match(bodies[0].mask, /^data:image\/png;base64,/); assert.equal(bodies[0].reference_images.length, 2);
    assert.equal(bodies[1].operation, undefined); assert.equal(bodies[1].images.length, 3);
  } finally { global.fetch = originalFetch; await fs.rm(root, { recursive: true, force: true }); }
});

test('repairImage snapshots signed Kunpo CDN results instead of persisting transient URLs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-provider-snapshot-'));
  const originalFetch = global.fetch;
  try {
    const source = path.join(root, 'source.png'); await fs.writeFile(source, pngHeader(128, 64));
    global.fetch = async (url) => String(url).endsWith('/images/tasks')
      ? new Response(JSON.stringify({ result_url: 'https://kunpoapiimg.ziy.cc/output/repair.png?token=temporary', task_id: 'signed-repair' }), { status: 200 })
      : new Response(pngHeader(128, 64), { status: 200, headers: { 'content-type': 'image/png' } });
    const result = await repairImage({ configured: true, baseUrl: 'https://example.test', imageModel: 'Image-GPT2', mode: 'gateway' }, {
      mode: 'regenerate', prompt: 'repair', sourcePath: source, overlayPath: source, componentBoardPath: source, size: '128x64', maxReferenceImages: 6
    });
    assert.equal(result.storageMode, 'inline_snapshot');
    assert.equal(result.remoteOnly, false);
    assert.match(result.url, /^data:image\/png;base64,/);
    assert.equal(result.source_location.has_query, true);
  } finally { global.fetch = originalFetch; await fs.rm(root, { recursive: true, force: true }); }
});

test('snapshot download refuses redirects and oversized bodies without following them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-provider-redirect-'));
  const originalFetch = global.fetch;
  try {
    const source = path.join(root, 'source.png'); await fs.writeFile(source, pngHeader(128, 64));
    const seen = [];
    global.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/images/tasks')) return new Response(JSON.stringify({ result_url: 'https://kunpoapiimg.ziy.cc/output/repair.png?token=temporary', task_id: 'redirect-repair' }), { status: 200 });
      seen.push({ url: String(url), redirect: options.redirect });
      if (options.redirect !== 'error') throw new TypeError('fetch must not be allowed to follow redirects in this test');
      const error = new TypeError('redirect not allowed'); error.name = 'TypeError'; throw error;
    };
    await assert.rejects(repairImage({ configured: true, baseUrl: 'https://example.test', imageModel: 'Image-GPT2', mode: 'gateway' }, {
      mode: 'regenerate', prompt: 'repair', sourcePath: source, overlayPath: source, componentBoardPath: source, size: '128x64', maxReferenceImages: 6
    }), /Unable to snapshot the transient Kunpo image/);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].redirect, 'error');
  } finally { global.fetch = originalFetch; await fs.rm(root, { recursive: true, force: true }); }
});

test('snapshot download rejects bodies declared larger than the 25MB limit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-provider-oversize-'));
  const originalFetch = global.fetch;
  try {
    const source = path.join(root, 'source.png'); await fs.writeFile(source, pngHeader(128, 64));
    global.fetch = async (url) => String(url).endsWith('/images/tasks')
      ? new Response(JSON.stringify({ result_url: 'https://kunpoapiimg.ziy.cc/output/repair.png?token=temporary', task_id: 'oversize-repair' }), { status: 200 })
      : new Response(pngHeader(128, 64), { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(26 * 1024 * 1024) } });
    await assert.rejects(repairImage({ configured: true, baseUrl: 'https://example.test', imageModel: 'Image-GPT2', mode: 'gateway' }, {
      mode: 'regenerate', prompt: 'repair', sourcePath: source, overlayPath: source, componentBoardPath: source, size: '128x64', maxReferenceImages: 6
    }), /25MB snapshot limit/);
  } finally { global.fetch = originalFetch; await fs.rm(root, { recursive: true, force: true }); }
});

test('repairImage snapshots signed Tencent COS delivery URLs from the provider', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-provider-cos-'));
  const originalFetch = global.fetch;
  try {
    const source = path.join(root, 'source.png'); await fs.writeFile(source, pngHeader(128, 64));
    const cosUrl = 'https://vcg-prod-1258344699.cos.ap-guangzhou.tencentcos.cn/imagegeneration/results/1328005011/ac5c2bae.png?sign=abc&q-sign-algorithm=sha1';
    global.fetch = async (url) => String(url).endsWith('/images/tasks')
      ? new Response(JSON.stringify({ result_url: cosUrl, task_id: 'cos-repair' }), { status: 200 })
      : new Response(pngHeader(128, 64), { status: 200, headers: { 'content-type': 'image/png' } });
    const result = await repairImage({ configured: true, baseUrl: 'https://example.test', imageModel: 'Image-GPT2', mode: 'gateway' }, {
      mode: 'regenerate', prompt: 'repair', sourcePath: source, overlayPath: source, componentBoardPath: source, size: '128x64', maxReferenceImages: 6
    });
    assert.equal(result.storageMode, 'inline_snapshot');
    assert.equal(result.source_location.hostname, 'vcg-prod-1258344699.cos.ap-guangzhou.tencentcos.cn');
    assert.match(result.url, /^data:image\/png;base64,/);
  } finally { global.fetch = originalFetch; await fs.rm(root, { recursive: true, force: true }); }
});

test('snapshot host allowlist rejects lookalike hosts and non-image content types', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-provider-lookalike-'));
  const originalFetch = global.fetch;
  try {
    const source = path.join(root, 'source.png'); await fs.writeFile(source, pngHeader(128, 64));
    const run = async (resultUrl, contentType) => {
      global.fetch = async (url) => String(url).endsWith('/images/tasks')
        ? new Response(JSON.stringify({ result_url: resultUrl, task_id: 'lookalike' }), { status: 200 })
        : new Response(pngHeader(128, 64), { status: 200, headers: { 'content-type': contentType } });
      return repairImage({ configured: true, baseUrl: 'https://example.test', imageModel: 'Image-GPT2', mode: 'gateway' }, {
        mode: 'regenerate', prompt: 'repair', sourcePath: source, overlayPath: source, componentBoardPath: source, size: '128x64', maxReferenceImages: 6
      });
    };
    await assert.rejects(run('https://vcg-prod-1258344699.cos.ap-guangzhou.tencentcos.cn.evil.test/x.png', 'image/png'), /untrusted image location/);
    await assert.rejects(run('https://kunpoapiimg.ziy.cc/output/repair.png?token=temporary', 'text/html'), /unexpected content type/);
  } finally { global.fetch = originalFetch; await fs.rm(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// v1.4 §7.5 / §13.2：requestJson 的 processValue 纠正环与捕获语义。
// ---------------------------------------------------------------------------

function jsonResponse(content, extra = {}) {
  return new Response(JSON.stringify({ id: 'resp-1', model: 'vision-x', ...extra, choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const REQUEST_JSON_CONFIG = { configured: true, baseUrl: 'https://example.test', visionModel: 'vision-x', mode: 'gateway' };

test('requestJson retries with bounded validation feedback when processValue reports errors', async () => {
  const originalFetch = global.fetch;
  const prompts = [];
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    prompts.push(JSON.parse(options.body).messages[0].content[0].text);
    const content = calls === 1 ? JSON.stringify({ page_type: 'bogus' }) : JSON.stringify({ page_type: 'full_screen' });
    return jsonResponse(content);
  };
  const processValue = (value) => value.page_type === 'full_screen'
    ? { value, errors: [], warnings: [] }
    : { value: null, errors: ['page_type 不在枚举内'], warnings: [], repairContext: { page_type: 'bogus' } };
  try {
    const result = await requestJson(REQUEST_JSON_CONFIG, { prompt: 'BASE_PROMPT', processValue });
    assert.equal(calls, 2);
    assert.deepEqual(result.value, { page_type: 'full_screen' });
    assert.deepEqual(result.warnings, []);
    assert.match(prompts[1], /Attempt 1 failed validation with 1 error\(s\)/);
    assert.match(prompts[1], /page_type 不在枚举内/);
    assert.match(prompts[1], /"page_type":"bogus"/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('requestJson does not retry on warnings and captures provider metadata only', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; return jsonResponse(JSON.stringify({ page_type: 'full_screen' })); };
  try {
    const result = await requestJson(REQUEST_JSON_CONFIG, {
      prompt: 'BASE', captureMeta: true,
      processValue: (value) => ({ value, errors: [], warnings: ['仅提示：层数量为 1'] })
    });
    assert.equal(calls, 1);
    assert.equal(result.capture_version, '1.0');
    assert.equal(result.attempt, 1);
    assert.deepEqual(result.warnings, ['仅提示：层数量为 1']);
    assert.equal(result.provider.response_id, 'resp-1');
    assert.equal(result.provider.model, 'vision-x');
    // meta 载荷绝不含 raw text / Key / data URL。
    assert.equal(result.raw_text, undefined);
    assert.doesNotMatch(JSON.stringify(result), /data:image/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('requestJson caps feedback volume, truncates long errors and redacts data URLs', async () => {
  const originalFetch = global.fetch;
  const prompts = [];
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls += 1;
    prompts.push(JSON.parse(options.body).messages[0].content[0].text);
    return jsonResponse(calls === 1 ? JSON.stringify({ bad: true }) : JSON.stringify({ ok: true }));
  };
  const errors = Array.from({ length: 30 }, (_unused, index) => `错误条目-${index}-${'长'.repeat(400)}`);
  const processValue = (value) => value.ok
    ? { value, errors: [], warnings: [] }
    : { value: null, errors, warnings: [], repairContext: { image: 'data:image/png;base64,QUJDREVGRw==' } };
  try {
    const base = 'BASE_PROMPT';
    await requestJson(REQUEST_JSON_CONFIG, { prompt: base, processValue });
    const feedback = prompts[1].slice(base.length);
    assert.match(feedback, /错误条目-0-/);
    assert.match(feedback, /错误条目-19-/);
    assert.doesNotMatch(feedback, /错误条目-20-/);
    assert.doesNotMatch(feedback, /错误条目-29-/);
    assert.match(feedback, /\[redacted-image-data\]/);
    assert.doesNotMatch(feedback, /QUJDREVGRw/);
    assert.ok(Buffer.byteLength(feedback, 'utf8') <= 96 * 1024);
  } finally {
    global.fetch = originalFetch;
  }
});

test('requestJson gives up after three failed corrections and attaches the failureCode', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; return jsonResponse(JSON.stringify({ bad: true })); };
  try {
    await assert.rejects(
      requestJson(REQUEST_JSON_CONFIG, {
        prompt: 'BASE', failureCode: 'INTENT_ANALYSIS_INVALID',
        processValue: () => ({ value: null, errors: ['结构性错误'], warnings: [], repairContext: {} })
      }),
      (error) => {
        assert.equal(error.code, 'INTENT_ANALYSIS_INVALID');
        assert.match(error.message, /连续 3 次未返回有效内容/);
        return true;
      }
    );
    assert.equal(calls, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('requestJson reads each image once and reuses it across correction attempts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-provider-reads-'));
  const originalFetch = global.fetch;
  const originalReadFile = fs.readFile;
  const imagePath = path.join(root, 'wireframe.png');
  try {
    await fs.writeFile(imagePath, pngHeader(128, 64));
    let reads = 0;
    fs.readFile = (...args) => {
      if (String(args[0]) === imagePath) reads += 1;
      return originalReadFile.apply(fs, args);
    };
    let calls = 0;
    global.fetch = async () => { calls += 1; return jsonResponse(calls === 1 ? JSON.stringify({ bad: true }) : JSON.stringify({ ok: true })); };
    const processValue = (value) => value.ok ? { value, errors: [], warnings: [] } : { value: null, errors: ['非法'], warnings: [], repairContext: {} };
    // 基线：单次成功尝试的图片读取次数。
    await requestJson(REQUEST_JSON_CONFIG, { prompt: 'BASE', imagePaths: [imagePath], processValue: (value) => ({ value, errors: [], warnings: [] }) });
    const baselineReads = reads;
    reads = 0;
    calls = 0;
    const result = await requestJson(REQUEST_JSON_CONFIG, { prompt: 'BASE', imagePaths: [imagePath], captureMeta: true, processValue });
    assert.equal(calls, 2);
    assert.equal(result.attempt, 2);
    // 纠正重试不得重读图片：两次尝试的总读取次数与单次尝试相同。
    assert.equal(reads, baselineReads);
  } finally {
    global.fetch = originalFetch;
    fs.readFile = originalReadFile;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('requestJson keeps legacy captureRaw and plain return behavior without processValue', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => jsonResponse(JSON.stringify({ requirement_draft: '初稿文本' }));
  try {
    const captured = await requestJson(REQUEST_JSON_CONFIG, { prompt: 'BASE', requiredStringKeys: ['requirement_draft'], captureRaw: true });
    assert.equal(captured.capture_version, '1.0');
    assert.equal(captured.value.requirement_draft, '初稿文本');
    assert.match(captured.raw_text, /初稿文本/);
    assert.equal(captured.provider.model, 'vision-x');
    const plain = await requestJson(REQUEST_JSON_CONFIG, { prompt: 'BASE', requiredStringKeys: ['requirement_draft'] });
    assert.equal(plain.requirement_draft, '初稿文本');
  } finally {
    global.fetch = originalFetch;
  }
});
