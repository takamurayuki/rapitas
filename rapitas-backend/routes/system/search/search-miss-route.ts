/**
 * Search Miss Route
 *
 * Surfaces zero-result ("search miss") data:
 *  - GET /miss           top open misses by hit count (SearchMissPanel)
 *  - GET /miss/related   misses related to a draft task's text (new-task panel)
 *  - GET /miss/analytics per-status counts + top open queries (aggregation)
 */
import { Elysia } from 'elysia';
import {
  getTopMissedQueries,
  getRelatedMisses,
  getMissAnalytics,
} from '../../../services/search/search-miss-service';
import { createLogger } from '../../../config/logger';

const log = createLogger('routes:search:miss');

export const searchMissRoute = new Elysia()
  .get('/miss', async ({ query: q, set }) => {
    try {
      const limit = Math.min(parseInt((q as { limit?: string }).limit || '10', 10), 50);
      const items = await getTopMissedQueries(limit);
      return { success: true, items, total: items.length };
    } catch (error) {
      log.error({ err: error }, 'Search miss listing error');
      set.status = 500;
      return { success: false, error: 'Failed to get search misses' };
    }
  })
  .get('/miss/related', async ({ query: q, set }) => {
    try {
      const text = (q as { q?: string }).q ?? '';
      const limit = Math.min(parseInt((q as { limit?: string }).limit || '5', 10), 20);
      // Split on whitespace and common separators so each phrase/identifier is a
      // candidate term; getRelatedMisses drops terms shorter than 3 chars.
      const keywords = text.split(/[\s/、。,.:：・]+/).filter(Boolean);
      const items = await getRelatedMisses(keywords, limit);
      return { success: true, items, total: items.length };
    } catch (error) {
      log.error({ err: error }, 'Related search miss error');
      set.status = 500;
      return { success: false, error: 'Failed to get related search misses' };
    }
  })
  .get('/miss/analytics', async ({ set }) => {
    try {
      const analytics = await getMissAnalytics();
      return { success: true, analytics };
    } catch (error) {
      log.error({ err: error }, 'Search miss analytics error');
      set.status = 500;
      return { success: false, error: 'Failed to get search miss analytics' };
    }
  });
