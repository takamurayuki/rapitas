import { renderHook, act } from '@testing-library/react';
import { useSplitView } from '../use-split-view';

const mockIsTauri = vi.fn().mockReturnValue(false);
const mockOpenExternalUrlInSplitView = vi.fn().mockResolvedValue(undefined);
const mockIsSplitViewActive = vi.fn().mockReturnValue(false);

vi.mock('@/utils/tauri', () => ({
  isTauri: (...args: unknown[]) => mockIsTauri(...args),
  openExternalUrlInSplitView: (...args: unknown[]) =>
    mockOpenExternalUrlInSplitView(...args),
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

  it('should poll status periodically', () => {
    mockIsTauri.mockReturnValue(true);
    mockIsSplitViewActive.mockReturnValue(false);

    renderHook(() => useSplitView());

    act(() => {
      vi.advanceTimersByTime(0);
    });

    // Change the mock return value
    mockIsSplitViewActive.mockReturnValue(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // isSplitViewActive should be called multiple times due to interval
    expect(mockIsSplitViewActive.mock.calls.length).toBeGreaterThan(1);
  });

  it('should open split view and refresh status', async () => {
    mockIsTauri.mockReturnValue(true);

    const { result } = renderHook(() => useSplitView());

    await act(async () => {
      await result.current.openSplitView('https://example.com');
    });

    expect(mockOpenExternalUrlInSplitView).toHaveBeenCalledWith(
      'https://example.com',
    );
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

  it('should cleanup timers on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    const { unmount } = renderHook(() => useSplitView());

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
