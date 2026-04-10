/**
 * useAchievements — stub hook
 *
 * Placeholder until the achievement feature is fully implemented.
 * Returns empty achievements and no-op actions.
 */
'use client';

import type { Achievement } from '@/types/achievement';

export interface UseAchievementsReturn {
  achievements: Achievement[];
  unlockedAchievements: Achievement[];
  lockedAchievements: Achievement[];
  isLoading: boolean;
  error: string | null;
  checkAchievements: () => Promise<void>;
  dismissAchievement: (id: string) => void;
}

export function useAchievements(): UseAchievementsReturn {
  return {
    achievements: [],
    unlockedAchievements: [],
    lockedAchievements: [],
    isLoading: false,
    error: null,
    checkAchievements: async () => {},
    dismissAchievement: () => {},
  };
}
