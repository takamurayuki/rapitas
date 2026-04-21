/**
 * Task Auto-Generate Route
 *
 * Endpoint for the "auto-execution mode" on the task list page.
 * Calls Claude to analyze the project and generate new tasks,
 * with IdeaBox integration and category scoping.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import { autoGenerateTasks } from '../../services/ai/auto-task-generator';

const log = createLogger('routes:task-auto-generate');

export const taskAutoGenerateRoutes = new Elysia({ prefix: '/tasks' })
  .post(
    '/auto-generate',
    async ({ body, set }) => {
      try {
        const result = await autoGenerateTasks({
          autoExecute: body.autoExecute ?? false,
          categoryId: body.categoryId ?? undefined,
          force: body.force ?? false,
        });

        return {
          success: true,
          tasks: result.generatedTasks,
          executionTriggered: result.executionTriggered,
          count: result.generatedTasks.length,
          ideasUsed: result.ideasUsed,
          insufficientData: result.insufficientData ?? false,
          completedTaskCount: result.completedTaskCount,
        };
      } catch (err) {
        log.error({ err }, 'Auto-generate tasks failed');
        set.status = 500;
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to auto-generate tasks',
        };
      }
    },
    {
      body: t.Object({
        autoExecute: t.Optional(t.Boolean({ default: false })),
        categoryId: t.Optional(t.Nullable(t.Number())),
        force: t.Optional(t.Boolean({ default: false })),
      }),
    },
  );
