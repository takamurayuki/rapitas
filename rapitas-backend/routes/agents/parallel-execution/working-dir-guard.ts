/**
 * WorkingDirGuard
 *
 * Validates that a task's working directory is configured and does not point
 * at the rapitas source tree. Centralises the repeated safety check used
 * across create-pr, approve-merge, and execute routes.
 */
import { join } from 'path';
import { getProjectRoot } from '../../../config';

/** Result returned by validateWorkingDirectory. */
export type WorkingDirValidation =
  | { ok: true; workingDirectory: string }
  | { ok: false; error: string };

/**
 * Validate that the theme's working directory is set and does not overlap
 * with the rapitas project root.
 *
 * @param taskId - Task ID for log messages / ログ用タスクID
 * @param workingDirectory - Raw working directory from the task's theme / テーマの作業ディレクトリ
 * @param operation - Short operation label for log context / ログ用操作ラベル
 * @returns Validation result / バリデーション結果
 */
export function validateWorkingDirectory(
  taskId: number,
  workingDirectory: string | null | undefined,
  operation: string,
): WorkingDirValidation {
  if (!workingDirectory) {
    return {
      ok: false,
      error:
        'Task theme must have workingDirectory configured. Please set the working directory in theme settings.',
    };
  }

  const projectRoot = getProjectRoot();
  if (
    workingDirectory === projectRoot ||
    workingDirectory.startsWith(join(projectRoot, 'rapitas-'))
  ) {
    return {
      ok: false,
      error:
        'Working directory cannot be the rapitas project itself. Please configure a different working directory in theme settings.',
    };
  }

  return { ok: true, workingDirectory };
}
