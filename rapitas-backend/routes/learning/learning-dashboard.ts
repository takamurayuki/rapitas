/**
 * Learning Dashboard Route
 *
 * Unified endpoint that aggregates ExamGoal, LearningGoal, and StudyStreak
 * data into a single response. Eliminates the need for the frontend to make
 * multiple separate API calls to render a learning overview.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:learning-dashboard');

/** Aggregated learning dashboard response shape. */
interface LearningDashboardResponse {
  examGoals: Array<{
    id: number;
    name: string;
    examDate: string;
    targetScore: string | null;
    isCompleted: boolean;
    actualScore: string | null;
    color: string;
    daysRemaining: number;
    taskCount: number;
    completedTaskCount: number;
    progressPercent: number;
  }>;
  learningGoals: Array<{
    id: number;
    title: string;
    currentLevel: string | null;
    targetLevel: string | null;
    deadline: string | null;
    dailyHours: number;
    status: string;
    isApplied: boolean;
    progressPercent: number;
  }>;
  studyStreak: {
    currentStreak: number;
    longestStreak: number;
    todayMinutes: number;
    todayTasksCompleted: number;
    weeklyMinutes: number;
    weeklyHistory: Array<{ date: string; minutes: number; tasks: number }>;
  };
}

export const learningDashboardRouter = new Elysia({ prefix: '/learning' }).get(
  '/dashboard',
  async (): Promise<LearningDashboardResponse> => {
    try {
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);

      // Parallel data fetching for all learning features.
      // NOTE: reads the unified StudyGoal model (post-merge); the response
      // keeps the legacy examGoals/learningGoals field shapes so the
      // dashboard frontend needs no change.
      const [examGoals, learningGoals, studyStreaks, todayStreak] = await Promise.all([
        // Exam-type goals with task counts
        prisma.studyGoal.findMany({
          where: { type: 'exam' },
          include: {
            tasks: { select: { id: true, status: true } },
          },
          orderBy: { deadline: 'asc' },
        }),

        // Skill-type goals (旧 学習目標)
        prisma.studyGoal.findMany({
          where: { type: 'skill' },
          orderBy: { createdAt: 'desc' },
        }),

        // Study streaks (last 7 days)
        prisma.studyStreak.findMany({
          where: { date: { gte: weekAgo } },
          orderBy: { date: 'desc' },
        }),

        // Today's streak
        prisma.studyStreak.findFirst({
          where: { date: todayStart },
        }),
      ]);

      // Calculate exam goal progress
      const examGoalData = examGoals.map((goal) => {
        const taskCount = goal.tasks.length;
        const completedTaskCount = goal.tasks.filter((t) => t.status === 'done').length;
        const progressPercent =
          taskCount > 0 ? Math.round((completedTaskCount / taskCount) * 100) : 0;
        const daysRemaining = goal.deadline
          ? Math.max(
              0,
              Math.ceil((goal.deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
            )
          : 0;

        return {
          id: goal.id,
          name: goal.title,
          examDate: (goal.deadline ?? goal.createdAt).toISOString(),
          targetScore: goal.targetScore,
          isCompleted: goal.status === 'completed',
          actualScore: goal.actualScore,
          color: goal.color,
          daysRemaining,
          taskCount,
          completedTaskCount,
          progressPercent,
        };
      });

      // Calculate learning goal progress
      const learningGoalData = learningGoals.map((goal) => {
        let progressPercent = 0;
        if (goal.deadline && goal.createdAt) {
          const totalDays =
            (goal.deadline.getTime() - goal.createdAt.getTime()) / (1000 * 60 * 60 * 24);
          const elapsedDays = (now.getTime() - goal.createdAt.getTime()) / (1000 * 60 * 60 * 24);
          progressPercent =
            totalDays > 0 ? Math.min(100, Math.round((elapsedDays / totalDays) * 100)) : 0;
        }
        if (goal.status === 'completed') progressPercent = 100;

        return {
          id: goal.id,
          title: goal.title,
          currentLevel: goal.currentLevel,
          targetLevel: goal.targetLevel,
          deadline: goal.deadline?.toISOString() ?? null,
          dailyHours: Math.round((goal.dailyMinutes / 60) * 10) / 10,
          status: goal.status,
          isApplied: goal.isApplied,
          progressPercent,
        };
      });

      // Calculate streak
      const sortedStreaks = studyStreaks.sort((a, b) => b.date.getTime() - a.date.getTime());
      let currentStreak = 0;
      const checkDate = new Date(todayStart);
      for (const streak of sortedStreaks) {
        const streakDate = new Date(streak.date);
        streakDate.setHours(0, 0, 0, 0);
        if (streakDate.getTime() === checkDate.getTime() && streak.tasksCompleted > 0) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }

      // Weekly totals
      const weeklyMinutes = studyStreaks.reduce((sum, s) => sum + s.studyMinutes, 0);
      const weeklyHistory = studyStreaks.map((s) => ({
        date: s.date.toISOString().split('T')[0],
        minutes: s.studyMinutes,
        tasks: s.tasksCompleted,
      }));

      // Longest streak (simplified: from available data)
      const allStreaks = await prisma.studyStreak.findMany({
        where: { tasksCompleted: { gt: 0 } },
        orderBy: { date: 'asc' },
        select: { date: true },
      });
      let longestStreak = 0;
      let tempStreak = 0;
      let prevDate: Date | null = null;
      for (const s of allStreaks) {
        if (prevDate) {
          const diff = (s.date.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);
          if (Math.abs(diff - 1) < 0.5) {
            tempStreak++;
          } else {
            tempStreak = 1;
          }
        } else {
          tempStreak = 1;
        }
        longestStreak = Math.max(longestStreak, tempStreak);
        prevDate = s.date;
      }

      return {
        examGoals: examGoalData,
        learningGoals: learningGoalData,
        studyStreak: {
          currentStreak,
          longestStreak,
          todayMinutes: todayStreak?.studyMinutes ?? 0,
          todayTasksCompleted: todayStreak?.tasksCompleted ?? 0,
          weeklyMinutes,
          weeklyHistory,
        },
      };
    } catch (error) {
      log.error({ err: error }, 'Failed to build learning dashboard');
      throw error;
    }
  },
);
