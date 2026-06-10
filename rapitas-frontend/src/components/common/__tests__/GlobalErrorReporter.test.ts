/**
 * GlobalErrorReporter tests
 *
 * Verifies that shouldReport() correctly filters BENIGN_ERRORS and deduplicates
 * repeated messages within DEDUPE_WINDOW_MS.
 */

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

// Re-import the module under test after each test to reset module-level state
// (recentMessages array is module-scoped).
const importFresh = () =>
  import('../GlobalErrorReporter?t=' + Math.random().toString(36).slice(2));

describe('GlobalErrorReporter — BENIGN_ERRORS filtering', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not send ResizeObserver loop completed error', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { default: GlobalErrorReporter } = await importFresh();
    const { unmount } = renderHook(() => GlobalErrorReporter());

    window.dispatchEvent(
      Object.assign(new Event('error'), {
        message: 'ResizeObserver loop completed with undelivered notifications',
        error: null,
      }),
    );

    await vi.runAllTimersAsync();
    expect(mockFetch).not.toHaveBeenCalled();
    unmount();
  });

  it('does not send ResizeObserver loop limit exceeded error', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { default: GlobalErrorReporter } = await importFresh();
    const { unmount } = renderHook(() => GlobalErrorReporter());

    window.dispatchEvent(
      Object.assign(new Event('error'), {
        message: 'ResizeObserver loop limit exceeded',
        error: null,
      }),
    );

    await vi.runAllTimersAsync();
    expect(mockFetch).not.toHaveBeenCalled();
    unmount();
  });

  it('sends errors that are not in BENIGN_ERRORS', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { default: GlobalErrorReporter } = await importFresh();
    const { unmount } = renderHook(() => GlobalErrorReporter());

    await act(async () => {
      window.dispatchEvent(
        Object.assign(new Event('error'), {
          message: 'Uncaught TypeError: Cannot read properties of undefined',
          error: { stack: 'TypeError: ...' },
        }),
      );
    });

    await vi.runAllTimersAsync();
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test:3001/system/errors',
      expect.objectContaining({ method: 'POST' }),
    );
    unmount();
  });

  it('deduplicates the same non-benign error within the dedupe window', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { default: GlobalErrorReporter } = await importFresh();
    const { unmount } = renderHook(() => GlobalErrorReporter());

    const fireError = () =>
      window.dispatchEvent(
        Object.assign(new Event('error'), {
          message: 'Uncaught ReferenceError: x is not defined',
          error: null,
        }),
      );

    await act(async () => {
      fireError();
      fireError();
    });

    await vi.runAllTimersAsync();
    expect(mockFetch).toHaveBeenCalledOnce();
    unmount();
  });
});
