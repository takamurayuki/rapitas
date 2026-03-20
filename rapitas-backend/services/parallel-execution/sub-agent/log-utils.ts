/**
 * SubAgentLogUtils
 *
 * Utility functions for managing per-task log files written by sub-agent
 * processes. Responsible only for path resolution and directory creation;
 * does not read or parse log content.
 */
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Return (and create if necessary) the directory used for sub-agent log files.
 *
 * @returns Absolute path to the log directory / ログディレクトリの絶対パス
 */
export function getLogDirectory(): string {
  const logDir = join(tmpdir(), 'rapitas-subagent-logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

/**
 * Return the log file path for a specific task execution.
 *
 * @param taskId - Task ID / タスクID
 * @param executionId - Execution ID within the task / タスク内の実行ID
 * @returns Absolute log file path / ログファイルの絶対パス
 */
export function getLogFilePath(taskId: number, executionId: number): string {
  return join(getLogDirectory(), `task-${taskId}-exec-${executionId}.log`);
}
