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
 * Detect if an error is a Prisma-related error
 */
function isPrismaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const name = error.name || "";
  const message = error.message || "";

  // Prismaエラーのクラス名検出
  if (name.includes("PrismaClient")) return true;
  if (name.includes("PrismaKnown")) return true;
  if (name.includes("PrismaUnknown")) return true;
  if (name.includes("PrismaValidation")) return true;

  // Prismaエラーメッセージの検出
  if (message.includes("Invalid `prisma")) return true;
  if (message.includes("prisma.") && message.includes("invocation")) return true;
  if (message.includes("Prisma schema")) return true;
  if (message.includes("Unknown argument")) return true;
  if (message.includes("Database connection")) return true;
  if (message.includes("prisma client")) return true;

  // 追加のPrismaエラーパターン
  if (message.includes("PrismaClientKnownRequestError")) return true;
  if (message.includes("PrismaClientUnknownRequestError")) return true;
  if (message.includes("PrismaClientRustPanicError")) return true;
  if (message.includes("PrismaClientInitializationError")) return true;
  if (message.includes("PrismaClientValidationError")) return true;

  // スタックトレースベースのフォールバック検出
  const stack = error.stack || "";
  if (stack.includes("@prisma/client")) return true;
  if (stack.includes("PrismaClient")) return true;

  // Prisma固有のエラーコードプロパティ（P2001-P2034等）
  if ("code" in error && typeof (error as Record<string, unknown>).code === "string") {
    const code = (error as Record<string, unknown>).code as string;
    if (/^P\d{4}$/.test(code)) return true;
  }

  return false;
}

/**
 * Error handler middleware plugin
 */
export const errorHandler = new Elysia({ name: "error-handler" }).onError(
  ({ code, error, set }) => {
    // Ensure JSON content type for all error responses
    set.headers["Content-Type"] = "application/json; charset=utf-8";

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

    // Prisma related errors (all types)
    if (isPrismaError(error)) {
      console.error("[Prisma Error]", error);
      set.status = 400;
      return {
        error: "データベースクエリエラー",
        details: error instanceof Error ? error.message : String(error),
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
