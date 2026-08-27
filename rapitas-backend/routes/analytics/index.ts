// Routes Analytics barrel export — 集約 + ドメイン単位マージ済みインスタンス
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
