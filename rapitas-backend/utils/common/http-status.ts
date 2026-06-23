/**
 * http-status
 *
 * Single source of truth for HTTP status code constants used across routes and
 * middleware. All numeric status literals in route handlers must be replaced
 * with named keys from this object.
 *
 * Using `as const` preserves literal types (e.g. `200` not `number`) so
 * assignment to Elysia's `set.status` remains type-compatible (literal → number
 * is always a widening, never an error).
 */

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export type HttpStatusCode = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];
