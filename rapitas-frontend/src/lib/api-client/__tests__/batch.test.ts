/**
 * batch.test.ts
 *
 * ApiClientBatch のバッチ合流・成功時ディスパッチ・失敗時の個別フォールバック
 * を検証する。10msの合流ウィンドウをフェイクタイマーで制御する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClientBatch } from '../batch';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

describe('ApiClientBatch', () => {
  let batch: ApiClientBatch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    batch = new ApiClientBatch();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const fallback = vi.fn();

  beforeEach(() => {
    fallback.mockReset();
  });

  it('10ms以内の複数enqueueを1回のPOST /batchにまとめること', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));

    const p1 = batch.enqueue('/tasks/1', {}, fallback);
    const p2 = batch.enqueue('/tasks/2', {}, fallback);
    void p1;
    void p2;

    await vi.advanceTimersByTimeAsync(10);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://test:3001/batch');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.requests).toHaveLength(2);
    expect(sentBody.requests.map((r: { url: string }) => r.url)).toEqual(['/tasks/1', '/tasks/2']);
  });

  it('GETのデフォルトmethodとカスタムmethod/bodyを正しく積むこと', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));

    batch.enqueue('/tasks/1', {}, fallback);
    batch.enqueue('/tasks', { method: 'POST', body: JSON.stringify({ title: 'x' }) }, fallback);

    await vi.advanceTimersByTimeAsync(10);

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(sentBody.requests[0].method).toBe('GET');
    expect(sentBody.requests[1].method).toBe('POST');
    expect(sentBody.requests[1].body).toBe(JSON.stringify({ title: 'x' }));
  });

  it('レスポンスのidに応じて対応するPromiseをresolveすること', async () => {
    const resultPromise = batch.enqueue<{ ok: boolean }>('/tasks/1', {}, fallback);

    // Capture the generated request id from the outgoing fetch payload once flushed.
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string);
      const id = sent.requests[0].id;
      return jsonResponse([{ id, status: 200, body: { ok: true } }]);
    });

    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toEqual({ ok: true });
  });

  it('レスポンスにerrorが含まれる場合は対応するPromiseをrejectすること', async () => {
    const resultPromise = batch.enqueue('/tasks/999', {}, fallback);
    // Attach the rejection assertion BEFORE advancing timers so the promise
    // never has a tick without a handler (avoids a false "unhandled rejection").
    const assertion = expect(resultPromise).rejects.toThrow('not found');

    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string);
      const id = sent.requests[0].id;
      return jsonResponse([{ id, status: 404, body: null, error: 'not found' }]);
    });

    await vi.advanceTimersByTimeAsync(10);

    await assertion;
  });

  it('レスポンスにidが存在しない項目は無視されること（不整合防御）', async () => {
    const resultPromise = batch.enqueue('/tasks/1', {}, fallback);
    let settled = false;
    resultPromise.then(
      () => (settled = true),
      () => (settled = true),
    );

    mockFetch.mockResolvedValue(jsonResponse([{ id: 'unknown-id', status: 200, body: {} }]));

    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();

    expect(settled).toBe(false);
  });

  it('/batch がHTTPエラーを返した場合、各リクエストを個別にfetchFallbackへ委譲すること', async () => {
    mockFetch.mockResolvedValue(jsonResponse(null, false, 500));
    fallback.mockResolvedValue({ id: 1, title: 'fallback-ok' });

    const resultPromise = batch.enqueue('/tasks/1', {}, fallback);

    await vi.advanceTimersByTimeAsync(10);
    // flush() catches, then calls fetchFallback per request (not awaited by flush itself)
    await vi.waitFor(() => expect(fallback).toHaveBeenCalledTimes(1));

    expect(fallback).toHaveBeenCalledWith('/tasks/1', { method: 'GET', body: undefined });
    await expect(resultPromise).resolves.toEqual({ id: 1, title: 'fallback-ok' });
  });

  it('/batch がfetch自体で例外を投げた場合もフォールバックへ委譲すること', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    fallback.mockResolvedValue({ ok: true });

    const resultPromise = batch.enqueue('/tasks/5', {}, fallback);

    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => expect(fallback).toHaveBeenCalledTimes(1));

    await expect(resultPromise).resolves.toEqual({ ok: true });
  });

  it('フォールバックも失敗した場合はPromiseをrejectすること', async () => {
    mockFetch.mockResolvedValue(jsonResponse(null, false, 500));
    fallback.mockRejectedValue(new Error('fallback also failed'));

    const resultPromise = batch.enqueue('/tasks/6', {}, fallback);
    const assertion = expect(resultPromise).rejects.toThrow('fallback also failed');

    await vi.advanceTimersByTimeAsync(10);

    await assertion;
  });

  it('複数回に分けてenqueueすると、それぞれ別のバッチウィンドウでflushされること', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));

    batch.enqueue('/tasks/1', {}, fallback);
    await vi.advanceTimersByTimeAsync(10);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    batch.enqueue('/tasks/2', {}, fallback);
    await vi.advanceTimersByTimeAsync(10);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
