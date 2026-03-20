/**
 * Tasks API Routes
 *
 * Assembles sub-routers into the /tasks prefix.
 * Business logic is delegated to task-service.ts; handlers live in ./handlers/.
 */

import { Elysia } from 'elysia';
import { taskCrudRoutes } from './handlers/task-crud-handlers';
import { taskSuggestionRoutes } from './handlers/task-suggestion-handlers';
import { taskSubtaskRoutes } from './handlers/task-subtask-handlers';
import { taskQuickCreateRoutes } from './handlers/task-quick-create-handler';

export const tasksRoutes = new Elysia({ prefix: '/tasks' })
  .use(taskCrudRoutes)
  .use(taskSuggestionRoutes)
  .use(taskSubtaskRoutes)
  .use(taskQuickCreateRoutes);
