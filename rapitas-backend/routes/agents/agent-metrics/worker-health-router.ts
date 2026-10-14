/**
 * Worker Health Router
 *
 * Elysia sub-router for GET /agent-metrics/worker-health. Delegates to the
 * worker-health query module and contains no business logic. Mounted by router.ts.
 */

import { Elysia } from 'elysia';
import { createLogger } from '../../../config/logger';
import { getWorkerHealth } from './queries/worker-health';

const log = createLogger('routes:agent-metrics:worker-health');

export const workerHealthRouter = new Elysia({ prefix: '/worker-health' }).get(
  '/',
  async ({ set }) => {
    try {
      const data = await getWorkerHealth();
      return { success: true, data };
    } catch (error) {
      log.error({ err: error }, 'Error computing worker health series');
      set.status = 500;
      return { success: false, error: 'Failed to compute worker health series' };
    }
  },
);
