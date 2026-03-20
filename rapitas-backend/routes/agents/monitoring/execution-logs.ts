/**
 * Execution Log File API Routes
 * AI agent execution log file access endpoints
 */
import { Elysia, t } from 'elysia';
import { readFile } from 'fs/promises';
import {
  listExecutionLogFiles,
  getExecutionLogFile,
} from '../../../services/agents/execution-file-logger';

export const executionLogsRoutes = new Elysia()
  /**
   * List execution log files.
   */
  .get('/api/execution-logs', async (context) => {
    const { query } = context;
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
   * Get log file for a specific execution ID.
   */
  .get('/api/execution-logs/:executionId', async (context) => {
    const { params, query, set } = context;
    const executionId = Number(params.executionId);
    if (isNaN(executionId)) {
      set.status = 400;
      return { error: 'Invalid execution ID' };
    }

    const logFile = await getExecutionLogFile(executionId);
    if (!logFile) {
      set.status = 404;
      return { error: `No log file found for execution ${executionId}` };
    }

    const format = query?.format || 'text';

    if (format === 'json') {
      // Return structured JSON summary
      const content = await readFile(logFile.path, 'utf-8');
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
      return { error: 'Failed to extract JSON section from log file' };
    }

    // Return log file content as plain text
    const content = await readFile(logFile.path, 'utf-8');
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
   * Download the log file for a specific execution ID.
   */
  .get('/api/execution-logs/:executionId/download', async (context) => {
    const { params, set } = context;
    const executionId = Number(params.executionId);
    if (isNaN(executionId)) {
      set.status = 400;
      return { error: 'Invalid execution ID' };
    }

    const logFile = await getExecutionLogFile(executionId);
    if (!logFile) {
      set.status = 404;
      return { error: `No log file found for execution ${executionId}` };
    }

    const content = await readFile(logFile.path, 'utf-8');
    set.headers['Content-Type'] = 'text/plain; charset=utf-8';

    // Encode filename for Content-Disposition header
    const encodedFileName = encodeURIComponent(logFile.filename);
    set.headers['Content-Disposition'] =
      `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`;
    return content;
  })

  /**
   * Get only the error summary for a specific execution ID.
   */
  .get('/api/execution-logs/:executionId/errors', async (context) => {
    const { params, set } = context;
    const executionId = Number(params.executionId);
    if (isNaN(executionId)) {
      set.status = 400;
      return { error: 'Invalid execution ID' };
    }

    const logFile = await getExecutionLogFile(executionId);
    if (!logFile) {
      set.status = 404;
      return { error: `No log file found for execution ${executionId}` };
    }

    const content = await readFile(logFile.path, 'utf-8');
    const jsonSection = extractJsonSection(content);
    if (!jsonSection) {
      set.status = 500;
      return { error: 'Failed to extract data from log file' };
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
 * Format file size into a human-readable string.
 *
 * @param bytes - File size in bytes / バイト単位のファイルサイズ
 * @returns Formatted size string (e.g. "1.5 MB") / フォーマット済みサイズ文字列
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Extract the execution ID from a log filename.
 *
 * @param filename - Log file name / ログファイル名
 * @returns Execution ID or null / 実行IDまたはnull
 */
function extractExecutionId(filename: string): number | null {
  const match = filename.match(/^exec-(\d+)-/);
  return match ? Number(match[1]) : null;
}

/**
 * Extract the structured JSON data section from a log file.
 *
 * @param content - Raw log file content / ログファイルの生のコンテンツ
 * @returns JSON string or null / JSON文字列またはnull
 */
function extractJsonSection(content: string): string | null {
  const jsonMarker = '[STRUCTURED DATA (JSON)]';
  const jsonStart = content.indexOf(jsonMarker);
  if (jsonStart === -1) return null;

  // Skip the separator line after the marker and locate the JSON body
  const afterMarker = content.substring(jsonStart + jsonMarker.length);
  const jsonContentStart = afterMarker.indexOf('{');
  if (jsonContentStart === -1) return null;

  const jsonContent = afterMarker.substring(jsonContentStart).trim();
  return jsonContent;
}
