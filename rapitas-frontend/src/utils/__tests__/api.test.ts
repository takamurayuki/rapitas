import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApiUrl, fetchWithRetry } from '../api';

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('buildApiUrl', () => {
  it('builds URL with leading slash', () => {
    expect(buildApiUrl('/tasks')).toMatch(/\/tasks$/);
  });

  it('adds leading slash if missing', () => {
    expect(buildApiUrl('tasks')).toMatch(/\/tasks$/);
  });
});

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns response on successful fetch', async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

    const result = await fetchWithRetry('http://test.com/api');
    expect(result.ok).toBe(true);
  });

  it('retries on network error and succeeds', async () => {
    vi.useRealTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const result = await fetchWithRetry(
      'http://test.com/api',
      undefined,
      3,
      10,
    );
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries', async () => {
    vi.useRealTimers();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch'),
    );

    await expect(
      fetchWithRetry('http://test.com/api', undefined, 2, 10, 10000, {
        silent: true,
      }),
    ).rejects.toThrow(/Failed to fetch.*after 2 attempts/);
  });

  it('throws on HTTP error status', async () => {
    vi.useRealTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    await expect(
      fetchWithRetry('http://test.com/api', undefined, 1, 10, 10000, {
        silent: true,
      }),
    ).rejects.toThrow(/404/);
  });

  it('throws immediately if signal is already aborted', async () => {
    vi.useRealTimers();
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchWithRetry(
        'http://test.com/api',
        { signal: controller.signal },
        1,
        50,
        5000,
        { silent: true },
      ),
    ).rejects.toThrow(/aborted/);
  });
});
