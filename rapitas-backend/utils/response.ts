/**
 * Standardized response utilities
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export const createResponse = <T>(data: T, message?: string): ApiResponse<T> => {
  return {
    success: true,
    data,
    message,
  };
};

export const createErrorResponse = (
  error: string,
  statusCode?: number,
): ApiResponse => {
  return {
    success: false,
    error,
  };
};