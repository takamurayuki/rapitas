/**
 * Search Suggest Route
 *
 * GET /suggest — returns autocomplete suggestions for tasks and comments
 * matching a partial search query. Capped at 8 results for low-latency UI use.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { getMatchContext } from './helpers';

const log = createLogger('routes:search:suggest');

/**
 * Autocomplete suggestion route.
 */
export const searchSuggestRoute = new Elysia()

  .get('/suggest', async ({ query: q, set }) => {
    try {
      const searchQuery = q.q?.trim();
      if (!searchQuery || searchQuery.length < 1) {
        return { success: true, suggestions: [] };
      }

      const words = searchQuery.split(/\s+/).filter((w) => w.length > 0);

      const taskWhere = {
        AND: words.map((word) => ({
          OR: [
            { title: { contains: word, mode: 'insensitive' as const } },
            { description: { contains: word, mode: 'insensitive' as const } },
          ],
        })),
      };

      const tasks = await prisma.task.findMany({
        where: taskWhere,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          updatedAt: true,
        },
        take: 6,
        orderBy: { updatedAt: 'desc' },
      });

      const commentWhere = {
        AND: words.map((word) => ({
          content: { contains: word, mode: 'insensitive' as const },
        })),
      };

      const comments = await prisma.comment.findMany({
        where: commentWhere,
        select: {
          id: true,
          content: true,
          updatedAt: true,
          task: { select: { id: true, title: true } },
        },
        take: 2,
        orderBy: { updatedAt: 'desc' },
      });

      const suggestions = [
        ...tasks.map((t) => ({
          id: t.id,
          title: t.title,
          type: 'task' as const,
          status: t.status,
          matchContext: getMatchContext(t.title, t.description, searchQuery),
        })),
        ...comments.map((c) => ({
          id: c.id,
          title: c.task ? `Comment on: ${c.task.title}` : `Comment #${c.id}`,
          type: 'comment' as const,
          matchContext: getMatchContext(c.content, null, searchQuery),
          metadata: {
            taskId: c.task?.id,
            taskTitle: c.task?.title,
          },
        })),
      ];

      return {
        success: true,
        suggestions: suggestions.slice(0, 8),
      };
    } catch (error) {
      log.error({ err: error }, 'Search suggest error');
      set.status = 500;
      return { success: false, error: 'Failed to get suggestions' };
    }
  });
