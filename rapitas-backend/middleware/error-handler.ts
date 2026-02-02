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
  ({ code, error, set }: { code: string; error: Error; set: { status: number } }) => {
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
        details: error.message,
      };
    }

    // Not found
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "リソースが見つかりません" };
    }

    // Generic server error
    console.error("[Error]", error);
    set.status = 500;
    return { error: "サーバーエラーが発生しました" };
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
