/**
 * Decision Trace Router
 *
 * Read-only viewing API for the structured decision-audit trail
 * (AgentDecisionTrace). Returns the reconstructed DAG for a task or
 * execution; recording/verdicts are owned by services/observability/
 * decision-trace, not this router.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../../config/logger';
import { getDecisionDag } from '../../../services/observability/decision-trace';

const log = createLogger('routes:decision-trace');

export const decisionTraceRouter = new Elysia({ prefix: '/agents' }).get(
  '/decision-trace',
  async (context) => {
    const { query } = context;
    const taskId = query.taskId ? parseInt(query.taskId, 10) : undefined;
    const executionId = query.executionId ? parseInt(query.executionId, 10) : undefined;

    if (
      (taskId === undefined || Number.isNaN(taskId)) &&
      (executionId === undefined || Number.isNaN(executionId))
    ) {
      context.set.status = 400;
      return { success: false, error: 'taskId or executionId query parameter is required' };
    }

    try {
      const dag = await getDecisionDag({
        ...(taskId !== undefined && !Number.isNaN(taskId) ? { taskId } : {}),
        ...(executionId !== undefined && !Number.isNaN(executionId) ? { executionId } : {}),
      });
      return { success: true, data: dag };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ error: msg }, '[decision-trace] DAG query failed');
      context.set.status = 500;
      return { success: false, error: msg };
    }
  },
  {
    query: t.Object({
      taskId: t.Optional(t.String()),
      executionId: t.Optional(t.String()),
    }),
  },
);
