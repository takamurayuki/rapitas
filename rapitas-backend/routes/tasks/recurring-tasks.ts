/**
 * Recurring Task Routes
 *
 * API endpoints for managing recurring tasks.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import {
  setTaskRecurrence,
  removeTaskRecurrence,
  getUpcomingOccurrences,
  getGeneratedTasks,
  RECURRENCE_PRESETS,
} from '../../services/scheduling';

const log = createLogger('routes:recurring-tasks');

export const recurringTaskRoutes = new Elysia({ prefix: '/tasks' })

  /**
   * Set recurrence on a task (makes it a recurring master task).
   */
  .put(
    '/:id/recurrence',
    async ({ params, body, set }) => {
      const taskId = parseInt(params.id);
      const { recurrenceRule, recurrenceEndAt, recurrenceTime, inheritWorkflowFiles } = body;

      try {
        const task = await setTaskRecurrence(prisma, taskId, {
          recurrenceRule,
          recurrenceEndAt: recurrenceEndAt ? new Date(recurrenceEndAt) : null,
          recurrenceTime: recurrenceTime || '00:00',
          inheritWorkflowFiles: inheritWorkflowFiles ?? true,
        });

        return {
          success: true,
          task,
          message: '繰り返し設定を保存しました',
        };
      } catch (err) {
        log.error({ err, taskId }, 'Failed to set task recurrence');
        set.status = 400;
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to set recurrence',
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        recurrenceRule: t.String({ minLength: 1 }),
        recurrenceEndAt: t.Optional(t.Union([t.String(), t.Null()])),
        recurrenceTime: t.Optional(t.String()),
        inheritWorkflowFiles: t.Optional(t.Boolean()),
      }),
    },
  )

  /**
   * Remove recurrence from a task.
   */
  .delete(
    '/:id/recurrence',
    async ({ params, set }) => {
      const taskId = parseInt(params.id);

      try {
        const task = await removeTaskRecurrence(prisma, taskId);

        return {
          success: true,
          task,
          message: '繰り返し設定を解除しました',
        };
      } catch (err) {
        log.error({ err, taskId }, 'Failed to remove task recurrence');
        set.status = 400;
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to remove recurrence',
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  /**
   * Get upcoming occurrences preview for a recurrence rule.
   */
  .get(
    '/:id/occurrences',
    async ({ params, query }) => {
      const taskId = parseInt(params.id);
      const limit = query.limit ? parseInt(query.limit) : 10;

      const task = await prisma.task.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        return { success: false, error: 'Task not found' };
      }

      if (!task.isRecurring || !task.recurrenceRule) {
        return {
          success: true,
          occurrences: [],
          message: 'このタスクには繰り返し設定がありません',
        };
      }

      const occurrences = getUpcomingOccurrences(
        task.recurrenceRule,
        new Date(),
        task.recurrenceEndAt,
        limit,
      );

      return {
        success: true,
        occurrences: occurrences.map((d) => d.toISOString()),
        recurrenceRule: task.recurrenceRule,
        recurrenceEndAt: task.recurrenceEndAt?.toISOString() ?? null,
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
      }),
    },
  )

  /**
   * Get tasks generated from a master recurring task.
   */
  .get(
    '/:id/generated',
    async ({ params, query }) => {
      const taskId = parseInt(params.id);
      const limit = query.limit ? parseInt(query.limit) : 50;
      const includeCompleted = query.includeCompleted !== 'false';

      const tasks = await getGeneratedTasks(prisma, taskId, { limit, includeCompleted });

      return {
        success: true,
        tasks,
        count: tasks.length,
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
        includeCompleted: t.Optional(t.String()),
      }),
    },
  )

  /**
   * Preview upcoming occurrences for a recurrence rule (without saving).
   */
  .post(
    '/recurrence/preview',
    async ({ body }) => {
      const { recurrenceRule, recurrenceEndAt, limit = 10 } = body;

      try {
        const occurrences = getUpcomingOccurrences(
          recurrenceRule,
          new Date(),
          recurrenceEndAt ? new Date(recurrenceEndAt) : null,
          limit,
        );

        return {
          success: true,
          occurrences: occurrences.map((d) => d.toISOString()),
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Invalid recurrence rule',
        };
      }
    },
    {
      body: t.Object({
        recurrenceRule: t.String({ minLength: 1 }),
        recurrenceEndAt: t.Optional(t.Union([t.String(), t.Null()])),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
      }),
    },
  )

  /**
   * Get available recurrence presets.
   */
  .get('/recurrence/presets', () => {
    return {
      success: true,
      presets: Object.entries(RECURRENCE_PRESETS).map(([key, rule]) => ({
        key,
        rule,
        label: getPresetLabel(key),
      })),
    };
  });

/**
 * Get human-readable label for a preset.
 */
function getPresetLabel(key: string): string {
  const labels: Record<string, string> = {
    daily: '毎日',
    weekdays: '平日（月〜金）',
    weekly: '毎週',
    biweekly: '隔週',
    monthly: '毎月',
    yearly: '毎年',
  };
  return labels[key] ?? key;
}
