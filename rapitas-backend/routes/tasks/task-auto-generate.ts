/**
 * Task Auto-Generate Route
 *
 * Endpoint for the "auto-execution mode" on the task list page.
 * Calls Claude to analyze the project and generate new tasks.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import { autoGenerateTasks } from '../../services/ai/auto-task-generator';

const log = createLogger('routes:task-auto-generate');

export const taskAutoGenerateRoutes = new Elysia({ prefix: '/tasks' })
  /**
   * Auto-generate tasks by analyzing the project state.
   * Used by the "auto-execution mode" toggle on the task list page.
   */
  .post(
    '/auto-generate',
    async ({ body, set }) => {
      try {
        const result = await autoGenerateTasks(body.autoExecute ?? false);
        return {
          success: true,
          tasks: result.generatedTasks,
          executionTriggered: result.executionTriggered,
          count: result.generatedTasks.length,
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
      }),
      detail: {
        tags: ['Tasks', 'AI'],
        summary: 'AIがプロジェクトを分析してタスクを自動生成',
        description:
          'Claude APIでプロジェクト状態を分析し、3〜5件の新規タスクを自動作成。autoExecute=trueで自動実行も設定。',
      },
    },
  );
