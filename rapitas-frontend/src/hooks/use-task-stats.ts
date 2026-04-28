'use client';

interface UseTaskStatsOptions {
  userId?: number;
}

export interface TaskStats {
  totalCompleted: number;
  totalCreated: number;
  streakDays: number;
  totalFocusMinutes: number;
  weeklyCompleted: number;
}

export interface UseTaskStatsReturn {
  stats: TaskStats;
  recentAchievements: string[];
  isTracking: boolean;
  isLoading: boolean;
  trackTaskCompletion: () => void;
  trackStudySession: () => void;
  trackAgentExecution: () => void;
}

export function useTaskStats(_options: UseTaskStatsOptions = {}): UseTaskStatsReturn {
  return {
    stats: {
      totalCompleted: 0,
      totalCreated: 0,
      streakDays: 0,
      totalFocusMinutes: 0,
      weeklyCompleted: 0,
    },
    recentAchievements: [],
    isTracking: false,
    isLoading: false,
    trackTaskCompletion: () => {},
    trackStudySession: () => {},
    trackAgentExecution: () => {},
  };
}
