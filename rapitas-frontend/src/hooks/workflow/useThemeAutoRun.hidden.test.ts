/**
 * useThemeAutoRun.hidden.test
 *
 * Task 1553: the auto-run state poll (8 s) is stretched to 32 s while
 * rapitas is in the background, and returns to 8 s — with one immediate
 * fetch — when the window comes back.
 */
import { renderHook, act } from '@testing-library/react';
import { useThemeAutoRun } from './useThemeAutoRun';
import { setAppHidden } from '@/hooks/common/app-visibility-store';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

function setDocumentHidden(value: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}

function intervalDelays(spy: ReturnType<typeof vi.spyOn>): number[] {
  return spy.mock.calls.map((c: unknown[]) => c[1] as number);
}

const body = {
  success: true,
  autoRun: { id: 1, themeId: 1, enabled: true, status: 'running', order: 'priority' },
  currentTask: null,
  remainingCount: 0,
};

describe('useThemeAutoRun while hidden (task 1553)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    setDocumentHidden(false);
    setAppHidden(false);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('polls every 32 s instead of 8 s while hidden and fetches nothing at 8 s', async () => {
    setDocumentHidden(true);
    const spy = vi.spyOn(globalThis, 'setInterval');
    renderHook(() => useThemeAutoRun(1, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(intervalDelays(spy)).toContain(32_000);
    expect(intervalDelays(spy)).not.toContain(8_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns to 8 s and fetches at once when visible again', async () => {
    setDocumentHidden(true);
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { result } = renderHook(() => useThemeAutoRun(1, true));
    await act(async () => {
      setDocumentHidden(false);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(intervalDelays(spy).at(-1)).toBe(8_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });
});
