import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Download, ImageOff, LoaderCircle, RotateCcw, Search, X, ZoomIn, ZoomOut
} from 'lucide-react';
import { copilotApi } from '../../api';
import type { GalleryAsset, GalleryListResult, GalleryQuery } from '../../types';
import { friendlyError } from '../shared/ui';

export type GalleryHandle = { reinsert: (asset: GalleryAsset) => void };

type GalleryFilters = {
  scope: 'all' | 'hidden';
  projectId: string;
  screenId: string;
  orientation: '' | 'landscape' | 'portrait' | 'square';
  range: '' | 'today' | '7d' | '30d';
  sort: 'newest' | 'oldest';
};

const DEFAULT_FILTERS: GalleryFilters = { scope: 'all', projectId: '', screenId: '', orientation: '', range: '', sort: 'newest' };
const DOWNLOADABLE_MODES = new Set(['exploration', 'existing-guided']);
const STRICT_BLOCKED_MESSAGE = '严格继承项目的图片需回到工作流完成正式交付后导出。';
const FAIL_CLOSED_BLOCKED_MESSAGE = '历史快照缺少生成时路线证据，按受控交付处理；如需原图请在对应 Screen 重新生成或走正式交付导出。';
const blockedMessage = (asset: GalleryAsset) => asset.mode_provenance === 'fail-closed' ? FAIL_CLOSED_BLOCKED_MESSAGE : STRICT_BLOCKED_MESSAGE;

export function isGalleryDownloadBlocked(asset: GalleryAsset): boolean {
  return !DOWNLOADABLE_MODES.has(asset.continuation_mode || '');
}

