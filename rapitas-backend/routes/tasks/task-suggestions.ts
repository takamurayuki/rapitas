/**
 * Task Suggestion Routes
 *
 * Search, autocomplete, frequency/AI/knowledge/unified suggestions,
 * and suggestion approval/rejection. Extracted from tasks.ts to stay
 * under the 500-line per-file limit.
 */
import { Elysia, t } from 'elysia';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error-handler';
import { createLogger } from '../../config/logger';
import {
  getFrequencyBasedSuggestions,
  generateAISuggestions,
} from '../../services/task/task-service';
import { getKnowledgeBasedSuggestions } from '../../services/task/task-knowledge-suggestions';
import { getUnifiedSuggestions } from '../../services/task/task-unified-suggestions';

const logger = createLogger('task-suggestions');

export const taskSuggestionRoutes = new Elysia({ prefix: '/tasks' })
  // Search task titles for autocomplete (enhanced with multi-word and description search)
  .get(
    '/search',
    async (context) => {
      const { query } = context;
      const { q, limit, themeId, projectId, status, searchDescription } = query;
      const searchQuery = q?.trim() ?? '';
      const resultLimit = Math.min(parseInt(limit ?? '10'), 20);

      if (!searchQuery) {
        return [];
      }

      // Split query for multi-word search
      const words = searchQuery.split(/\s+/).filter((w) => w.length > 0);

      // NOTE: AND を後段で push するため、TaskWhereInput のユニオン (TaskWhereInput | TaskWhereInput[])
      // ではなく明示的に配列型に narrow した interface を使う。
      const andConditions: Prisma.TaskWhereInput[] = [];
      const whereCondition: Prisma.TaskWhereInput & { AND: Prisma.TaskWhereInput[] } = {
        parentId: null,
        AND: andConditions,
      };

      // Multi-word search (title + optional description)
      const searchConditions = words.map((word) => {
        const conditions: Prisma.TaskWhereInput[] = [
          { title: { contains: word, mode: 'insensitive' } },
        ];

        // Include description in search when searchDescription is true
        if (searchDescription === 'true') {
          conditions.push({ description: { contains: word, mode: 'insensitive' } });
        }

        return { OR: conditions };
      });

      whereCondition.AND.push(...searchConditions);

      if (themeId) {
        whereCondition.themeId = parseInt(themeId);
      }
      if (projectId) {
        whereCondition.projectId = parseInt(projectId);
      }
      if (status) {
        const statusList = status.split(',');
        whereCondition.status = { in: statusList };
      }

      const tasks = await prisma.task.findMany({
        where: whereCondition,
        select: {
          id: true,
          title: true,
          description: true,
          priority: true,
          status: true,
          updatedAt: true,
          theme: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: resultLimit,
      });

      // Sort by relevance score for multi-word queries
      if (words.length > 1) {
        const scored = tasks.map((task) => {
          let score = 0;
          const lowerTitle = task.title.toLowerCase();
          const lowerDesc = task.description?.toLowerCase() || '';
          const lowerQuery = searchQuery.toLowerCase();

          if (lowerTitle.includes(lowerQuery)) score += 50;
          if (searchDescription === 'true' && lowerDesc.includes(lowerQuery)) score += 30;

          for (const word of words) {
            if (lowerTitle.includes(word.toLowerCase())) score += 10;
            if (searchDescription === 'true' && lowerDesc.includes(word.toLowerCase())) score += 5;
          }

          return { ...task, relevanceScore: score };
        });

        scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
        return scored.map(({ relevanceScore, ...task }) => task);
      }

      return tasks;
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        themeId: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        status: t.Optional(t.String()),
        searchDescription: t.Optional(t.String()),
      }),
    },
  )

  // Unified suggestions: aggregates frequency + knowledge sources with deduplication
  .get(
    '/suggestions/unified',
    async (context) => {
      const { query } = context;
      const { themeId, limit } = query;

      if (!themeId) return { suggestions: [] };

      const resultLimit = limit ? parseInt(limit) : 8;
      const suggestions = await getUnifiedSuggestions(prisma, parseInt(themeId), resultLimit);
      return { suggestions };
    },
    {
      query: t.Object({
        themeId: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  )

  // Get task suggestions based on past tasks for a theme (frequency-based fallback)
  .get(
    '/suggestions',
    async (context) => {
      const { query } = context;
      const { themeId, limit } = query;
      const resultLimit = Math.min(parseInt(limit ?? '10'), 20);

      if (!themeId) {
        return { suggestions: [] };
      }

      const suggestions = await getFrequencyBasedSuggestions(
        prisma,
        parseInt(themeId),
        resultLimit,
      );
      return { suggestions };
    },
    {
      query: t.Object({
        themeId: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  )

  // Knowledge-based task suggestions: analyze accumulated knowledge to recommend next tasks
  .get(
    '/suggestions/knowledge',
    async (context) => {
      const { query } = context;
      const { themeId, limit } = query;

      if (!themeId) {
        return { suggestions: [] };
      }

      const resultLimit = limit ? parseInt(limit) : 5;
      const suggestions = await getKnowledgeBasedSuggestions(
        prisma,
        parseInt(themeId),
        resultLimit,
      );
      return { suggestions };
    },
    {
      query: t.Object({
        themeId: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  )

  // AI-powered task suggestions: analyze past tasks and suggest new ones
  .get(
    '/suggestions/ai',
    async (context) => {
      const { query } = context;
      const { themeId, limit } = query;
      const resultLimit = Math.min(parseInt(limit ?? '5'), 10);

      if (!themeId) {
        return { suggestions: [], source: 'none' };
      }

      return await generateAISuggestions(prisma, parseInt(themeId), resultLimit);
    },
    {
      query: t.Object({
        themeId: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  )

  // Get cached AI suggestions for a theme
  .get(
    '/suggestions/ai/cache',
    async (context) => {
      const { query } = context;
      const { themeId } = query;

      if (!themeId) {
        return { suggestions: [], analysis: null, source: 'none' };
      }

      const parsedThemeId = parseInt(themeId);

      if (!prisma.taskSuggestionCache) {
        logger.warn(
          '[tasks/suggestions/ai/cache] taskSuggestionCache model not available - run prisma generate',
        );
        return { suggestions: [], analysis: null, source: 'none' };
      }

      const cached = await prisma.taskSuggestionCache.findMany({
        where: { themeId: parsedThemeId },
        orderBy: { id: 'asc' },
      });

      if (cached.length === 0) {
        return { suggestions: [], analysis: null, source: 'none' };
      }

      const analysis =
        cached.find((c: { analysis: string | null }) => c.analysis)?.analysis || null;

      const suggestions = cached.map(
        (c: {
          title: string;
          description: string | null;
          priority: string;
          estimatedHours: number | null;
          reason: string | null;
          category: string;
          labelIds: string;
          completionCriteria?: string | null;
          measurableOutcome?: string | null;
          dependencies?: string | null;
          suggestedApproach?: string | null;
        }) => ({
          title: c.title,
          description: c.description,
          priority: c.priority,
          estimatedHours: c.estimatedHours,
          reason: c.reason,
          category: c.category,
          completionCriteria: c.completionCriteria || null,
          measurableOutcome: c.measurableOutcome || null,
          dependencies: c.dependencies || null,
          suggestedApproach: c.suggestedApproach || null,
          labelIds: JSON.parse(c.labelIds),
          frequency: 0,
        }),
      );

      return { suggestions, analysis, source: 'cache' };
    },
    {
      query: t.Object({
        themeId: t.Optional(t.String()),
      }),
    },
  )

  // Delete cached suggestions for a theme
  .delete(
    '/suggestions/ai/cache',
    async (context) => {
      const { query } = context;
      const { themeId } = query;

      if (!themeId) {
        return { success: false, message: 'themeId is required' };
      }

      const parsedThemeId = parseInt(themeId);

      if (!prisma.taskSuggestionCache) {
        logger.warn(
          '[tasks/suggestions/ai/cache] taskSuggestionCache model not available - run prisma generate',
        );
        return {
          success: false,
          message: 'taskSuggestionCache model not available',
        };
      }

      const result = await prisma.taskSuggestionCache.deleteMany({
        where: { themeId: parsedThemeId },
      });

      return {
        success: true,
        deletedCount: result.count,
      };
    },
    {
      query: t.Object({
        themeId: t.Optional(t.String()),
      }),
    },
  );
