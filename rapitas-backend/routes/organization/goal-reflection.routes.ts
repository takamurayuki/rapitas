/**
 * goal-reflection routes
 *
 * Mounts the weekly 前進の振り返り API on the real database. The rules and the
 * handlers live in services/goals and goal-reflection-router.ts.
 */
import { prisma } from '../../config/database';
import type { ReflectionDb } from '../../services/goals/goal-reflection';
import type { SettingsDb } from '../../services/goals/reflection-prompt-settings';
import { createGoalReflectionRouter } from './goal-reflection-router';

// NOTE: The Prisma client is regenerated on the next server start after the
// GoalReflection model is added, so the delegate is typed by the narrow slice
// the services use rather than by the (possibly stale) generated client type.
const goalReflectionRoutes = createGoalReflectionRouter(
  prisma as unknown as ReflectionDb & SettingsDb,
);

export default goalReflectionRoutes;
