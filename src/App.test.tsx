import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig, GalleryAsset, GalleryListResult } from './types';

// App 顶栏帮助入口测试：点击打开应用内说明书弹窗（iframe 嵌入 guide HTML）；
// 弹窗内「在系统浏览器中打开」失败时必须在错误条反馈，不允许静默无反应（PR#25 收口 P1）。
const openUserGuide = vi.fn();
const createProject = vi.fn();
const openProject = vi.fn();
const listProjects = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
const listGallery = vi.fn(async (..._args: unknown[]): Promise<GalleryListResult> => ({ items: [], total: 0, nextCursor: null, facets: { projects: [], screens: [] } }));
const hideGalleryAsset = vi.fn();
const restoreGalleryAsset = vi.fn();
const downloadGalleryAsset = vi.fn();
const saveProject = vi.fn();
const draftRequirement = vi.fn();
const getConfig = vi.fn(async (): Promise<AppConfig> => ({
  platform: 'darwin',
  workspaceRoot: '/tmp/workspace',
  features: { assistant: false },
  kunpo: { configured: true, mode: 'gateway', modelSource: 'models.json', envSource: '.env', assistantModel: 'assistant', visionModel: 'vision', imageModel: 'image' }
}));
const listAssistantConversations = vi.fn(async () => ({ conversations: [], warnings: [] }));
vi.mock('./api', () => ({
  copilotApi: {
    getConfig: () => getConfig(),
    listProjects: (...args: unknown[]) => listProjects(...args),
    createProject: (...args: unknown[]) => createProject(...args),
    openProject: (...args: unknown[]) => openProject(...args),
    openUserGuide: (...args: unknown[]) => openUserGuide(...args),
    listGallery: (...args: unknown[]) => listGallery(...args),
    hideGalleryAsset: (...args: unknown[]) => hideGalleryAsset(...args),
    restoreGalleryAsset: (...args: unknown[]) => restoreGalleryAsset(...args),
    downloadGalleryAsset: (...args: unknown[]) => downloadGalleryAsset(...args),
    saveProject: (...args: unknown[]) => saveProject(...args),
    draftRequirement: (...args: unknown[]) => draftRequirement(...args),
    listAssistantConversations: () => listAssistantConversations()
  }
}));

import { App } from './App';
import { makeProject } from './test-utils/fixtures';

// jsdom 未实现 Element.scrollTo（App 在阶段切换时对主工作区调用），测试环境补空实现
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
// jsdom 30 尚未实现原生 dialog 方法；只在测试环境补最小行为。
if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function close() { this.open = false; };

afterEach(() => {
  cleanup();
  openUserGuide.mockReset();
  createProject.mockReset();
  openProject.mockReset();
  listProjects.mockReset();
  listProjects.mockImplementation(async () => []);
  listGallery.mockReset();
  listGallery.mockImplementation(async () => ({ items: [], total: 0, nextCursor: null, facets: { projects: [], screens: [] } }));
  hideGalleryAsset.mockReset();
  restoreGalleryAsset.mockReset();
  downloadGalleryAsset.mockReset();
  saveProject.mockReset();
  saveProject.mockResolvedValue(undefined);
  draftRequirement.mockReset();
  getConfig.mockReset();
  getConfig.mockImplementation(async () => ({
    platform: 'darwin', workspaceRoot: '/tmp/workspace', features: { assistant: false },
    kunpo: { configured: true, mode: 'gateway', modelSource: 'models.json', envSource: '.env', assistantModel: 'assistant', visionModel: 'vision', imageModel: 'image' }
  }));
  listAssistantConversations.mockReset();
  listAssistantConversations.mockResolvedValue({ conversations: [], warnings: [] });
});

