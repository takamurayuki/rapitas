/**
 * error-messages
 *
 * Single source of truth for common error message strings used across routes,
 * services, and middleware. Values must be byte-identical to the original
 * inline literals so existing API responses and tests remain unchanged.
 *
 * Add new entries here when the same message string appears in 2 or more files.
 * Do NOT change values without auditing every consumer (test assertions depend
 * on exact byte content).
 */

/** Response message when a requested task cannot be found by ID. */
export const TASK_NOT_FOUND = 'タスクが見つかりません' as const;

/** Response message when a supplied ID is not a valid integer. */
export const INVALID_ID = '無効なIDです' as const;

/** Default message for NotFoundError — mirrors the class default in error-handler.ts. */
export const RESOURCE_NOT_FOUND = 'Resource not found' as const;

/** Default message for ValidationError — mirrors the class default in error-handler.ts. */
export const VALIDATION_ERROR = 'Validation error' as const;
