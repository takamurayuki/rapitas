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

/** Return a CSS color string for the given rarity tier. */
export function getRarityColor(rarity: string): string {
  switch (rarity) {
    case 'legendary': return '#F59E0B';
    case 'epic': return '#8B5CF6';
    case 'rare': return '#3B82F6';
    default: return '#6B7280';
  }
}
