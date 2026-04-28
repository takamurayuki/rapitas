import { ACHIEVEMENTS, BADGES } from '@/data/achievements';
import type {
  Achievement,
  AchievementNotification,
  AchievementProgress,
  PlayerStats,
  StatsUpdateRequest,
} from '@/types/achievement';

function statValue(stats: PlayerStats, achievement: Achievement): number {
  const value = stats[achievement.metric];
  return typeof value === 'number' ? Math.max(0, value) : 0;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function isNextDay(previous: Date, current: Date): boolean {
  const next = new Date(previous);
  next.setDate(next.getDate() + 1);
  return isSameDay(next, current);
}

export function checkAchievementUnlocked(achievement: Achievement, stats: PlayerStats): boolean {
  const knownAchievement = ACHIEVEMENTS.some((item) => item.id === achievement.id);
  return knownAchievement && statValue(stats, achievement) >= achievement.targetValue;
}

export function calculateAchievementProgress(
  achievement: Achievement,
  stats: PlayerStats,
): AchievementProgress {
  const currentValue = statValue(stats, achievement);
  const targetValue = achievement.targetValue;
  const progressPercentage =
    targetValue <= 0 ? 100 : Math.min(100, (currentValue / targetValue) * 100);
  const isUnlocked = checkAchievementUnlocked(achievement, stats);

  return {
    achievementId: achievement.id,
    currentValue,
    targetValue,
    progressPercentage,
    isUnlocked,
    unlockedAt: isUnlocked ? new Date() : undefined,
  };
}

export function getAllAchievementProgress(stats: PlayerStats): AchievementProgress[] {
  return ACHIEVEMENTS.map((achievement) => calculateAchievementProgress(achievement, stats));
}

export function checkNewlyUnlockedAchievements(
  oldStats: PlayerStats,
  newStats: PlayerStats,
  currentlyUnlocked: string[] = [],
): Achievement[] {
  const unlocked = new Set(currentlyUnlocked);
  return ACHIEVEMENTS.filter(
    (achievement) =>
      !unlocked.has(achievement.id) &&
      !checkAchievementUnlocked(achievement, oldStats) &&
      checkAchievementUnlocked(achievement, newStats),
  );
}

export function updatePlayerStats(stats: PlayerStats, update: StatsUpdateRequest): PlayerStats {
  const timestamp = update.timestamp ?? new Date();
  const previousUpdatedAt = new Date(stats.lastUpdatedAt);
  const sameDay = isSameDay(previousUpdatedAt, timestamp);
  const nextDay = isNextDay(previousUpdatedAt, timestamp);
  const existingTaskStreak =
    stats.currentTaskStreak > 0 ? stats.currentTaskStreak : stats.tasksCompletedToday > 0 ? 1 : 0;
  const existingStudyStreak =
    stats.currentStudyStreak > 0 ? stats.currentStudyStreak : stats.studyTimeToday > 0 ? 1 : 0;

  const tasksCompleted = Math.max(0, update.tasksCompleted ?? 0);
  const studyTimeMinutes = Math.max(0, update.studyTimeMinutes ?? 0);
  const agentExecutions = Math.max(0, update.agentExecutions ?? 0);
  const highPriorityTasksCompleted = Math.max(0, update.highPriorityTasksCompleted ?? 0);

  return {
    ...stats,
    totalTasksCompleted: stats.totalTasksCompleted + tasksCompleted,
    tasksCompletedToday: (sameDay ? stats.tasksCompletedToday : 0) + tasksCompleted,
    tasksCompletedThisWeek: stats.tasksCompletedThisWeek + tasksCompleted,
    currentTaskStreak:
      tasksCompleted > 0
        ? sameDay
          ? Math.max(1, existingTaskStreak)
          : nextDay
            ? existingTaskStreak + 1
            : 1
        : stats.currentTaskStreak,
    maxTaskStreak:
      tasksCompleted > 0
        ? Math.max(
            stats.maxTaskStreak,
            sameDay ? Math.max(1, existingTaskStreak) : nextDay ? existingTaskStreak + 1 : 1,
          )
        : stats.maxTaskStreak,
    totalStudyTimeMinutes: stats.totalStudyTimeMinutes + studyTimeMinutes,
    studyTimeToday: (sameDay ? stats.studyTimeToday : 0) + studyTimeMinutes,
    studyTimeThisWeek: stats.studyTimeThisWeek + studyTimeMinutes,
    currentStudyStreak:
      studyTimeMinutes > 0
        ? sameDay
          ? Math.max(1, existingStudyStreak)
          : nextDay
            ? existingStudyStreak + 1
            : 1
        : stats.currentStudyStreak,
    maxStudyStreak:
      studyTimeMinutes > 0
        ? Math.max(
            stats.maxStudyStreak,
            sameDay ? Math.max(1, existingStudyStreak) : nextDay ? existingStudyStreak + 1 : 1,
          )
        : stats.maxStudyStreak,
    totalAgentExecutions: stats.totalAgentExecutions + agentExecutions,
    agentExecutionsToday: (sameDay ? stats.agentExecutionsToday : 0) + agentExecutions,
    agentExecutionsThisWeek: stats.agentExecutionsThisWeek + agentExecutions,
    highPriorityTasksCompleted: stats.highPriorityTasksCompleted + highPriorityTasksCompleted,
    lastUpdatedAt: timestamp,
  };
}

export function createAchievementNotification(achievement: Achievement): AchievementNotification {
  return {
    id: `${achievement.id}-${Date.now()}`,
    achievementId: achievement.id,
    achievementName: achievement.name,
    title: achievement.name,
    description: achievement.description,
    icon: achievement.icon,
    rarity: achievement.rarity,
    pointsReward: achievement.pointsReward,
    timestamp: new Date(),
    isShown: false,
  };
}

export function checkBadgeEligibility(unlockedAchievements: string[], badgeId: string): boolean {
  const badge = BADGES.find((item) => item.id === badgeId);
  if (!badge) return false;
  return badge.requiredAchievements.every((id) => unlockedAchievements.includes(id));
}

export function getEligibleBadges(unlockedAchievements: string[]): string[] {
  return BADGES.filter((badge) => checkBadgeEligibility(unlockedAchievements, badge.id)).map(
    (badge) => badge.id,
  );
}

export function calculateTotalPoints(unlockedAchievementIds: string[]): number {
  return ACHIEVEMENTS.filter((achievement) =>
    unlockedAchievementIds.includes(achievement.id),
  ).reduce((sum, achievement) => sum + achievement.pointsReward, 0);
}
