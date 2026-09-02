const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readJson, writeJson } = require('./jsonStore.cjs');

// 图库（v1.1 §5–§7）：用户/租户级可重建物化目录。
// 权威仍在各项目 visual-results 与保留的历史快照；本索引只是按可信
// 永久 CDN URL 去重的查询视图。登记失败不阻断生成（§5.4），打开时
// 轻量对账负责补齐（§6.3）。

const CONTINUATION_MODES = new Set(['exploration', 'existing-guided', 'existing-strict', 'locked-continuation']);
// §7.5 fail-closed：快照缺失或无法识别的路线一律按最严格的
// existing-strict 处理，下载被阻断；绝不为了可下载而放宽。
const FAIL_CLOSED_MODE = 'existing-strict';
const DOWNLOADABLE_MODES = new Set(['exploration', 'existing-guided']);
const HISTORY_SNAPSHOTS_PER_SCREEN = 20;
const DEFAULT_LIMIT = 40;

function normalizeMode(value) {
  return CONTINUATION_MODES.has(value) ? value : FAIL_CLOSED_MODE;
}

function isDownloadAllowed(asset) {
  return DOWNLOADABLE_MODES.has(asset?.continuation_mode);
}

function orientationOf(asset) {
  const width = Number(asset.width);
  const height = Number(asset.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (width > height) return 'landscape';
  if (width < height) return 'portrait';
  return 'square';
}

function createGalleryStore({ workspaceRoot, projectStore, isTrustedCdnUrl }) {
  if (!workspaceRoot) throw new Error('galleryStore requires workspaceRoot.');
  if (!projectStore) throw new Error('galleryStore requires projectStore.');
  if (typeof isTrustedCdnUrl !== 'function') throw new Error('galleryStore requires isTrustedCdnUrl.');
  const indexPath = path.join(workspaceRoot, '.gallery', 'index.json');

  // §5.4：同一 index 文件的写操作经 Promise 队列串行提交，
  // 并行完成多张图片时不会后写覆盖先写。
  let writeQueue = Promise.resolve();
  function enqueue(operation) {
    const run = writeQueue.catch(() => {}).then(() => operation());
    writeQueue = run.catch(() => {});
    return run;
  }

  // jsonStore.readJson 对损坏文件抛错（非 ENOENT）：错误必须上抛给
  // UI 显示，绝不静默重建空索引（§6.3）。
  async function readIndex() {
    const stored = await readJson(indexPath, null);
    if (!stored) return { schema_version: '1.0', assets: [] };
    if (!Array.isArray(stored.assets)) return { schema_version: '1.0', assets: [], initial_backfill_completed_at: stored.initial_backfill_completed_at, last_reconciled_at: stored.last_reconciled_at };
    return stored;
  }

  async function commit(mutator) {
    return enqueue(async () => {
      const index = await readIndex();
      const result = await mutator(index);
      await writeJson(indexPath, index);
      return result;
    });
  }

  function trustedVariationImage(variation) {
    const url = typeof variation?.image_url === 'string' ? variation.image_url.trim() : '';
    if (!url) return '';
    const storage = variation.storageMode || variation.storage_mode;
    if (storage && storage !== 'provider_cdn') return '';
    return isTrustedCdnUrl(url) ? url : '';
  }

  function applyRegistration(index, context, variation, fallbackCreatedAt) {
    const cdnUrl = trustedVariationImage(variation);
    if (!cdnUrl) return null;
    const now = new Date().toISOString();
    const incoming = {
      provider_task_id: variation.provider_task_id || undefined,
      project_id: context.projectId || undefined,
      project_name_snapshot: context.projectName || undefined,
      project_status_snapshot: context.projectStatus === 'archived' ? 'archived' : 'draft',
      screen_id: context.screenId || undefined,
      screen_name_snapshot: context.screenName || undefined,
      variation_id: variation.id || undefined,
      strategy: variation.strategy || undefined,
      layout_name: variation.layout_name || undefined,
      style_name: variation.style_name || undefined,
      width: Number(variation.output_width || variation.width) || undefined,
      height: Number(variation.output_height || variation.height) || undefined,
      target_size: variation.target_size || undefined,
      created_at: variation.created_at || fallbackCreatedAt || undefined,
      mode_provenance: context.modeProvenance || 'task-start'
    };
    const existing = index.assets.find((asset) => asset.cdn_url === cdnUrl);
    if (existing) {
      // §5.3：同一 URL 再次登记——刷新 last_seen_at、补齐缺失元数据，
      // 保留原 id / indexed_at / hidden_at / created_at / continuation_mode。
      for (const [key, value] of Object.entries(incoming)) {
        if (existing[key] === undefined || existing[key] === null || existing[key] === '') existing[key] = value;
      }
      existing.last_seen_at = now;
      return existing;
    }
    const asset = {
      id: randomUUID(),
      cdn_url: cdnUrl,
      provider: 'kunpo',
      provider_task_id: incoming.provider_task_id,
      storage_mode: 'provider_cdn',
      remote_only: true,
      origin_kind: context.originKind === 'underlay_repair' ? 'underlay_repair' : 'visual_exploration',
      continuation_mode: normalizeMode(context.continuationMode),
      mode_provenance: incoming.mode_provenance,
      project_id: incoming.project_id,
      project_name_snapshot: incoming.project_name_snapshot,
      project_status_snapshot: incoming.project_status_snapshot,
      screen_id: incoming.screen_id,
      screen_name_snapshot: incoming.screen_name_snapshot,
      variation_id: incoming.variation_id,
      strategy: incoming.strategy,
      layout_name: incoming.layout_name,
      style_name: incoming.style_name,
      width: incoming.width,
      height: incoming.height,
      target_size: incoming.target_size,
      created_at: incoming.created_at || now,
      indexed_at: now,
      last_seen_at: now,
      hidden_at: null
    };
    index.assets.push(asset);
    return asset;
  }

  async function registerVariation(context = {}, variation = {}) {
    return commit((index) => applyRegistration(index, context, variation));
  }

  function safeSnapshotPath(projectPath, relative) {
    const candidate = path.resolve(projectPath, String(relative || ''));
    return candidate.startsWith(`${path.resolve(projectPath)}${path.sep}`) ? candidate : null;
  }

  async function projectScreenResults(project) {
    const registry = await projectStore.listScreens(project.id).catch(() => ({ screens: [] }));
    const outputs = [];
    for (const screen of registry.screens || []) {
      const results = await readJson(path.join(project.workspacePath, 'screens', screen.id, 'explorations', 'results.json'), null).catch(() => null);
      if (results) outputs.push({ screenId: screen.id, screenName: screen.name, variations: results.variations || [], savedAt: results.updated_at });
    }
    return outputs;
  }

  async function projectHistorySnapshots(project, limit) {
    const history = await readJson(path.join(project.workspacePath, 'workflow', 'artifact-history.json'), []).catch(() => []);
    const snapshots = [];
    for (const entry of (history || []).filter((item) => item?.kind === 'visual-results').slice(0, limit)) {
      const snapshotPath = safeSnapshotPath(project.workspacePath, entry.snapshot);
      if (!snapshotPath) continue;
      const snapshot = await readJson(snapshotPath, null).catch(() => null);
      if (!snapshot) continue;
      snapshots.push({ screenId: typeof snapshot.screen_id === 'string' ? snapshot.screen_id : undefined, variations: snapshot.variations || [], savedAt: entry.saved_at || snapshot.updated_at });
    }
    return snapshots;
  }

  // §6.3：轻量对账——全部 Screen 当前 visual-results + 每屏最近 20 条
  // 历史快照。只增补/刷新，绝不清除 hidden_at（applyRegistration 保留）。
  async function reconcileCurrent() {
    const projects = await projectStore.list().catch(() => []);
    await warmRegistryCache(projects);
    await commit(async (index) => {
      for (const project of projects || []) {
        if (!project?.workspacePath) continue;
        const context = {
          projectId: project.id, projectName: project.name, projectStatus: project.status,
          continuationMode: project.continuation_mode, originKind: 'visual_exploration'
        };
        const screens = await projectScreenResults(project);
        for (const { screenId, screenName, variations, savedAt } of screens) {
          for (const variation of variations) applyRegistration(index, { ...context, screenId, screenName }, variation, savedAt);
        }
        // 历史快照缺少生成时路线证据，按 fail-closed 登记；已登记资产
        // 的既有快照在 upsert 中被保留。
        const snapshots = await projectHistorySnapshots(project, HISTORY_SNAPSHOTS_PER_SCREEN);
        for (const { screenId, variations, savedAt } of snapshots) {
          for (const variation of variations) {
            const resolvedScreenId = screenId || resolveScreenFromVariationId(project.id, variation?.id);
            const screenName = resolvedScreenId ? registryScreenName(projects, project.id, resolvedScreenId) : undefined;
            applyRegistration(index, { ...context, continuationMode: FAIL_CLOSED_MODE, modeProvenance: 'fail-closed', screenId: resolvedScreenId, screenName, originKind: variation.strategy === 'underlay-repair' ? 'underlay_repair' : 'visual_exploration' }, variation, savedAt);
          }
        }
      }
      index.last_reconciled_at = new Date().toISOString();
    });
  }

  const registryCache = new Map();
  function registryScreenName(projects, projectId, screenId) {
    return registryCache.get(`${projectId}:${screenId}`);
  }
  async function warmRegistryCache(projects) {
    registryCache.clear();
    for (const project of projects || []) {
      const registry = await projectStore.listScreens(project.id).catch(() => ({ screens: [] }));
      for (const screen of registry.screens || []) registryCache.set(`${project.id}:${screen.id}`, screen.name);
    }
  }

  // 历史快照不带 screen 字段，但 variation_id 带 Screen id 前缀
  // （如 main-conservative-…），按注册表反查恢复 Screen 上下文；最长前缀优先。
  function resolveScreenFromVariationId(projectId, variationId) {
    if (typeof variationId !== 'string') return undefined;
    let best;
    for (const key of registryCache.keys()) {
      if (!key.startsWith(`${projectId}:`)) continue;
      const screenId = key.slice(projectId.length + 1);
      if (variationId.startsWith(`${screenId}-`) && (!best || screenId.length > best.length)) best = screenId;
    }
    return best;
  }

  // §6.2：首次完整回填（含全部历史快照）。只在
  // initial_backfill_completed_at 缺失时执行；写索引成功后才记录完成。
  async function backfillHistoryIfNeeded() {
    const projects = await projectStore.list().catch(() => []);
    await warmRegistryCache(projects);
    await commit(async (index) => {
      if (index.initial_backfill_completed_at) return;
      for (const project of projects || []) {
        if (!project?.workspacePath) continue;
        const context = {
          projectId: project.id, projectName: project.name, projectStatus: project.status,
          continuationMode: project.continuation_mode, originKind: 'visual_exploration'
        };
        const screens = await projectScreenResults(project);
        for (const { screenId, screenName, variations, savedAt } of screens) {
          for (const variation of variations) applyRegistration(index, { ...context, screenId, screenName }, variation, savedAt);
        }
        const snapshots = await projectHistorySnapshots(project, Number.MAX_SAFE_INTEGER);
        for (const { screenId, variations, savedAt } of snapshots) {
          for (const variation of variations) {
            const resolvedScreenId = screenId || resolveScreenFromVariationId(project.id, variation?.id);
            const screenName = resolvedScreenId ? registryScreenName(projects, project.id, resolvedScreenId) : undefined;
            applyRegistration(index, { ...context, continuationMode: FAIL_CLOSED_MODE, modeProvenance: 'fail-closed', screenId: resolvedScreenId, screenName, originKind: variation.strategy === 'underlay-repair' ? 'underlay_repair' : 'visual_exploration' }, variation, savedAt);
          }
        }
      }
      index.initial_backfill_completed_at = new Date().toISOString();
    });
  }

  function matchesQuery(asset, query = {}) {
    const hidden = asset.hidden_at != null;
    if ((query.scope || 'all') === 'hidden' ? !hidden : hidden) return false;
    if (query.projectId && asset.project_id !== query.projectId) return false;
    if (query.screenId && asset.screen_id !== query.screenId) return false;
    if (query.orientation && orientationOf(asset) !== query.orientation) return false;
    if (query.range && query.range !== 'all') {
      const created = Date.parse(asset.created_at);
      if (!Number.isFinite(created)) return false;
      const start = new Date();
      if (query.range === 'today') { start.setHours(0, 0, 0, 0); }
      else if (query.range === '7d') start.setDate(start.getDate() - 7);
      else if (query.range === '30d') start.setDate(start.getDate() - 30);
      else return false;
      if (created < start.getTime()) return false;
    }
    if (query.query) {
      const needle = String(query.query).trim().toLowerCase();
      if (needle) {
        const haystack = [asset.project_name_snapshot, asset.screen_name_snapshot, asset.strategy, asset.layout_name, asset.style_name, asset.cdn_url]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
    }
    return true;
  }

  function encodeCursor(created, id) {
    return Buffer.from(JSON.stringify({ t: created, id }), 'utf8').toString('base64url');
  }

  function decodeCursor(cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(String(cursor || ''), 'base64url').toString('utf8'));
      return typeof parsed?.t === 'string' && typeof parsed?.id === 'string' ? parsed : null;
    } catch { return null; }
  }

  async function list(query = {}) {
    // §7.2：首页查询前先回填/对账；翻页请求（带 cursor）不重复扫描。
    if (!query.cursor) {
      await backfillHistoryIfNeeded();
      await reconcileCurrent();
    }
    const index = await readIndex();
    const filtered = index.assets.filter((asset) => matchesQuery(asset, query));
    const direction = query.sort === 'oldest' ? 1 : -1;
    filtered.sort((a, b) => {
      const delta = String(a.created_at).localeCompare(String(b.created_at)) * direction;
      return delta !== 0 ? delta : String(a.id).localeCompare(String(b.id));
    });
    const cursor = decodeCursor(query.cursor);
    let start = 0;
    if (cursor) {
      start = filtered.findIndex((asset) => {
        const delta = String(asset.created_at).localeCompare(cursor.t) * direction;
        return delta > 0 || (delta === 0 && String(asset.id).localeCompare(cursor.id) > 0);
      });
      if (start < 0) start = filtered.length;
    }
    const limit = Math.max(1, Math.min(Number(query.limit) || DEFAULT_LIMIT, 200));
    const items = filtered.slice(start, start + limit);
    const nextItem = filtered[start + limit];
    // facets 基于当前 scope 的全部资产构建，筛选器选项不受分页影响。
    const projectFacets = new Map();
    const screenFacets = new Map();
    for (const asset of index.assets.filter((item) => matchesQuery(item, { scope: query.scope }))) {
      if (asset.project_id && !projectFacets.has(asset.project_id)) {
        projectFacets.set(asset.project_id, { id: asset.project_id, name: asset.project_name_snapshot || asset.project_id, status: asset.project_status_snapshot || 'draft' });
      }
      if (asset.screen_id && !screenFacets.has(asset.screen_id)) {
        screenFacets.set(asset.screen_id, { id: asset.screen_id, name: asset.screen_name_snapshot || asset.screen_id, projectId: asset.project_id });
      }
    }
    return {
      items,
      total: filtered.length,
      nextCursor: nextItem ? encodeCursor(nextItem.created_at, nextItem.id) : null,
      facets: { projects: [...projectFacets.values()], screens: [...screenFacets.values()] }
    };
  }

  async function hide(assetId) {
    return commit((index) => {
      const asset = index.assets.find((item) => item.id === assetId);
      if (!asset) throw Object.assign(new Error(`图库资产不存在：${assetId}`), { code: 'GALLERY_ASSET_NOT_FOUND', status: 404 });
      asset.hidden_at = asset.hidden_at || new Date().toISOString();
      return asset;
    });
  }

  async function restore(assetId) {
    return commit((index) => {
      const asset = index.assets.find((item) => item.id === assetId);
      if (!asset) throw Object.assign(new Error(`图库资产不存在：${assetId}`), { code: 'GALLERY_ASSET_NOT_FOUND', status: 404 });
      asset.hidden_at = null;
      return asset;
    });
  }

  // 下载边界（§7.2/§7.5）：只按已登记 assetId 读取；调用方拿到资产后
  // 必须再次执行可信 CDN 校验与 continuation_mode 快照门禁。
  async function getDownloadAsset(assetId) {
    const index = await readIndex();
    const asset = index.assets.find((item) => item.id === assetId);
    if (!asset) throw Object.assign(new Error(`图库资产不存在：${assetId}`), { code: 'GALLERY_ASSET_NOT_FOUND', status: 404 });
    return asset;
  }

  return { indexPath, list, registerVariation, reconcileCurrent, backfillHistoryIfNeeded, hide, restore, getDownloadAsset };
}

const STRICT_BLOCKED_MESSAGE = '严格继承项目的图片需回到工作流完成正式交付后导出。';
const FAIL_CLOSED_BLOCKED_MESSAGE = '历史快照缺少生成时路线证据，按受控交付处理；如需原图请在对应 Screen 重新生成或走正式交付导出。';

function blockedDownloadMessage(asset) {
  return asset?.mode_provenance === 'fail-closed' ? FAIL_CLOSED_BLOCKED_MESSAGE : STRICT_BLOCKED_MESSAGE;
}

module.exports = { createGalleryStore, isDownloadAllowed, blockedDownloadMessage, FAIL_CLOSED_MODE, DOWNLOADABLE_MODES };
