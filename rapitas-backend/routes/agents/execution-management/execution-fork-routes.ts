/**
 * ExecutionForkRoutes
 *
 * API endpoints for forking executions and comparing alternative approaches.
 */
import { Elysia, t } from 'elysia';
import { forkExecution, getForkComparison } from '../../../services/core/execution-fork-service';
import { createLogger } from '../../../config/logger';

const log = createLogger('routes:execution-fork');

export const executionForkRoutes = new Elysia({ prefix: '/execution-fork' })
  /**
   * Fork an execution to explore an alternative approach.
   */
  .post(
    '/fork',
    async (context) => {
      const { body } = context;
      try {
        const result = await forkExecution({
          sourceExecutionId: (body as { sourceExecutionId: number }).sourceExecutionId,
          modelId: (body as { modelId?: string }).modelId,
          instruction: (body as { instruction?: string }).instruction,
          label: (body as { label?: string }).label,
        });

        return { success: result.success, data: result };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error({ error: msg }, '[ExecutionFork] Fork failed');
        return { success: false, error: msg };
      }
    },
    {
      body: t.Object({
        sourceExecutionId: t.Number(),
        modelId: t.Optional(t.String()),
        instruction: t.Optional(t.String()),
        label: t.Optional(t.String()),
      }),
    },
  )

  /**
   * Get fork comparison for a source execution.
   */
  .get(
    '/compare/:executionId',
    async (context) => {
      const { params } = context;
      try {
        const executionId = parseInt(params.executionId);
        const comparison = await getForkComparison(executionId);

        if (!comparison) {
          return { success: false, error: 'Execution not found' };
        }

        return { success: true, data: comparison };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: msg };
      }
    },
    {
      params: t.Object({
        executionId: t.String(),
      }),
    },
  );
