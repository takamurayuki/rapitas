/**
 * TemporalDebugRoutes
 *
 * API endpoints for querying agent reasoning traces tied to code changes.
 */
import { Elysia, t } from 'elysia';
import {
  getFileTemporalHistory,
  getExecutionTrace,
} from '../../services/temporal-debugger';

export const temporalDebugRoutes = new Elysia({ prefix: '/temporal-debug' })
  /**
   * Get reasoning history for a specific file.
   */
  .get(
    '/file',
    async (context) => {
      const { query } = context;
      const filePath = query.path || '';
      const limit = query.limit ? parseInt(query.limit) : 20;

      if (!filePath) return { success: false, error: 'path parameter is required' };

      const history = await getFileTemporalHistory(filePath, limit);
      return { success: true, data: history };
    },
    {
      query: t.Object({
        path: t.String(),
        limit: t.Optional(t.String()),
      }),
    },
  )

  /**
   * Get full reasoning trace for a specific execution.
   */
  .get(
    '/execution/:executionId',
    async (context) => {
      const { params } = context;
      const executionId = parseInt(params.executionId);

      const trace = await getExecutionTrace(executionId);
      if (!trace) return { success: false, error: 'Trace not found' };

      return { success: true, data: trace };
    },
    {
      params: t.Object({ executionId: t.String() }),
    },
  );
