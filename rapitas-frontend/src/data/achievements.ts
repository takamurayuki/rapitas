/**
 * Achievement definitions — stub module
 *
 * Placeholder export so consumers compile. Will be populated with real
 * achievement definitions when the feature is fully implemented.
 */
import type { Achievement, AchievementCategory, Badge } from '@/types/achievement';

export const ACHIEVEMENTS: Achievement[] = [];

export const ACHIEVEMENT_CATEGORIES: AchievementCategory[] = [];

export const BADGES: Badge[] = [];

/** Look up an achievement definition by ID. */
export function getAchievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
