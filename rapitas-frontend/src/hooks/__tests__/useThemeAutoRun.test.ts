import { renderHook, act } from '@testing-library/react';
import { useThemeAutoRun } from '../workflow/useThemeAutoRun';

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

  it('sets a network error message when the action fetch throws', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.reject(new Error('network down'));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockAutoRunResponse()) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useThemeAutoRun(5, true));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.error).toBe('network down');
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
});
