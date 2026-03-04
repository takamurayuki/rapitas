#!/usr/bin/env bun
/**
 * CI/CD用のスタブバックエンドサーバー
 * 最小限のAPIエンドポイントを提供して、フロントエンドが動作するようにする
 */
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { createLogger } from "./config/logger";

const log = createLogger("stub-server");

const app = new Elysia();

// CORS設定
app.use(cors());

// ヘルスチェックエンドポイント
app.get("/health", () => ({
  status: "ok",
  message: "CI/CD Stub Backend",
  timestamp: new Date().toISOString(),
}));

// 基本的なAPIレスポンス
const stubResponse = {
  message: "This is a stub response from CI/CD build. Database not connected.",
  data: [],
};

// タスク関連のスタブエンドポイント
app.get("/tasks", () => stubResponse);
app.get("/tasks/:id", (context) => ({
  ...stubResponse,
  id: context.params.id,
  title: "Stub Task",
}));

// テーマ関連のスタブエンドポイント
app.get("/themes", () => stubResponse);
app.get("/themes/:id", (context) => ({
  ...stubResponse,
  id: context.params.id,
  name: "Stub Theme",
}));

// プロジェクト関連のスタブエンドポイント
app.get("/projects", () => stubResponse);
app.get("/projects/:id", (context) => ({
  ...stubResponse,
  id: context.params.id,
  name: "Stub Project",
}));

// 設定関連のスタブエンドポイント
app.get("/settings", () => ({
  autoResumeInterruptedTasks: false, // 自動再開を無効化（スタブ環境では不要）
  enableDeveloperMode: false,
  enableAgentExecution: false,
  enableParallelExecution: false,
  maxParallelExecutions: 1,
  autoRetryOnRateLimit: false,
  rateLimitRetryDelay: 5,
}));

// エージェント実行関連のスタブエンドポイント
app.get("/agents/resumable-executions", () => []); // 再開可能な実行はなし

app.post("/agents/executions/:id/resume", (context) => ({
  success: false,
  message: "Stub backend: execution resume not available",
  executionId: context.params.id,
}));

app.post("/agents/executions/:id/acknowledge", (context) => ({
  success: true,
  message: "Acknowledged (stub)",
  executionId: context.params.id,
}));

// SSEスタブエンドポイント
app.get("/sse", (context) => {
  const { set } = context;
  set.headers["Content-Type"] = "text/event-stream";
  set.headers["Cache-Control"] = "no-cache";
  set.headers["Connection"] = "keep-alive";

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          'data: {"type":"connected","message":"CI/CD Stub SSE"}\n\n',
        );
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    },
  );
});

// 404ハンドラー
app.onError(({ code, error }) => {
  if (code === "NOT_FOUND") {
    return {
      error: "Not Found",
      message: "This endpoint is not available in CI/CD stub backend",
      stub: true,
    };
  }
  return {
    error: error instanceof Error ? error.message : String(error),
    stub: true,
  };
});

// Check for version flag (for CI/CD build testing)
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  log.info("CI/CD Stub Backend v1.0.0");
  process.exit(0);
}

// Check for CI environment flag
const isCI = process.env.CI === "true";
const CI_TIMEOUT = 5000; // 5 seconds timeout in CI

// サーバー起動
const PORT = parseInt(process.env.PORT || "3001", 10);
app.listen({
  port: PORT,
  reusePort: true,
});

log.info(`CI/CD Stub Backend running on http://localhost:${PORT}`);
log.warn("This is a minimal stub server for CI/CD builds.");
log.warn("Database functionality is not available.");

// Auto-exit after timeout in CI environment
if (isCI) {
  log.info({ timeoutMs: CI_TIMEOUT }, `CI mode: Auto-exit after ${CI_TIMEOUT}ms`);
  setTimeout(() => {
    log.info("CI timeout reached, exiting...");
    process.exit(0);
  }, CI_TIMEOUT);
}

// グレースフルシャットダウン
process.on("SIGTERM", () => {
  log.info("Received SIGTERM, shutting down...");
  process.exit(0);
});

process.on("SIGINT", () => {
  log.info("Received SIGINT, shutting down...");
  process.exit(0);
});
