const test = require('node:test');
const assert = require('node:assert/strict');
const { generateImage, isTrustedKunpoCdnUrl, requestArtifact, taskId } = require('./kunpoClient.cjs');

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
    assert.deepEqual(artifact.required_controls, ['保存阵容', '选择5名角色']);
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
