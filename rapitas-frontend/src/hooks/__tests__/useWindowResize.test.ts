import { renderHook, act } from '@testing-library/react';
import { useWindowResize } from '../ui/useWindowResize';
import { fireEvent } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
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
});
