/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Run `bun run generate:route-barrels` to regenerate from
 * routes/route-barrel-legacy-manifest.json + *.routes.ts auto-discovery
 * (see scripts/generate-route-barrels.cjs).
 */
import { Elysia } from 'elysia';
import { knowledgeRoutes } from './knowledge';
import { memorySystemRoutes } from './memory-system';
import { crossProjectKnowledgeRoutes } from './cross-project-knowledge';
import { ideaBoxRoutes } from './idea-box';
import { concernBacklogRoutes } from './concern-backlog';
import { hypothesisRoutes } from './hypothesis';
import { backlogScheduleRoutes } from '../backlog';
import { backlogThemeOverrideRoutes } from '../backlog';
import { dailyReportRoutes } from '../daily-report-routes';

export { knowledgeRoutes } from './knowledge';
export { memorySystemRoutes } from './memory-system';
export { crossProjectKnowledgeRoutes } from './cross-project-knowledge';
export { ideaBoxRoutes } from './idea-box';
export { concernBacklogRoutes } from './concern-backlog';
export { hypothesisRoutes } from './hypothesis';
export { backlogScheduleRoutes } from '../backlog';
export { backlogThemeOverrideRoutes } from '../backlog';
export { dailyReportRoutes } from '../daily-report-routes';

export const memoryDomainRoutes = new Elysia()
  .use(knowledgeRoutes)
  .use(memorySystemRoutes)
  .use(crossProjectKnowledgeRoutes)
  .use(ideaBoxRoutes)
  .use(concernBacklogRoutes)
  .use(hypothesisRoutes)
  .use(backlogScheduleRoutes)
  .use(backlogThemeOverrideRoutes)
  .use(dailyReportRoutes);
