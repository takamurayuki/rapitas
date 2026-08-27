// Routes Workflow barrel export — 集約 + ドメイン単位マージ済みインスタンス
import { Elysia } from 'elysia';
import { workflowRoutes } from './core/workflow';
import { workflowRolesRoutes } from './core/workflow-roles';
import { orchestraRoutes } from './orchestra';
import { workflowLearningRoutes } from './workflow-learning';
import { themeAutoRunRoutes } from './theme-auto-run';
import { taskSpecRoutes } from '../tasks/task-spec-routes';

export { workflowRoutes } from './core/workflow';
export { workflowRolesRoutes } from './core/workflow-roles';
export { orchestraRoutes } from './orchestra';
export { workflowLearningRoutes } from './workflow-learning';
export { themeAutoRunRoutes } from './theme-auto-run';
export { taskSpecRoutes } from '../tasks/task-spec-routes';

export const workflowDomainRoutes = new Elysia()
  .use(workflowRoutes)
  .use(workflowRolesRoutes)
  .use(orchestraRoutes)
  .use(workflowLearningRoutes)
  .use(themeAutoRunRoutes)
  .use(taskSpecRoutes);
