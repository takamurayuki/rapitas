/**
 * useTaskStats — stub hook
 *
 * Placeholder until the achievement/stats feature is fully implemented.
 */
'use client';

export interface TaskStats {
  totalCompleted: number;
  totalCreated: number;
  streakDays: number;
  totalFocusMinutes: number;
  weeklyCompleted: number;
}

export interface UseTaskStatsReturn {
  stats: TaskStats;
  isLoading: boolean;
}

export function useTaskStats(): UseTaskStatsReturn {
  return {
    stats: {
      totalCompleted: 0,
      totalCreated: 0,
      streakDays: 0,
      totalFocusMinutes: 0,
      weeklyCompleted: 0,
    },
    isLoading: false,
  };
}
