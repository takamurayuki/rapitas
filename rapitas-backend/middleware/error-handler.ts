/**
 * Error Handler Middleware
 * Centralized error handling for the API
 */
import { Elysia } from 'elysia';
import { createLogger } from '../config/logger';

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
export const errorHandler = new Elysia({ name: 'error-handler' }).onError(
  ({ code, error, set }) => {
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
      set.status = 400;
      return {
        error: 'Validation error',
        details:
          'message' in error && typeof error.message === 'string' ? error.message : String(error),
      };
    }

    // Not found
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: 'Resource not found' };
    }

    // Prisma related errors (all types)
    if (isPrismaError(error)) {
      log.error({ err: error }, 'Prisma Error');
      set.status = 400;
      return {
        error: 'Database query error',
      };
    }

    // Generic server error
    log.error({ err: error }, 'Unhandled error');
    set.status = 500;

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
