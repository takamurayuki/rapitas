import { renderHook, act } from '@testing-library/react';
import { useElapsedTime } from '../common/useElapsedTime';
import { setAppHidden } from '../common/app-visibility-store';

describe('useElapsedTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    setAppHidden(false);
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

  describe('可視性連動（document.hidden / app-visibility-store）', () => {
    it('document.hidden の間はtickが進まない', () => {
      const { result } = renderHook(() => useElapsedTime('2026-01-01T00:00:00.000Z', true));
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(result.current).toBe('0:03');

      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(result.current).toBe('0:03');
    });

    it('visibilitychange で表示に戻った瞬間に正しい値へ即座に更新される', () => {
      const { result } = renderHook(() => useElapsedTime('2026-01-01T00:00:00.000Z', true));
      const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(result.current).toBe('0:00');

      hiddenSpy.mockReturnValue(false);
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(result.current).toBe('0:05');
    });

    it('getAppHidden() の間はtickが進まない（最小化）', () => {
      const { result } = renderHook(() => useElapsedTime('2026-01-01T00:00:00.000Z', true));
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current).toBe('0:02');

      setAppHidden(true);
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(result.current).toBe('0:02');
    });

    it('最小化から復帰した瞬間に正しい値へ即座に更新される', () => {
      const { result } = renderHook(() => useElapsedTime('2026-01-01T00:00:00.000Z', true));
      setAppHidden(true);
      act(() => {
        vi.advanceTimersByTime(7000);
      });
      expect(result.current).toBe('0:00');

      act(() => {
        setAppHidden(false);
      });
      expect(result.current).toBe('0:07');
    });
  });

  describe('baseOffsetMs（累積実働ベース、task #560）', () => {
    it('base + 現在経過を表示する', () => {
      const { result } = renderHook(() =>
        useElapsedTime('2026-01-01T00:00:00.000Z', true, 10 * 60 * 1000),
      );
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      // 10分（累積）+ 30秒（現在経過）
      expect(result.current).toBe('10:30');
    });

    it('inactive でも base > 0 なら累積を静的表示する', () => {
      const { result } = renderHook(() => useElapsedTime(null, false, 3 * 60 * 1000 + 21 * 1000));
      expect(result.current).toBe('3:21');
    });

    it('受入3: フェーズ切替（新アンカー+累積繰上げ）で表示が単調増加し 0 に戻らない', () => {
      // フェーズ1: base=0、00:00 開始
      const { result, rerender } = renderHook(
        ({ startedAt, base }) => useElapsedTime(startedAt, true, base),
        {
          initialProps: { startedAt: '2026-01-01T00:00:00.000Z', base: 0 },
        },
      );
      act(() => {
        vi.advanceTimersByTime(10 * 60 * 1000); // フェーズ1が10分経過
      });
      expect(result.current).toBe('10:00');

      // フェーズ切替: 新実行行（アンカーが現在時刻へリセット）+ 完了10分が base へ
      rerender({ startedAt: '2026-01-01T00:10:00.000Z', base: 10 * 60 * 1000 });
      // 切替直後も 0 に戻らず累積 10 分から継続
      expect(result.current).toBe('10:00');

      act(() => {
        vi.advanceTimersByTime(45_000);
      });
      // フェーズ2の経過が累積に上乗せされ単調増加
      expect(result.current).toBe('10:45');
    });

    it('base 未指定は従来どおり経過のみ（後方互換）', () => {
      const { result } = renderHook(() => useElapsedTime('2026-01-01T00:00:00.000Z', true));
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(result.current).toBe('0:05');
    });
  });
});
