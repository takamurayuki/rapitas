/**
 * Task Statistics Routes
 *
 * Provides aggregated task statistics (counts by status, category).
 * Not responsible for detailed analytics — see analytics/statistics.ts.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const logger = createLogger('task-statistics');

export const taskStatisticsRoutes = new Elysia({ prefix: '/tasks' }).get(
  '/statistics',
  async () => {
    const tasks = await prisma.task.findMany({
      where: { parentId: null },
      select: {
        status: true,
        theme: { select: { categoryId: true } },
      },
    });

    const total = tasks.length;
    const byStatus: Record<string, number> = {
      todo: 0,
      'in-progress': 0,
      done: 0,
    };
    const byCategory: Record<number, number> = {};

    for (const task of tasks) {
      if (task.status in byStatus) {
        byStatus[task.status]++;
      }
      const categoryId = task.theme?.categoryId ?? 0;
      byCategory[categoryId] = (byCategory[categoryId] || 0) + 1;
    }

    logger.debug({ total }, 'Task statistics fetched');

    return { total, byStatus, byCategory };
  },
);
