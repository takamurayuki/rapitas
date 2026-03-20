/**
 * Search Main Route
 *
 * GET / — cross-entity full-text search across tasks, notes, comments, and resources.
 * Scoring and excerpt logic delegated to helpers.ts.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { type SearchResultItem, createExcerpt, calculateRelevance } from './helpers';

const log = createLogger('routes:search:main');

/**
 * Main cross-entity search route handler.
 */
export const searchMainRoute = new Elysia()

  .get('/', async ({ query: q, set }) => {
    try {
      const searchQuery = q.q?.trim();
      if (!searchQuery || searchQuery.length < 1) {
        set.status = 400;
        return { success: false, error: 'Search query is required' };
      }

      if (searchQuery.length > 500) {
        set.status = 400;
        return { success: false, error: 'Search query is too long (max 500 characters)' };
      }

      const types = q.type?.split(',') || ['task', 'comment', 'note', 'resource'];
      const limit = q.limit ? Math.min(parseInt(q.limit), 100) : 20;
      const offset = q.offset ? parseInt(q.offset) : 0;
      const sortBy = q.sortBy || 'relevance';

      const statusFilter = q.status?.split(',');
      const priorityFilter = q.priority?.split(',');
      const labelIdFilter = q.labelId
        ?.split(',')
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));
      const themeIdFilter = q.themeId ? parseInt(q.themeId) : undefined;
      const dateFrom = q.dateFrom ? new Date(q.dateFrom) : undefined;
      const dateTo = q.dateTo ? new Date(q.dateTo) : undefined;

      const words = searchQuery.split(/\s+/).filter((w) => w.length > 0);
      const results: SearchResultItem[] = [];

      if (types.includes('task')) {
        // HACK(agent): `any` used for dynamic Prisma where clause construction — no typed builder available.
        const taskWhere: any = {
          AND: [
            ...words.map((word) => ({
              OR: [
                { title: { contains: word, mode: 'insensitive' as const } },
                { description: { contains: word, mode: 'insensitive' as const } },
              ],
            })),
          ],
        };

        if (statusFilter) taskWhere.AND.push({ status: { in: statusFilter } });
        if (priorityFilter) taskWhere.AND.push({ priority: { in: priorityFilter } });
        if (themeIdFilter) taskWhere.AND.push({ themeId: themeIdFilter });
        if (dateFrom || dateTo) {
          // HACK(agent): `any` used for optional date condition object construction.
          const dateCondition: any = {};
          if (dateFrom) dateCondition.gte = dateFrom;
          if (dateTo) dateCondition.lte = dateTo;
          taskWhere.AND.push({ updatedAt: dateCondition });
        }
        if (labelIdFilter && labelIdFilter.length > 0) {
          taskWhere.AND.push({
            taskLabels: { some: { labelId: { in: labelIdFilter } } },
          });
        }

        // HACK(agent): `any` used for dynamic orderBy — Prisma doesn't export the union type.
        const orderBy: any =
          sortBy === 'updatedAt'
            ? { updatedAt: 'desc' }
            : sortBy === 'createdAt'
              ? { createdAt: 'desc' }
              : { updatedAt: 'desc' }; // relevance sorted later in JS

        const tasks = await prisma.task.findMany({
          where: taskWhere,
          include: {
            theme: { select: { id: true, name: true, color: true } },
            taskLabels: { include: { label: true } },
          },
          skip: sortBy === 'relevance' ? 0 : offset,
          take: sortBy === 'relevance' ? undefined : limit,
          orderBy,
        });

        for (const task of tasks) {
          const titleRelevance = calculateRelevance(task.title, task.description, searchQuery, {
            isTitle: true,
            updatedAt: task.updatedAt,
            status: task.status,
          });
          const descRelevance = task.description
            ? calculateRelevance(task.description, null, searchQuery, {
                isDescription: true,
                updatedAt: task.updatedAt,
                status: task.status,
              })
            : 0;

          results.push({
            id: task.id,
            type: 'task',
            title: task.title,
            excerpt: task.description ? createExcerpt(task.description, searchQuery) : '',
            relevance: Math.max(titleRelevance, descRelevance),
            metadata: {
              status: task.status,
              priority: task.priority,
              theme: task.theme,
              labels: task.taskLabels.map((tl) => tl.label),
              dueDate: task.dueDate,
            },
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          });
        }
      }

      if (types.includes('note')) {
        const pomodoroWhere = {
          AND: [
            { note: { not: null } },
            ...words.map((word) => ({
              note: { contains: word, mode: 'insensitive' as const },
            })),
          ],
        };

        const pomodoroSessions = await prisma.pomodoroSession.findMany({
          where: pomodoroWhere,
          include: { task: { select: { id: true, title: true } } },
          take: 50,
          orderBy: { updatedAt: 'desc' },
        });

        for (const session of pomodoroSessions) {
          if (session.note) {
            results.push({
              id: session.id,
              type: 'note',
              title: session.task
                ? `Pomodoro Note: ${session.task.title}`
                : `Pomodoro Session #${session.id}`,
              excerpt: createExcerpt(session.note, searchQuery),
              relevance:
                calculateRelevance(session.note, null, searchQuery, {
                  updatedAt: session.updatedAt,
                }) * 0.5,
              metadata: {
                sessionType: 'pomodoro',
                taskId: session.taskId,
                taskTitle: session.task?.title,
                startedAt: session.startedAt,
                completedAt: session.completedAt,
              },
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
            });
          }
        }

        const timeEntryWhere = {
          AND: [
            { note: { not: null } },
            ...words.map((word) => ({
              note: { contains: word, mode: 'insensitive' as const },
            })),
          ],
        };

        const timeEntries = await prisma.timeEntry.findMany({
          where: timeEntryWhere,
          include: { task: { select: { id: true, title: true } } },
          take: 50,
          orderBy: { updatedAt: 'desc' },
        });

        for (const entry of timeEntries) {
          if (entry.note) {
            results.push({
              id: entry.id,
              type: 'note',
              title: entry.task
                ? `Time Entry Note: ${entry.task.title}`
                : `Time Entry #${entry.id}`,
              excerpt: createExcerpt(entry.note, searchQuery),
              relevance:
                calculateRelevance(entry.note, null, searchQuery, {
                  updatedAt: entry.updatedAt,
                }) * 0.5,
              metadata: {
                sessionType: 'time_entry',
                taskId: entry.taskId,
                taskTitle: entry.task?.title,
                startedAt: entry.startedAt,
                endedAt: entry.endedAt,
                duration: entry.duration,
              },
              createdAt: entry.createdAt,
              updatedAt: entry.updatedAt,
            });
          }
        }
      }

      if (types.includes('comment')) {
        const commentWhere = {
          AND: words.map((word) => ({
            content: { contains: word, mode: 'insensitive' as const },
          })),
        };

        const comments = await prisma.comment.findMany({
          where: commentWhere,
          include: { task: { select: { id: true, title: true } } },
          take: 50,
          orderBy: { updatedAt: 'desc' },
        });

        for (const comment of comments) {
          results.push({
            id: comment.id,
            type: 'comment',
            title: comment.task
              ? `Comment on: ${comment.task.title}`
              : `Comment #${comment.id}`,
            excerpt: createExcerpt(comment.content, searchQuery),
            relevance:
              calculateRelevance(comment.content, null, searchQuery, {
                updatedAt: comment.updatedAt,
              }) * 0.6,
            metadata: {
              taskId: comment.taskId,
              taskTitle: comment.task?.title,
            },
            createdAt: comment.createdAt,
            updatedAt: comment.updatedAt,
          });
        }
      }

      if (types.includes('resource')) {
        const resourceWhere = {
          AND: words.map((word) => ({
            OR: [
              { title: { contains: word, mode: 'insensitive' as const } },
              { description: { contains: word, mode: 'insensitive' as const } },
            ],
          })),
        };

        const resources = await prisma.resource.findMany({
          where: resourceWhere,
          include: { task: { select: { id: true, title: true } } },
          take: 50,
          orderBy: { updatedAt: 'desc' },
        });

        for (const resource of resources) {
          const titleRelevance = calculateRelevance(
            resource.title,
            resource.description,
            searchQuery,
            { isTitle: true, updatedAt: resource.updatedAt },
          );
          const descRelevance = resource.description
            ? calculateRelevance(resource.description, null, searchQuery, {
                isDescription: true,
                updatedAt: resource.updatedAt,
              })
            : 0;

          results.push({
            id: resource.id,
            type: 'resource',
            title: resource.title,
            excerpt: resource.description ? createExcerpt(resource.description, searchQuery) : '',
            relevance: Math.max(titleRelevance, descRelevance),
            metadata: {
              resourceType: resource.type,
              url: resource.url,
              taskId: resource.taskId,
              taskTitle: resource.task?.title,
            },
            createdAt: resource.createdAt,
            updatedAt: resource.updatedAt,
          });
        }
      }

      if (sortBy === 'relevance') {
        results.sort((a, b) => b.relevance - a.relevance);
      } else if (sortBy === 'updatedAt') {
        results.sort((a, b) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0));
      } else if (sortBy === 'createdAt') {
        results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }

      const total = results.length;
      const paginatedResults = results.slice(offset, offset + limit);

      return {
        success: true,
        query: searchQuery,
        results: paginatedResults,
        total,
        limit,
        offset,
        filters: {
          status: statusFilter || [],
          priority: priorityFilter || [],
          labelId: labelIdFilter || [],
          themeId: themeIdFilter,
          dateFrom: dateFrom?.toISOString(),
          dateTo: dateTo?.toISOString(),
          sortBy,
        },
      };
    } catch (error) {
      log.error({ err: error }, 'Search error');
      set.status = 500;
      return { success: false, error: 'Search failed' };
    }
  });
