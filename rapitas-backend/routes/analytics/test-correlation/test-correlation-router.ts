/**
 * test-correlation router
 *
 * Route definitions only — delegates to test-correlation-handlers.ts.
 * Mounted under /analytics/test-correlation.
 */
import { Elysia } from 'elysia';
import {
  handleGetDrilldown,
  handleGetMatrix,
  handlePostManualRun,
  handlePostPrScan,
} from './test-correlation-handlers';

export const testCorrelationRoutes = new Elysia({ prefix: '/analytics/test-correlation' })
  .get('/matrix', ({ query, set }) => {
    const { status, body } = handleGetMatrix(query as Record<string, unknown>);
    set.status = status;
    return body;
  })
  .get('/drilldown', ({ query, set }) => {
    const { status, body } = handleGetDrilldown(query as Record<string, unknown>);
    set.status = status;
    return body;
  })
  .post('/pr-scan', async ({ body, set }) => {
    const result = await handlePostPrScan(body as Record<string, unknown>);
    set.status = result.status;
    return result.body;
  })
  .post('/manual-run', ({ body, set }) => {
    const result = handlePostManualRun(body as Record<string, unknown>);
    set.status = result.status;
    return result.body;
  });
