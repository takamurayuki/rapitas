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

      const { duration, breakDuration, note, startedAt, endedAt } = body as {
        duration: number;
        breakDuration?: number;
        note?: string;
        startedAt: string;
        endedAt: string;
      };
      return await prisma.timeEntry.create({
        data: {
          taskId,
          duration,
          ...(breakDuration !== undefined && { breakDuration }),
          note,
          startedAt: new Date(startedAt),
          endedAt: new Date(endedAt),
        },
      });
    },
    {
      body: t.Object({
        duration: t.Number({ minimum: 0 }),
        startedAt: t.String(),
        endedAt: t.String(),
        breakDuration: t.Optional(t.Number({ minimum: 0 })),
        note: t.Optional(t.String()),
      }),
    },
  );
