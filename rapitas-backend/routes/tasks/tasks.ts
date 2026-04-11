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
  cleanupDuplicateSubtasks,
  cleanupAllDuplicateSubtasks,
} from '../../services/task/task-service';
import { removeWorktree } from '../../services/agents/orchestrator/git-operations/worktree-ops';
import { getProjectRoot } from '../../config';

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

    // Clean up any worktrees associated with this task before deletion
    try {
      const task = await prisma.task.findUnique({
        where: { id },
        select: { workingDirectory: true },
      });

      if (task) {
        // Find any agent sessions with worktrees for this task
        const sessionsWithWorktrees = await prisma.agentSession.findMany({
          where: {
            worktreePath: { not: null },
            config: {
              taskId: id,
            },
          },
          select: {
            id: true,
            worktreePath: true,
          },
        });

        const baseDir = task.workingDirectory || getProjectRoot();

        for (const session of sessionsWithWorktrees) {
          if (session.worktreePath) {
            try {
              await removeWorktree(baseDir, session.worktreePath);
              await prisma.agentSession.update({
                where: { id: session.id },
                data: { worktreePath: null },
              });
              logger.info(`[tasks] Cleaned up worktree for task ${id}: ${session.worktreePath}`);
            } catch (worktreeError) {
              logger.warn(
                { err: worktreeError },
                `[tasks] Failed to clean up worktree for task ${id}: ${session.worktreePath}`,
              );
            }
          }
        }
      }
    } catch (cleanupError) {
      logger.warn(
        { err: cleanupError },
        `[tasks] Failed to clean up worktrees for task ${id}, proceeding with deletion`,
      );
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
  );
