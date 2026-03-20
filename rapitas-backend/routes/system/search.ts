/**
 * Search API Routes (re-export)
 *
 * This file is kept for backward compatibility.
 * The implementation has been split into sub-modules under ./search/.
 */
export {
  searchRoutes,
  searchMainRoute,
  searchSuggestRoute,
  createExcerpt,
  calculateRelevance,
  getMatchContext,
} from './search/index';
export type { SearchResultItem } from './search/index';
