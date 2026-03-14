/**
 * Search API Routes
 * Cross-entity full-text search endpoint
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:search');

type SearchResultItem = {
  id: number;
  type: 'task' | 'comment' | 'note' | 'resource';
  title: string;
  excerpt: string;
  relevance: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt?: Date;
};

/**
 * Generate an excerpt by extracting text around the match location.
 */
function createExcerpt(text: string, query: string, maxLength = 200): string {
  if (!text) return '';
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) {
    return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
  }

  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + query.length + 150);
  let excerpt = text.slice(start, end);

  if (start > 0) excerpt = '...' + excerpt;
  if (end < text.length) excerpt = excerpt + '...';

  return excerpt;
}

/**
 * Get match context (indicates where the match was found).
 */
function getMatchContext(text: string, description: string | null, query: string): string {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (lowerText.includes(lowerQuery)) {
    return 'title';
  }

  if (description && description.toLowerCase().includes(lowerQuery)) {
    return 'description';
  }

  // Per-word match check
  const words = lowerQuery.split(/\s+/).filter((w) => w.length > 0);
  for (const word of words) {
    if (lowerText.includes(word)) {
      return 'title';
    }
    if (description && description.toLowerCase().includes(word)) {
      return 'description';
    }
  }

  return 'title'; // fallback
}

/**
 * Calculate improved relevance score.
 */
function calculateRelevance(
  text: string,
  description: string | null,
  query: string,
  options: {
    isTitle?: boolean;
    isDescription?: boolean;
    updatedAt?: Date;
    status?: string;
  } = {},
): number {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/).filter((w) => w.length > 0);

  let score = 0;

  // Exact match: highest score
  if (lowerText === lowerQuery) {
    score = options.isTitle ? 100 : 20;
  }
  // Prefix match
  else if (lowerText.startsWith(lowerQuery)) {
    score = options.isTitle ? 50 : 15;
  }
  // Full query containment
  else if (lowerText.includes(lowerQuery)) {
    score = options.isTitle ? 30 : 10;
  }
  // Individual word matching
  else {
    let wordMatches = 0;
    for (const word of words) {
      if (word && lowerText.includes(word)) {
        wordMatches++;
      }
    }
    if (wordMatches > 0) {
      score = options.isTitle
        ? (wordMatches / words.length) * 25
        : (wordMatches / words.length) * 8;
    }
  }

  // Additional score for description (when not title)
  if (!options.isTitle && description) {
    const lowerDesc = description.toLowerCase();
    if (lowerDesc.includes(lowerQuery)) {
      score += 20;
    } else {
      let descWordMatches = 0;
      for (const word of words) {
        if (word && lowerDesc.includes(word)) {
          descWordMatches++;
        }
      }
      score += (descWordMatches / words.length) * 5;
    }
  }

  // Recent update bonus (within 7 days)
  if (options.updatedAt) {
    const daysDiff = (Date.now() - options.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff <= 7) {
      score += 5;
    }
  }

  // Active status bonus
  if (options.status && (options.status === 'todo' || options.status === 'in_progress')) {
    score += 3;
  }

  return Math.min(score, 100);
}

