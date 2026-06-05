/**
 * Search Miss Route
 *
 * GET /miss — returns the top open (zero-result) search queries ordered by hit count.
 * Used by SearchMissPanel to surface content gaps and allow task creation.
 */
import { Elysia } from 'elysia';
import { getTopMissedQueries } from '../../../services/search/search-miss-service';
import { createLogger } from '../../../config/logger';

const log = createLogger('routes:search:miss');

/**
 * Search miss listing route.
 */
export const searchMissRoute = new Elysia().get('/miss', async ({ query: q, set }) => {
  try {
    const limit = Math.min(parseInt((q as { limit?: string }).limit || '10', 10), 50);
    const items = await getTopMissedQueries(limit);
    return { success: true, items, total: items.length };
  } catch (error) {
    log.error({ err: error }, 'Search miss listing error');
    set.status = 500;
    return { success: false, error: 'Failed to get search misses' };
  }
});
