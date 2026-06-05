/**
 * Search Services — Barrel Export
 *
 * Re-exports the public search-domain service functions.
 */

// Barrel export for search-domain services.
export {
  recordSearchMiss,
  getTopMissedQueries,
  linkTaskToMiss,
  autoLinkMatchingMisses,
  resolveSearchMissForTask,
  getMissAnalytics,
} from './search-miss-service';
