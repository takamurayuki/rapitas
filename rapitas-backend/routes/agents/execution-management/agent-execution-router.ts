/**
 * Agent Execution Router
 *
 * Composes all agent execution sub-routes into a single Elysia instance.
 * Kept at this path for backward compatibility — all implementations live
 * in rapitas-backend/routes/agents/execution/.
 */

import { Elysia } from 'elysia';
import { executeRoute } from '../execution/execute-route';
import { statusRoute } from '../execution/status-route';
import { respondRoute } from '../execution/respond-route';
import { stopRoute } from '../execution/stop-route';
import { continueRoute } from '../execution/continue-route';
import { resetRoute } from '../execution/reset-route';

// Re-export helpers for consumers that import directly from this module
export { acquireTaskExecutionLock, releaseTaskExecutionLock } from '../execution/execution-lock';
export { updateSessionStatusWithRetry, createCodeReviewApproval } from '../execution/session-helpers';

export const agentExecutionRouter = new Elysia()
  .use(executeRoute)
  .use(statusRoute)
  .use(respondRoute)
  .use(stopRoute)
  .use(continueRoute)
  .use(resetRoute);
