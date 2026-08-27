// Routes Memory barrel export — 集約 + ドメイン単位マージ済みインスタンス
import { Elysia } from 'elysia';
import { knowledgeRoutes } from './knowledge';
import { memorySystemRoutes } from './memory-system';
import { crossProjectKnowledgeRoutes } from './cross-project-knowledge';
import { ideaBoxRoutes } from './idea-box';
import { concernBacklogRoutes } from './concern-backlog';
import { hypothesisRoutes } from './hypothesis';
import { backlogScheduleRoutes, backlogThemeOverrideRoutes } from '../backlog';
import { dailyReportRoutes } from '../daily-report-routes';

export { knowledgeRoutes } from './knowledge';
export { memorySystemRoutes } from './memory-system';
export { crossProjectKnowledgeRoutes } from './cross-project-knowledge';
export { ideaBoxRoutes } from './idea-box';
export { concernBacklogRoutes } from './concern-backlog';
export { hypothesisRoutes } from './hypothesis';
export { backlogScheduleRoutes, backlogThemeOverrideRoutes } from '../backlog';
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
