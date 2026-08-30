/**
 * execution-log-entries routes
 *
 * GET /agents/executions/:executionId/logs — task #785. Paginated read of
 * one AgentExecution's structured `AgentExecutionLog` rows (DB, not the
 * on-disk log files served by execution-logs.ts). Used by the frontend
 * phase-timeline's deferred fetch for a collapsed phase's log detail.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';

const log = createLogger('routes:execution-log-entries');

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

const executionLogEntriesRoutes = new Elysia({ prefix: '/agents' }).get(
  '/executions/:executionId/logs',
  async (ctx) => {
    const params = ctx.params as { executionId: string };
    const query = ctx.query as { offset?: string; limit?: string };
    const executionId = parseInt(params.executionId, 10);
    if (!Number.isFinite(executionId)) {
      ctx.set.status = 400;
      return { success: false, error: 'invalid executionId' };
    }
    const offset = Math.max(0, parseInt(query.offset ?? '0', 10) || 0);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(query.limit ?? '', 10) || DEFAULT_LIMIT),
    );

    try {
      const [total, rows] = await Promise.all([
        prisma.agentExecutionLog.count({ where: { executionId } }),
        prisma.agentExecutionLog.findMany({
          where: { executionId },
          orderBy: { sequenceNumber: 'asc' },
          skip: offset,
          take: limit,
        }),
      ]);

      return {
        success: true,
        executionId,
        total,
        offset,
        limit,
        logs: rows.map((r) => ({
          id: r.id,
          sequenceNumber: r.sequenceNumber,
          logType: r.logType,
          logChunk: r.logChunk,
          timestamp: r.timestamp,
        })),
      };
    } catch (err) {
      log.error({ err, executionId }, '[execution-log-entries] failed to fetch logs');
      ctx.set.status = 500;
      return { success: false, error: 'failed to fetch execution logs' };
    }
  },
);

export default executionLogEntriesRoutes;
