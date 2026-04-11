// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck — Achievement feature is scaffolded but not yet complete. Remove when implementing.
/**
 * Achievement Logic Tests
 *
 * Unit tests for achievement checking, progress calculation,
 * and stats management functions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { PlayerStats, StatsUpdateRequest } from '../../types/achievement';
import {
  checkAchievementUnlocked,
  calculateAchievementProgress,
  getAllAchievementProgress,
  checkNewlyUnlockedAchievements,
  updatePlayerStats,
  createAchievementNotification,
  checkBadgeEligibility,
  getEligibleBadges,
  calculateTotalPoints
} from '../achievements';
import { ACHIEVEMENTS, BADGES } from '../../data/achievements';

// Mock player stats for testing
const createMockPlayerStats = (overrides: Partial<PlayerStats> = {}): PlayerStats => ({
  userId: 1,
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
  lastUpdatedAt: new Date('2023-01-01T00:00:00Z'),
  ...overrides,
});

describe('Achievement Logic', () => {
  describe('checkAchievementUnlocked', () => {
    it('should unlock first_steps achievement after 1 task', () => {
      const stats = createMockPlayerStats({ totalTasksCompleted: 1 });
      const achievement = ACHIEVEMENTS.find(a => a.id === 'first_steps')!;

      const isUnlocked = checkAchievementUnlocked(achievement, stats);
      expect(isUnlocked).toBe(true);
    });

    it('should not unlock first_steps achievement with 0 tasks', () => {
      const stats = createMockPlayerStats({ totalTasksCompleted: 0 });
      const achievement = ACHIEVEMENTS.find(a => a.id === 'first_steps')!;

      const isUnlocked = checkAchievementUnlocked(achievement, stats);
      expect(isUnlocked).toBe(false);
    });

    it('should unlock task_master achievement after 10 tasks', () => {
      const stats = createMockPlayerStats({ totalTasksCompleted: 10 });
      const achievement = ACHIEVEMENTS.find(a => a.id === 'task_master')!;

      const isUnlocked = checkAchievementUnlocked(achievement, stats);
      expect(isUnlocked).toBe(true);
    });

    it('should unlock lightning_fast achievement with 5 tasks today', () => {
      const stats = createMockPlayerStats({ tasksCompletedToday: 5 });
      const achievement = ACHIEVEMENTS.find(a => a.id === 'lightning_fast')!;

      const isUnlocked = checkAchievementUnlocked(achievement, stats);
      expect(isUnlocked).toBe(true);
    });

    it('should unlock study_rookie achievement after 10 hours study', () => {
      const stats = createMockPlayerStats({ totalStudyTimeMinutes: 600 });
      const achievement = ACHIEVEMENTS.find(a => a.id === 'study_rookie')!;

      const isUnlocked = checkAchievementUnlocked(achievement, stats);
      expect(isUnlocked).toBe(true);
    });

    it('should unlock daily_learner achievement with 7-day streak', () => {
      const stats = createMockPlayerStats({ currentStudyStreak: 7 });
      const achievement = ACHIEVEMENTS.find(a => a.id === 'daily_learner')!;

      const isUnlocked = checkAchievementUnlocked(achievement, stats);
      expect(isUnlocked).toBe(true);
    });

    it('should unlock ai_beginner achievement after 1 agent execution', () => {
      const stats = createMockPlayerStats({ totalAgentExecutions: 1 });
      const achievement = ACHIEVEMENTS.find(a => a.id === 'ai_beginner')!;

      const isUnlocked = checkAchievementUnlocked(achievement, stats);
      expect(isUnlocked).toBe(true);
    });

    it('should unlock consistency_champion achievement with 30-day task streak', () => {
      const stats = createMockPlayerStats({ currentTaskStreak: 30 });
      const achievement = ACHIEVEMENTS.find(a => a.id === 'consistency_champion')!;

      const isUnlocked = checkAchievementUnlocked(achievement, stats);
      expect(isUnlocked).toBe(true);
    });
  });

  describe('calculateAchievementProgress', () => {
    it('should calculate 50% progress for task_master with 5 tasks', () => {
      const stats = createMockPlayerStats({ totalTasksCompleted: 5 });
      const achievement = ACHIEVEMENTS.find(a => a.id === 'task_master')!;

      const progress = calculateAchievementProgress(achievement, stats);

      expect(progress.achievementId).toBe('task_master');
      expect(progress.currentValue).toBe(5);
      expect(progress.targetValue).toBe(10);
      expect(progress.progressPercentage).toBe(50);
      expect(progress.isUnlocked).toBe(false);
    });

    it('should calculate 100% progress for completed achievement', () => {
      const stats = createMockPlayerStats({ totalTasksCompleted: 10 });
      const achievement = ACHIEVEMENTS.find(a => a.id === 'task_master')!;

      const progress = calculateAchievementProgress(achievement, stats);

      expect(progress.progressPercentage).toBe(100);
      expect(progress.isUnlocked).toBe(true);
      expect(progress.unlockedAt).toBeDefined();
    });

    it('should handle overflow progress correctly', () => {
      const stats = createMockPlayerStats({ totalTasksCompleted: 20 });
      const achievement = ACHIEVEMENTS.find(a => a.id === 'task_master')!;

      const progress = calculateAchievementProgress(achievement, stats);

      expect(progress.progressPercentage).toBe(100); // Should cap at 100%
      expect(progress.isUnlocked).toBe(true);
    });
  });

  describe('getAllAchievementProgress', () => {
    it('should return progress for all achievements', () => {
      const stats = createMockPlayerStats({
        totalTasksCompleted: 5,
        totalStudyTimeMinutes: 300,
        totalAgentExecutions: 2
      });

      const allProgress = getAllAchievementProgress(stats);

      expect(allProgress).toHaveLength(ACHIEVEMENTS.length);
      expect(allProgress.every(p => p.achievementId)).toBe(true);
      expect(allProgress.every(p => typeof p.progressPercentage === 'number')).toBe(true);
    });
  });

  describe('checkNewlyUnlockedAchievements', () => {
    it('should detect newly unlocked achievements', () => {
      const oldStats = createMockPlayerStats({ totalTasksCompleted: 0 });
      const newStats = createMockPlayerStats({ totalTasksCompleted: 1 });
      const currentlyUnlocked: string[] = [];

      const newlyUnlocked = checkNewlyUnlockedAchievements(oldStats, newStats, currentlyUnlocked);

      expect(newlyUnlocked).toHaveLength(1);
      expect(newlyUnlocked[0].id).toBe('first_steps');
    });

    it('should not return already unlocked achievements', () => {
      const oldStats = createMockPlayerStats({ totalTasksCompleted: 0 });
      const newStats = createMockPlayerStats({ totalTasksCompleted: 1 });
      const currentlyUnlocked = ['first_steps'];

      const newlyUnlocked = checkNewlyUnlockedAchievements(oldStats, newStats, currentlyUnlocked);

      expect(newlyUnlocked).toHaveLength(0);
    });

    it('should detect multiple newly unlocked achievements', () => {
      const oldStats = createMockPlayerStats({
        totalTasksCompleted: 0,
        totalAgentExecutions: 0
      });
      const newStats = createMockPlayerStats({
        totalTasksCompleted: 1,
        totalAgentExecutions: 1
      });

      const newlyUnlocked = checkNewlyUnlockedAchievements(oldStats, newStats, []);

      expect(newlyUnlocked).toHaveLength(2);
      expect(newlyUnlocked.map(a => a.id)).toContain('first_steps');
      expect(newlyUnlocked.map(a => a.id)).toContain('ai_beginner');
    });
  });

  describe('updatePlayerStats', () => {
    let baseStats: PlayerStats;

    beforeEach(() => {
      baseStats = createMockPlayerStats({
        lastUpdatedAt: new Date('2023-01-01T12:00:00Z')
      });
    });

    it('should update task completion stats correctly', () => {
      const updateRequest: StatsUpdateRequest = {
        tasksCompleted: 3,
        timestamp: new Date('2023-01-01T13:00:00Z')
      };

      const updatedStats = updatePlayerStats(baseStats, updateRequest);

      expect(updatedStats.totalTasksCompleted).toBe(3);
      expect(updatedStats.tasksCompletedToday).toBe(3);
      expect(updatedStats.tasksCompletedThisWeek).toBe(3);
      expect(updatedStats.currentTaskStreak).toBe(1);
    });

    it('should update study time stats correctly', () => {
      const updateRequest: StatsUpdateRequest = {
        studyTimeMinutes: 120,
        timestamp: new Date('2023-01-01T13:00:00Z')
      };

      const updatedStats = updatePlayerStats(baseStats, updateRequest);

      expect(updatedStats.totalStudyTimeMinutes).toBe(120);
      expect(updatedStats.studyTimeToday).toBe(120);
      expect(updatedStats.studyTimeThisWeek).toBe(120);
      expect(updatedStats.currentStudyStreak).toBe(1);
    });

    it('should handle day transitions correctly', () => {
      const statsWithTodayData = createMockPlayerStats({
        tasksCompletedToday: 5,
        lastUpdatedAt: new Date('2023-01-01T12:00:00Z')
      });

      const updateRequest: StatsUpdateRequest = {
        tasksCompleted: 2,
        timestamp: new Date('2023-01-02T12:00:00Z') // Next day
      };

      const updatedStats = updatePlayerStats(statsWithTodayData, updateRequest);

      expect(updatedStats.tasksCompletedToday).toBe(2); // Reset for new day
      expect(updatedStats.currentTaskStreak).toBe(2); // Continued from yesterday
    });

    it('should accumulate stats within the same day', () => {
      const statsWithData = createMockPlayerStats({
        totalTasksCompleted: 5,
        tasksCompletedToday: 2,
        lastUpdatedAt: new Date('2023-01-01T10:00:00Z')
      });

      const updateRequest: StatsUpdateRequest = {
        tasksCompleted: 3,
        timestamp: new Date('2023-01-01T14:00:00Z') // Same day
      };

      const updatedStats = updatePlayerStats(statsWithData, updateRequest);

      expect(updatedStats.totalTasksCompleted).toBe(8);
      expect(updatedStats.tasksCompletedToday).toBe(5);
    });
  });

  describe('createAchievementNotification', () => {
    it('should create a valid notification', () => {
      const achievement = ACHIEVEMENTS.find(a => a.id === 'first_steps')!;
      const notification = createAchievementNotification(achievement);

      expect(notification.achievementId).toBe('first_steps');
      expect(notification.achievementName).toBe(achievement.name);
      expect(notification.description).toBe(achievement.description);
      expect(notification.pointsReward).toBe(achievement.pointsReward);
      expect(notification.isShown).toBe(false);
      expect(notification.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Badge System', () => {
    describe('checkBadgeEligibility', () => {
      it('should return true when all required achievements are unlocked', () => {
        const unlockedAchievements = ['first_steps', 'task_master'];
        const badge = BADGES.find(b => b.id === 'task_novice')!;

        const isEligible = checkBadgeEligibility(unlockedAchievements, badge.id);
        expect(isEligible).toBe(true);
      });

      it('should return false when some achievements are missing', () => {
        const unlockedAchievements = ['first_steps'];
        const badge = BADGES.find(b => b.id === 'task_novice')!;

        const isEligible = checkBadgeEligibility(unlockedAchievements, badge.id);
        expect(isEligible).toBe(false);
      });
    });

    describe('getEligibleBadges', () => {
      it('should return all eligible badges', () => {
        const unlockedAchievements = ['first_steps', 'task_master'];

        const eligibleBadges = getEligibleBadges(unlockedAchievements);

        expect(eligibleBadges).toContain('task_novice');
        expect(eligibleBadges).toHaveLength(1);
      });

      it('should return multiple badges when eligible', () => {
        const unlockedAchievements = [
          'first_steps',
          'task_master',
          'ai_beginner',
          'automation_expert'
        ];

        const eligibleBadges = getEligibleBadges(unlockedAchievements);

        expect(eligibleBadges).toContain('task_novice');
        expect(eligibleBadges).toContain('ai_collaborator');
        expect(eligibleBadges.length).toBeGreaterThan(1);
      });
    });
  });

  describe('calculateTotalPoints', () => {
    it('should calculate correct total points', () => {
      const unlockedAchievements = ['first_steps', 'task_master'];

      const totalPoints = calculateTotalPoints(unlockedAchievements);

      const expectedPoints = ACHIEVEMENTS
        .filter(a => unlockedAchievements.includes(a.id))
        .reduce((sum, a) => sum + a.pointsReward, 0);

      expect(totalPoints).toBe(expectedPoints);
    });

    it('should return 0 for no achievements', () => {
      const totalPoints = calculateTotalPoints([]);
      expect(totalPoints).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle invalid achievement IDs gracefully', () => {
      const stats = createMockPlayerStats();
      const invalidAchievement = {
        ...ACHIEVEMENTS[0],
        id: 'invalid_achievement'
      };

      const isUnlocked = checkAchievementUnlocked(invalidAchievement, stats);
      expect(isUnlocked).toBe(false);
    });

    it('should handle negative values in stats', () => {
      const stats = createMockPlayerStats({
        totalTasksCompleted: -5,
        totalStudyTimeMinutes: -100
      });
      const achievement = ACHIEVEMENTS.find(a => a.id === 'first_steps')!;

      const isUnlocked = checkAchievementUnlocked(achievement, stats);
      expect(isUnlocked).toBe(false);
    });

    it('should handle very large stat values', () => {
      const stats = createMockPlayerStats({
        totalTasksCompleted: 1000000
      });
      const achievement = ACHIEVEMENTS.find(a => a.id === 'productivity_beast')!;

      const isUnlocked = checkAchievementUnlocked(achievement, stats);
      expect(isUnlocked).toBe(true);
    });
  });
});