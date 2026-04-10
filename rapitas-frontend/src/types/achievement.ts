/**
 * Achievement types — stub module
 *
 * The achievement feature is partially scaffolded but not yet complete.
 * This file provides the type exports that AchievementToast.tsx and
 * AchievementsClient.tsx expect so the project compiles. Real definitions
 * will replace these stubs when the feature is implemented.
 */

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  unlockedAt?: string;
  progress?: number;
  maxProgress?: number;
}

export interface AchievementCategory {
  id: string;
  label: string;
  icon: string;
}

/** Player stats for achievement evaluation. Stub — shape TBD. */
export interface PlayerStats {
  userId: number;
  totalTasksCompleted: number;
  totalPomodoros: number;
  consecutiveDays: number;
  totalFocusMinutes: number;
  [key: string]: unknown;
}

/** Request shape for updating player stats. Stub — shape TBD. */
export interface StatsUpdateRequest {
  type: string;
  value: number;
  [key: string]: unknown;
}

/** Badge definition. Stub — shape TBD. */
export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  requirement: string;
}
