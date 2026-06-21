/**
 * SessionResumeDetector
 *
 * Shared utility for detecting Claude Code CLI session-expiry failures.
 * Consumed by fallback-handler.ts (orchestrator) and available to any future
 * execution module (e.g. execution-resume.ts) without depending on orchestrator internals.
 */
import type { AgentExecutionResult } from './base-agent';

/**
 * Matches actual Claude Code CLI session-expiry messages.
 * Intentionally narrow: generic tokens like "session", "code 1", "invalid",
 * and "not found" alone are excluded — they caused false positives on unrelated
 * failures when execution-resolver injected "session expired or not found" into
 * every resume-mode errorMessage regardless of actual cause.
 */
export const SESSION_FAILURE_RE =
  /no conversation found|conversation .*not found|session (id )?(not found|expired|invalid|does not exist)|no such session|could not (resume|find) session|resume failed/i;

/**
 * Determines whether a result indicates that the --resume session ID is no longer valid.
 * Requires an actual CLI session-expiry signature in errorMessage; execution-time
 * heuristics alone are not sufficient (they caused false positives on working-dir-not-found
 * and other quick exits unrelated to session expiry).
 *
 * @param result - Agent execution result / エージェント実行結果
 * @param claudeSessionId - Session ID that was used / 使用されたセッションID
 * @returns true if the failure pattern matches a stale session / セッション失効パターンに一致する場合true
 */
export function isSessionResumeFailure(
  result: AgentExecutionResult,
  claudeSessionId: string | null,
): boolean {
  return (
    !result.success &&
    !result.waitingForInput &&
    !!claudeSessionId &&
    SESSION_FAILURE_RE.test(result.errorMessage ?? '')
  );
}
