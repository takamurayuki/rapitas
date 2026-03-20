/**
 * Task Mutations
 *
 * Public API for task creation and updates, including label management,
 * user behavior recording, and study streak tracking.
 * Private create helpers live in task-create-helpers.ts.
 * Does NOT handle suggestions, cleanup utilities, or query-only operations.
 */
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../config/logger';
import { UserBehaviorService } from '../src/services/userBehaviorService';
import { notifyTaskCompleted } from '../communication/notification-service';
import { onGeneratedTaskCompleted } from './recurring-task-service';
import { createSubtask, createParentTask } from './task-create-helpers';

type PrismaInstance = InstanceType<typeof PrismaClient>;

const logger = createLogger('task-mutations');

/**
 * Common Prisma include for task queries that return the full task shape.
 *
 * NOTE: Exported so sub-modules (task-create-helpers, etc.) can share this without duplication.
 */
export const TASK_FULL_INCLUDE = {
  subtasks: { orderBy: { createdAt: 'asc' as const } },
  theme: true,
  project: true,
  milestone: true,
  examGoal: true,
  taskLabels: { include: { label: true } },
} as const;

/** Input shape for task creation. */
export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  labels?: string;
  labelIds?: number[];
  estimatedHours?: number;
  dueDate?: string;
  subject?: string;
  parentId?: number;
  projectId?: number;
  milestoneId?: number;
  themeId?: number;
  examGoalId?: number;
  isDeveloperMode?: boolean;
  isAiTaskAnalysis?: boolean;
}

/**
 * Creates a task (parent or subtask) based on whether parentId is provided.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param input - Task creation input / タスク作成入力
 * @returns Created task with full includes / フルインクルード付きの作成タスク
 */
export async function createTask(prisma: PrismaInstance, input: CreateTaskInput) {
  const { parentId, title, labelIds, ...rest } = input;

  if (parentId) {
    return createSubtask(prisma, parentId, title, labelIds, rest);
  }

  return createParentTask(prisma, title, labelIds, rest);
}

/** Input shape for task updates. */
export interface UpdateTaskInput {
  title?: string;
  description?: string;
  themeId?: number;
  status?: string;
  priority?: string;
  labels?: string;
  labelIds?: number[];
  estimatedHours?: number;
  dueDate?: string;
  subject?: string;
  projectId?: number;
  milestoneId?: number;
  examGoalId?: number;
  autoApprovePlan?: boolean;
}

/**
 * Updates a task's fields, labels, streaks, and user behavior records.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param taskId - Task ID to update / 更新するタスクID
 * @param input - Fields to update / 更新フィールド
 * @returns Updated task with full includes / フルインクルード付きの更新タスク
 * @throws {Error} When the task is not found / タスクが見つからない場合
 */
export async function updateTask(prisma: PrismaInstance, taskId: number, input: UpdateTaskInput) {
  const { labelIds, ...fields } = input;

  const currentTask = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true, parentId: true },
  });

  if (!currentTask) {
    throw new Error(`タスク(ID: ${taskId})が見つかりません`);
  }

  // Record streak
  if (fields.status === 'done') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await prisma.studyStreak.upsert({
      where: { date: today },
      update: { tasksCompleted: { increment: 1 } },
      create: { date: today, studyMinutes: 0, tasksCompleted: 1 },
    });
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(fields.title && { title: fields.title }),
      ...(fields.description !== undefined && { description: fields.description }),
      ...(fields.themeId !== undefined && { themeId: fields.themeId }),
      ...(fields.status && { status: fields.status }),
      ...(fields.status === 'done' && { completedAt: new Date() }),
      ...(fields.status === 'in-progress' &&
        currentTask?.status !== 'in-progress' && { startedAt: new Date() }),
      ...(fields.priority && { priority: fields.priority }),
      ...(fields.labels && { labels: fields.labels }),
      ...(fields.estimatedHours !== undefined && { estimatedHours: fields.estimatedHours }),
      ...(fields.dueDate !== undefined && {
        dueDate: fields.dueDate ? new Date(fields.dueDate) : null,
      }),
      ...(fields.subject !== undefined && { subject: fields.subject }),
      ...(fields.projectId !== undefined && { projectId: fields.projectId }),
      ...(fields.milestoneId !== undefined && { milestoneId: fields.milestoneId }),
      ...(fields.examGoalId !== undefined && { examGoalId: fields.examGoalId }),
      ...(fields.autoApprovePlan !== undefined && { autoApprovePlan: fields.autoApprovePlan }),
    },
  });

  // Update labels
  if (labelIds !== undefined) {
    await prisma.taskLabel.deleteMany({ where: { taskId } });
    if (labelIds.length > 0) {
      await prisma.taskLabel.createMany({
        data: labelIds.map((labelId) => ({ taskId, labelId })),
      });
    }
  }

  const updatedTask = await prisma.task.findUnique({
    where: { id: taskId },
    include: TASK_FULL_INCLUDE,
  });

  // Record user behavior (parent tasks only)
  if (!currentTask?.parentId && updatedTask) {
    if (fields.status && currentTask?.status !== fields.status) {
      if (fields.status === 'in-progress' && currentTask?.status !== 'in-progress') {
        await UserBehaviorService.recordTaskStarted(taskId, updatedTask);
      } else if (fields.status === 'done' && currentTask?.status !== 'done') {
        await UserBehaviorService.recordTaskCompleted(taskId, updatedTask);
        notifyTaskCompleted(taskId, updatedTask.title).catch((err) => {
          logger.warn({ err, taskId }, 'Failed to send task completion notification');
        });
        // Trigger next recurring task generation if this was a generated task
        onGeneratedTaskCompleted(prisma, updatedTask).catch((err) => {
          logger.warn({ err, taskId }, 'Failed to generate next recurring task');
        });
      }
    }

  // Subtask completion: check if all siblings are done → generate parent verify.md
  if (fields.status === 'done' && currentTask?.parentId && updatedTask) {
    import('./workflow/subtask-completion-handler').then(({ onSubtaskCompleted }) => {
      onSubtaskCompleted(taskId).catch((err) => {
        logger.warn({ err, taskId }, 'Failed to handle subtask completion');
      });
    }).catch(() => {});
  }

    if (
      fields.title ||
      fields.description !== undefined ||
      fields.priority ||
      fields.themeId !== undefined
    ) {
      await UserBehaviorService.recordBehavior('task_updated', {
        taskId,
        themeId: updatedTask.themeId ?? undefined,
        metadata: {
          changes: {
            title: fields.title !== undefined,
            description: fields.description !== undefined,
            priority: fields.priority !== undefined,
            themeId: fields.themeId !== undefined,
          },
        },
      });
    }
  }

  return updatedTask;
}
