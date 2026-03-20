/**
 * ExecutionFileLogger / LogFileManager
 *
 * File-system helpers for listing, retrieving, and cleaning up execution log
 * files.  Not responsible for log entry collection or formatting.
 */

import { readdir, stat, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

/** Default log directory — mirrors DEFAULT_CONFIG.logDir to avoid a circular import. */
const DEFAULT_LOG_DIR = path.join(process.cwd(), 'logs', 'agent-executions');

/** Metadata about a single execution log file on disk. */
export type LogFileMeta = {
  filename: string;
  path: string;
  size: number;
  mtime: Date;
};

/**
 * List all execution log files in the given directory, sorted newest-first.
 *
 * @param logDir - Directory to scan (defaults to the standard log directory) / スキャンするディレクトリ（省略時はデフォルトディレクトリ）
 * @returns Array of log file metadata / ログファイルメタデータの配列
 */
export async function listExecutionLogFiles(logDir?: string): Promise<LogFileMeta[]> {
  const dir = logDir || DEFAULT_LOG_DIR;
  try {
    if (!existsSync(dir)) return [];

    const files = await readdir(dir);
    const logFiles = files.filter((f) => f.startsWith('exec-') && f.endsWith('.log'));

    const results = await Promise.all(
      logFiles.map(async (f) => {
        const fullPath = path.join(dir, f);
        const fileStat = await stat(fullPath);
        return {
          filename: f,
          path: fullPath,
          size: fileStat.size,
          mtime: fileStat.mtime,
        };
      }),
    );

    results.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return results;
  } catch {
    return [];
  }
}

/**
 * Find the log file for a specific execution ID.
 *
 * @param executionId - The numeric execution ID to look up / 検索する実行ID
 * @param logDir - Directory to search (defaults to the standard log directory) / 検索するディレクトリ（省略時はデフォルトディレクトリ）
 * @returns Log file metadata, or null if not found / ログファイルメタデータ（見つからない場合はnull）
 */
export async function getExecutionLogFile(
  executionId: number,
  logDir?: string,
): Promise<LogFileMeta | null> {
  const dir = logDir || DEFAULT_LOG_DIR;
  try {
    if (!existsSync(dir)) return null;

    const files = await readdir(dir);
    const matchingFile = files.find(
      (f) => f.startsWith(`exec-${executionId}-`) && f.endsWith('.log'),
    );

    if (!matchingFile) return null;

    const fullPath = path.join(dir, matchingFile);
    const fileStat = await stat(fullPath);
    return {
      filename: matchingFile,
      path: fullPath,
      size: fileStat.size,
      mtime: fileStat.mtime,
    };
  } catch {
    return null;
  }
}

/**
 * Delete the oldest log files when the total count exceeds the allowed maximum.
 *
 * @param logDir - Directory to clean up / クリーンアップするディレクトリ
 * @param maxLogFiles - Maximum number of files to retain / 保持するファイルの最大数
 */
export async function cleanupOldLogs(logDir: string, maxLogFiles: number): Promise<void> {
  try {
    const files = await readdir(logDir);
    const logFiles = files
      .filter((f) => f.startsWith('exec-') && f.endsWith('.log'))
      .map((f) => path.join(logDir, f));

    if (logFiles.length <= maxLogFiles) return;

    const fileStats = await Promise.all(
      logFiles.map(async (f) => ({
        path: f,
        mtime: (await stat(f)).mtime,
      })),
    );
    fileStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

    const deleteCount = fileStats.length - maxLogFiles;
    for (let i = 0; i < deleteCount; i++) {
      try {
        await unlink(fileStats[i].path);
      } catch {
        // Ignore individual file deletion failures — stale entries are not fatal.
      }
    }
  } catch {
    // Ignore directory-level errors — cleanup failure should not break the caller.
  }
}
