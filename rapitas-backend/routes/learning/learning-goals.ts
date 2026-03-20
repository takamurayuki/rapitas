/**
 * Learning Goals API Routes
 *
 * Assembles sub-routers into the /learning-goals prefix.
 * CRUD handlers live in ./handlers/learning-goal-crud-handlers.ts.
 * Plan generation, application, and adaptation live in ./handlers/learning-goal-plan-handlers.ts.
 * Shared types and pure helpers live in ./learning-goal-helpers.ts.
 */

import { Elysia } from 'elysia';
import { learningGoalCrudRoutes } from './handlers/learning-goal-crud-handlers';
import { learningGoalPlanRoutes } from './handlers/learning-goal-plan-handlers';
import { learningGoalApplyRoutes } from './handlers/learning-goal-apply-handler';

// Re-export helpers for consumers that imported them from this path
export type { GeneratedLearningPlan } from './learning-goal-helpers';
export { buildTaskDescription, generateFallbackPlan } from './learning-goal-helpers';

export const learningGoalsRoutes = new Elysia({ prefix: '/learning-goals' })
  .use(learningGoalCrudRoutes)
  .use(learningGoalPlanRoutes)
  .use(learningGoalApplyRoutes);
