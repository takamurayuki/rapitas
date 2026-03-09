/**
 * Tasks API Routes
 * Core task CRUD operations
 * ビジネスロジックは task-service.ts に委譲
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
} from '../../services/task-service';
import { parseNaturalLanguageTask } from '../../services/natural-language-parser';
import { analyzeTask, generateExecutionInstructions } from '../../services/claude-agent/task-analyzer';
import { analyzeTaskComplexity } from '../../services/workflow/complexity-analyzer';
import { getDefaultProvider } from '../../utils/ai-client';
import { generateTaskTitle } from '../../services/claude-agent/naming-service';

const logger = createLogger('tasks');

export const tasksRoutes = new Elysia({ prefix: '/tasks' })
  // Search task titles for autocomplete
  .get(
    '/search',
    async (context) => {
      const { query } = context;
      const { q, limit, themeId, projectId } = query;
      const searchQuery = q?.trim() ?? '';
      const resultLimit = Math.min(parseInt(limit ?? '10'), 20);

      if (!searchQuery) {
        return [];
      }

      return await prisma.task.findMany({
        where: {
          parentId: null,
          title: {
            contains: searchQuery,
          },
          ...(themeId && { themeId: parseInt(themeId) }),
          ...(projectId && { projectId: parseInt(projectId) }),
        },
        select: {
          id: true,
          title: true,
          priority: true,
          status: true,
          theme: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: resultLimit,
      });
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        themeId: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
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
        // 現在存在する全タスクのIDを取得（削除検出用）
        prisma.task.findMany({
          where: baseWhere,
          select: { id: true },
        }),
      ]);

      return {
        tasks: updated,
        totalCount,
        activeIds: allIds.map((t) => t.id), // 現在アクティブなタスクIDのリスト
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

  // 重複サブタスクを削除（特定のタスク配下）
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

  // 全タスクの重複サブタスクを一括削除
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

  // サブタスクの一括削除（特定のタスク配下のすべてのサブタスクを削除）
  .delete('/:id/subtasks', async (context) => {
    const { params } = context;
    const parentId = parseInt(params.id);
    if (isNaN(parentId)) {
      throw new ValidationError('無効なIDです');
    }

    // 親タスクの存在確認
    const parentTask = await prisma.task.findUnique({
      where: { id: parentId },
    });

    if (!parentTask) {
      throw new ValidationError('タスクが見つかりません');
    }

    // サブタスクを取得して削除数を確認
    const subtasks = await prisma.task.findMany({
      where: { parentId },
      select: { id: true },
    });

    const deletedCount = subtasks.length;

    // 一括削除
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

  // サブタスクの選択削除（指定されたIDのサブタスクを一括削除）
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

      // 親タスクの存在確認
      const parentTask = await prisma.task.findUnique({
        where: { id: parentId },
      });

      if (!parentTask) {
        throw new ValidationError('タスクが見つかりません');
      }

      // 指定されたサブタスクが実際にこの親タスクに属しているか確認
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

      // 有効なサブタスクのみ削除
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
              logger.warn({ err: e }, '[quick-create] AI title summarization failed, using parsed title');
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
            send({ step: 'analyzing', status: 'done', data: { score: complexity.complexityScore, subtaskCount: analysis.result.suggestedSubtasks.length } });

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
            send({ step: 'generating_subtasks', status: 'done', data: { count: createdSubtasks.length } });

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
            send({ step: 'error', status: 'error', message: error instanceof Error ? error.message : 'Quick create pipeline failed' });
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
