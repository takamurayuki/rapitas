export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface Achievement {
  id: string;
  name: string;
  title?: string;
  description: string;
  icon: string;
  category: string;
  rarity: AchievementRarity;
  pointsReward: number;
  metric: keyof PlayerStats;
  targetValue: number;
}

export interface AchievementCategory {
  id: string;
  label: string;
  icon: string;
}

export interface AchievementProgress {
  achievementId: string;
  currentValue: number;
  targetValue: number;
  progressPercentage: number;
  isUnlocked: boolean;
  unlockedAt?: Date;
}

export interface PlayerStats {
  userId: number;
  totalPoints: number;
  unlockedAchievements: number;
  earnedBadges: number;
  totalTasksCompleted: number;
  tasksCompletedToday: number;
  tasksCompletedThisWeek: number;
  currentTaskStreak: number;
  maxTaskStreak: number;
  totalStudyTimeMinutes: number;
  studyTimeToday: number;
  studyTimeThisWeek: number;
  currentStudyStreak: number;
  maxStudyStreak: number;
  totalAgentExecutions: number;
  agentExecutionsToday: number;
  agentExecutionsThisWeek: number;
  highPriorityTasksCompleted: number;
  onTimeCompletionRate: number;
  lastUpdatedAt: Date;
  totalPomodoros?: number;
  consecutiveDays?: number;
  totalFocusMinutes?: number;
}

export interface StatsUpdateRequest {
  tasksCompleted?: number;
  studyTimeMinutes?: number;
  agentExecutions?: number;
  highPriorityTasksCompleted?: number;
  timestamp?: Date;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  requiredAchievements: string[];
}

export interface AchievementNotification {
  id: string;
  achievementId: string;
  achievementName: string;
  title: string;
  description: string;
  icon: string;
  rarity: AchievementRarity;
  pointsReward: number;
  timestamp: Date;
  unlockedAt?: string;
  isShown: boolean;
}
