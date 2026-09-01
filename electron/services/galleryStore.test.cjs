// 图库索引（v1.1 §5–§7）：登记/去重/隐藏恢复、回填与对账、下载门禁
// fail-closed、索引损坏不静默重建。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProjectStore } = require('./projectStore.cjs');
const { createGalleryStore, isDownloadAllowed, FAIL_CLOSED_MODE } = require('./galleryStore.cjs');

const TRUSTED = (name) => `https://kunpoapiimg.ziy.cc/gallery-tests/${name}.png`;

async function withStore(body) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-store-'));
  try {
    const projectStore = createProjectStore({ workspaceRoot: root });
    const galleryStore = createGalleryStore({
      workspaceRoot: root,
      projectStore,
      isTrustedCdnUrl: (url) => /^https:\/\/kunpoapiimg\.ziy\.cc\//.test(String(url)) && /\.(png|jpe?g|webp)$/i.test(String(url))
    });
    return await body({ root, projectStore, galleryStore });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const explorationContext = (overrides = {}) => ({
  projectId: 'demo-project', screenId: 'main', screenName: '主页面',
  continuationMode: 'exploration', projectName: '演示项目', projectStatus: 'draft',
  originKind: 'visual_exploration', ...overrides
});

const variation = (id, url, overrides = {}) => ({
  id, image_url: url, provider_task_id: `task-${id}`, strategy: 'conservative',
  storageMode: 'provider_cdn', created_at: '2026-08-20T10:00:00.000Z',
  output_width: 1920, output_height: 1080, target_size: '1920x1080', ...overrides
});

test('registerVariation 登记可信 CDN 资产并携带路线快照', () => withStore(async ({ galleryStore }) => {
  const asset = await galleryStore.registerVariation(explorationContext(), variation('v1', TRUSTED('v1')));
  assert.ok(asset);
  assert.equal(asset.cdn_url, TRUSTED('v1'));
  assert.equal(asset.continuation_mode, 'exploration');
  assert.equal(asset.storage_mode, 'provider_cdn');
  assert.equal(asset.remote_only, true);
  assert.equal(asset.project_name_snapshot, '演示项目');
  assert.equal(asset.screen_name_snapshot, '主页面');
  assert.ok(isDownloadAllowed(asset));
}));

test('registerVariation 拒绝不可信 URL 与非 provider_cdn 存储', () => withStore(async ({ galleryStore }) => {
  assert.equal(await galleryStore.registerVariation(explorationContext(), variation('v2', 'https://evil.example.com/v2.png')), null);
  assert.equal(await galleryStore.registerVariation(explorationContext(), variation('v3', TRUSTED('v3'), { storageMode: 'inline_snapshot' })), null);
  const index = await fs.readFile(path.join(galleryStore.indexPath), 'utf8').catch(() => '');
  assert.ok(!index.includes('evil.example.com'));
}));

test('同一 URL 重复登记保留 id 与 hidden_at，只刷新 last_seen_at', () => withStore(async ({ galleryStore }) => {
  const first = await galleryStore.registerVariation(explorationContext(), variation('v1', TRUSTED('dup')));
  await galleryStore.hide(first.id);
  const second = await galleryStore.registerVariation(explorationContext({ continuationMode: 'existing-strict' }), variation('v1', TRUSTED('dup')));
  assert.equal(second.id, first.id);
  assert.ok(second.hidden_at, '隐藏状态必须保留');
  assert.equal(second.continuation_mode, 'exploration', '既有路线快照不得被后来的登记覆盖');
}));

test('缺失路线快照时下载门禁 fail-closed', () => withStore(async ({ galleryStore }) => {
  const asset = await galleryStore.registerVariation(explorationContext({ continuationMode: undefined }), variation('v1', TRUSTED('unknown-mode')));
  assert.equal(asset.continuation_mode, FAIL_CLOSED_MODE);
  assert.equal(isDownloadAllowed(asset), false);
  const strict = await galleryStore.registerVariation(explorationContext({ continuationMode: 'existing-strict' }), variation('v2', TRUSTED('strict')));
  assert.equal(isDownloadAllowed(strict), false);
  const guided = await galleryStore.registerVariation(explorationContext({ continuationMode: 'existing-guided' }), variation('v3', TRUSTED('guided')));
  assert.equal(isDownloadAllowed(guided), true);
}));

test('hide/restore 只切换 hidden_at，未知资产报错', () => withStore(async ({ galleryStore }) => {
  const asset = await galleryStore.registerVariation(explorationContext(), variation('v1', TRUSTED('toggle')));
  const hidden = await galleryStore.hide(asset.id);
  assert.ok(hidden.hidden_at);
  const restored = await galleryStore.restore(asset.id);
  assert.equal(restored.hidden_at, null);
  await assert.rejects(() => galleryStore.hide('missing-id'), /不存在/);
  await assert.rejects(() => galleryStore.getDownloadAsset('missing-id'), /不存在/);
}));

test('list 支持 scope、筛选、排序、游标分页与 facets', () => withStore(async ({ galleryStore }) => {
  for (let index = 0; index < 5; index += 1) {
    await galleryStore.registerVariation(explorationContext(), variation(`v${index}`, TRUSTED(`page-${index}`), { created_at: `2026-08-2${index}T10:00:00.000Z` }));
  }
  const hidden = await galleryStore.registerVariation(explorationContext(), variation('vh', TRUSTED('hidden-asset')));
  await galleryStore.hide(hidden.id);

  const all = await galleryStore.list({ limit: 2, sort: 'newest' });
  assert.equal(all.total, 5, 'all scope 不含已隐藏');
  assert.equal(all.items.length, 2);
  assert.ok(all.nextCursor);
  const page2 = await galleryStore.list({ limit: 2, sort: 'newest', cursor: all.nextCursor });
  assert.equal(page2.items.length, 2);
  assert.notEqual(page2.items[0].id, all.items[0].id);
  const hiddenScope = await galleryStore.list({ scope: 'hidden' });
  assert.equal(hiddenScope.total, 1);
  assert.equal(hiddenScope.items[0].id, hidden.id);
  assert.ok(all.facets.projects.some((facet) => facet.id === 'demo-project'));
  const oldest = await galleryStore.list({ sort: 'oldest', limit: 1 });
  assert.equal(oldest.items[0].cdn_url, TRUSTED('page-0'));
  const filtered = await galleryStore.list({ query: 'page-3' });
  assert.equal(filtered.total, 1);
}));

test('回填当前结果与历史快照，缺失路线按 fail-closed 登记', () => withStore(async ({ root, projectStore, galleryStore }) => {
  const project = await projectStore.create({ name: '回填项目', projectType: 'new' });
  // 两轮保存：第二轮把第一轮推入历史快照。
  await projectStore.saveArtifact(project.id, 'visual-results', {
    schema_version: '1.0', id: 'main-visual-results', version: 1, status: 'generated', source: {},
    variations: [variation('old', TRUSTED('history-old'), { created_at: undefined })]
  }, { screenId: 'main' });
  await projectStore.saveArtifact(project.id, 'visual-results', {
    schema_version: '1.0', id: 'main-visual-results', version: 2, status: 'generated', source: {},
    variations: [variation('current', TRUSTED('current'))]
  }, { screenId: 'main' });

  await galleryStore.backfillHistoryIfNeeded();
  const result = await galleryStore.list({ scope: 'all', limit: 100 });
  const urls = result.items.map((item) => item.cdn_url);
  assert.ok(urls.includes(TRUSTED('current')), '当前结果必须回填');
  assert.ok(urls.includes(TRUSTED('history-old')), '历史快照必须回填');
  const historical = result.items.find((item) => item.cdn_url === TRUSTED('history-old'));
  assert.equal(historical.continuation_mode, FAIL_CLOSED_MODE, '历史快照缺失路线证据时按 fail-closed');
  const current = result.items.find((item) => item.cdn_url === TRUSTED('current'));
  assert.equal(current.continuation_mode, 'exploration');

  const raw = JSON.parse(await fs.readFile(path.join(root, '.gallery', 'index.json'), 'utf8'));
  assert.ok(raw.initial_backfill_completed_at);
}));

test('轻量对账补齐登记遗漏，且绝不清除 hidden_at', () => withStore(async ({ projectStore, galleryStore }) => {
  const project = await projectStore.create({ name: '对账项目', projectType: 'new' });
  const seed = variation('late', TRUSTED('late-arrived'));
  await projectStore.saveArtifact(project.id, 'visual-results', {
    schema_version: '1.0', id: 'main-visual-results', version: 1, status: 'generated', source: {}, variations: [seed]
  }, { screenId: 'main' });
  await galleryStore.reconcileCurrent();
  const found = await galleryStore.list({ query: 'late-arrived' });
  assert.equal(found.total, 1);
  await galleryStore.hide(found.items[0].id);
  await galleryStore.reconcileCurrent();
  const after = await galleryStore.list({ scope: 'hidden' });
  assert.equal(after.total, 1, '对账不得复活用户隐藏的资产');
}));

test('并发登记经写队列串行提交，不丢失记录', () => withStore(async ({ galleryStore }) => {
  await Promise.all(Array.from({ length: 12 }, (_, index) =>
    galleryStore.registerVariation(explorationContext(), variation(`c${index}`, TRUSTED(`concurrent-${index}`)))));
  const result = await galleryStore.list({ limit: 100 });
  assert.equal(result.total, 12);
}));

test('索引损坏时明确报错，不静默重建空索引', () => withStore(async ({ galleryStore }) => {
  await galleryStore.registerVariation(explorationContext(), variation('v1', TRUSTED('corrupt-guard')));
  await fs.writeFile(galleryStore.indexPath, '{ not valid json');
  await assert.rejects(() => galleryStore.list({}), SyntaxError);
  const raw = await fs.readFile(galleryStore.indexPath, 'utf8');
  assert.ok(raw.includes('not valid json'), '损坏文件必须原样保留供人工恢复');
}));
