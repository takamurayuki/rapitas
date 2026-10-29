/**
 * Time Entries API Routes
 * Task time tracking endpoints
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { ValidationError } from '../../middleware/error-handler';

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

      // NOTE: `source` is still accepted in the body (callers send it) but no
      // longer read — it only ever chose whether to double-count the minutes
      // as study time, and the learning features were removed.
      const { duration, breakDuration, note, startedAt, endedAt } = body as {
        duration: number;
        breakDuration?: number;
        note?: string;
        startedAt: string;
        endedAt: string;
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

      // NOTE: this used to also record the same minutes as study time against
      // a study-goal-linked task. The learning features were removed, so a
      // time entry is now only ever a time entry.
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
