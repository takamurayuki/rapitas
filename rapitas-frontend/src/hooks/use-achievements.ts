'use client';

import { useMemo, useState } from 'react';
import { ACHIEVEMENTS } from '@/data/achievements';
import { calculateTotalPoints, getAllAchievementProgress } from '@/lib/achievements';
import type { Achievement, AchievementNotification, PlayerStats } from '@/types/achievement';

interface UseAchievementsOptions {
  userId?: number;
}

export interface UseAchievementsReturn {
  achievements: Achievement[];
  unlockedAchievements: Achievement[];
  lockedAchievements: Achievement[];
  progress: ReturnType<typeof getAllAchievementProgress>;
  notifications: AchievementNotification[];
  playerStats: PlayerStats;
  totalPoints: number;
  unlockedCount: number;
  totalCount: number;
  completionPercentage: number;
  isLoading: boolean;
  isError: boolean;
  error: string | null;
  checkAchievements: () => Promise<void>;
  dismissAchievement: (id: string) => void;
  markNotificationAsShown: (id: string) => void;
  clearNotifications: () => void;
  refreshAchievements: () => Promise<void>;
}

function createDefaultStats(userId = 1): PlayerStats {
  return {
    userId,
    totalPoints: 0,
    unlockedAchievements: 0,
    earnedBadges: 0,
    totalTasksCompleted: 0,
    tasksCompletedToday: 0,
    tasksCompletedThisWeek: 0,
    currentTaskStreak: 0,
    maxTaskStreak: 0,
    totalStudyTimeMinutes: 0,
    studyTimeToday: 0,
    studyTimeThisWeek: 0,
    currentStudyStreak: 0,
    maxStudyStreak: 0,
    totalAgentExecutions: 0,
    agentExecutionsToday: 0,
    agentExecutionsThisWeek: 0,
    highPriorityTasksCompleted: 0,
    onTimeCompletionRate: 100,
    lastUpdatedAt: new Date(),
  };
}

export function useAchievements(options: UseAchievementsOptions = {}): UseAchievementsReturn {
  const [notifications, setNotifications] = useState<AchievementNotification[]>([]);
  const playerStats = useMemo(() => createDefaultStats(options.userId), [options.userId]);
  const progress = useMemo(() => getAllAchievementProgress(playerStats), [playerStats]);
  const unlockedIds = progress.filter((item) => item.isUnlocked).map((item) => item.achievementId);
  const unlockedAchievements = ACHIEVEMENTS.filter((achievement) =>
    unlockedIds.includes(achievement.id),
  );
  const lockedAchievements = ACHIEVEMENTS.filter(
    (achievement) => !unlockedIds.includes(achievement.id),
  );
  const totalPoints = calculateTotalPoints(unlockedIds);
  const totalCount = ACHIEVEMENTS.length;
  const unlockedCount = unlockedAchievements.length;

  return {
    achievements: ACHIEVEMENTS,
    unlockedAchievements,
    lockedAchievements,
    progress,
    notifications,
    playerStats,
    totalPoints,
    unlockedCount,
    totalCount,
    completionPercentage: totalCount === 0 ? 0 : (unlockedCount / totalCount) * 100,
    isLoading: false,
    isError: false,
    error: null,
    checkAchievements: async () => {},
    dismissAchievement: (id: string) => {
      setNotifications((current) => current.filter((notification) => notification.id !== id));
    },
    markNotificationAsShown: (id: string) => {
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === id ? { ...notification, isShown: true } : notification,
        ),
      );
    },
    clearNotifications: () => setNotifications([]),
    refreshAchievements: async () => {},
  };
}
