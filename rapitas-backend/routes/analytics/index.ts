/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Run `bun run generate:route-barrels` to regenerate from
 * routes/route-barrel-legacy-manifest.json + *.routes.ts auto-discovery
 * (see scripts/generate-route-barrels.cjs).
 */
import { Elysia } from 'elysia';
import { statisticsRoutes } from './statistics';
import { reportsRoutes } from './reports';
import { intelligentSuggestionsRoutes } from './intelligent-suggestions';
import { weeklyReviewRoutes } from './weekly-review';

export { statisticsRoutes } from './statistics';
export { reportsRoutes } from './reports';
export { intelligentSuggestionsRoutes } from './intelligent-suggestions';
export { weeklyReviewRoutes } from './weekly-review';

export const analyticsDomainRoutes = new Elysia()
  .use(statisticsRoutes)
  .use(reportsRoutes)
  .use(intelligentSuggestionsRoutes)
  .use(weeklyReviewRoutes);