describe('App 顶栏帮助入口', () => {
  it('点击帮助按钮打开说明书弹窗，iframe 指向 guide HTML，且不触发系统浏览器', async () => {
    const user = userEvent.setup();
    render(<App />);
    const helpButton = await screen.findByTitle('使用说明书');
    await user.click(helpButton);
    const dialog = screen.getByRole('dialog', { name: '使用说明书' });
    const frame = dialog.querySelector('iframe.guide-frame');
    expect(frame?.getAttribute('src')).toBe('./guide/quick-start-guide.html');
    expect(openUserGuide).not.toHaveBeenCalled();
  });

  it('弹窗可通过关闭按钮与遮罩点击关闭', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTitle('使用说明书'));
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog', { name: '使用说明书' })).toBeNull();

    await user.click(screen.getByTitle('使用说明书'));
    const backdrop = screen.getByRole('dialog', { name: '使用说明书' }).parentElement!;
    await user.click(backdrop);
    expect(screen.queryByRole('dialog', { name: '使用说明书' })).toBeNull();
  });

  it('弹窗内「在系统浏览器中打开」返回 { ok: false } 时显示错误条并给出自助路径', async () => {
    const user = userEvent.setup();
    openUserGuide.mockResolvedValue({ ok: false });
    render(<App />);
    await user.click(await screen.findByTitle('使用说明书'));
    await user.click(screen.getByRole('button', { name: '在系统浏览器中打开' }));
    await screen.findByText(/无法打开使用说明书/);
    const banner = document.querySelector('.error-banner');
    expect(banner?.textContent).toContain('docs/user/quick-start-guide.html');
  });

  it('「在系统浏览器中打开」成功时不出现错误条', async () => {
    const user = userEvent.setup();
    openUserGuide.mockResolvedValue({ ok: true });
    render(<App />);
    await user.click(await screen.findByTitle('使用说明书'));
    await user.click(screen.getByRole('button', { name: '在系统浏览器中打开' }));
    await waitFor(() => expect(openUserGuide).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.error-banner')).toBeNull();
  });

  it('「在系统浏览器中打开」抛错时错误条展示友好错误', async () => {
    const user = userEvent.setup();
    openUserGuide.mockRejectedValue(new Error('IPC_GUIDE_OPEN_FAILED: shell busy'));
    render(<App />);
    await user.click(await screen.findByTitle('使用说明书'));
    await user.click(screen.getByRole('button', { name: '在系统浏览器中打开' }));
    await screen.findByText(/IPC_GUIDE_OPEN_FAILED/);
  });
});

describe('App 助手功能开关与右侧列', () => {
  it('功能开关关闭时不渲染助手入口', async () => {
    render(<App />);
    await screen.findByTitle('模型与工作区配置');
    expect(screen.queryByRole('button', { name: 'AI 助手' })).toBeNull();
  });

  it('助手与产物检查器互斥，图库打开时保持挂载但 inert', async () => {
    const user = userEvent.setup();
    getConfig.mockResolvedValueOnce({
      platform: 'darwin', workspaceRoot: '/tmp/workspace', features: { assistant: true },
      kunpo: { configured: true, mode: 'gateway', modelSource: 'models.json', envSource: '.env', assistantModel: 'assistant', visionModel: 'vision', imageModel: 'image' }
    });
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'AI 助手' }));
    const panel = screen.getByTestId('assistant-panel');
    expect(panel.hidden).toBe(false);
    expect(document.querySelector('.artifact-inspector')).toBeNull();
    await user.click(screen.getByTitle('查看 AI 输入、产物与历史版本'));
    expect(panel.hidden).toBe(true);
    expect(document.querySelector('.artifact-inspector')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'AI 助手' }));
    expect(panel.hidden).toBe(false);
    expect(document.querySelector('.artifact-inspector')).toBeNull();
    await user.click(screen.getByTestId('gallery-entry'));
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.assistant-panel .button--primary')).toBeNull();
  });

  it('共享 Settings dialog 受控关闭、归还焦点并可重新打开', async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = await screen.findByTitle('模型与工作区配置');
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '模型与工作区配置' });
    expect((dialog as HTMLDialogElement).open).toBe(true);
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '模型与工作区配置' })).toBeNull());
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    expect((screen.getByRole('dialog', { name: '模型与工作区配置' }) as HTMLDialogElement).open).toBe(true);
  });

  it('项目管理复用同一个 Portal 原生 dialog', async () => {
    const user = userEvent.setup();
    const project = makeProject({ id: 'project-a', name: '项目 A' });
    listProjects.mockResolvedValueOnce([{ id: project.id, name: project.name, project_type: project.project_type, status: 'draft', updated_at: project.updated_at }]);
    openProject.mockResolvedValueOnce(project);
    render(<App />);
    const trigger = await screen.findByRole('button', { name: '管理' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '项目管理' });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.querySelector('.utility-dialog--wide')).not.toBeNull();
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancel);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '项目管理' })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});

