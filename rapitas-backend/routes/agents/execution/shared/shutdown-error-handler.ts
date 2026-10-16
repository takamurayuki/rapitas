/**
 * execution/shutdown-error-handler
 *
 * Shared utilities for detecting and handling server-shutdown errors in
 * agent execution route handlers. Consolidates the shutdown branch that
 * previously appeared (inconsistently) across execute-route, continue-post-handler,
 * approve-handler, and bulk-approve-handler.
 *
 * Responsibilities:
 * - Detect whether an error originates from an in-progress shutdown (isShutdownError)
 * - Log a WARN and mark the AgentSession as 'interrupted' (handleShutdownInterruption)
 *
 * NOT responsible for:
 * - Releasing the task execution lock (each caller's existing flow handles this)
 * - Updating the task row (shutdown is not a failure; task stays in-progress for resume)
 */

import { createLogger } from '../../../../config/logger';
import { updateSessionStatusWithRetry } from './session-helpers';
import { isShutdownError } from '../../../../utils/common/shutdown-error';

export { isShutdownError };

const log = createLogger('routes:agent-execution:shutdown-handler');

/**
 * Handles the shutdown-interrupted case for execute/continue handlers:
 * emits a WARN log and marks the session as 'interrupted'.
 *
 * Does NOT release the execution lock — each caller's existing flow
 * (finally() in execute-route, explicit call in continue-post-handler) handles
 * that to avoid double-release.
 *
 * Does NOT update the task row — shutdown is a controlled interruption, not a
 * failure. Leaving the task in-progress allows the resume flow to restart it
 * after the server comes back up.
 *
 * NOTE: this is only true of the route-level path. For agents the orchestrator
 * still tracks, `lifecycle-manager.saveAgentState` DOES revert 'in-progress' →
 * 'todo' on shutdown so the task stays selectable if the resume never happens.
 * The two policies coexist on purpose; what makes that safe is that every
 * dispatch re-asserts the status itself (reconcileTaskStatusBeforeRun flips
 * 'todo' → 'in-progress' with a conditional update). Do not "fix" one of these
 * to match the other without checking that guarantee still holds.
 *
 * @param params.sessionId - AgentSession ID to mark interrupted / 中断マーク対象セッションID
 * @param params.logPrefix - Prefix for identifying the calling route / ログ識別プレフィックス
 */
export async function handleShutdownInterruption(params: {
  sessionId: number;
  logPrefix: string;
}): Promise<void> {
  const { sessionId, logPrefix } = params;

  log.warn(`${logPrefix} Server is shutting down — marking session ${sessionId} as interrupted`);

  await updateSessionStatusWithRetry(sessionId, 'interrupted', logPrefix);
}
