import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface BehaviorContext {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek: string;
  previousAction?: string;
  sessionDuration?: number;
  [key: string]: any;
}

export class UserBehaviorService {
  /**
   * ユーザー行動を記録
   */
  static async recordBehavior(
    actionType: string,
    options: {
      userId?: number;
      taskId?: number;
      themeId?: number;
      context?: BehaviorContext;
      metadata?: Record<string, any>;
    } = {}
  ) {
    const { userId = 1, taskId, themeId, context, metadata } = options;

    try {
      // 現在の時刻情報を取得
      const now = new Date();
      const hour = now.getHours();
      let timeOfDay: BehaviorContext['timeOfDay'];

      if (hour >= 5 && hour < 12) timeOfDay = 'morning';
      else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
      else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
      else timeOfDay = 'night';

      const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()];

      const fullContext: BehaviorContext = {
        timeOfDay,
        dayOfWeek,
        ...context
      };

      await prisma.userBehavior.create({
        data: {
          userId,
          actionType,
          taskId,
          themeId,
          context: JSON.stringify(fullContext),
          metadata: metadata ? JSON.stringify(metadata) : null,
        }
      });
    } catch (error) {
      console.error('Failed to record user behavior:', error);
      // エラーをスローしない（ユーザー行動記録の失敗がメイン処理を妨げないように）
    }
  }

  /**
   * タスク作成時の行動を記録
   */
  static async recordTaskCreated(taskId: number, task: any) {
    await this.recordBehavior('task_created', {
      taskId,
      themeId: task.themeId,
      metadata: {
        priority: task.priority,
        estimatedHours: task.estimatedHours,
        hasDescription: !!task.description,
        labelIds: task.taskLabels?.map((tl: any) => tl.labelId) || [],
      }
    });
  }

  /**
   * タスク開始時の行動を記録
   */
  static async recordTaskStarted(taskId: number, task: any) {
    await this.recordBehavior('task_started', {
      taskId,
      themeId: task.themeId,
      metadata: {
        timeToStart: task.startedAt && task.createdAt
          ? (new Date(task.startedAt).getTime() - new Date(task.createdAt).getTime()) / 1000 / 60 / 60 // 時間単位
          : null,
      }
    });
  }

  /**
   * タスク完了時の行動を記録・パターンを更新
   */
  static async recordTaskCompleted(taskId: number, task: any) {
    await this.recordBehavior('task_completed', {
      taskId,
      themeId: task.themeId,
      metadata: {
        actualHours: task.actualHours,
        timeToComplete: task.completedAt && task.startedAt
          ? (new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 1000 / 60 / 60 // 時間単位
          : null,
      }
    });

    // タスクパターンを更新
    await this.updateTaskPattern(task);
  }

  /**
   * タスクパターンを更新
   */
  private static async updateTaskPattern(task: any) {
    const userId = 1; // 現在は固定
    const labelIds = task.taskLabels?.map((tl: any) => tl.labelId) || [];

    const existingPattern = await prisma.taskPattern.findUnique({
      where: {
        userId_taskTitle_themeId: {
          userId,
          taskTitle: task.title,
          themeId: task.themeId || 0,
        }
      }
    });

    const timeToStart = task.startedAt && task.createdAt
      ? (new Date(task.startedAt).getTime() - new Date(task.createdAt).getTime()) / 1000 / 60 / 60
      : null;

    const timeToComplete = task.completedAt && task.startedAt
      ? (new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 1000 / 60 / 60
      : null;

    if (existingPattern) {
      // 既存パターンを更新
      const newFrequency = existingPattern.frequency + 1;
      const avgTimeToStart = existingPattern.averageTimeToStart || 0;
      const avgTimeToComplete = existingPattern.averageTimeToComplete || 0;

      await prisma.taskPattern.update({
        where: { id: existingPattern.id },
        data: {
          frequency: newFrequency,
          averageTimeToStart: timeToStart !== null
            ? (avgTimeToStart * (newFrequency - 1) + timeToStart) / newFrequency
            : avgTimeToStart,
          averageTimeToComplete: timeToComplete !== null
            ? (avgTimeToComplete * (newFrequency - 1) + timeToComplete) / newFrequency
            : avgTimeToComplete,
          actualHours: task.actualHours,
          lastOccurrence: new Date(),
          labelIds: JSON.stringify(labelIds),
        }
      });
    } else {
      // 新規パターンを作成
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
        }
      });
    }
  }

  /**
   * 行動サマリーを生成・更新
   */
  static async updateBehaviorSummary(userId: number = 1, periodType: 'daily' | 'weekly' | 'monthly') {
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

    // この期間の行動を集計
    const behaviors = await prisma.userBehavior.findMany({
      where: {
        userId,
        createdAt: {
          gte: periodStart,
          lt: periodEnd,
        }
      },
      include: {
        task: {
          include: {
            taskLabels: true,
          }
        }
      }
    });

    // テーマごとに集計
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

      // ラベル使用頻度を計算
      const labelCounts = new Map<number, number>();
      themeBehaviors.forEach((b) => {
        if (b.task?.taskLabels) {
          b.task.taskLabels.forEach((tl) => {
            labelCounts.set(tl.labelId, (labelCounts.get(tl.labelId) || 0) + 1);
          });
        }
      });

      // 優先度別タスク数を計算
      const priorityCounts: Record<string, number> = {};
      themeBehaviors.forEach((b) => {
        if (b.task?.priority) {
          priorityCounts[b.task.priority] = (priorityCounts[b.task.priority] || 0) + 1;
        }
      });

      // 時間帯の好みを計算
      const timeOfDayCounts: Record<string, number> = {};
      themeBehaviors.forEach((b) => {
        const context = b.context ? JSON.parse(b.context) : {};
        if (context.timeOfDay) {
          timeOfDayCounts[context.timeOfDay] = (timeOfDayCounts[context.timeOfDay] || 0) + 1;
        }
      });
      const preferredTimeOfDay = Object.entries(timeOfDayCounts)
        .sort(([, a], [, b]) => b - a)[0]?.[0] || null;

      // 既存のサマリーを探す
      const existingSummary = await prisma.userBehaviorSummary.findUnique({
        where: {
          userId_periodType_periodStart_themeId: {
            userId,
            periodType,
            periodStart,
            themeId: themeId || 0,
          }
        }
      });

      const summaryData = {
        totalTasks: taskCreated,
        completedTasks: taskCompleted,
        preferredTimeOfDay,
        mostUsedLabels: JSON.stringify(
          Array.from(labelCounts.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([labelId, count]) => ({ labelId, count }))
        ),
        taskPriorities: JSON.stringify(priorityCounts),
      };

      if (existingSummary) {
        await prisma.userBehaviorSummary.update({
          where: { id: existingSummary.id },
          data: summaryData,
        });
      } else {
        await prisma.userBehaviorSummary.create({
          data: {
            userId,
            periodType,
            periodStart,
            periodEnd,
            themeId,
            ...summaryData,
          }
        });
      }
    }
  }
}