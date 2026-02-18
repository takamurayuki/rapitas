#!/usr/bin/env bun
/**
 * CI/CD用のスタブバックエンドサーバー
 * 最小限のAPIエンドポイントを提供して、フロントエンドが動作するようにする
 */
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";

const app = new Elysia();

// CORS設定
app.use(cors());

// ヘルスチェックエンドポイント
app.get("/health", () => ({
  status: "ok",
  message: "CI/CD Stub Backend",
  timestamp: new Date().toISOString()
}));

// 基本的なAPIレスポンス
const stubResponse = {
  message: "This is a stub response from CI/CD build. Database not connected.",
  data: []
};

// タスク関連のスタブエンドポイント
app.get("/tasks", () => stubResponse);
app.get("/tasks/:id", ({ params: { id } }: { params: { id: string } }) => ({
  ...stubResponse,
  id,
  title: "Stub Task"
}));

// テーマ関連のスタブエンドポイント
app.get("/themes", () => stubResponse);
app.get("/themes/:id", ({ params: { id } }: { params: { id: string } }) => ({
  ...stubResponse,
  id,
  name: "Stub Theme"
}));

// プロジェクト関連のスタブエンドポイント
app.get("/projects", () => stubResponse);
app.get("/projects/:id", ({ params: { id } }: { params: { id: string } }) => ({
  ...stubResponse,
  id,
  name: "Stub Project"
}));

// 設定関連のスタブエンドポイント
app.get("/settings", () => ({
  autoResumeInterruptedTasks: false,
  enableDeveloperMode: false,
  enableAgentExecution: false,
  enableParallelExecution: false,
  maxParallelExecutions: 1,
  autoRetryOnRateLimit: false,
  rateLimitRetryDelay: 5
}));

// SSEスタブエンドポイント
app.get("/sse", ({ set }: { set: { headers: Record<string, string> } }) => {
  set.headers["Content-Type"] = "text/event-stream";
  set.headers["Cache-Control"] = "no-cache";
  set.headers["Connection"] = "keep-alive";

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue("data: {\"type\":\"connected\",\"message\":\"CI/CD Stub SSE\"}\n\n");
      }
    }),
    {
      headers: set.headers
    }
  );
});

// 404ハンドラー
app.onError(({ code, error }: { code: string; error: Error }) => {
  if (code === "NOT_FOUND") {
    return {
      error: "Not Found",
      message: "This endpoint is not available in CI/CD stub backend",
      stub: true
    };
  }
  return {
    error: error.message,
    stub: true
  };
});

// Check for version flag (for CI/CD build testing)
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log("CI/CD Stub Backend v1.0.0");
  process.exit(0);
}

// Check for CI environment flag
const isCI = process.env.CI === "true";
const CI_TIMEOUT = 5000; // 5 seconds timeout in CI

// サーバー起動
const PORT = parseInt(process.env.PORT || "3001", 10);
app.listen({
  port: PORT,
  reusePort: true
});

console.log(`🚀 CI/CD Stub Backend running on http://localhost:${PORT}`);
console.log(`⚠️  This is a minimal stub server for CI/CD builds.`);
console.log(`⚠️  Database functionality is not available.`);

// Auto-exit after timeout in CI environment
if (isCI) {
  console.log(`⏱️  CI mode: Auto-exit after ${CI_TIMEOUT}ms`);
  setTimeout(() => {
    console.log("CI timeout reached, exiting...");
    process.exit(0);
  }, CI_TIMEOUT);
}

// グレースフルシャットダウン
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down...");
  process.exit(0);
});