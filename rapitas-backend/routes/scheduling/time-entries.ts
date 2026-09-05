/**
 * Time Entries API Routes
 * Task time tracking endpoints
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { ValidationError } from '../../middleware/error-handler';
import { recordTaskWorkStudyTime } from '../../services/learning/study-time';

export const timeEntriesRoutes = new Elysia()
  // Get time entries for a task
  .get('/tasks/:id/time-entries', async (context) => {
    const { params } = context;
    const taskId = parseInt(params.id);
    if (isNaN(taskId)) {
      throw new ValidationError('無効なタスクIDです');
    }

    return await prisma.timeEntry.findMany({
      where: { taskId },
      orderBy: { startedAt: 'desc' },
    });
  })

  // Create time entry for a task
  .post(
    '/tasks/:id/time-entries',
    async (context) => {
      const { params, body } = context;
      const taskId = parseInt(params.id);
      if (isNaN(taskId)) {
        throw new ValidationError('無効なタスクIDです');
      }

      const { duration, breakDuration, note, startedAt, endedAt, source } = body as {
        duration: number;
        breakDuration?: number;
        note?: string;
        startedAt: string;
        endedAt: string;
        source?: string;
      };
      const entry = await prisma.timeEntry.create({
        data: {
          taskId,
          duration,
          ...(breakDuration !== undefined && { breakDuration }),
          note,
          startedAt: new Date(startedAt),
          endedAt: new Date(endedAt),
        },
      });

      // NOTE: work time on a study-goal-linked (theme or parent) task counts
      // as study time automatically. Pomodoro-originated entries are skipped
      // — the pomodoro session path already recorded the same minutes
      // (pomodoroSessionId-keyed), and doubling here would inflate streaks.
      if (source !== 'pomodoro' && duration > 0) {
        await recordTaskWorkStudyTime({ taskId, durationHours: duration });
      }

      return entry;
    },
    {
      body: t.Object({
        duration: t.Number({ minimum: 0 }),
        startedAt: t.String(),
        endedAt: t.String(),
        breakDuration: t.Optional(t.Number({ minimum: 0 })),
        note: t.Optional(t.String()),
        source: t.Optional(t.String()),
      }),
    },
  );
