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

import { createLogger } from '../../../config/logger';
import { updateSessionStatusWithRetry } from './session-helpers';

const log = createLogger('routes:agent-execution:shutdown-handler');

/**
 * Returns true when the given error was thrown because the server is in the
 * process of shutting down.
 *
 * All shutdown error sources (AgentWorkerManager, task-executor,
 * continuation-executor, execution-resume) include the literal string
 * 'shutting down' in their messages, so a single substring check suffices.
 *
 * @param error - Value caught in a .catch() handler / キャッチされた値
 * @returns true if the error is a shutdown error, false otherwise / シャットダウンエラーなら true
 */
export function isShutdownError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('shutting down');
}

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
 * @param params.sessionId - AgentSession ID to mark interrupted / 中断マーク対象セッションID
 * @param params.logPrefix - Prefix for identifying the calling route / ログ識別プレフィックス
 */
export async function handleShutdownInterruption(params: {
  sessionId: number;
  logPrefix: string;
}): Promise<void> {
  const { sessionId, logPrefix } = params;

  log.warn(
    `${logPrefix} Server is shutting down — marking session ${sessionId} as interrupted`,
  );

  await updateSessionStatusWithRetry(sessionId, 'interrupted', logPrefix);
}
