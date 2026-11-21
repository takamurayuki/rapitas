import { renderHook, act } from '@testing-library/react';
import {
  AUTO_RUN_ACTION_RETRY_MS,
  AUTO_RUN_ERROR_UNREACHABLE,
  useThemeAutoRun,
} from '../workflow/useThemeAutoRun';
import { setAppHidden } from '../common/app-visibility-store';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

function mockAutoRunResponse(overrides: Partial<{ status: string }> = {}) {
  return {
    success: true,
    autoRun: {
      id: 1,
      themeId: 1,
      enabled: true,
      status: overrides.status ?? 'idle',
      order: 'priority',
      currentTaskId: null,
      processedCount: 0,
      lastError: null,
      lastRunAt: null,
      startedAt: null,
      updatedAt: '2026-01-01T00:00:00Z',
    },
    currentTask: null,
    remainingCount: 0,
  };
}

describe('useThemeAutoRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setAppHidden(false);
  });

  it('does not fetch when themeId is null', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useThemeAutoRun(null, true));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it('does not fetch when isDevelopment is false', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useThemeAutoRun(5, false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches auto-run state when themeId + isDevelopment are set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockAutoRunResponse()),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useThemeAutoRun(5, true));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(fetchMock).toHaveBeenCalledWith('http://test:3001/themes/5/auto-run');
    expect(result.current.data?.autoRun.status).toBe('idle');
    expect(result.current.loading).toBe(false);
  });

  it('leaves data null when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    const { result } = renderHook(() => useThemeAutoRun(5, true));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('start() posts the start action and sets error on failure', async () => {
    // Route by HTTP method rather than call order: React may run the mount
    // effect more than once (dev double-invoke), so a fixed once-queue is
    // fragile here — the GET response must be reusable across N mount calls.
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: false, error: 'cannot start' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockAutoRunResponse()) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useThemeAutoRun(5, true));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    await act(async () => {
      await result.current.start('priority');
    });

    expect(result.current.error).toBe('cannot start');
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://test:3001/themes/5/auto-run',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('start() optimistically updates autoRun state on success', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              autoRun: mockAutoRunResponse({ status: 'running' }).autoRun,
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockAutoRunResponse()) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useThemeAutoRun(5, true));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.data?.autoRun.status).toBe('running');
    expect(result.current.error).toBeNull();
  });

  // 2026-11-21: 再開 pressed while the backend was restarting (it restarts
  // itself to apply new commits) failed with "Failed to fetch" in a tiny badge,
  // and the run stayed paused. The action now retries until the server is back.
  it('retries an action the restarting backend could not take, then applies it', async () => {
    let posts = 0;
    // The GET answers with what the server holds, so the re-fetch after the
    // action reads the applied state rather than a fixed idle.
    let serverStatus = 'paused';
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1;
        if (posts <= 2) return Promise.reject(new TypeError('Failed to fetch'));
        serverStatus = 'running';
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              autoRun: mockAutoRunResponse({ status: 'running' }).autoRun,
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockAutoRunResponse({ status: serverStatus })),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useThemeAutoRun(5, true));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    let done: Promise<void> | undefined;
    act(() => {
      done = result.current.start('priority');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(result.current.reconnecting).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      await done;
    });
    expect(posts).toBe(3);
    expect(result.current.data?.autoRun.status).toBe('running');
    expect(result.current.error).toBeNull();
    expect(result.current.reconnecting).toBe(false);
    expect(result.current.actionLoading).toBe(false);
  });

  it('retries a 503 from a backend that is still starting', async () => {
    let posts = 0;
    let serverStatus = 'paused';
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1;
        serverStatus = posts === 1 ? serverStatus : 'running';
        if (posts === 1) {
          return Promise.resolve({
            ok: false,
            status: 503,
            json: () => Promise.reject(new SyntaxError('not json')),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              autoRun: mockAutoRunResponse({ status: 'running' }).autoRun,
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockAutoRunResponse({ status: serverStatus })),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useThemeAutoRun(5, true));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await act(async () => {
      const done = result.current.start();
      await vi.advanceTimersByTimeAsync(5_000);
      await done;
    });
    expect(posts).toBe(2);
    expect(result.current.data?.autoRun.status).toBe('running');
  });

  it('gives up with an unreachable error once the server stays down', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockAutoRunResponse()) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useThemeAutoRun(5, true));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    await act(async () => {
      const done = result.current.stop();
      await vi.advanceTimersByTimeAsync(AUTO_RUN_ACTION_RETRY_MS + 10_000);
      await done;
    });

    expect(result.current.error).toBe(AUTO_RUN_ERROR_UNREACHABLE);
    expect(result.current.reconnecting).toBe(false);
    expect(result.current.actionLoading).toBe(false);
  });

  it('does not fetch while document.hidden is true', async () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(mockAutoRunResponse()) });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useThemeAutoRun(5, true));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fetch while the app is hidden (minimized) even if document.hidden is false', async () => {
    setAppHidden(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(mockAutoRunResponse()) });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useThemeAutoRun(5, true));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches immediately when restored from minimize', async () => {
    setAppHidden(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(mockAutoRunResponse()) });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useThemeAutoRun(5, true));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      setAppHidden(false);
    });

    expect(fetchMock).toHaveBeenCalledWith('http://test:3001/themes/5/auto-run');
  });
});
