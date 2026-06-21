/**
 * Shutdown Error Utility
 *
 * Provides the single source of truth for the "Manager is shutting down" error
 * message and an `isShutdownError` predicate used across all execution catch handlers.
 * Not responsible for performing the shutdown itself.
 */

/**
 * The fixed error message emitted by `rejectAllPendingRequests` during graceful shutdown.
 *
 * NOTE: The string 'Manager is shutting down' is thrown in worker-shutdown.ts via
 * `rejectAllPendingRequests`. Update both sites together if this message ever changes.
 */
export const SHUTDOWN_ERROR_MESSAGE = 'Manager is shutting down';

/**
 * Returns true only when `error` is the specific Error thrown during a
 * graceful worker manager shutdown.
 *
 * @param error - Any caught value / 任意の catch 値
 * @returns `true` if the error is a shutdown-originated Error / シャットダウン起因の場合 true
 */
export function isShutdownError(error: unknown): boolean {
  return error instanceof Error && error.message === SHUTDOWN_ERROR_MESSAGE;
}
