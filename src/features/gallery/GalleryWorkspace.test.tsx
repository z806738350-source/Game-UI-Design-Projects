// 图库工作区组件测试（v1.1 §11.4）：状态互不混淆、筛选联动、门禁受控态、
// 灯箱键盘操作与焦点恢复、隐藏/恢复回调、分页追加。
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GalleryAsset, GalleryListResult } from '../../types';

const listGallery = vi.fn();
const hideGalleryAsset = vi.fn();
const restoreGalleryAsset = vi.fn();
const waiveGalleryDownload = vi.fn();
const downloadGalleryAsset = vi.fn();
vi.mock('../../api', () => ({
  copilotApi: {
    listGallery: (...args: unknown[]) => listGallery(...args),
    hideGalleryAsset: (...args: unknown[]) => hideGalleryAsset(...args),
    restoreGalleryAsset: (...args: unknown[]) => restoreGalleryAsset(...args),
    waiveGalleryDownload: (...args: unknown[]) => waiveGalleryDownload(...args),
    downloadGalleryAsset: (...args: unknown[]) => downloadGalleryAsset(...args)
  }
}));

import { GalleryWorkspace } from './GalleryWorkspace';

function makeAsset(overrides: Partial<GalleryAsset> = {}): GalleryAsset {
  return {
    id: 'asset-1', cdn_url: 'https://kunpoapiimg.ziy.cc/gallery-tests/one.png', provider: 'kunpo',
    storage_mode: 'provider_cdn', remote_only: true, origin_kind: 'visual_exploration',
    continuation_mode: 'exploration', project_id: 'project-1', project_name_snapshot: '云境计划',
    screen_id: 'main', screen_name_snapshot: '主页面', strategy: 'conservative', width: 1920, height: 1080,
    created_at: new Date().toISOString(), indexed_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
    hidden_at: null, ...overrides
  };
}

function makeResult(items: GalleryAsset[], extras: Partial<GalleryListResult> = {}): GalleryListResult {
  return {
    items, total: items.length, nextCursor: null,
    facets: {
      projects: [{ id: 'project-1', name: '云境计划', status: 'draft' }],
      screens: [{ id: 'main', name: '主页面', projectId: 'project-1' }]
    },
    ...extras
  };
}

function renderGallery(props: Partial<Parameters<typeof GalleryWorkspace>[0]> = {}) {
  const callbacks = {
    onClose: vi.fn(), onHidden: vi.fn(), onRestored: vi.fn(), onError: vi.fn(), onNotify: vi.fn(),
    ...props
  };
  const view = render(<GalleryWorkspace open explorationBusy={false} {...callbacks} />);
  return { ...view, ...callbacks };
}

afterEach(() => {
  cleanup();
  listGallery.mockReset();
  hideGalleryAsset.mockReset();
  restoreGalleryAsset.mockReset();
  waiveGalleryDownload.mockReset();
  downloadGalleryAsset.mockReset();
});

describe('GalleryWorkspace 状态', () => {
  it('空图库显示空态而不是错误态', async () => {
    listGallery.mockResolvedValue(makeResult([]));
    renderGallery();
    await screen.findByText('图库还是空的');
    expect(screen.queryByText('图库加载失败')).toBeNull();
  });

  it('加载失败显示错误态并可重试', async () => {
    listGallery.mockRejectedValueOnce(new Error('索引读取失败'));
    listGallery.mockResolvedValueOnce(makeResult([]));
    renderGallery();
    await screen.findByText('图库加载失败');
    await userEvent.setup().click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText('图库还是空的');
  });

  it('open=false 时不渲染任何内容', () => {
    const { container } = render(<GalleryWorkspace open={false} explorationBusy={false} onClose={vi.fn()} onHidden={vi.fn()} onRestored={vi.fn()} onError={vi.fn()} onNotify={vi.fn()} />);
    expect(container.innerHTML).toBe('');
    expect(listGallery).not.toHaveBeenCalled();
  });
});

