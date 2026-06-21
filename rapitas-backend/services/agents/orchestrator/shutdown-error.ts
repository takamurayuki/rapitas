/**
 * shutdown-error
 *
 * Centralizes the shutdown error message constant and related helpers for the
 * orchestrator layer. All "Server is shutting down" strings must originate here
 * so that a single change propagates everywhere.
 */

/** Common prefix for all orchestrator-layer shutdown errors. */
export const SHUTDOWN_ERROR_MESSAGE = 'Server is shutting down';

/**
 * Builds a full shutdown error message for the given action.
 *
 * @param action - The action that was prevented (e.g. `'start new execution'`) / 阻止されたアクションの説明
 * @returns Full error message string / 完全なエラーメッセージ文字列
 */
export function buildShutdownErrorMessage(action: string): string {
  return `${SHUTDOWN_ERROR_MESSAGE}, cannot ${action}`;
}

/**
 * Returns true when the given value is a shutdown error thrown by the orchestrator.
 *
 * Accepts `unknown` because catch-clause values are `unknown` in TypeScript strict mode.
 *
 * @param error - Value caught from a catch clause / catch 節の値
 * @returns Whether the error is a shutdown error / シャットダウンエラーかどうか
 */
export function isShutdownError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(SHUTDOWN_ERROR_MESSAGE);
}