// AUD-03：run() 失败不得被调用方当作成功。创建项目失败时对话框必须保持
// 打开，让用户看到错误并重试，而不是静默关闭。
describe('App 创建项目失败语义（AUD-03）', () => {
  it('创建失败时对话框保持打开并显示错误条', async () => {
    const user = userEvent.setup();
    createProject.mockRejectedValueOnce(new Error('项目创建失败：工作区不可写'));
    render(<App />);
    await user.click(await screen.findByText('建立第一个项目'));
    await user.type(screen.getByPlaceholderText(/云境计划/), '测试项目');
    await user.click(screen.getByTestId('create-project'));
    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('create-project-dialog')).toBeTruthy();
    await screen.findByText(/工作区不可写/);
  });

  it('mutation 成功但列表刷新失败时不改判失败，也不提供重跑 mutation 的重试入口（AUD-03）', async () => {
    const user = userEvent.setup();
    // 首次进入加载成功；创建成功后的辅助列表刷新因临时 I/O 失败。
    listProjects.mockResolvedValueOnce([]);
    listProjects.mockRejectedValueOnce(new Error('list io failed'));
    createProject.mockResolvedValueOnce(makeProject({ id: 'project-new', name: '测试项目' }));
    render(<App />);
    await user.click(await screen.findByText('建立第一个项目'));
    await user.type(screen.getByPlaceholderText(/云境计划/), '测试项目');
    await user.click(screen.getByTestId('create-project'));
    // mutation 成功语义保留：对话框关闭，且 mutation 只执行一次。
    await waitFor(() => expect(screen.queryByTestId('create-project-dialog')).toBeNull());
    expect(createProject).toHaveBeenCalledTimes(1);
    // 刷新失败不得产生错误条与“重试”入口（重试会重复创建项目）。
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));
    expect(document.querySelector('.error-banner')).toBeNull();
  });
});

// AUD-04 Job Identity 回归防护：创建项目是 newEntity 任务，其目标是尚不
// 存在的新项目；若 run() 冻结了当前打开的旧项目 id，成功返回的新项目会被
// applyJobResult 的身份校验拒绝，页面停留在旧项目（CI ui-e2e 曾因此失败）。
describe('App 创建项目身份豁免（AUD-04 newEntity）', () => {
  it('已打开其他项目时创建成功：新项目直接接管工作区，不被 Job Identity 校验拒绝', async () => {
    const user = userEvent.setup();
    const oldProject = makeProject({ id: 'project-old', name: '旧项目' });
    const newProject = makeProject({ id: 'project-new', name: '新建测试项目' });
    listProjects.mockResolvedValueOnce([{ id: 'project-old', name: '旧项目', project_type: 'existing', status: 'draft', updated_at: oldProject.updated_at, workspacePath: oldProject.workspacePath }]);
    // 创建成功后的辅助列表刷新返回包含新项目的列表，切换器选项可见。
    const newSummary = { id: 'project-new', name: '新建测试项目', project_type: 'new', status: 'draft', updated_at: newProject.updated_at, workspacePath: newProject.workspacePath };
    const oldSummary = { id: 'project-old', name: '旧项目', project_type: 'existing', status: 'draft', updated_at: oldProject.updated_at, workspacePath: oldProject.workspacePath };
    listProjects.mockResolvedValueOnce([oldSummary, newSummary]);
    openProject.mockResolvedValueOnce(oldProject);
    createProject.mockResolvedValueOnce(newProject);
    render(<App />);
    // 启动时自动打开旧项目，此时创建任务的目标不是当前打开的项目。
    await screen.findByText('旧项目');
    await user.click(screen.getByText('新项目', { selector: '.project-switcher button' }));
    await user.type(screen.getByPlaceholderText(/云境计划/), '新建测试项目');
    await user.click(screen.getByTestId('create-project'));
    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
    // 新项目必须成为当前打开的项目（切换器显示新项目名），而不是被
    // 身份校验拒绝后停留在旧项目；也不得产生错误条。
    await waitFor(() => expect(document.querySelector('.error-banner')).toBeNull());
    await screen.findByText('新建测试项目');
    expect(screen.queryByText('旧项目')).toBeNull();
  });
});

function makeGalleryAsset(overrides: Partial<GalleryAsset> = {}): GalleryAsset {
  return {
    id: 'asset-1', cdn_url: 'https://kunpoapiimg.ziy.cc/gallery-tests/one.png', provider: 'kunpo',
    storage_mode: 'provider_cdn', remote_only: true, origin_kind: 'visual_exploration',
    continuation_mode: 'exploration', project_id: 'project-1', project_name_snapshot: '云境计划',
    screen_id: 'main', screen_name_snapshot: '主页面', strategy: 'conservative', width: 1920, height: 1080,
    created_at: new Date().toISOString(), indexed_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
    hidden_at: null, ...overrides
  };
}

