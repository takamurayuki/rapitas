/**
 * Error Handler Middleware
 * Centralized error handling for the API
 */
import { Elysia } from 'elysia';
import { createLogger } from '../config/logger';
import { HTTP_STATUS } from '../utils/common/http-status';
import {
  RESOURCE_NOT_FOUND,
  VALIDATION_ERROR,
  JSON_PARSE_ERROR,
} from '../utils/common/error-messages';

const log = createLogger('error-handler');

/**
 * Custom application error class
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Not Found Error
 */
export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', code?: string) {
    super(404, message, code);
    this.name = 'NotFoundError';
  }
}

/**
 * Validation Error
 */
export class ValidationError extends AppError {
  constructor(message: string = 'Validation error', code?: string) {
    super(400, message, code);
    this.name = 'ValidationError';
  }
}

/**
 * Conflict Error (duplicate resource, unique constraint violation)
 */
export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists', code?: string) {
    super(409, message, code);
    this.name = 'ConflictError';
  }
}

/**
 * Authentication Error
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', code?: string) {
    super(401, message, code);
    this.name = 'AuthenticationError';
  }
}

/**
 * Parse and validate a numeric ID from route params.
 * Throws ValidationError if invalid.
 */
export function parseId(value: string | number, label: string = 'ID'): number {
  const id = typeof value === 'number' ? value : parseInt(value, 10);
  if (isNaN(id) || id <= 0) {
    throw new ValidationError(`Invalid ${label}: ${value}`, 'INVALID_ID');
  }
  return id;
}

/**
 * Detect if an error is a Prisma-related error
 */
function isPrismaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const name = error.name || '';
  const message = error.message || '';

  if (name.includes('PrismaClient')) return true;
  if (name.includes('PrismaKnown')) return true;
  if (name.includes('PrismaUnknown')) return true;
  if (name.includes('PrismaValidation')) return true;

  if (message.includes('Invalid `prisma')) return true;
  if (message.includes('prisma.') && message.includes('invocation')) return true;
  if (message.includes('Prisma schema')) return true;
  if (message.includes('Unknown argument')) return true;
  if (message.includes('Database connection')) return true;
  if (message.includes('prisma client')) return true;

  if (message.includes('PrismaClientKnownRequestError')) return true;
  if (message.includes('PrismaClientUnknownRequestError')) return true;
  if (message.includes('PrismaClientRustPanicError')) return true;
  if (message.includes('PrismaClientInitializationError')) return true;
  if (message.includes('PrismaClientValidationError')) return true;

  // NOTE: Fallback - Prisma errors may not always have recognizable class names or messages
  const stack = error.stack || '';
  if (stack.includes('@prisma/client')) return true;
  if (stack.includes('PrismaClient')) return true;

  if ('code' in error && typeof (error as Record<string, unknown>).code === 'string') {
    const code = (error as Record<string, unknown>).code as string;
    if (/^P\d{4}$/.test(code)) return true;
  }

  return false;
}

/**
 * Error handler middleware plugin
 */
// NOTE: `as: 'global'` is REQUIRED. Elysia 1.x scopes lifecycle hooks to the
// defining plugin by default, so without it this onError only caught errors
// thrown inside the (empty) error-handler plugin — every route's AppError fell
// through to Elysia's default handler and returned the raw message as HTTP 500
// (e.g. a ValidationError surfaced as 500 "無効なIDです" instead of 400 JSON).
export const errorHandler = new Elysia({ name: 'error-handler' }).onError(
  { as: 'global' },
  ({ code, error, set, path, request }) => {
    // Ensure JSON content type for all error responses
    set.headers['Content-Type'] = 'application/json; charset=utf-8';

    // Custom AppError
    if (error instanceof AppError) {
      set.status = error.statusCode;
      return {
        error: error.message,
        code: error.code,
      };
    }

    // Elysia validation error
    if (code === 'VALIDATION') {
      set.status = HTTP_STATUS.BAD_REQUEST;
      return {
        error: VALIDATION_ERROR,
        details:
          'message' in error && typeof error.message === 'string' ? error.message : String(error),
      };
    }

    // Not found
    if (code === 'NOT_FOUND') {
      set.status = HTTP_STATUS.NOT_FOUND;
      return { error: RESOURCE_NOT_FOUND };
    }

    // Request body is not valid JSON. Elysia's ParseError already carries
    // status 400, but without this branch it fell through to the generic
    // fallback below, which overwrote it with 500 and logged it as an
    // unclassified server error (K-6588, K-6729, #683).
    if (code === 'PARSE') {
      const cause = error.cause instanceof Error ? error.cause.message : undefined;
      log.warn({ path, method: request.method, cause }, 'Failed to parse JSON request body');
      set.status = HTTP_STATUS.BAD_REQUEST;
      return { error: JSON_PARSE_ERROR };
    }

    // Prisma related errors (all types)
    if (isPrismaError(error)) {
      log.error({ err: error }, 'Prisma Error');
      set.status = HTTP_STATUS.BAD_REQUEST;
      return {
        error: 'Database query error',
      };
    }

    // Generic server error
    log.error({ err: error }, 'Unhandled error');
    set.status = HTTP_STATUS.INTERNAL_SERVER_ERROR;

    return {
      error: 'Server error occurred',
    };
  },
);

/**
 * Global error handlers for uncaught exceptions
 * Should be called once at application startup
 */
export function setupGlobalErrorHandlers(): void {
  process.on('uncaughtException', (error) => {
    log.fatal({ err: error }, 'Uncaught Exception');
  });

  process.on('unhandledRejection', (reason, promise) => {
    log.fatal({ reason, promise }, 'Unhandled Rejection');
  });
}
