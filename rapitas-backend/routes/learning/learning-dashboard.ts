/**
 * Learning Dashboard Route
 *
 * Unified endpoint that aggregates ExamGoal, Flashcard, LearningGoal,
 * and StudyStreak data into a single response. Eliminates the need for
 * the frontend to make 4+ separate API calls to render a learning overview.
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
  flashcards: {
    totalDecks: number;
    totalCards: number;
    dueToday: number;
    reviewedToday: number;
    masteredCards: number;
    averageRetention: number;
  };
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

export const learningDashboardRouter = new Elysia({ prefix: '/learning' })

  .get('/dashboard', async (): Promise<LearningDashboardResponse> => {
    try {
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);

      // Parallel data fetching for all learning features
      const [
        examGoals,
        flashcardStats,
        dueCards,
        reviewedToday,
        learningGoals,
        studyStreaks,
        todayStreak,
      ] = await Promise.all([
        // Exam Goals with task counts
        prisma.examGoal.findMany({
          include: {
            tasks: { select: { id: true, status: true } },
          },
          orderBy: { examDate: 'asc' },
        }),

        // Flashcard aggregate stats
        prisma.flashcard.aggregate({
          _count: { id: true },
          _avg: { stability: true },
        }),

        // Cards due today
        prisma.flashcard.count({
          where: {
            OR: [
              { nextReview: { lte: now } },
              { nextReview: null, reviewCount: 0 },
            ],
          },
        }),

        // Cards reviewed today
        prisma.flashcard.count({
          where: {
            lastReview: { gte: todayStart },
          },
        }),

        // Learning Goals
        prisma.learningGoal.findMany({
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

      // Deck count
      const deckCount = await prisma.flashcardDeck.count();

      // Mastered cards (state=2 with high stability)
      const masteredCards = await prisma.flashcard.count({
        where: { state: 2, stability: { gte: 10 } },
      });

      // Calculate exam goal progress
      const examGoalData = examGoals.map((goal) => {
        const taskCount = goal.tasks.length;
        const completedTaskCount = goal.tasks.filter((t) => t.status === 'done').length;
        const progressPercent = taskCount > 0 ? Math.round((completedTaskCount / taskCount) * 100) : 0;
        const daysRemaining = Math.max(
          0,
          Math.ceil((goal.examDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        );

        return {
          id: goal.id,
          name: goal.name,
          examDate: goal.examDate.toISOString(),
          targetScore: goal.targetScore,
          isCompleted: goal.isCompleted,
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
          const totalDays = (goal.deadline.getTime() - goal.createdAt.getTime()) / (1000 * 60 * 60 * 24);
          const elapsedDays = (now.getTime() - goal.createdAt.getTime()) / (1000 * 60 * 60 * 24);
          progressPercent = totalDays > 0 ? Math.min(100, Math.round((elapsedDays / totalDays) * 100)) : 0;
        }
        if (goal.status === 'completed') progressPercent = 100;

        return {
          id: goal.id,
          title: goal.title,
          currentLevel: goal.currentLevel,
          targetLevel: goal.targetLevel,
          deadline: goal.deadline?.toISOString() ?? null,
          dailyHours: goal.dailyHours,
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

      const avgStability = flashcardStats._avg.stability ?? 0;
      const averageRetention = Math.min(100, Math.round(avgStability * 10));

      return {
        examGoals: examGoalData,
        flashcards: {
          totalDecks: deckCount,
          totalCards: flashcardStats._count.id,
          dueToday: dueCards,
          reviewedToday,
          masteredCards,
          averageRetention,
        },
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
  });
