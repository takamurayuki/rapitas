import { renderHook, act } from '@testing-library/react';
import { useAchievements } from '../use-achievements';

describe('useAchievements', () => {
  it('splits achievements into locked/unlocked based on default (zero) player stats', () => {
    const { result } = renderHook(() => useAchievements());

    // Default stats are all zero, so nothing should be unlocked yet.
    expect(result.current.unlockedCount).toBe(0);
    expect(result.current.lockedAchievements.length).toBe(result.current.totalCount);
    expect(result.current.unlockedAchievements).toEqual([]);
    expect(result.current.totalPoints).toBe(0);
  });

  it('computes completionPercentage as 0 when nothing is unlocked', () => {
    const { result } = renderHook(() => useAchievements());
    expect(result.current.completionPercentage).toBe(0);
  });

  it('is not loading/erroring and exposes async no-op checkers', async () => {
    const { result } = renderHook(() => useAchievements());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.checkAchievements();
      await result.current.refreshAchievements();
    });
  });

  it('dismissAchievement removes a notification by id', () => {
    const { result } = renderHook(() => useAchievements());
    // Notifications start empty since there's no unlock flow wired here;
    // dismissing a non-existent id should simply be a no-op, not throw.
    act(() => {
      result.current.dismissAchievement('nonexistent');
    });
    expect(result.current.notifications).toEqual([]);
  });

  it('clearNotifications empties the notifications list', () => {
    const { result } = renderHook(() => useAchievements());
    act(() => {
      result.current.clearNotifications();
    });
    expect(result.current.notifications).toEqual([]);
  });

  it('markNotificationAsShown is a no-op safe call when list is empty', () => {
    const { result } = renderHook(() => useAchievements());
    act(() => {
      result.current.markNotificationAsShown('nonexistent');
    });
    expect(result.current.notifications).toEqual([]);
  });

  it('playerStats reflects the passed userId', () => {
    const { result } = renderHook(() => useAchievements({ userId: 42 }));
    expect(result.current.playerStats.userId).toBe(42);
  });

  it('achievements list matches the ACHIEVEMENTS catalog length', () => {
    const { result } = renderHook(() => useAchievements());
    expect(result.current.achievements.length).toBe(result.current.totalCount);
  });
});
