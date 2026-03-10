/**
 * Study Streak API Routes
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';

export const studyStreaksRoutes = new Elysia({ prefix: '/study-streaks' })
  .get('/', async (context) => {
    const { query } = context;
    const { days } = query as { days?: string };
    const daysNum = days ? parseInt(days) : 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    startDate.setHours(0, 0, 0, 0);

    return await prisma.studyStreak.findMany({
      where: {
        date: { gte: startDate },
      },
      orderBy: { date: 'asc' },
    });
  })

  .get('/current', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentStreak = 0;
    let checkDate = new Date(today);

    while (true) {
      const streak = await prisma.studyStreak.findUnique({
        where: { date: checkDate },
      });

      if (streak && (streak.studyMinutes > 0 || streak.tasksCompleted > 0)) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    const allStreaks = await prisma.studyStreak.findMany({
      orderBy: { date: 'asc' },
    });

    let longestStreak = 0;
    let tempStreak = 0;
    let prevDate: Date | null = null;

    for (const streak of allStreaks) {
      if (streak.studyMinutes > 0 || streak.tasksCompleted > 0) {
        if (prevDate) {
          const diff = Math.round(
            (streak.date.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24),
          );
          if (diff === 1) {
            tempStreak++;
          } else {
            tempStreak = 1;
          }
        } else {
          tempStreak = 1;
        }
        longestStreak = Math.max(longestStreak, tempStreak);
        prevDate = streak.date;
      } else {
        tempStreak = 0;
        prevDate = null;
      }
    }

    return {
      currentStreak,
      longestStreak,
      today: today.toISOString(),
    };
  })

  .post(
    '/record',
    async (context) => {
      const { body } = context;
      const { date, studyMinutes, tasksCompleted } = body as {
        date?: string | null;
        studyMinutes?: number | null;
        tasksCompleted?: number | null;
      };

      const targetDate = date ? new Date(date) : new Date();
      targetDate.setHours(0, 0, 0, 0);

      return await prisma.studyStreak.upsert({
        where: { date: targetDate },
        update: {
          ...(studyMinutes !== undefined && {
            studyMinutes: { increment: studyMinutes || 0 },
          }),
          ...(tasksCompleted !== undefined && {
            tasksCompleted: { increment: tasksCompleted || 0 },
          }),
        },
        create: {
          date: targetDate,
          studyMinutes: studyMinutes || 0,
          tasksCompleted: tasksCompleted || 0,
        },
      });
    },
    {
      body: t.Object({
        date: t.Optional(t.Nullable(t.String())),
        studyMinutes: t.Optional(t.Nullable(t.Number())),
        tasksCompleted: t.Optional(t.Nullable(t.Number())),
      }),
    },
  );
