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
  .get("/api/execution-logs", async ({  query  }: any) => {
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
