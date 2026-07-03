import { renderHook, act } from '@testing-library/react';
import { useStudyTimer } from '../study/useStudyTimer';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

describe('useStudyTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at 0 and not running', () => {
    const { result } = renderHook(() => useStudyTimer());
    expect(result.current.elapsed).toBe(0);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.isPaused).toBe(false);
  });

  it('start() begins ticking every second', () => {
    const { result } = renderHook(() => useStudyTimer());
    act(() => result.current.start());
    expect(result.current.isRunning).toBe(true);

    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.elapsed).toBe(3);
  });

  it('start() while already running (not paused) is a no-op', () => {
    const { result } = renderHook(() => useStudyTimer());
    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(2000));
    act(() => result.current.start()); // should not reset elapsed
    expect(result.current.elapsed).toBe(2);
  });

  it('pause() stops ticking and preserves elapsed', () => {
    const { result } = renderHook(() => useStudyTimer());
    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(4000));
    act(() => result.current.pause());
    expect(result.current.isPaused).toBe(true);

    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.elapsed).toBe(4); // did not advance while paused
  });

  it('pause() when not running is a no-op', () => {
    const { result } = renderHook(() => useStudyTimer());
    act(() => result.current.pause());
    expect(result.current.isPaused).toBe(false);
  });

  it('resume() continues ticking from where it paused', () => {
    const { result } = renderHook(() => useStudyTimer());
    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(2000));
    act(() => result.current.pause());
    act(() => result.current.resume());
    expect(result.current.isPaused).toBe(false);

    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.elapsed).toBe(5);
  });

  it('resume() when not paused is a no-op', () => {
    const { result } = renderHook(() => useStudyTimer());
    act(() => result.current.resume());
    expect(result.current.isRunning).toBe(false);
  });

  it('reset() clears elapsed and running/paused flags', () => {
    const { result } = renderHook(() => useStudyTimer());
    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(6000));
    act(() => result.current.reset());

    expect(result.current.elapsed).toBe(0);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.isPaused).toBe(false);

    // Confirm the interval was actually cleared (no further ticking).
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.elapsed).toBe(0);
  });

  it('clears the interval on unmount', () => {
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const { result, unmount } = renderHook(() => useStudyTimer());
    act(() => result.current.start());
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