export const searchRoutes = new Elysia({ prefix: '/search' })
  // Cross-entity search
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
      const sortBy = q.sortBy || 'relevance'; // relevance, updatedAt, createdAt

      
      const statusFilter = q.status?.split(',');
      const priorityFilter = q.priority?.split(',');
      const labelIdFilter = q.labelId
        ?.split(',')
        .map((id) => parseInt(id))
        .filter((id) => !isNaN(id));
      const themeIdFilter = q.themeId ? parseInt(q.themeId) : undefined;
      const dateFrom = q.dateFrom ? new Date(q.dateFrom) : undefined;
      const dateTo = q.dateTo ? new Date(q.dateTo) : undefined;

      // Split query for multi-word search
      const words = searchQuery.split(/\s+/).filter((w) => w.length > 0);

      const results: SearchResultItem[] = [];

      // Task search: title + description (DB-level filtering)
      if (types.includes('task')) {
        
        const taskWhere: any = {
          AND: [
            
            ...words.map((word) => ({
              OR: [
                { title: { contains: word, mode: 'insensitive' } },
                { description: { contains: word, mode: 'insensitive' } },
              ],
            })),
          ],
        };

        
        if (statusFilter) {
          taskWhere.AND.push({ status: { in: statusFilter } });
        }
        if (priorityFilter) {
          taskWhere.AND.push({ priority: { in: priorityFilter } });
        }
        if (themeIdFilter) {
          taskWhere.AND.push({ themeId: themeIdFilter });
        }
        if (dateFrom || dateTo) {
          const dateCondition: any = {};
          if (dateFrom) dateCondition.gte = dateFrom;
          if (dateTo) dateCondition.lte = dateTo;
          taskWhere.AND.push({ updatedAt: dateCondition });
        }
        if (labelIdFilter && labelIdFilter.length > 0) {
          taskWhere.AND.push({
            taskLabels: {
              some: {
                labelId: { in: labelIdFilter },
              },
            },
          });
        }

        // Sort conditions
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
          skip: sortBy === 'relevance' ? 0 : offset, // JS post-processing for relevance
          take: sortBy === 'relevance' ? undefined : limit, // no limit for relevance
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

      // Note search (PomodoroSession.note and TimeEntry.note)
      if (types.includes('note')) {
        // PomodoroSession.note search
        const pomodoroWhere = {
          AND: [
            { note: { not: null } },
            ...words.map((word) => ({
              note: { contains: word, mode: 'insensitive' },
            })),
          ],
        };

        const pomodoroSessions = await prisma.pomodoroSession.findMany({
          where: pomodoroWhere,
          include: {
            task: { select: { id: true, title: true } },
          },
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

        // TimeEntry.note search
        const timeEntryWhere = {
          AND: [
            { note: { not: null } },
            ...words.map((word) => ({
              note: { contains: word, mode: 'insensitive' },
            })),
          ],
        };

        const timeEntries = await prisma.timeEntry.findMany({
          where: timeEntryWhere,
          include: {
            task: { select: { id: true, title: true } },
          },
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

      // Comment search (multi-word)
      if (types.includes('comment')) {
        const commentWhere = {
          AND: words.map((word) => ({
            content: { contains: word, mode: 'insensitive' },
          })),
        };

        const comments = await prisma.comment.findMany({
          where: commentWhere,
          include: {
            task: { select: { id: true, title: true } },
          },
          take: 50,
          orderBy: { updatedAt: 'desc' },
        });

        for (const comment of comments) {
          results.push({
            id: comment.id,
            type: 'comment',
            title: comment.task ? `Comment on: ${comment.task.title}` : `Comment #${comment.id}`,
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

      // Resource search (multi-word)
      if (types.includes('resource')) {
        const resourceWhere = {
          AND: words.map((word) => ({
            OR: [
              { title: { contains: word, mode: 'insensitive' } },
              { description: { contains: word, mode: 'insensitive' } },
            ],
          })),
        };

        const resources = await prisma.resource.findMany({
          where: resourceWhere,
          include: {
            task: { select: { id: true, title: true } },
          },
          take: 50,
          orderBy: { updatedAt: 'desc' },
        });

        for (const resource of resources) {
          const titleRelevance = calculateRelevance(
            resource.title,
            resource.description,
            searchQuery,
            {
              isTitle: true,
              updatedAt: resource.updatedAt,
            },
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
  })

  // Search suggestions (multi-word + description matching)
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
            { title: { contains: word, mode: 'insensitive' } },
            { description: { contains: word, mode: 'insensitive' } },
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
          content: { contains: word, mode: 'insensitive' },
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