describe('GalleryWorkspace 列表与筛选', () => {
  it('渲染资产卡片并按日期分组', async () => {
    listGallery.mockResolvedValue(makeResult([makeAsset(), makeAsset({ id: 'asset-2', cdn_url: 'https://kunpoapiimg.ziy.cc/gallery-tests/two.png' })]));
    renderGallery();
    await screen.findAllByTestId('gallery-card');
    expect(screen.getAllByTestId('gallery-card')).toHaveLength(2);
    const groupLabels = Array.from(document.querySelectorAll('.gallery-group-label')).map((node) => node.textContent);
    expect(groupLabels).toEqual(['今天']);
  });

  it('筛选栏使用自绘下拉而不是系统原生 select', async () => {
    listGallery.mockResolvedValue(makeResult([]));
    renderGallery();
    await screen.findByText('图库还是空的');
    expect(screen.getAllByRole('combobox')).toHaveLength(5);
    expect(document.querySelectorAll('.gallery-filters select')).toHaveLength(0);
  });

  it('下拉展开时按 Escape 只收起列表，不关闭图库', async () => {
    const user = userEvent.setup();
    listGallery.mockResolvedValue(makeResult([]));
    const { onClose } = renderGallery();
    await screen.findByText('图库还是空的');
    await user.click(screen.getByRole('combobox', { name: '按画布方向筛选' }));
    await screen.findByRole('listbox', { name: '按画布方向筛选' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByTestId('gallery-overlay')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('项目筛选变化会携带 projectId 重新查询，且清除筛选可还原', async () => {
    const user = userEvent.setup();
    listGallery.mockResolvedValue(makeResult([]));
    renderGallery();
    await screen.findByText('图库还是空的');
    await user.click(screen.getByRole('combobox', { name: '按项目筛选' }));
    await user.click(screen.getByRole('option', { name: '云境计划' }));
    await waitFor(() => expect(listGallery).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1' })));
    await user.click(screen.getByRole('button', { name: '清除筛选' }));
    await waitFor(() => expect(listGallery).toHaveBeenCalledWith(expect.not.objectContaining({ projectId: 'project-1' })));
  });

  it('分页追加不替换已有条目', async () => {
    const user = userEvent.setup();
    listGallery.mockResolvedValueOnce(makeResult([makeAsset()], { total: 2, nextCursor: 'cursor-2' }));
    listGallery.mockResolvedValueOnce(makeResult([makeAsset({ id: 'asset-2', cdn_url: 'https://kunpoapiimg.ziy.cc/gallery-tests/two.png' })], { total: 2, nextCursor: null }));
    renderGallery();
    await screen.findByText(/加载更多/);
    await user.click(screen.getByRole('button', { name: /加载更多/ }));
    await waitFor(() => expect(screen.getAllByTestId('gallery-card')).toHaveLength(2));
  });
});

describe('GalleryWorkspace 下载门禁与隐藏', () => {
  it('严格继承资产显示受控交付状态，点击说明原因而不伪装成功', async () => {
    const user = userEvent.setup();
    listGallery.mockResolvedValue(makeResult([makeAsset({ continuation_mode: 'existing-strict' })]));
    const { onError } = renderGallery();
    const blocked = await screen.findByRole('button', { name: '受控交付' });
    expect(blocked.getAttribute('aria-disabled')).toBe('true');
    await user.click(blocked);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('严格继承'));
    expect(downloadGalleryAsset).not.toHaveBeenCalled();
    expect(screen.queryByTestId('gallery-waiver-dialog')).toBeNull();
  });

  it('fail-closed 历史资产点击受控交付打开豁免对话框，确认理由后放行下载', async () => {
    const user = userEvent.setup();
    const historical = makeAsset({ continuation_mode: 'existing-strict', mode_provenance: 'fail-closed' });
    listGallery.mockResolvedValue(makeResult([historical]));
    waiveGalleryDownload.mockResolvedValue({ ...historical, download_waiver: { at: new Date().toISOString(), reason: '该历史方案已确认复用，需要导出原图归档。' } });
    downloadGalleryAsset.mockResolvedValue({ status: 'saved', path: '/tmp/history.png' });
    const { onError, onNotify } = renderGallery();
    await user.click(await screen.findByRole('button', { name: '受控交付' }));
    const dialog = await screen.findByTestId('gallery-waiver-dialog');
    expect(onError).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole('button', { name: '确认按当前项目路线下载' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await user.type(within(dialog).getByLabelText('豁免理由'), '该历史方案已确认复用，需要导出原图归档。');
    expect(confirm.hasAttribute('disabled')).toBe(false);
    await user.click(confirm);
    await waitFor(() => expect(waiveGalleryDownload).toHaveBeenCalledWith('asset-1', '该历史方案已确认复用，需要导出原图归档。'));
    await waitFor(() => expect(downloadGalleryAsset).toHaveBeenCalledWith('asset-1'));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(expect.stringContaining('/tmp/history.png')));
    await waitFor(() => expect(screen.queryByTestId('gallery-waiver-dialog')).toBeNull());
    expect(screen.getByRole('button', { name: '下载原图' })).toBeTruthy();
  });

  it('已豁免的历史资产直接显示下载原图', async () => {
    listGallery.mockResolvedValue(makeResult([makeAsset({
      continuation_mode: 'existing-strict', mode_provenance: 'fail-closed',
      download_waiver: { at: new Date().toISOString(), reason: '该历史方案已确认复用。' }
    })]));
    renderGallery();
    expect(await screen.findByRole('button', { name: '下载原图' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '受控交付' })).toBeNull();
  });

  it('可下载路线点击下载，保存成功后展示通知', async () => {
    const user = userEvent.setup();
    downloadGalleryAsset.mockResolvedValue({ status: 'saved', path: '/tmp/one.png' });
    listGallery.mockResolvedValue(makeResult([makeAsset()]));
    const { onNotify } = renderGallery();
    await user.click(await screen.findByRole('button', { name: '下载原图' }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith(expect.stringContaining('/tmp/one.png')));
  });

  it('移除调用隐藏接口并回调，不删除云端文件', async () => {
    const user = userEvent.setup();
    hideGalleryAsset.mockResolvedValue(makeAsset({ hidden_at: new Date().toISOString() }));
    listGallery.mockResolvedValue(makeResult([makeAsset()]));
    const { onHidden } = renderGallery();
    await user.click(await screen.findByRole('button', { name: '移除' }));
    await waitFor(() => expect(hideGalleryAsset).toHaveBeenCalledWith('asset-1'));
    expect(onHidden).toHaveBeenCalledWith(expect.objectContaining({ id: 'asset-1' }));
    await waitFor(() => expect(screen.queryAllByTestId('gallery-card')).toHaveLength(0));
  });

  it('已移除范围中提供恢复入口', async () => {
    const user = userEvent.setup();
    restoreGalleryAsset.mockResolvedValue(makeAsset());
    listGallery.mockResolvedValue(makeResult([makeAsset({ hidden_at: new Date().toISOString() })], { total: 1 }));
    const { onRestored } = renderGallery();
    await user.click(await screen.findByRole('button', { name: '已移除' }));
    await user.click(await screen.findByRole('button', { name: '恢复' }));
    await waitFor(() => expect(restoreGalleryAsset).toHaveBeenCalledWith('asset-1'));
    expect(onRestored).toHaveBeenCalled();
  });
});

describe('GalleryWorkspace 灯箱', () => {
  it('打开灯箱、方向键切换并可用 Escape 关闭且恢复焦点', async () => {
    const user = userEvent.setup();
    listGallery.mockResolvedValue(makeResult([
      makeAsset(),
      makeAsset({ id: 'asset-2', cdn_url: 'https://kunpoapiimg.ziy.cc/gallery-tests/two.png' })
    ]));
    renderGallery();
    const previews = await screen.findAllByRole('button', { name: /查看大图/ });
    await user.click(previews[0]);
    const lightbox = await screen.findByTestId('gallery-lightbox');
    expect(within(lightbox).getByText('1 / 2')).toBeTruthy();
    await user.keyboard('{ArrowRight}');
    expect(within(lightbox).getByText('2 / 2')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('gallery-lightbox')).toBeNull());
    expect(document.activeElement).toBe(previews[0]);
  });

  it('缩放按钮在边界内调整倍率', async () => {
    const user = userEvent.setup();
    listGallery.mockResolvedValue(makeResult([makeAsset()]));
    renderGallery();
    await user.click((await screen.findAllByRole('button', { name: /查看大图/ }))[0]);
    const zoomIn = screen.getByLabelText('放大');
    await user.click(zoomIn);
    expect(screen.getByText('125%')).toBeTruthy();
  });
});
