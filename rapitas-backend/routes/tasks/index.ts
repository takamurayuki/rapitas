/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Run `bun run generate:route-barrels` to regenerate from
 * routes/route-barrel-legacy-manifest.json + *.routes.ts auto-discovery
 * (see scripts/generate-route-barrels.cjs).
 */
import { Elysia } from 'elysia';
import { tasksRoutes } from './tasks';
import { ganttDataRoute } from './gantt-data';
import { tempStatisticsRoutes } from './temp-statistics';
import { taskAnalysisConfigRoutes } from './task-analysis-config';
import { batchRoutes } from './batch';
import { recurringTaskRoutes } from './recurring-tasks';
import { taskSuggestionRoutes } from './task-suggestions';
import { taskQuickCreateRoutes } from './task-quick-create';
import { taskAutoGenerateRoutes } from './task-auto-generate';

export { tasksRoutes } from './tasks';
export { ganttDataRoute } from './gantt-data';
export { tempStatisticsRoutes } from './temp-statistics';
export { taskAnalysisConfigRoutes } from './task-analysis-config';
export { batchRoutes } from './batch';
export { recurringTaskRoutes } from './recurring-tasks';
export { taskSuggestionRoutes } from './task-suggestions';
export { taskQuickCreateRoutes } from './task-quick-create';
export { taskAutoGenerateRoutes } from './task-auto-generate';

export const tasksDomainRoutes = new Elysia()
  .use(tasksRoutes)
  .use(ganttDataRoute)
  .use(tempStatisticsRoutes)
  .use(taskAnalysisConfigRoutes)
  .use(batchRoutes)
  .use(recurringTaskRoutes)
  .use(taskSuggestionRoutes)
  .use(taskQuickCreateRoutes)
  .use(taskAutoGenerateRoutes);
