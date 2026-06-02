/**
 * Gantt Data Route
 *
 * GET /gantt-data — returns top-level tasks (with theme/category) shaped for the
 * Gantt chart view, plus metadata. Optional filters: themeId, categoryId, and a
 * date window (from/to) applied to dueDate (tasks with no dueDate are always
 * included so the chart can position them at "now").
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:gantt-data');

export const ganttDataRoute = new Elysia().get(
  '/gantt-data',
  async ({ query }) => {
    try {
      const themeId = query.themeId ? parseInt(query.themeId as string) : null;
      const categoryId = query.categoryId ? parseInt(query.categoryId as string) : null;
      const from = (query.from as string) || null;
      const to = (query.to as string) || null;

      const dateClause =
        from && to
          ? {
              OR: [{ dueDate: { gte: new Date(from), lte: new Date(to) } }, { dueDate: null }],
            }
          : {};

      const tasks = await prisma.task.findMany({
        where: {
          parentId: null,
          status: { notIn: ['archived', 'cancelled'] },
          ...(themeId ? { themeId } : {}),
          ...(categoryId ? { theme: { categoryId } } : {}),
          ...dateClause,
        },
        include: { theme: { include: { category: true } } },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        take: 500,
      });

      const ganttTasks = tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        dueDate: task.dueDate ? task.dueDate.toISOString() : null,
        estimatedHours: task.estimatedHours,
        theme: task.theme
          ? {
              id: task.theme.id,
              name: task.theme.name,
              color: task.theme.color,
              category: task.theme.category
                ? { id: task.theme.category.id, name: task.theme.category.name }
                : null,
            }
          : null,
      }));

      return {
        tasks: ganttTasks,
        metadata: {
          totalTasks: ganttTasks.length,
          dateRange: { from, to },
          filters: { themeId, categoryId },
        },
      };
    } catch (err) {
      log.error({ err }, '[gantt-data] Failed to build gantt data');
      throw err;
    }
  },
  {
    query: t.Object({
      themeId: t.Optional(t.String()),
      categoryId: t.Optional(t.String()),
      from: t.Optional(t.String()),
      to: t.Optional(t.String()),
    }),
  },
);
