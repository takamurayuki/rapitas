/**
 * Git Cache Metrics Routes
 *
 * Exposes hit/miss/expiry counters for the two git read caches:
 * - execGitReadonly cache (orchestrator layer)
 * - ownerRepoFromGitRemote cache (github service layer)
 *
 * Use GET /git-cache-metrics to observe cache effectiveness and decide TTL tuning.
 * Use POST /git-cache-metrics/reset to open a new measurement window.
 */
import { Elysia } from 'elysia';
import { createLogger } from '../../../config/logger';
import { getGitExecCacheStats, resetGitExecCacheStats } from '../../../services/agents/orchestrator/git-operations/git-exec';
import { getGitRemoteCacheStats, resetGitRemoteCacheStats } from '../../../services/github/git-exec';

const log = createLogger('routes:git-cache-metrics');

export const gitCacheMetricsRoutes = new Elysia({ prefix: '/git-cache-metrics' })
  /**
   * GET /git-cache-metrics
   * Returns current hit/miss/expiry counters for both git caches.
   */
  .get('/', () => {
    try {
      return {
        gitExec: getGitExecCacheStats(),
        gitRemote: getGitRemoteCacheStats(),
      };
    } catch (error) {
      log.error({ err: error }, 'Error fetching git cache metrics');
      throw error;
    }
  })
  /**
   * POST /git-cache-metrics/reset
   * Resets counters to zero without clearing the cache Map.
   * Opens a new measurement window while keeping the cache warm.
   */
  .post('/reset', () => {
    try {
      resetGitExecCacheStats();
      resetGitRemoteCacheStats();
      log.info('Git cache stats counters reset');
      return { ok: true };
    } catch (error) {
      log.error({ err: error }, 'Error resetting git cache metrics');
      throw error;
    }
  });
