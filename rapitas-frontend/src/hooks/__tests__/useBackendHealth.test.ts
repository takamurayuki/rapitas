import { renderHook, act, waitFor } from '@testing-library/react';
import { useBackendHealth } from '../common/useBackendHealth';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

describe('useBackendHealth', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('should have initial status of checking', () => {
    mockFetch.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useBackendHealth());
    expect(result.current.status).toBe('checking');
  });

  it('should set connected on successful health check', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useBackendHealth());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status).toBe('connected');
    expect(result.current.isConnected).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test:3001/events/status',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('should set disconnected on failed health check', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    const { result } = renderHook(() => useBackendHealth());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status).toBe('disconnected');
    expect(result.current.isConnected).toBe(false);
  });

  it('should set disconnected on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const { result } = renderHook(() => useBackendHealth());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status).toBe('disconnected');
  });

  it('should call onDisconnectAction when disconnecting', async () => {
    const onDisconnectAction = vi.fn();
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    renderHook(() => useBackendHealth({ onDisconnectAction }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onDisconnectAction).toHaveBeenCalledTimes(1);
  });

  it('should call onReconnectAction when recovering from disconnect', async () => {
    const onReconnectAction = vi.fn();

    // First call fails
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const { result } = renderHook(() =>
      useBackendHealth({
        onReconnectAction,
        intervalMs: 5000,
        retryIntervalMs: 2000,
      }),
    );

    // Initial check - fails
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status).toBe('disconnected');

    // Next call succeeds
    mockFetch.mockResolvedValue({ ok: true });

    // Advance to trigger retry interval (disconnected uses retryIntervalMs=2000)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(result.current.status).toBe('connected');
    expect(onReconnectAction).toHaveBeenCalledTimes(1);
  });

  it('should only call onDisconnectAction once for consecutive failures', async () => {
    const onDisconnectAction = vi.fn();
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    renderHook(() => useBackendHealth({ onDisconnectAction, retryIntervalMs: 1000 }));

    // Initial check
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onDisconnectAction).toHaveBeenCalledTimes(1);

    // Second check
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Should still be 1 - not called again
    expect(onDisconnectAction).toHaveBeenCalledTimes(1);
  });

  it('should use retryIntervalMs when disconnected', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    renderHook(() => useBackendHealth({ intervalMs: 5000, retryIntervalMs: 1000 }));

    // Initial check
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    mockFetch.mockClear();

    // At 1000ms (retryInterval), should check again
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockFetch).toHaveBeenCalled();
  });
});
