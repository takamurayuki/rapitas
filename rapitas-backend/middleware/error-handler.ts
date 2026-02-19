/**
 * Error Handler Middleware
 * Centralized error handling for the API
 */
import { Elysia } from "elysia";

/**
 * Custom application error class
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Not Found Error
 */
export class NotFoundError extends AppError {
  constructor(message: string = "リソースが見つかりません", code?: string) {
    super(404, message, code);
    this.name = "NotFoundError";
  }
}

/**
 * Validation Error
 */
export class ValidationError extends AppError {
  constructor(message: string = "バリデーションエラー", code?: string) {
    super(400, message, code);
    this.name = "ValidationError";
  }
}

/**
 * Error handler middleware plugin
 */
export const errorHandler = new Elysia({ name: "error-handler" }).onError(
  ({ code, error, set }) => {
    // Custom AppError
    if (error instanceof AppError) {
      set.status = error.statusCode;
      return {
        error: error.message,
        code: error.code,
      };
    }

    // Elysia validation error
    if (code === "VALIDATION") {
      set.status = 400;
      return {
        error: "バリデーションエラー",
        details: ('message' in error && typeof error.message === 'string') ? error.message : String(error),
      };
    }

    // Not found
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "リソースが見つかりません" };
    }

    // Prisma related errors
    if ('message' in error && typeof error.message === 'string' && error.message.includes("Invalid `prisma")) {
      console.error("[Prisma Error]", error);
      set.status = 400;
      return {
        error: "データベースクエリエラー",
        details: error.message
      };
    }

    // Generic server error
    console.error("[Error]", error);
    set.status = 500;

    // Ensure error response is always JSON
    const errorMessage = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : "サーバーエラーが発生しました";

    return {
      error: errorMessage,
      type: (error instanceof Error && error.name) ? error.name : "UnknownError"
    };
  }
);

/**
 * Global error handlers for uncaught exceptions
 * Should be called once at application startup
 */
export function setupGlobalErrorHandlers(): void {
  process.on("uncaughtException", (error) => {
    console.error("[FATAL] Uncaught Exception:", error);
    console.error("[FATAL] Stack:", error.stack);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("[FATAL] Unhandled Rejection at:", promise);
    console.error("[FATAL] Reason:", reason);
  });
}