// §8.1 / §11.4：图库是无损往返的顶层视图——入口选中态、再次点击 no-op、
// 返回后焦点恢复、工作流仅被 inert 而从未卸载、移除后的撤销提示。
describe('App 图库入口与无损往返', () => {
  it('入口选中态与 aria-current 正确，再次点击不退出，返回按钮恢复工作流与焦点', async () => {
    const user = userEvent.setup();
    render(<App />);
    const entry = await screen.findByTestId('gallery-entry');
    expect(entry.className).not.toContain('is-active');
    await user.click(entry);
    await screen.findByTestId('gallery-overlay');
    expect(screen.getByTestId('gallery-entry').className).toContain('is-active');
    expect(screen.getByTestId('gallery-entry').getAttribute('aria-current')).toBe('page');
    // 再次点击入口是 no-op：不产生含糊的 toggle。
    await user.click(screen.getByTestId('gallery-entry'));
    expect(screen.getByTestId('gallery-overlay')).toBeTruthy();
    await user.click(screen.getByTestId('gallery-back'));
    await waitFor(() => expect(screen.queryByTestId('gallery-overlay')).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId('gallery-entry'));
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(false);
  });

  it('overlay 打开期间工作流不被卸载，只被 inert 隔离', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('gallery-entry'));
    await screen.findByTestId('gallery-overlay');
    expect(screen.getByText('为游戏 UI 设计师准备的 AI 流水线')).toBeTruthy();
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(true);
  });

  it('Escape 关闭图库并恢复入口焦点', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTestId('gallery-entry'));
    await screen.findByTestId('gallery-overlay');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('gallery-overlay')).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId('gallery-entry'));
  });

  it('移除图片出现撤销提示，撤销调用恢复接口且不提删除云端', async () => {
    const user = userEvent.setup();
    const asset = makeGalleryAsset();
    listGallery.mockImplementation(async () => ({
      items: [asset], total: 1, nextCursor: null,
      facets: { projects: [{ id: 'project-1', name: '云境计划', status: 'draft' as const }], screens: [{ id: 'main', name: '主页面', projectId: 'project-1' }] }
    }));
    hideGalleryAsset.mockResolvedValue({ ...asset, hidden_at: new Date().toISOString() });
    restoreGalleryAsset.mockResolvedValue(asset);
    render(<App />);
    await user.click(await screen.findByTestId('gallery-entry'));
    await user.click(await screen.findByRole('button', { name: '移除' }));
    await waitFor(() => expect(hideGalleryAsset).toHaveBeenCalledWith('asset-1'));
    const toast = await screen.findByTestId('gallery-undo-toast');
    expect(toast.textContent).toContain('云端文件不会被删除');
    await user.click(screen.getByTestId('gallery-undo'));
    await waitFor(() => expect(restoreGalleryAsset).toHaveBeenCalledWith('asset-1'));
    await waitFor(() => expect(screen.queryByTestId('gallery-undo-toast')).toBeNull());
  });
});

