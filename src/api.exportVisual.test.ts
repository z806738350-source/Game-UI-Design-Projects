import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// P1-03：Web exportVisual 必须用 fetch 下载——非 2xx 读取 JSON 错误并 throw
//（409 Gate 错误回传到应用错误条），2xx 转 Blob 再触发下载，且下载 URL
// 携带调用时冻结的 screenId。测试强制走 webApi 分支（无桌面注入、非 DEV）。

type FetchCall = { url: string; init?: RequestInit };

const jsonResponse = (status: number, payload: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => payload,
  blob: async () => new Blob(['png-bytes']),
  headers: new Headers()
}) as unknown as Response;

const pngResponse = (disposition: string) => ({
  status: 200,
  ok: true,
  json: async () => ({}),
  blob: async () => new Blob(['png-bytes']),
  headers: new Headers({ 'Content-Disposition': disposition })
}) as unknown as Response;

describe('Web exportVisual（P1-03 fetch 下载）', () => {
  const calls: FetchCall[] = [];
  let fetchMock: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let clickedAnchor: HTMLAnchorElement | undefined;
  // 按 URL 路由响应：/visual/ 请求用 exportResponse，其余（openProject）
  // 回落到带 screen_id 的项目 JSON，避免 mock 队列与调用顺序耦合。
  let exportResponse: Response | null;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DEV', false);
    calls.length = 0;
    clickedAnchor = undefined;
    exportResponse = null;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/visual/') && exportResponse) return exportResponse;
      return jsonResponse(200, { id: 'p1', screen_id: 'battle' });
    });
    vi.stubGlobal('fetch', fetchMock);
    // jsdom 没有实现 URL.createObjectURL；下载锚点的点击也不应真的导航。
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:mock-object-url');
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clickedAnchor = this; });
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const importApi = async () => (await import('./api')).copilotApi;
  const rememberScreen = async (copilotApi: Awaited<ReturnType<typeof importApi>>) => {
    await copilotApi.openProject('p1', { includePreviews: false });
  };

  it('409 等非 2xx 响应读取 JSON 错误并 throw，且 URL 携带冻结的 screenId', async () => {
    const copilotApi = await importApi();
    await rememberScreen(copilotApi);
    exportResponse = jsonResponse(409, { error: 'FINAL_APPROVAL_REQUIRED' });
    await expect(copilotApi.exportVisual('p1', 'final')).rejects.toThrow('FINAL_APPROVAL_REQUIRED');
    const exportCall = calls.at(-1);
    expect(exportCall?.url).toContain('/api/projects/p1/visual/final');
    expect(exportCall?.url).toContain('screenId=battle');
    expect((URL as unknown as { revokeObjectURL: ReturnType<typeof vi.fn> }).revokeObjectURL).not.toHaveBeenCalled();
  });

  it('无 JSON 错误体时回退到带状态码的通用错误', async () => {
    const copilotApi = await importApi();
    await rememberScreen(copilotApi);
    exportResponse = {
      status: 409, ok: false,
      json: async () => { throw new Error('not json'); },
      blob: async () => new Blob(),
      headers: new Headers()
    } as unknown as Response;
    await expect(copilotApi.exportVisual('p1', 'final')).rejects.toThrow('导出最终成图失败（409）');
  });

  it('2xx 响应转 Blob 下载，文件名取 Content-Disposition，并回收 object URL', async () => {
    const copilotApi = await importApi();
    await rememberScreen(copilotApi);
    exportResponse = pngResponse('attachment; filename="battle-final.png"');
    const result = await copilotApi.exportVisual('p1', 'final');
    expect(result).toEqual({ ok: true });
    expect((URL as unknown as { createObjectURL: ReturnType<typeof vi.fn> }).createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickedAnchor).toBeTruthy();
    expect(clickedAnchor?.href).toBe('blob:mock-object-url');
    expect(clickedAnchor?.download).toBe('battle-final.png');
    expect((URL as unknown as { revokeObjectURL: ReturnType<typeof vi.fn> }).revokeObjectURL).toHaveBeenCalledWith('blob:mock-object-url');
  });

  it('未知 screenId 上下文时 URL 不带 screenId 查询参数（向后兼容）', async () => {
    const copilotApi = await importApi();
    exportResponse = pngResponse('attachment; filename="x.png"');
    await copilotApi.exportVisual('p1', 'final');
    const exportCall = calls.at(-1);
    expect(exportCall?.url).toBe('/api/projects/p1/visual/final');
  });
});
