import { renderHook, act } from '@testing-library/react';
import { useTaskStats } from '../use-task-stats';

describe('useTaskStats', () => {
  it('returns a fully-zeroed default stats object', () => {
    const { result } = renderHook(() => useTaskStats());
    expect(result.current.stats).toEqual({
      totalCompleted: 0,
      totalCreated: 0,
      streakDays: 0,
      totalFocusMinutes: 0,
      weeklyCompleted: 0,
    });
    expect(result.current.recentAchievements).toEqual([]);
    expect(result.current.isTracking).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('exposes stub tracking functions that do not throw', () => {
    const { result } = renderHook(() => useTaskStats({ userId: 42 }));
    expect(() => {
      act(() => {
        result.current.trackTaskCompletion();
        result.current.trackStudySession();
        result.current.trackAgentExecution();
      });
    }).not.toThrow();
  });
});