// 反馈按上下文隔离：提示条是遮挡层，工作流的忙碌条/错误条不得跟随进入图库
// 遮挡图库功能按钮，图库的撤销提示与错误也不得悬浮在工作流上；顶栏等两界
// 共用入口的错误（global）两边都显示。图库态的后台信号是标题行不遮挡状态片。
describe('App 反馈按上下文隔离', () => {
  const openInputProject = () => {
    const project = makeProject({ id: 'project-iso', name: '隔离项目', wireframe_path: '/tmp/wireframe.png', workflow: { current_stage: 'input', stages: {} } });
    listProjects.mockResolvedValue([{ id: project.id, name: project.name, project_type: 'existing', status: 'draft', updated_at: project.updated_at, workspacePath: project.workspacePath }]);
    openProject.mockResolvedValue(project);
    return project;
  };

  it('工作流忙碌条不跟随进入图库；非探索任务在图库不显示状态片', async () => {
    const user = userEvent.setup();
    openInputProject();
    draftRequirement.mockImplementation(() => new Promise(() => {}));
    render(<App />);
    await user.click(await screen.findByTestId('intent-draft'));
    await waitFor(() => expect(document.querySelector('.busy-bar')).not.toBeNull());
    await user.click(screen.getByTestId('gallery-entry'));
    await waitFor(() => expect(document.querySelector('.busy-bar')).toBeNull());
    expect(screen.queryByTestId('gallery-busy-chip')).toBeNull();
    await user.click(screen.getByTestId('gallery-back'));
    await waitFor(() => expect(document.querySelector('.busy-bar')).not.toBeNull());
  });

  it('workflow 作用域错误只在工作流显示，切回后状态保留', async () => {
    const user = userEvent.setup();
    openInputProject();
    draftRequirement.mockRejectedValue(new Error('模型不可用'));
    render(<App />);
    await user.click(await screen.findByTestId('intent-draft'));
    await screen.findByText('当前步骤未完成');
    await user.click(screen.getByTestId('gallery-entry'));
    await waitFor(() => expect(document.querySelector('.error-banner')).toBeNull());
    await user.click(screen.getByTestId('gallery-back'));
    await screen.findByText('当前步骤未完成');
  });

  it('gallery 作用域错误只在图库显示', async () => {
    const user = userEvent.setup();
    openInputProject();
    const asset = makeGalleryAsset();
    listGallery.mockResolvedValue({ items: [asset], total: 1, nextCursor: null, facets: { projects: [], screens: [] } });
    hideGalleryAsset.mockRejectedValue(new Error('索引写入失败'));
    render(<App />);
    await user.click(await screen.findByTestId('gallery-entry'));
    await screen.findByTestId('gallery-card');
    await user.click(screen.getByRole('button', { name: '移除' }));
    await screen.findByText('当前步骤未完成');
    await user.click(screen.getByTestId('gallery-back'));
    await waitFor(() => expect(document.querySelector('.error-banner')).toBeNull());
  });

  it('global 作用域错误在图库与工作流都显示', async () => {
    const user = userEvent.setup();
    openInputProject();
    openUserGuide.mockResolvedValue({ ok: false });
    render(<App />);
    await user.click(await screen.findByTitle('使用说明书'));
    await user.click(screen.getByRole('button', { name: '在系统浏览器中打开' }));
    await screen.findByText(/无法打开使用说明书/);
    await user.click(screen.getByRole('button', { name: '关闭' }));
    await user.click(screen.getByTestId('gallery-entry'));
    await screen.findByText(/无法打开使用说明书/);
  });

  // 重试入口属于工作流上下文：图库态忙碌条被抑制、状态片只对视觉探索出现，
  // 若在图库内点重试会全程零反馈地重跑工作流任务，还会改动 inert 覆盖层后
  // 面的阶段。入口只跟随 workflow 作用域错误。
  it('图库态错误条不携带工作流重试入口，回到工作流后重试入口恢复且可重跑', async () => {
    const user = userEvent.setup();
    openInputProject();
    listGallery.mockResolvedValue({ items: [makeGalleryAsset()], total: 1, nextCursor: null, facets: { projects: [], screens: [] } });
    draftRequirement.mockRejectedValue(new Error('模型不可用'));
    hideGalleryAsset.mockRejectedValue(new Error('索引写入失败'));
    render(<App />);
    await user.click(await screen.findByTestId('intent-draft'));
    await screen.findByText('当前步骤未完成');
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    // 工作流错误在图库内隐藏；图库操作失败后错误条重新出现，但不得带上
    // 那个属于工作流的重试入口。
    await user.click(screen.getByTestId('gallery-entry'));
    await user.click(await screen.findByRole('button', { name: '移除' }));
    await screen.findByText('当前步骤未完成');
    expect(document.querySelector('.error-retry')).toBeNull();
    // 回到工作流重新触发 workflow 错误：重试入口恢复，且点击真的重跑任务。
    await user.click(screen.getByTestId('gallery-back'));
    await user.click(screen.getByTestId('intent-draft'));
    await user.click(await screen.findByRole('button', { name: '重试' }));
    await waitFor(() => expect(draftRequirement).toHaveBeenCalledTimes(3));
  });

  // 图库实例常驻，隐藏/恢复/下载的回调在 await 之后无条件触发：请求在飞时
  // 返回工作流，回执不得泄漏到工作流视图，重开图库也不得看到残留提示。
  it('图库请求在飞时返回工作流：撤销提示不泄漏，重开图库不残留', async () => {
    const user = userEvent.setup();
    openInputProject();
    const asset = makeGalleryAsset();
    listGallery.mockResolvedValue({ items: [asset], total: 1, nextCursor: null, facets: { projects: [], screens: [] } });
    let resolveHide: (value: GalleryAsset) => void = () => {};
    hideGalleryAsset.mockImplementation(() => new Promise<GalleryAsset>((resolve) => { resolveHide = resolve; }));
    render(<App />);
    await user.click(await screen.findByTestId('gallery-entry'));
    await user.click(await screen.findByRole('button', { name: '移除' }));
    await waitFor(() => expect(hideGalleryAsset).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId('gallery-back'));
    resolveHide({ ...asset, hidden_at: new Date().toISOString() });
    await waitFor(() => expect(screen.queryByTestId('gallery-undo-toast')).toBeNull());
    await user.click(screen.getByTestId('gallery-entry'));
    await screen.findByTestId('gallery-overlay');
    expect(screen.queryByTestId('gallery-undo-toast')).toBeNull();
  });
});