function dayStart(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayLabel(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '未知时间';
  const today = dayStart(Date.now());
  const day = dayStart(time);
  if (day === today) return '今天';
  if (day === today - 86400000) return '昨天';
  return new Date(day).toLocaleDateString();
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '未知时间' : date.toLocaleString();
}

function originLabel(asset: GalleryAsset): string {
  return asset.origin_kind === 'underlay_repair' ? '底层修复' : '探索生成';
}

function GalleryThumb({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="gallery-image-fallback"><ImageOff size={18} /><br />图片暂时无法加载，稍后再试</span>;
  return <img src={url} loading="lazy" alt={alt} onError={() => setFailed(true)} />;
}

// 图库工作区（v1.1 §8.2）：数据一律来自服务端查询结果，前端只管理展示状态；
// 关闭时返回 null 卸载 overlay 子树，但组件实例由 App 常驻以保留筛选与滚动。
export const GalleryWorkspace = forwardRef<GalleryHandle, {
  open: boolean;
  explorationBusy: boolean;
  onClose: () => void;
  onHidden: (asset: GalleryAsset) => void;
  onRestored: (asset: GalleryAsset) => void;
  onError: (message: string) => void;
  onNotify: (message: string) => void;
}>(function GalleryWorkspace({ open, explorationBusy, onClose, onHidden, onRestored, onError, onNotify }, ref) {
  const [filters, setFilters] = useState<GalleryFilters>(DEFAULT_FILTERS);
  const [queryInput, setQueryInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [result, setResult] = useState<GalleryListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const previewRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const openerRef = useRef(0);
  const requestRef = useRef(0);
  const items = result?.items ?? [];

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQuery(queryInput.trim()), 250); return () => window.clearTimeout(timer); }, [queryInput]);

  const queryFor = useCallback((cursor?: string): GalleryQuery => {
    const query: GalleryQuery = { scope: filters.scope, sort: filters.sort, limit: 40 };
    if (filters.projectId) query.projectId = filters.projectId;
    if (filters.screenId) query.screenId = filters.screenId;
    if (filters.orientation) query.orientation = filters.orientation;
    if (filters.range) query.range = filters.range;
    if (debouncedQuery) query.query = debouncedQuery;
    if (cursor) query.cursor = cursor;
    return query;
  }, [filters, debouncedQuery]);

  const load = useCallback(async (cursor?: string) => {
    const requestId = ++requestRef.current;
    if (cursor) setLoadingMore(true); else { setLoading(true); setListError(''); }
    try {
      const next = await copilotApi.listGallery(queryFor(cursor));
      if (requestRef.current !== requestId) return;
      setResult((current) => cursor && current
        ? { ...next, items: [...current.items, ...next.items.filter((item) => !current.items.some((existing) => existing.id === item.id))] }
        : next);
    } catch (cause) {
      if (requestRef.current !== requestId) return;
      setListError(friendlyError(cause));
    } finally {
      if (requestRef.current === requestId) { setLoading(false); setLoadingMore(false); }
    }
  }, [queryFor]);

  useEffect(() => { if (open) void load(); }, [open, filters.scope, filters.projectId, filters.screenId, filters.orientation, filters.range, filters.sort, debouncedQuery, load]);

  // §8.1：视觉探索进行中定时轻量刷新；刷新只替换数据，不动筛选与滚动位置。
  useEffect(() => {
    if (!open || !explorationBusy) return;
    const timer = window.setInterval(() => { void load(); }, 4000);
    return () => window.clearInterval(timer);
  }, [open, explorationBusy, load]);

  // 任务在图库打开期间完成时补一次刷新，让逐张落盘后的最终列表立即可见。
  const previousBusy = useRef(explorationBusy);
  useEffect(() => {
    if (previousBusy.current && !explorationBusy && open) void load();
    previousBusy.current = explorationBusy;
  }, [explorationBusy, open, load]);

  useImperativeHandle(ref, () => ({
    reinsert(asset: GalleryAsset) {
      setResult((current) => {
        if (!current) return current;
        if (current.items.some((item) => item.id === asset.id)) return current;
        if (filters.scope === 'hidden') return { ...current, total: Math.max(0, current.total - 1) };
        const list = filters.sort === 'oldest' ? [...current.items, asset] : [asset, ...current.items];
        return { ...current, items: list, total: current.total + 1 };
      });
    }
  }), [filters.scope, filters.sort]);

  useEffect(() => { if (open) backRef.current?.focus(); }, [open]);

  useEffect(() => {
    if (!open) return;
    // 键盘处理挂在 window 上：打开灯箱后焦点仍在卡片按钮上，事件不会经过灯箱节点。
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (lightboxIndex !== null) {
          setLightboxIndex(null);
          previewRefs.current[openerRef.current]?.focus();
        } else {
          onClose();
        }
      } else if (lightboxIndex !== null && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        setLightboxIndex((current) => current === null || items.length === 0 ? current : (current + delta + items.length) % items.length);
        setZoom(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, lightboxIndex, items.length]);

  const updateFilter = (patch: Partial<GalleryFilters>) => {
    setFilters((current) => ({ ...current, ...patch, ...(patch.projectId !== undefined ? { screenId: '' } : {}) }));
    setLightboxIndex(null);
  };
  const hasActiveFilters = Boolean(filters.projectId || filters.screenId || filters.orientation || filters.range || queryInput);
  const clearFilters = () => { setFilters((current) => ({ ...DEFAULT_FILTERS, scope: current.scope })); setQueryInput(''); };

  const groups = useMemo(() => {
    const list: Array<{ label: string; assets: GalleryAsset[] }> = [];
    for (const asset of items) {
      const label = dayLabel(asset.created_at);
      const last = list[list.length - 1];
      if (last && last.label === label) last.assets.push(asset);
      else list.push({ label, assets: [asset] });
    }
    return list;
  }, [items]);

  const screenOptions = useMemo(() => {
    if (!result) return [];
    return filters.projectId ? result.facets.screens.filter((screen) => !screen.projectId || screen.projectId === filters.projectId) : result.facets.screens;
  }, [result, filters.projectId]);

  const hideAsset = async (asset: GalleryAsset) => {
    try {
      await copilotApi.hideGalleryAsset(asset.id);
      setResult((current) => current ? { ...current, items: current.items.filter((item) => item.id !== asset.id), total: Math.max(0, current.total - 1) } : current);
      setLightboxIndex((current) => {
        if (current === null) return current;
        const next = items.filter((item) => item.id !== asset.id);
        return next.length === 0 ? null : Math.min(current, next.length - 1);
      });
      onHidden(asset);
    } catch (cause) { onError(friendlyError(cause)); }
  };

  const restoreAsset = async (asset: GalleryAsset) => {
    try {
      await copilotApi.restoreGalleryAsset(asset.id);
      setResult((current) => current ? { ...current, items: current.items.filter((item) => item.id !== asset.id), total: Math.max(0, current.total - 1) } : current);
      setLightboxIndex(null);
      onRestored(asset);
    } catch (cause) { onError(friendlyError(cause)); }
  };

  const downloadAsset = async (asset: GalleryAsset) => {
    try {
      const outcome = await copilotApi.downloadGalleryAsset(asset.id);
      if (outcome.status === 'saved') onNotify(`原图已保存${outcome.path ? `：${outcome.path}` : '。'}`);
      else if (outcome.status === 'cancelled') onNotify('已取消保存。');
      else onError(outcome.message || blockedMessage(asset));
    } catch (cause) { onError(friendlyError(cause)); }
  };

  if (!open) return null;
  const lightbox = lightboxIndex === null ? null : items[lightboxIndex] ?? null;
  const lightboxBlocked = lightbox ? isGalleryDownloadBlocked(lightbox) : false;
  const changeZoom = (factor: number) => setZoom((current) => Math.min(4, Math.max(1, Number((current * factor).toFixed(2)))));
  const stepLightbox = (delta: number) => {
    if (lightboxIndex === null || items.length === 0) return;
    setLightboxIndex((lightboxIndex + delta + items.length) % items.length);
    setZoom(1);
  };

  return <section className="gallery-overlay" role="dialog" aria-modal="true" aria-label="图库工作区" data-testid="gallery-overlay">
    <header className="gallery-header">
      <button ref={backRef} className="gallery-back" onClick={onClose} data-testid="gallery-back"><ArrowLeft size={15} />返回工作流</button>
      <h1>图库</h1>
      {result && <span className="gallery-count" data-testid="gallery-count">{result.total}</span>}
      <p>按项目与 Screen 整理已生成的永久 CDN 图片；移除只是从图库隐藏，绝不删除云端文件。</p>
    </header>
    <div className="gallery-filters">
      <div className="gallery-scope-tabs" role="group" aria-label="图库范围">
        <button type="button" className={filters.scope === 'all' ? 'is-active' : ''} aria-pressed={filters.scope === 'all'} onClick={() => updateFilter({ scope: 'all' })}>全部图片</button>
        <button type="button" className={filters.scope === 'hidden' ? 'is-active' : ''} aria-pressed={filters.scope === 'hidden'} onClick={() => updateFilter({ scope: 'hidden' })}>已移除</button>
      </div>
      <label className="filter-field">项目
        <select aria-label="按项目筛选" value={filters.projectId} onChange={(event) => updateFilter({ projectId: event.target.value })}>
          <option value="">全部项目</option>
          {result?.facets.projects.map((item) => <option key={item.id} value={item.id}>{item.status === 'archived' ? '〔归档〕' : ''}{item.name}</option>)}
        </select>
      </label>
      <label className="filter-field">Screen
        <select aria-label="按 Screen 筛选" value={filters.screenId} onChange={(event) => updateFilter({ screenId: event.target.value })} disabled={!screenOptions.length}>
          <option value="">全部 Screen</option>
          {screenOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="filter-field">方向
        <select aria-label="按画布方向筛选" value={filters.orientation} onChange={(event) => updateFilter({ orientation: event.target.value as GalleryFilters['orientation'] })}>
          <option value="">全部方向</option>
          <option value="landscape">横版</option>
          <option value="portrait">竖版</option>
          <option value="square">方形</option>
        </select>
      </label>
      <label className="filter-field">时间
        <select aria-label="按生成时间筛选" value={filters.range} onChange={(event) => updateFilter({ range: event.target.value as GalleryFilters['range'] })}>
          <option value="">全部时间</option>
          <option value="today">今天</option>
          <option value="7d">最近 7 天</option>
          <option value="30d">最近 30 天</option>
        </select>
      </label>
      <label className="filter-field">
        <Search size={14} />
        <input aria-label="搜索图库" value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="搜索项目 / Screen / 策略" />
      </label>
      <label className="filter-field">排序
        <select aria-label="排序方式" value={filters.sort} onChange={(event) => updateFilter({ sort: event.target.value as GalleryFilters['sort'] })}>
          <option value="newest">最新优先</option>
          <option value="oldest">最早优先</option>
        </select>
      </label>
      {hasActiveFilters && <button type="button" className="filter-clear" onClick={clearFilters}>清除筛选</button>}
    </div>
    <div className="gallery-body" ref={bodyRef}>
      {loading && !items.length ? <div className="gallery-state" role="status"><LoaderCircle className="spin" size={22} /><b>正在整理图库…</b><p>首次打开会回填历史生成记录，稍等片刻。</p></div>
        : listError ? <div className="gallery-state is-error" role="alert"><ImageOff size={22} /><b>图库加载失败</b><p>{listError}</p><button type="button" className="button button--secondary" onClick={() => void load()}>重试</button></div>
        : !items.length ? <div className="gallery-state">{filters.scope === 'hidden' ? <><b>没有已移除的图片</b><p>从全部图片中移除的资产会出现在这里，随时可以恢复。</p></> : hasActiveFilters ? <><b>没有匹配的图片</b><p>当前筛选条件下没有结果，试试清除筛选。</p></> : <><b>图库还是空的</b><p>完成一次视觉探索或底层修复后，可信的永久 CDN 图片会自动登记到这里。</p></>}</div>
        : <div className="gallery-grid-wrap">
          {groups.map((group) => <section key={group.label} aria-label={group.label}>
            <div className="gallery-group-label">{group.label}</div>
            <div className="gallery-grid">
              {group.assets.map((asset) => {
                const flatIndex = items.findIndex((item) => item.id === asset.id);
                const blocked = isGalleryDownloadBlocked(asset);
                return <article key={asset.id} className="gallery-card" data-testid="gallery-card">
                  <button
                    type="button"
                    className="gallery-card-preview"
                    aria-label={`查看大图：${asset.project_name_snapshot || '未知项目'} ${asset.screen_name_snapshot || ''}`.trim()}
                    ref={(node) => { previewRefs.current[flatIndex] = node; }}
                    onClick={() => { setZoom(1); openerRef.current = flatIndex; setLightboxIndex(flatIndex); }}
                  >
                    <div className="gallery-card-image">
                      <GalleryThumb url={asset.cdn_url} alt={`${asset.project_name_snapshot || '未知项目'} · ${asset.screen_name_snapshot || '未知 Screen'} 的生成结果`} />
                    </div>
                  </button>
                  <div className="gallery-card-meta">
                    <b>{asset.project_name_snapshot || '未知项目'} · {asset.screen_name_snapshot || '未知 Screen'}</b>
                    <small>{originLabel(asset)}{asset.strategy ? ` · ${asset.strategy}` : ''}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}</small>
                    <code>{formatTime(asset.created_at)}</code>
                  </div>
                  <div className="gallery-card-actions">
                    {filters.scope === 'hidden'
                      ? <button type="button" onClick={() => void restoreAsset(asset)}><RotateCcw size={14} />恢复</button>
                      : <>
                        {blocked
                          ? <button type="button" className="gallery-download-blocked" aria-disabled="true" title={blockedMessage(asset)} onClick={() => onError(blockedMessage(asset))}><Download size={14} />受控交付</button>
                          : <button type="button" onClick={() => void downloadAsset(asset)}><Download size={14} />下载原图</button>}
                        <button type="button" className="gallery-remove" onClick={() => void hideAsset(asset)}>移除</button>
                      </>}
                  </div>
                </article>;
              })}
            </div>
          </section>)}
          {result?.nextCursor && <div className="gallery-load-more"><button type="button" className="button button--secondary" disabled={loadingMore} onClick={() => void load(result.nextCursor || undefined)}>{loadingMore ? <LoaderCircle className="spin" size={14} /> : null}加载更多（已显示 {items.length}/{result.total}）</button></div>}
        </div>}
    </div>
    {lightbox && <div className="gallery-lightbox" role="dialog" aria-modal="true" aria-label="图片灯箱" data-testid="gallery-lightbox">
      <header className="gallery-lightbox-header">
        <div><b>{lightbox.project_name_snapshot || '未知项目'} · {lightbox.screen_name_snapshot || '未知 Screen'}</b><small>{originLabel(lightbox)}{lightbox.strategy ? ` · ${lightbox.strategy}` : ''} · {formatTime(lightbox.created_at)}</small></div>
        <div className="lightbox-actions">
          {filters.scope === 'hidden'
            ? <button type="button" onClick={() => void restoreAsset(lightbox)}><RotateCcw size={14} />恢复到图库</button>
            : <>
              {lightboxBlocked
                ? <button type="button" className="gallery-download-blocked" aria-disabled="true" title={blockedMessage(lightbox)} onClick={() => onError(blockedMessage(lightbox))}><Download size={14} />受控交付</button>
                : <button type="button" onClick={() => void downloadAsset(lightbox)}><Download size={14} />下载原图</button>}
              <button type="button" className="is-danger" onClick={() => void hideAsset(lightbox)}>移除</button>
            </>}
          <button type="button" aria-label="关闭灯箱" onClick={() => { setLightboxIndex(null); previewRefs.current[openerRef.current]?.focus(); }}><X size={15} /></button>
        </div>
      </header>
      <div className="gallery-lightbox-viewport">
        <img src={lightbox.cdn_url} className={zoom > 1 ? 'is-zoomed' : ''} style={{ transform: `scale(${zoom})` }} alt={`${lightbox.project_name_snapshot || '未知项目'} · ${lightbox.screen_name_snapshot || '未知 Screen'} 的大图预览`} />
      </div>
      <footer className="gallery-lightbox-footer">
        <button type="button" aria-label="缩小" onClick={() => changeZoom(1 / 1.25)} disabled={zoom <= 1}><ZoomOut size={15} /></button>
        <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="放大" onClick={() => changeZoom(1.25)} disabled={zoom >= 4}><ZoomIn size={15} /></button>
        <div className="lightbox-nav">
          <button type="button" aria-label="上一张" onClick={() => stepLightbox(-1)} disabled={items.length < 2}><ChevronLeft size={15} /></button>
          <small>{(lightboxIndex ?? 0) + 1} / {items.length}</small>
          <button type="button" aria-label="下一张" onClick={() => stepLightbox(1)} disabled={items.length < 2}><ChevronRight size={15} /></button>
        </div>
      </footer>
    </div>}
  </section>;
});
