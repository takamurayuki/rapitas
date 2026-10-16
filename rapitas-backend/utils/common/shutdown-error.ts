/**
 * shutdown-error
 *
 * Single source of truth for all shutdown error detection across the backend.
 * Consolidates previously divergent implementations in orchestrator, agent-worker,
 * and route handler layers into one module reusable by any future module
 * (scheduler, monitor, etc.).
 *
 * NOT responsible for performing the shutdown or logging shutdown events.
 */

/**
 * Common prefix for all orchestrator-layer shutdown errors.
 * Thrown by task-executor, continuation-executor, and execution-resume as
 * `${SHUTDOWN_ERROR_MESSAGE}, cannot ${action}`.
 *
 * NOTE: This prefix string must stay in sync with usages in
 * `orchestrator/task-executor.ts`, `orchestrator/continuation-executor.ts`,
 * and `orchestrator/execution-resume.ts`. / orchestrator 系の各 executor が
 * このプレフィックスでエラーを throw するため変更時は一括更新が必要。
 */
export const SHUTDOWN_ERROR_MESSAGE = 'Server is shutting down';

/**
 * Exact error message emitted by the worker manager during graceful shutdown.
 * `worker-shutdown.ts` throws `new Error(WORKER_SHUTDOWN_ERROR_MESSAGE)` via
 * `rejectAllPendingRequests`.
 *
 * NOTE: Must stay in sync with `services/agents/agent-worker/worker-shutdown.ts`.
 * The value differs from SHUTDOWN_ERROR_MESSAGE intentionally — they originate
 * from different layers. / worker-shutdown.ts が literal で throw するため、
 * この値と worker-shutdown.ts を同時に変更しないと検出が壊れる。
 */
export const WORKER_SHUTDOWN_ERROR_MESSAGE = 'Manager is shutting down';

/**
 * Builds a full shutdown error message for the given action.
 *
 * @param action - The action that was prevented (e.g. `'start new execution'`) / 阻止されたアクションの説明
 * @returns Full error message string of the form `'Server is shutting down, cannot <action>'` / 完全なエラーメッセージ文字列
 */
export function buildShutdownErrorMessage(action: string): string {
  return `${SHUTDOWN_ERROR_MESSAGE}, cannot ${action}`;
}

/**
 * Exhaustive list of action strings passed to `buildShutdownErrorMessage`.
 * Add a new entry here when introducing a new executor that can be blocked by shutdown.
 *
 * NOTE: The three executor files that consume these values hard-code the same strings
 * (task-executor.ts, continuation-executor.ts, execution-resume.ts). The generated
 * truth-table test (`shutdown-error.generated.test.ts`) validates that each action
 * round-trips through `buildShutdownErrorMessage` + `isShutdownError` correctly,
 * so divergence is caught by CI without modifying the executor files. / 各 executor
 * が同じ文字列を独立して持つ設計は意図的（可読性優先）。ドリフト検出は生成テストが担保。
 */
export const SHUTDOWN_ACTIONS = [
  'start new execution',
  'continue execution',
  'resume execution',
] as const;

/**
 * Returns true when the given value is a shutdown error from any layer of the backend.
 *
 * Detection logic:
 * - Exact match for `WORKER_SHUTDOWN_ERROR_MESSAGE` ('Manager is shutting down') —
 *   covers the agent-worker IPC message. Intentionally exact: a suffix-extended
 *   variant (e.g. '…— extra text') must NOT be treated as a shutdown error.
 * - Prefix match for `SHUTDOWN_ERROR_MESSAGE` ('Server is shutting down') —
 *   covers the orchestrator family (`'…, cannot start/continue/resume execution'`).
 *
 * Accepts `unknown` because catch-clause values are `unknown` in TypeScript strict mode.
 *
 * @param error - Value caught from a catch clause / catch 節の値
 * @returns Whether the error is a shutdown error from any layer / いずれかのレイヤーのシャットダウンエラーかどうか
 */
export function isShutdownError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === WORKER_SHUTDOWN_ERROR_MESSAGE ||
      error.message.startsWith(SHUTDOWN_ERROR_MESSAGE))
  );
}
