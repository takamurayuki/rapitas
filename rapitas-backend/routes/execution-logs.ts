/**
 * Execution Log File API Routes
 * AI agent execution log file access endpoints
 */
import { Elysia } from "elysia";
import { readFile } from "fs/promises";
import {
  listExecutionLogFiles,
  getExecutionLogFile,
} from "../services/agents/execution-file-logger";

export const executionLogsRoutes = new Elysia()
  /**
   * 実行ログファイルの一覧を取得
   */
  .get("/api/execution-logs", async ({ query }: { query: any }) => {
    const limit = Number(query?.limit) || 50;
    const offset = Number(query?.offset) || 0;

    const allFiles = await listExecutionLogFiles();
    const paginatedFiles = allFiles.slice(offset, offset + limit);

    return {
      total: allFiles.length,
      offset,
      limit,
      files: paginatedFiles.map((f) => ({
        filename: f.filename,
        size: f.size,
        sizeHuman: formatFileSize(f.size),
        mtime: f.mtime.toISOString(),
        executionId: extractExecutionId(f.filename),
      })),
    };
  })

  /**
   * 特定の実行IDのログファイルを取得
   */
  .get("/api/execution-logs/:executionId", async ({ params, query, set }: { params: { executionId: string }; query: any; set: any }) => {
    const executionId = Number(params.executionId);
    if (isNaN(executionId)) {
      set.status = 400;
      return { error: "Invalid execution ID" };
    }

    const logFile = await getExecutionLogFile(executionId);
    if (!logFile) {
      set.status = 404;
      return { error: `No log file found for execution ${executionId}` };
    }

    const format = query?.format || "text";

    if (format === "json") {
      // JSON形式のサマリーを返す
      const content = await readFile(logFile.path, "utf-8");
      const jsonSection = extractJsonSection(content);
      if (jsonSection) {
        return {
          executionId,
          filename: logFile.filename,
          size: logFile.size,
          mtime: logFile.mtime.toISOString(),
          data: JSON.parse(jsonSection),
        };
      }
      set.status = 500;
      return { error: "Failed to extract JSON section from log file" };
    }

    // テキスト形式でログファイルの内容を返す
    const content = await readFile(logFile.path, "utf-8");
    return {
      executionId,
      filename: logFile.filename,
      size: logFile.size,
      sizeHuman: formatFileSize(logFile.size),
      mtime: logFile.mtime.toISOString(),
      content,
    };
  })

  /**
   * 特定の実行IDのログファイルをダウンロード
   */
  .get("/api/execution-logs/:executionId/download", async ({ params, set }: { params: { executionId: string }; set: any }) => {
    const executionId = Number(params.executionId);
    if (isNaN(executionId)) {
      set.status = 400;
      return { error: "Invalid execution ID" };
    }

    const logFile = await getExecutionLogFile(executionId);
    if (!logFile) {
      set.status = 404;
      return { error: `No log file found for execution ${executionId}` };
    }

    const content = await readFile(logFile.path, "utf-8");
    set.headers["Content-Type"] = "text/plain; charset=utf-8";
    set.headers["Content-Disposition"] = `attachment; filename="${logFile.filename}"`;
    return content;
  })

  /**
   * 特定の実行IDのエラーサマリーのみ取得
   */
  .get("/api/execution-logs/:executionId/errors", async ({ params, set }: { params: { executionId: string }; set: any }) => {
    const executionId = Number(params.executionId);
    if (isNaN(executionId)) {
      set.status = 400;
      return { error: "Invalid execution ID" };
    }

    const logFile = await getExecutionLogFile(executionId);
    if (!logFile) {
      set.status = 404;
      return { error: `No log file found for execution ${executionId}` };
    }

    const content = await readFile(logFile.path, "utf-8");
    const jsonSection = extractJsonSection(content);
    if (!jsonSection) {
      set.status = 500;
      return { error: "Failed to extract data from log file" };
    }

    const data = JSON.parse(jsonSection);
    return {
      executionId,
      summary: data.summary,
      errors: data.errors || [],
      errorCount: data.summary?.errorCount || 0,
      warningCount: data.summary?.warningCount || 0,
    };
  });

/**
 * ファイルサイズを人間が読みやすい形式にフォーマット
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * ファイル名から実行IDを抽出
 */
function extractExecutionId(filename: string): number | null {
  const match = filename.match(/^exec-(\d+)-/);
  return match ? Number(match[1]) : null;
}

/**
 * ログファイルからJSON構造化データセクションを抽出
 */
function extractJsonSection(content: string): string | null {
  const jsonMarker = "[STRUCTURED DATA (JSON)]";
  const jsonStart = content.indexOf(jsonMarker);
  if (jsonStart === -1) return null;

  // マーカー行の後の区切り線をスキップしてJSONを探す
  const afterMarker = content.substring(jsonStart + jsonMarker.length);
  const jsonContentStart = afterMarker.indexOf("{");
  if (jsonContentStart === -1) return null;

  const jsonContent = afterMarker.substring(jsonContentStart).trim();
  return jsonContent;
}
