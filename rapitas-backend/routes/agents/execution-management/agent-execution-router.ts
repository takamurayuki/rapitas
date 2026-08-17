/**
 * Agent Execution Router
 *
 * Composes all agent execution sub-routes into a single Elysia instance.
 * Kept at this path for backward compatibility — all implementations live
 * in rapitas-backend/routes/agents/execution/.
 */

import { Elysia } from 'elysia';
import {
  executeRoute,
  statusRoute,
  respondRoute,
  stopRoute,
  continueRoute,
  resetRoute,
  baseBranchesRoute,
} from '../execution';

// Re-export helpers for consumers that import directly from this module
export {
  acquireTaskExecutionLock,
  releaseTaskExecutionLock,
  updateSessionStatusWithRetry,
} from '../execution';

export const agentExecutionRouter = new Elysia()
  .use(executeRoute)
  .use(statusRoute)
  .use(respondRoute)
  .use(stopRoute)
  .use(continueRoute)
  .use(resetRoute)
  .use(baseBranchesRoute);
