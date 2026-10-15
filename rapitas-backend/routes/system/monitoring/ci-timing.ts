/**
 * CiTimingRoutes
 *
 * Serves CI test timing analytics from the pre-computed JSON cache.
 * Cache is generated offline by `bun run test:timing` — this route is read-only.
 */

import { Elysia } from 'elysia';
import {
  readTimingCacheOrEmpty,
  computeCiTimingAnalytics,
  SERIAL_GATE_FILES,
} from '../../../services/analytics/ci-timing';

export const ciTimingRoutes = new Elysia({ prefix: '/ci-timing' })
  /**
   * Return CI timing analytics from the local JSON cache.
   * Returns available:false with empty arrays when no cache exists yet.
   */
  .get('/', () => {
    const cache = readTimingCacheOrEmpty();
    const promoteMaxMs = process.env.RAPITAS_TIMING_PROMOTE_MAX_MS
      ? parseInt(process.env.RAPITAS_TIMING_PROMOTE_MAX_MS, 10)
      : undefined;
    const analytics = computeCiTimingAnalytics(cache, SERIAL_GATE_FILES, { promoteMaxMs });
    return { success: true, data: analytics };
  });
