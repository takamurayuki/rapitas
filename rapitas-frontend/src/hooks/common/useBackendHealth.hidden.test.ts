/**
 * useBackendHealth.hidden.test
 *
 * Task 1553: while rapitas is in the background the health poll timer is
 * stretched (5 s → 20 s) instead of waking every 5 s for a probe it skips,
 * and it re-arms at the base interval on return.
 */
import { renderHook, act } from '@testing-library/react';
import { useBackendHealth } from './useBackendHealth';
import { setAppHidden } from './app-visibility-store';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));
vi.mock('@/lib/sse/shared-event-source', () => ({
  sharedEventSource: { subscribe: vi.fn(() => vi.fn()) },
}));

function setDocumentHidden(value: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Delays passed to setInterval so far. */
function intervalDelays(spy: ReturnType<typeof vi.spyOn>): number[] {
  return spy.mock.calls.map((c: unknown[]) => c[1] as number);
}

describe('useBackendHealth while hidden (task 1553)', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    setDocumentHidden(false);
    setAppHidden(false);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('arms a 20 s timer while the document is hidden, and does not probe at 5 s', async () => {
    setDocumentHidden(true);
    const spy = vi.spyOn(globalThis, 'setInterval');
    renderHook(() => useBackendHealth());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(intervalDelays(spy)).toContain(20_000);
    expect(intervalDelays(spy)).not.toContain(5_000);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('re-arms at the base 5 s interval when the window is restored from minimize', async () => {
    setAppHidden(true);
    const spy = vi.spyOn(globalThis, 'setInterval');
    renderHook(() => useBackendHealth());
    expect(intervalDelays(spy).at(-1)).toBe(20_000);
    await act(async () => {
      setAppHidden(false);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(intervalDelays(spy).at(-1)).toBe(5_000);
    expect(mockFetch).toHaveBeenCalled();
  });
});
