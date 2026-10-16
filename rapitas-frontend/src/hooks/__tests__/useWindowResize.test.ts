import { renderHook, act } from '@testing-library/react';
import { useWindowResize, useResizePerformance } from '../ui/useWindowResize';
import { fireEvent } from '@testing-library/react';

// A single `mockWarn` reference (not a fresh `vi.fn()` per createLogger() call)
// so assertions can observe calls made by the module's own top-level
// `logger` instance, created once at import time. `vi.hoisted` is required
// (rather than a bare `const`) so the value exists by the time vi.mock's
// hoisted factory runs.
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mockWarn,
    error: vi.fn(),
  }),
}));

describe('useWindowResize', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement.classList.remove('window-resizing');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call onResizeStart on first resize event', () => {
    const onResizeStart = vi.fn();
    renderHook(() => useWindowResize({ onResizeStart }));

    act(() => {
      fireEvent.resize(window);
    });

    expect(onResizeStart).toHaveBeenCalledTimes(1);
  });

  it('should call onResize on each resize event', () => {
    const onResize = vi.fn();
    renderHook(() => useWindowResize({ onResize }));

    act(() => {
      fireEvent.resize(window);
    });
    act(() => {
      fireEvent.resize(window);
    });
    act(() => {
      fireEvent.resize(window);
    });

    expect(onResize).toHaveBeenCalledTimes(3);
  });

  it('should call onResizeEnd after debounce timeout', () => {
    const onResizeEnd = vi.fn();
    renderHook(() => useWindowResize({ onResizeEnd, debounceMs: 150 }));

    act(() => {
      fireEvent.resize(window);
    });

    expect(onResizeEnd).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });

  it('should add window-resizing class on resize start', () => {
    renderHook(() => useWindowResize());

    expect(document.documentElement.classList.contains('window-resizing')).toBe(false);

    act(() => {
      fireEvent.resize(window);
    });

    expect(document.documentElement.classList.contains('window-resizing')).toBe(true);
  });

  it('should remove window-resizing class after debounce timeout', () => {
    renderHook(() => useWindowResize({ debounceMs: 100 }));

    act(() => {
      fireEvent.resize(window);
    });

    expect(document.documentElement.classList.contains('window-resizing')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(document.documentElement.classList.contains('window-resizing')).toBe(false);
  });

  it('should clean up event listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useWindowResize());

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    removeEventListenerSpy.mockRestore();
  });

  it('should only call onResizeStart once during continuous resizing', () => {
    const onResizeStart = vi.fn();
    renderHook(() => useWindowResize({ onResizeStart, debounceMs: 200 }));

    act(() => {
      fireEvent.resize(window);
    });
    act(() => {
      fireEvent.resize(window);
    });
    act(() => {
      fireEvent.resize(window);
    });

    expect(onResizeStart).toHaveBeenCalledTimes(1);
  });

  it('should reset debounce timer on subsequent resize events', () => {
    const onResizeEnd = vi.fn();
    renderHook(() => useWindowResize({ onResizeEnd, debounceMs: 150 }));

    act(() => {
      fireEvent.resize(window);
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Fire another resize before debounce completes
    act(() => {
      fireEvent.resize(window);
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Should not have been called yet (timer was reset)
    expect(onResizeEnd).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });

  it('should allow a new resize cycle after debounce completes', () => {
    const onResizeStart = vi.fn();
    const onResizeEnd = vi.fn();
    renderHook(() => useWindowResize({ onResizeStart, onResizeEnd, debounceMs: 100 }));

    // First cycle
    act(() => {
      fireEvent.resize(window);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onResizeStart).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenCalledTimes(1);

    // Second cycle
    act(() => {
      fireEvent.resize(window);
    });

    expect(onResizeStart).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onResizeEnd).toHaveBeenCalledTimes(2);
  });

  describe('Tauri環境', () => {
    afterEach(() => {
      // @ts-expect-error test cleanup of injected Tauri marker
      delete window.__TAURI_INTERNALS__;
      vi.doUnmock('@tauri-apps/api/event');
    });

    it('Tauriの window-resize-optimized イベントを購読すること', async () => {
      // The outer describe's beforeEach enables fake timers; this test awaits a
      // REAL setTimeout to flush a dynamic import, so it needs real timers or
      // the wait hangs until the 5s test timeout.
      vi.useRealTimers();
      // @ts-expect-error injecting a minimal Tauri internals stub for the test
      window.__TAURI_INTERNALS__ = {};
      const mockUnlisten = vi.fn();
      const mockListen = vi.fn(async (_event: string, _cb: () => void) => mockUnlisten);
      vi.doMock('@tauri-apps/api/event', () => ({ listen: mockListen }));

      const onResizeStart = vi.fn();
      const { unmount } = renderHook(() => useWindowResize({ onResizeStart }));

      // Flush the fire-and-forget dynamic import inside the effect.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(mockListen).toHaveBeenCalledWith('window-resize-optimized', expect.any(Function));

      const registeredHandler = mockListen.mock.calls[0][1] as () => void;
      registeredHandler();
      expect(onResizeStart).toHaveBeenCalledTimes(1);

      unmount();
      expect(mockUnlisten).toHaveBeenCalledTimes(1);
    });
  });
});

describe('useResizePerformance', () => {
  let rafCallback: FrameRequestCallback | null = null;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockWarn.mockClear();
    rafCallback = null;
    rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        rafCallback = cb;
        return 1;
      });
    cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    rafSpy.mockRestore();
    cafSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('開発環境でなければFPS計測を開始しないこと', () => {
    vi.stubEnv('NODE_ENV', 'production');
    renderHook(() => useResizePerformance());

    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('開発環境ではFPS計測を開始すること', () => {
    vi.stubEnv('NODE_ENV', 'development');
    renderHook(() => useResizePerformance());

    expect(rafSpy).toHaveBeenCalledTimes(1);
  });

  it('FPSが30を下回ると警告を出すこと', () => {
    vi.stubEnv('NODE_ENV', 'development');
    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);

    renderHook(() => useResizePerformance());
    expect(rafCallback).not.toBeNull();

    // 10 frames spread over 1100ms → ~9fps, below the 30fps warning threshold.
    for (let i = 0; i < 10; i++) {
      now += 110;
      rafCallback?.(0);
    }

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('Low FPS'));
    nowSpy.mockRestore();
  });

  it('FPSが30以上であれば警告を出さないこと', () => {
    vi.stubEnv('NODE_ENV', 'development');
    let now = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);

    renderHook(() => useResizePerformance());

    // 60 frames over 1000ms → 60fps, comfortably above the threshold.
    for (let i = 0; i < 60; i++) {
      now += 1000 / 60;
      rafCallback?.(0);
    }
    now = 1000;
    rafCallback?.(0);

    expect(mockWarn).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it('アンマウント時にアニメーションフレームをキャンセルすること', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { unmount } = renderHook(() => useResizePerformance());

    unmount();

    expect(cafSpy).toHaveBeenCalledWith(1);
  });
});
