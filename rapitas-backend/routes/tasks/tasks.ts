/**
 * Tasks API Routes
 * Core task CRUD operations
 * Business logic is delegated to task-service.ts
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { AppError, ValidationError } from '../../middleware/error-handler';
import { createLogger } from '../../config/logger';
import {
  createTask,
  updateTask,
  getFrequencyBasedSuggestions,
  generateAISuggestions,
  cleanupDuplicateSubtasks,
  cleanupAllDuplicateSubtasks,
} from '../../services/task/task-service';
import { parseNaturalLanguageTask } from '../../services/ai/natural-language-parser';
import { getKnowledgeBasedSuggestions } from '../../services/task/task-knowledge-suggestions';
import { getUnifiedSuggestions } from '../../services/task/task-unified-suggestions';
import {
  analyzeTask,
  generateExecutionInstructions,
} from '../../services/claude-agent/task-analyzer';
import { analyzeTaskComplexity } from '../../services/workflow/complexity-analyzer';
import { getDefaultProvider } from '../../utils/ai-client';
import { generateTaskTitle } from '../../services/claude-agent/naming-service';
import { QueryOptimizers } from '../../utils/database/prisma-optimization';

const logger = createLogger('tasks');

export const tasksRoutes = new Elysia({ prefix: '/tasks' })
  // Test endpoint
  .get('/test', async () => {
    return { message: 'test endpoint working' };
  })

  // Get task statistics
  .get('/statistics', async () => {
    try {
      const stats = await QueryOptimizers.getTaskStatistics(prisma, { parentId: null });

      // Get category statistics via Theme relation (Task has no direct categoryId)
      const tasksWithTheme = await prisma.task.findMany({
        where: { parentId: null },
        select: { theme: { select: { categoryId: true } } },
      });

      const byCategory: Record<number, number> = {};
      for (const t of tasksWithTheme) {
        const catId = t.theme?.categoryId ?? 0;
        byCategory[catId] = (byCategory[catId] || 0) + 1;
      }

      return {
        total: stats.total,
        byStatus: stats.byStatus,
        byCategory,
      };
    } catch (error) {
      logger.error({ err: error }, 'Statistics endpoint error');
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  })

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

      const whereCondition: any = {
        parentId: null,
        AND: [],
      };

      // Multi-word search (title + optional description)
      const searchConditions = words.map((word) => {
        const conditions: any[] = [{ title: { contains: word, mode: 'insensitive' } }];

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
      const suggestions = await getKnowledgeBasedSuggestions(prisma, parseInt(themeId), resultLimit);
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
  )

  // Get task statistics
  .get('/statistics', async () => {
    try {
      const stats = await QueryOptimizers.getTaskStatistics(prisma, {});
      return stats;
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch task statistics');
      throw new AppError(500, 'Failed to fetch task statistics');
    }
  })

  // Get all tasks (supports incremental fetch via `since` param)
  .get('/', async (context) => {
    const { query } = context;
    const { projectId, milestoneId, priority, since } = query as {
      projectId?: string;
      milestoneId?: string;
      priority?: string;
      since?: string;
    };

    const baseWhere = {
      parentId: null,
      ...(projectId && { projectId: parseInt(projectId) }),
      ...(milestoneId && { milestoneId: parseInt(milestoneId) }),
      ...(priority && { priority }),
    };

    // If `since` is provided, return only tasks updated after that timestamp + total count
    if (since) {
      const sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        throw new ValidationError('Invalid `since` parameter');
      }

      const [updated, totalCount, allIds] = await Promise.all([
        prisma.task.findMany({
          where: {
            ...baseWhere,
            updatedAt: { gt: sinceDate },
          },
          include: {
            subtasks: {
              orderBy: { createdAt: 'asc' },
            },
            theme: true,
            project: true,
            milestone: true,
            examGoal: true,
            taskLabels: {
              include: {
                label: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.task.count({ where: baseWhere }),
        // Get all current task IDs (for deletion detection)
        prisma.task.findMany({
          where: baseWhere,
          select: { id: true },
        }),
      ]);

      return {
        tasks: updated,
        totalCount,
        activeIds: allIds.map((t) => t.id), // List of currently active task IDs
        since: sinceDate.toISOString(),
        incremental: true,
      };
    }

    // Full fetch (no `since`) — with pagination
    const page = query.page ? parseInt(query.page as string) : undefined;
    const pageSize = query.limit ? Math.min(parseInt(query.limit as string), 500) : undefined;

    const tasks = await prisma.task.findMany({
      where: baseWhere,
      include: {
        subtasks: {
          orderBy: { createdAt: 'asc' },
        },
        theme: true,
        project: true,
        milestone: true,
        examGoal: true,
        taskLabels: {
          include: {
            label: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      ...(pageSize && { take: pageSize }),
      ...(page && pageSize && { skip: (page - 1) * pageSize }),
    });

    if (page && pageSize) {
      const totalCount = await prisma.task.count({ where: baseWhere });
      return {
        tasks,
        totalCount,
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
      };
    }

    return tasks;
  })

  // Get task by ID
  .get('/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError('無効なIDです');
    }

    return await prisma.task.findUnique({
      where: { id },
      include: {
        subtasks: {
          orderBy: { createdAt: 'asc' },
        },
        theme: true,
        project: true,
        milestone: true,
        examGoal: true,
        taskLabels: {
          include: {
            label: true,
          },
        },
      },
    });
  })

  // Create task
  .post(
    '/',
    async (context) => {
      const { body } = context;
      try {
        return await createTask(prisma, body as Parameters<typeof createTask>[1]);
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof Error && error.message.includes('見つかりません')) {
          throw new AppError(400, error.message);
        }
        logger.error({ err: error }, '[tasks] Failed to create task');
        throw new AppError(500, 'タスクの作成に失敗しました');
      }
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        status: t.Optional(t.String()),
        priority: t.Optional(t.String()),
        labels: t.Optional(t.Array(t.String())),
        labelIds: t.Optional(t.Array(t.Number())),
        estimatedHours: t.Optional(t.Number()),
        dueDate: t.Optional(t.String()),
        subject: t.Optional(t.String()),
        parentId: t.Optional(t.Number()),
        projectId: t.Optional(t.Number()),
        milestoneId: t.Optional(t.Number()),
        themeId: t.Optional(t.Number()),
        examGoalId: t.Optional(t.Number()),
        isDeveloperMode: t.Optional(t.Boolean()),
        isAiTaskAnalysis: t.Optional(t.Boolean()),
      }),
    },
  )

  // Update task
  .patch('/:id', async (context) => {
    const { params, body } = context;
    const taskId = parseInt(params.id);
    if (isNaN(taskId)) {
      throw new ValidationError('無効なIDです');
    }
    return await updateTask(prisma, taskId, body as Parameters<typeof updateTask>[2]);
  })

  // Delete task
  .delete('/:id', async (context) => {
    const { params } = context;
    const id = parseInt(params.id);
    if (isNaN(id)) {
      throw new ValidationError('無効なIDです');
    }

    return await prisma.task.delete({
      where: { id },
    });
  })

  // Delete duplicate subtasks (under a specific task)
  .post('/:id/cleanup-duplicates', async (context) => {
    const { params } = context;
    const parentId = parseInt(params.id);
    if (isNaN(parentId)) {
      throw new ValidationError('無効なIDです');
    }

    const parentTask = await prisma.task.findUnique({ where: { id: parentId } });
    if (!parentTask) {
      throw new ValidationError('タスクが見つかりません');
    }

    const deletedIds = await cleanupDuplicateSubtasks(prisma, parentId);
    return {
      success: true,
      deletedCount: deletedIds.length,
      deletedIds,
      message:
        deletedIds.length > 0
          ? `${deletedIds.length}件の重複サブタスクを削除しました`
          : '重複サブタスクはありませんでした',
    };
  })

  // Bulk delete duplicate subtasks across all tasks
  .post('/cleanup-all-duplicates', async () => {
    const { deletedIds, affectedParents } = await cleanupAllDuplicateSubtasks(prisma);
    return {
      success: true,
      deletedCount: deletedIds.length,
      deletedIds,
      affectedParentCount: affectedParents.length,
      affectedParentIds: affectedParents,
      message:
        deletedIds.length > 0
          ? `${affectedParents.length}件のタスクから${deletedIds.length}件の重複サブタスクを削除しました`
          : '重複サブタスクはありませんでした',
    };
  })

  // Bulk delete all subtasks under a specific task
  .delete('/:id/subtasks', async (context) => {
    const { params } = context;
    const parentId = parseInt(params.id);
    if (isNaN(parentId)) {
      throw new ValidationError('無効なIDです');
    }

    const parentTask = await prisma.task.findUnique({
      where: { id: parentId },
    });

    if (!parentTask) {
      throw new ValidationError('タスクが見つかりません');
    }

    const subtasks = await prisma.task.findMany({
      where: { parentId },
      select: { id: true },
    });

    const deletedCount = subtasks.length;

    await prisma.task.deleteMany({
      where: { parentId },
    });

    logger.info(`[tasks] Deleted all ${deletedCount} subtasks for parent task ${parentId}`);

    return {
      success: true,
      deletedCount,
      message:
        deletedCount > 0
          ? `${deletedCount}件のサブタスクを削除しました`
          : '削除するサブタスクがありませんでした',
    };
  })

  // Delete selected subtasks by ID
  .post(
    '/:id/subtasks/delete-selected',
    async ({ params, body }) => {
      const parentId = parseInt(params.id);
      if (isNaN(parentId)) {
        throw new ValidationError('無効なIDです');
      }

      const { subtaskIds } = body as { subtaskIds: number[] };

      if (!subtaskIds || subtaskIds.length === 0) {
        throw new ValidationError('削除するサブタスクが指定されていません');
      }

      const parentTask = await prisma.task.findUnique({
        where: { id: parentId },
      });

      if (!parentTask) {
        throw new ValidationError('タスクが見つかりません');
      }

      // Verify subtasks belong to this parent
      const validSubtasks = await prisma.task.findMany({
        where: {
          id: { in: subtaskIds },
          parentId,
        },
        select: { id: true },
      });

      const validIds = validSubtasks.map((s: { id: number }) => s.id);
      const invalidIds = subtaskIds.filter((id) => !validIds.includes(id));

      if (invalidIds.length > 0) {
        logger.warn(
          `[tasks] Some subtask IDs are invalid or don't belong to parent ${parentId}: ${invalidIds.join(', ')}`,
        );
      }

      // Delete only valid subtasks
      const deleteResult = await prisma.task.deleteMany({
        where: {
          id: { in: validIds },
          parentId,
        },
      });

      logger.info(
        `[tasks] Deleted ${deleteResult.count} selected subtasks for parent task ${parentId}`,
      );

      return {
        success: true,
        deletedCount: deleteResult.count,
        deletedIds: validIds,
        invalidIds,
        message:
          deleteResult.count > 0
            ? `${deleteResult.count}件のサブタスクを削除しました`
            : '削除するサブタスクがありませんでした',
      };
    },
    {
      body: t.Object({
        subtaskIds: t.Array(t.Number()),
      }),
    },
  )

  // Quick create: NL parse → AI title → task → complexity → subtasks → instructions pipeline (NDJSON streaming)
  .post(
    '/quick-create',
    async ({ body }) => {
      const { text, themeId } = body;

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (data: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
          };

          try {
            // Step 1: Parse natural language
            send({ step: 'parsing', status: 'in_progress' });
            const parsed = parseNaturalLanguageTask(text);
            send({ step: 'parsing', status: 'done', data: parsed });

            // Step 2: AI title summarization
            send({ step: 'summarizing', status: 'in_progress' });
            let title = parsed.title;
            try {
              const provider = await getDefaultProvider();
              const result = await generateTaskTitle(text, provider);
              if (result.title) {
                title = result.title;
              }
            } catch (e) {
              logger.warn(
                { err: e },
                '[quick-create] AI title summarization failed, using parsed title',
              );
            }
            send({ step: 'summarizing', status: 'done', data: { title } });

            // Step 3: Create task
            send({ step: 'creating', status: 'in_progress' });
            const taskData: Parameters<typeof createTask>[1] = {
              title,
              ...(parsed.priority && { priority: parsed.priority }),
              ...(parsed.estimatedHours && { estimatedHours: parsed.estimatedHours }),
              ...(parsed.dueDate && { dueDate: parsed.dueDate }),
              ...(themeId && { themeId }),
              status: 'todo',
            };

            const task = await createTask(prisma, taskData);
            if (!task) {
              throw new AppError(500, 'Failed to create task');
            }
            send({ step: 'creating', status: 'done', data: { id: task.id, title: task.title } });

            // Step 4: Analyze complexity
            send({ step: 'analyzing', status: 'in_progress' });
            const complexity = analyzeTaskComplexity({
              title: task.title,
              description: task.description || undefined,
              estimatedHours: task.estimatedHours || undefined,
              priority: task.priority,
              labels: [],
            });

            const provider = await getDefaultProvider();
            const analysisConfig = {
              priority: 'balanced' as const,
              maxSubtasks: 10,
              provider,
            };

            const analysis = await analyzeTask(
              {
                id: task.id,
                title: task.title,
                description: task.description,
                priority: task.priority,
                dueDate: task.dueDate,
                estimatedHours: task.estimatedHours,
              },
              analysisConfig,
            );
            send({
              step: 'analyzing',
              status: 'done',
              data: {
                score: complexity.complexityScore,
                subtaskCount: analysis.result.suggestedSubtasks.length,
              },
            });

            // Step 5: Create subtasks
            send({ step: 'generating_subtasks', status: 'in_progress' });
            const createdSubtasks = [];
            for (const subtask of analysis.result.suggestedSubtasks) {
              const sub = await createTask(prisma, {
                title: subtask.title,
                description: subtask.description,
                priority: subtask.priority || task.priority,
                estimatedHours: subtask.estimatedHours,
                parentId: task.id,
                ...(themeId && { themeId }),
              });
              createdSubtasks.push(sub);
            }
            send({
              step: 'generating_subtasks',
              status: 'done',
              data: { count: createdSubtasks.length },
            });

            // Step 6: Generate execution instructions
            send({ step: 'generating_instructions', status: 'in_progress' });
            const instructions = await generateExecutionInstructions(
              { title: task.title, description: task.description },
              analysis.result.suggestedSubtasks,
              provider,
            );

            await prisma.task.update({
              where: { id: task.id },
              data: {
                description: `${task.description || ''}\n\n---\n## 実行手順\n${instructions.instructions}`,
              },
            });
            send({ step: 'generating_instructions', status: 'done' });

            // Complete
            send({ step: 'complete', status: 'done', taskId: task.id });
          } catch (error) {
            logger.error({ err: error }, '[tasks/quick-create] Pipeline failed');
            send({
              step: 'error',
              status: 'error',
              message: error instanceof Error ? error.message : 'Quick create pipeline failed',
            });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Transfer-Encoding': 'chunked',
          'Cache-Control': 'no-cache',
        },
      });
    },
    {
      body: t.Object({
        text: t.String({ minLength: 1 }),
        themeId: t.Optional(t.Number()),
        autoExecute: t.Optional(t.Boolean()),
        agentConfigId: t.Optional(t.Number()),
      }),
    },
  );
