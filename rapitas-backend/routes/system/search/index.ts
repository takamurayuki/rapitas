/**
 * Search Routes (barrel)
 *
 * Assembles the /search route group from main search and suggest sub-routes.
 * The named export `searchRoutes` matches the original search.ts so existing
 * imports require no changes.
 */
import { Elysia } from 'elysia';
import { searchMainRoute } from './search-route';
import { searchSuggestRoute } from './suggest-route';

export {
  type SearchResultItem,
  createExcerpt,
  calculateRelevance,
  getMatchContext,
} from './helpers';
export { searchMainRoute } from './search-route';
export { searchSuggestRoute } from './suggest-route';

/**
 * Combined search routes mounted under /search prefix.
 */
export const searchRoutes = new Elysia({ prefix: '/search' })
  .use(searchMainRoute)
  .use(searchSuggestRoute);
