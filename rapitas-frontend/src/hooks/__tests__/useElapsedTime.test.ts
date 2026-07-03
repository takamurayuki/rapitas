import { renderHook, act } from '@testing-library/react';
import { useElapsedTime } from '../common/useElapsedTime';

describe('useElapsedTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when inactive', () => {
    const { result } = renderHook(() => useElapsedTime('2026-01-01T00:00:00.000Z', false));
    expect(result.current).toBeNull();
  });

  it('returns null when startedAt is null', () => {
    const { result } = renderHook(() => useElapsedTime(null, true));
    expect(result.current).toBeNull();
  });

  it('returns null when startedAt is undefined', () => {
    const { result } = renderHook(() => useElapsedTime(undefined, true));
    expect(result.current).toBeNull();
  });

  it('returns null when startedAt is an invalid date string', () => {
    const { result } = renderHook(() => useElapsedTime('not-a-date', true));
    expect(result.current).toBeNull();
  });

  it('formats under a minute as M:SS', () => {
    const { result } = renderHook(() => useElapsedTime('2026-01-01T00:00:00.000Z', true));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe('0:05');
  });

  it('formats minutes and seconds correctly', () => {
    const { result } = renderHook(() => useElapsedTime('2026-01-01T00:00:00.000Z', true));
    act(() => {
      vi.advanceTimersByTime(3 * 60 * 1000 + 21 * 1000); // 3:21
    });
    expect(result.current).toBe('3:21');
  });

  it('formats past an hour as H:MM:SS', () => {
    const { result } = renderHook(() => useElapsedTime('2026-01-01T00:00:00.000Z', true));
    act(() => {
      vi.advanceTimersByTime(2 * 3600 * 1000 + 5 * 60 * 1000 + 9 * 1000); // 2:05:09
    });
    expect(result.current).toBe('2:05:09');
  });

  it('stops ticking when active becomes false', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useElapsedTime('2026-01-01T00:00:00.000Z', active),
      { initialProps: { active: true } },
    );
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe('0:10');

    rerender({ active: false });
    expect(result.current).toBeNull();
  });

  it('clears the interval on unmount', () => {
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const { unmount } = renderHook(() => useElapsedTime('2026-01-01T00:00:00.000Z', true));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
