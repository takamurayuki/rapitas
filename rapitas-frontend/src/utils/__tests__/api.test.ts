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

    const result = await fetchWithRetry('http://test.com/api', undefined, 3, 10);
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries', async () => {
    vi.useRealTimers();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      fetchWithRetry('http://test.com/api', undefined, 2, 10, 10000, {
        silent: true,
      }),
    ).rejects.toThrow(/Failed to fetch.*after 2 attempts/);
  });

  it('throws immediately on 4xx client error without retrying', async () => {
    vi.useRealTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValue(new Response('Not Found', { status: 404, statusText: 'Not Found' }));

    await expect(
      fetchWithRetry('http://test.com/api', undefined, 3, 10, 10000, {
        silent: true,
      }),
    ).rejects.toThrow(/404/);

    // 4xx is not retried, so fetch is called only once
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on 401 unauthorized without retrying', async () => {
    vi.useRealTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValue(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
    );

    await expect(
      fetchWithRetry('http://test.com/api', undefined, 3, 10, 10000, {
        silent: true,
      }),
    ).rejects.toThrow(/401/);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws immediately if signal is already aborted', async () => {
    vi.useRealTimers();
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchWithRetry('http://test.com/api', { signal: controller.signal }, 1, 50, 5000, {
        silent: true,
      }),
    ).rejects.toThrow(/aborted/);
  });

  it('retries on HTTP 500 error and succeeds on second attempt', async () => {
    vi.useRealTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(
      new Response('Internal Server Error', {
        status: 500,
        statusText: 'Internal Server Error',
      }),
    );
    fetchSpy.mockResolvedValueOnce(new Response('{"data": "ok"}', { status: 200 }));

    const result = await fetchWithRetry('http://test.com/api', undefined, 3, 10);
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries on HTTP 429 Too Many Requests', async () => {
    vi.useRealTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(
      new Response('Too Many Requests', {
        status: 429,
        statusText: 'Too Many Requests',
      }),
    );
    fetchSpy.mockResolvedValueOnce(new Response('{"data": "ok"}', { status: 200 }));

    const result = await fetchWithRetry('http://test.com/api', undefined, 3, 10);
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry when caller aborts the request', async () => {
    vi.useRealTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const controller = new AbortController();

    // Simulate abort during fetch
    fetchSpy.mockImplementationOnce(async (_input, init) => {
      controller.abort();
      (init?.signal as AbortSignal).throwIfAborted();
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    await expect(
      fetchWithRetry('http://test.com/api', { signal: controller.signal }, 3, 10, 5000, {
        silent: true,
      }),
    ).rejects.toThrow(/aborted/);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('includes cause in thrown error after all retries fail', async () => {
    vi.useRealTimers();
    const originalError = new TypeError('Failed to fetch');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(originalError);

    try {
      await fetchWithRetry('http://test.com/api', undefined, 1, 10, 10000, {
        silent: true,
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).cause).toBe(originalError);
    }
  });

  it('handles URL object input', async () => {
    vi.useRealTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const url = new URL('http://test.com/api');
    const result = await fetchWithRetry(url);
    expect(result.ok).toBe(true);
  });

  describe('X-Rapitas-Source header injection', () => {
    /** Normalize the init argument of a fetch spy call into Headers. */
    function headersOf(init: RequestInit | undefined): Headers {
      return new Headers(init?.headers);
    }

    it('adds x-rapitas-source: ui when no headers are given', async () => {
      vi.useRealTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      await fetchWithRetry('http://test.com/api');

      expect(headersOf(fetchSpy.mock.calls[0]?.[1]).get('x-rapitas-source')).toBe('ui');
    });

    it('preserves caller headers given as a plain object', async () => {
      vi.useRealTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      await fetchWithRetry('http://test.com/api', {
        headers: { 'Content-Type': 'application/json' },
      });

      const headers = headersOf(fetchSpy.mock.calls[0]?.[1]);
      expect(headers.get('content-type')).toBe('application/json');
      expect(headers.get('x-rapitas-source')).toBe('ui');
    });

    it('preserves caller headers given as a Headers instance', async () => {
      vi.useRealTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      await fetchWithRetry('http://test.com/api', {
        headers: new Headers({ Authorization: 'Bearer token' }),
      });

      const headers = headersOf(fetchSpy.mock.calls[0]?.[1]);
      expect(headers.get('authorization')).toBe('Bearer token');
      expect(headers.get('x-rapitas-source')).toBe('ui');
    });

    it('preserves caller headers given as a [key, value][] array', async () => {
      vi.useRealTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      await fetchWithRetry('http://test.com/api', {
        headers: [['X-Custom', 'abc']],
      });

      const headers = headersOf(fetchSpy.mock.calls[0]?.[1]);
      expect(headers.get('x-custom')).toBe('abc');
      expect(headers.get('x-rapitas-source')).toBe('ui');
    });

    it('does not overwrite a caller-provided x-rapitas-source value', async () => {
      vi.useRealTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      await fetchWithRetry('http://test.com/api', {
        headers: { 'x-rapitas-source': 'custom' },
      });

      expect(headersOf(fetchSpy.mock.calls[0]?.[1]).get('x-rapitas-source')).toBe('custom');
    });

    it('keeps the header on retry attempts', async () => {
      vi.useRealTimers();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      await fetchWithRetry('http://test.com/api', undefined, 3, 10);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(headersOf(fetchSpy.mock.calls[0]?.[1]).get('x-rapitas-source')).toBe('ui');
      expect(headersOf(fetchSpy.mock.calls[1]?.[1]).get('x-rapitas-source')).toBe('ui');
    });
  });
});
