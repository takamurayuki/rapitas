import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../config/logger';

const log = createLogger('user-behavior-service');
const prisma = new PrismaClient();

/**
 * Task type containing task-related data
 */
interface TaskWithRelations {
  title: string;
  description?: string | null;
  priority: string;
  estimatedHours?: number | null;
  actualHours?: number | null;
  themeId?: number | null;
  startedAt?: Date | string | null;
  createdAt?: Date | string | null;
  completedAt?: Date | string | null;
  taskLabels?: Array<{ labelId: number }>;
}

export interface BehaviorContext {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek: string;
  previousAction?: string;
  sessionDuration?: number;
  [key: string]: string | number | boolean | undefined;
}

export class UserBehaviorService {
  /**
   * Record user behavior
   */
  static async recordBehavior(
    actionType: string,
    options: {
      userId?: number;
      taskId?: number;
      themeId?: number;
      context?: BehaviorContext;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    const { userId = 1, taskId, themeId, context, metadata } = options;

    try {
      // Get current time information
      const now = new Date();
      const hour = now.getHours();
      let timeOfDay: BehaviorContext['timeOfDay'];

      if (hour >= 5 && hour < 12) timeOfDay = 'morning';
      else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
      else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
      else timeOfDay = 'night';

      const dayOfWeek = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
      ][now.getDay()];

      const fullContext: BehaviorContext = {
        timeOfDay,
        dayOfWeek,
        ...context,
      };

      await prisma.userBehavior.create({
        data: {
          userId,
          actionType,
          taskId,
          themeId,
          context: JSON.stringify(fullContext),
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      });
    } catch (error) {
      log.error({ err: error }, 'Failed to record user behavior');
      // Don't throw errors (prevent user behavior logging failures from blocking main process)
    }
  }

  /**
   * Record behavior when task is created
   */
  static async recordTaskCreated(taskId: number, task: TaskWithRelations) {
    await this.recordBehavior('task_created', {
      taskId,
      themeId: task.themeId ?? undefined,
      metadata: {
        priority: task.priority,
        estimatedHours: task.estimatedHours,
        hasDescription: !!task.description,
        labelIds: task.taskLabels?.map((tl) => tl.labelId) || [],
      },
    });
  }

  /**
   * Record behavior when task is started
   */
  static async recordTaskStarted(taskId: number, task: TaskWithRelations) {
    await this.recordBehavior('task_started', {
      taskId,
      themeId: task.themeId ?? undefined,
      metadata: {
        timeToStart:
          task.startedAt && task.createdAt
            ? (new Date(task.startedAt).getTime() - new Date(task.createdAt).getTime()) /
              1000 /
              60 /
              60 // time unit
            : null,
      },
    });
  }

  /**
   * Record behavior when task is completed and update pattern
   */
  static async recordTaskCompleted(taskId: number, task: TaskWithRelations) {
    await this.recordBehavior('task_completed', {
      taskId,
      themeId: task.themeId ?? undefined,
      metadata: {
        actualHours: task.actualHours,
        timeToComplete:
          task.completedAt && task.startedAt
            ? (new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) /
              1000 /
              60 /
              60 // time unit
            : null,
      },
    });

    // Update task pattern
    await this.updateTaskPattern(task);
  }

  /**
   * Update task pattern
   */
  private static async updateTaskPattern(task: TaskWithRelations) {
    const userId = 1; // Currently fixed
    const labelIds = task.taskLabels?.map((tl) => tl.labelId) || [];

    const existingPattern = await prisma.taskPattern.findUnique({
      where: {
        userId_taskTitle_themeId: {
          userId,
          taskTitle: task.title,
          themeId: task.themeId || 0,
        },
      },
    });

    const timeToStart =
      task.startedAt && task.createdAt
        ? (new Date(task.startedAt).getTime() - new Date(task.createdAt).getTime()) / 1000 / 60 / 60
        : null;

    const timeToComplete =
      task.completedAt && task.startedAt
        ? (new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) /
          1000 /
          60 /
          60
        : null;

    if (existingPattern) {
      // Update existing pattern
      const newFrequency = existingPattern.frequency + 1;
      const avgTimeToStart = existingPattern.averageTimeToStart || 0;
      const avgTimeToComplete = existingPattern.averageTimeToComplete || 0;

      await prisma.taskPattern.update({
        where: { id: existingPattern.id },
        data: {
          frequency: newFrequency,
          averageTimeToStart:
            timeToStart !== null
              ? (avgTimeToStart * (newFrequency - 1) + timeToStart) / newFrequency
              : avgTimeToStart,
          averageTimeToComplete:
            timeToComplete !== null
              ? (avgTimeToComplete * (newFrequency - 1) + timeToComplete) / newFrequency
              : avgTimeToComplete,
          actualHours: task.actualHours,
          lastOccurrence: new Date(),
          labelIds: JSON.stringify(labelIds),
        },
      });
    } else {
      // Create new pattern
      await prisma.taskPattern.create({
        data: {
          userId,
          themeId: task.themeId,
          taskTitle: task.title,
          taskDescription: task.description,
          priority: task.priority,
          estimatedHours: task.estimatedHours,
          actualHours: task.actualHours,
          averageTimeToStart: timeToStart,
          averageTimeToComplete: timeToComplete,
          labelIds: JSON.stringify(labelIds),
          lastOccurrence: new Date(),
        },
      });
    }
  }

  /**
   * Generate and update behavior summary
   */
  static async updateBehaviorSummary(
    userId: number = 1,
    periodType: 'daily' | 'weekly' | 'monthly',
  ) {
    const now = new Date();
    let periodStart: Date;
    let periodEnd: Date;

    switch (periodType) {
      case 'daily':
        periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
        break;
      case 'weekly':
        const weekStart = now.getDate() - now.getDay();
        periodStart = new Date(now.getFullYear(), now.getMonth(), weekStart);
        periodEnd = new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
    }

    // Aggregate behavior for this period
    const behaviors = await prisma.userBehavior.findMany({
      where: {
        userId,
        createdAt: {
          gte: periodStart,
          lt: periodEnd,
        },
      },
      include: {
        task: {
          include: {
            taskLabels: true,
          },
        },
      },
    });

    // Aggregate by theme
    const themeGroups = new Map<number | null, typeof behaviors>();
    behaviors.forEach((b) => {
      const key = b.themeId;
      if (!themeGroups.has(key)) {
        themeGroups.set(key, []);
      }
      themeGroups.get(key)!.push(b);
    });

    for (const [themeId, themeBehaviors] of themeGroups) {
      const taskCreated = themeBehaviors.filter((b) => b.actionType === 'task_created').length;
      const taskCompleted = themeBehaviors.filter((b) => b.actionType === 'task_completed').length;

      // Calculate label usage frequency
      const labelCounts = new Map<number, number>();
      themeBehaviors.forEach((b) => {
        if (b.task?.taskLabels) {
          b.task.taskLabels.forEach((tl) => {
            labelCounts.set(tl.labelId, (labelCounts.get(tl.labelId) || 0) + 1);
          });
        }
      });

      // Calculate task count by priority
      const priorityCounts: Record<string, number> = {};
      themeBehaviors.forEach((b) => {
        if (b.task?.priority) {
          priorityCounts[b.task.priority] = (priorityCounts[b.task.priority] || 0) + 1;
        }
      });

      // Calculate time preference
      const timeOfDayCounts: Record<string, number> = {};
      themeBehaviors.forEach((b) => {
        const context = b.context ? JSON.parse(b.context) : {};
        if (context.timeOfDay) {
          timeOfDayCounts[context.timeOfDay] = (timeOfDayCounts[context.timeOfDay] || 0) + 1;
        }
      });
      const preferredTimeOfDay =
        Object.entries(timeOfDayCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || null;

      // Find existing summary
      const existingSummary = await prisma.userBehaviorSummary.findFirst({
        where: {
          userId,
          periodType,
          periodStart,
          themeId: themeId ?? null,
        },
      });

      const summaryData = {
        totalTasks: taskCreated,
        completedTasks: taskCompleted,
        preferredTimeOfDay,
        mostUsedLabels: JSON.stringify(
          Array.from(labelCounts.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([labelId, count]) => ({ labelId, count })),
        ),
        taskPriorities: JSON.stringify(priorityCounts),
      };

      if (existingSummary) {
        await prisma.userBehaviorSummary.update({
          where: { id: existingSummary.id },
          data: summaryData,
        });
      } else {
        await prisma.userBehaviorSummary
          .create({
            data: {
              userId,
              periodType,
              periodStart,
              periodEnd,
              themeId,
              ...summaryData,
            },
          })
          .catch((e: unknown) => {
            // Race condition: another process created the record between findFirst and create
            if (e instanceof Error && 'code' in e && (e as { code: string }).code === 'P2002') {
              return prisma.userBehaviorSummary.updateMany({
                where: { userId, periodType, periodStart, themeId: themeId ?? null },
                data: summaryData,
              });
            }
            throw e;
          });
      }
    }
  }
}
