/**
 * Standardized API Response Utilities
 *
 * All routes should use these helpers for consistent response shapes.
 * Success: { success: true, data?, message? }
 * Error: { success: false, error, code? }
 * Paginated: { success: true, data, pagination: { total, limit, offset } }
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: string;
}

export interface PaginatedResponse<T = unknown> extends ApiResponse<T[]> {
  pagination: { total: number; limit: number; offset: number };
}

/** Wrap a successful result in the standard envelope. */
export function createResponse<T>(data: T, message?: string): ApiResponse<T> {
  return { success: true, data, message };
}

/** Wrap an error in the standard envelope. */
export function createErrorResponse(error: string, code?: string): ApiResponse {
  return { success: false, error, code };
}

/** Wrap a paginated list in the standard envelope. */
export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  limit: number,
  offset: number,
): PaginatedResponse<T> {
  return {
    success: true,
    data,
    pagination: { total, limit, offset },
  };
}
