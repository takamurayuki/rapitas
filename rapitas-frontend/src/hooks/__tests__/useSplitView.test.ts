import { renderHook, act } from '@testing-library/react';
import { useSplitView } from '../ui/useSplitView';
import { setAppHidden } from '../common/app-visibility-store';

const mockIsTauri = vi.fn().mockReturnValue(false);
const mockOpenExternalUrlInSplitView = vi.fn().mockResolvedValue(undefined);
const mockIsSplitViewActive = vi.fn().mockReturnValue(false);

vi.mock('@/utils/tauri', () => ({
  isTauri: (...args: unknown[]) => mockIsTauri(...args),
  openExternalUrlInSplitView: (...args: unknown[]) => mockOpenExternalUrlInSplitView(...args),
  isSplitViewActive: (...args: unknown[]) => mockIsSplitViewActive(...args),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('useSplitView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockIsTauri.mockReturnValue(false);
    mockIsSplitViewActive.mockReturnValue(false);
    mockOpenExternalUrlInSplitView.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setAppHidden(false);
  });

  it('should return isActive false in non-Tauri environment', () => {
    const { result } = renderHook(() => useSplitView());

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.isActive).toBe(false);
  });

  it('should check split view status in Tauri environment', () => {
    mockIsTauri.mockReturnValue(true);
    mockIsSplitViewActive.mockReturnValue(true);

    const { result } = renderHook(() => useSplitView());

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.isActive).toBe(true);
  });

  it('should recompute status on window resize', () => {
    mockIsTauri.mockReturnValue(true);
    mockIsSplitViewActive.mockReturnValue(false);

    const { result } = renderHook(() => useSplitView());

    act(() => {
      vi.advanceTimersByTime(0);
    });

    mockIsSplitViewActive.mockReturnValue(true);

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current.isActive).toBe(true);
  });

  it('should recompute status on visibilitychange', () => {
    mockIsTauri.mockReturnValue(true);
    mockIsSplitViewActive.mockReturnValue(false);

    const { result } = renderHook(() => useSplitView());

    act(() => {
      vi.advanceTimersByTime(0);
    });

    mockIsSplitViewActive.mockReturnValue(true);

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current.isActive).toBe(true);
  });

  it('should no longer poll on a 1-second interval', () => {
    mockIsTauri.mockReturnValue(true);
    mockIsSplitViewActive.mockReturnValue(false);

    renderHook(() => useSplitView());

    act(() => {
      vi.advanceTimersByTime(0);
    });

    const callsBeforeTick = mockIsSplitViewActive.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(mockIsSplitViewActive.mock.calls.length).toBe(callsBeforeTick);
  });

  it('should open split view and refresh status', async () => {
    mockIsTauri.mockReturnValue(true);

    const { result } = renderHook(() => useSplitView());

    await act(async () => {
      await result.current.openSplitView('https://example.com');
    });

    expect(mockOpenExternalUrlInSplitView).toHaveBeenCalledWith('https://example.com');
  });

  it('should handle openSplitView error gracefully', async () => {
    mockIsTauri.mockReturnValue(true);
    mockOpenExternalUrlInSplitView.mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => useSplitView());

    // Should not throw
    await act(async () => {
      await result.current.openSplitView('https://example.com');
    });

    // No error thrown, hook continues working
    expect(result.current.isActive).toBe(false);
  });

  it('should allow manual refresh', () => {
    mockIsTauri.mockReturnValue(true);
    mockIsSplitViewActive.mockReturnValue(false);

    const { result } = renderHook(() => useSplitView());

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.isActive).toBe(false);

    mockIsSplitViewActive.mockReturnValue(true);

    act(() => {
      result.current.refreshStatus();
    });

    expect(result.current.isActive).toBe(true);
  });

  it('should skip recompute on resize while the app is hidden (minimized)', () => {
    mockIsTauri.mockReturnValue(true);
    mockIsSplitViewActive.mockReturnValue(false);
    setAppHidden(true);

    renderHook(() => useSplitView());

    const callsBeforeEvent = mockIsSplitViewActive.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(mockIsSplitViewActive.mock.calls.length).toBe(callsBeforeEvent);
  });

  it('should cleanup timers and listeners on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useSplitView());

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
