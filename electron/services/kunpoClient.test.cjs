const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { generateImage, isTrustedKunpoCdnUrl, repairImage, requestArtifact, taskId } = require('./kunpoClient.cjs');

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
