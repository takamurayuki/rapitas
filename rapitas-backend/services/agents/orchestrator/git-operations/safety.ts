/**
 * GitOperations — Path Safety Utilities
 *
 * Validates that worktree paths are safely within the managed .worktrees/ directory
 * before any destructive filesystem or git operation.
 * Not responsible for executing git commands.
 */

import { join, resolve, normalize } from 'path';
import { createLogger } from '../../../../config/logger';

const logger = createLogger('git-operations/safety');

/** Directory name under baseDir where worktrees are created */
export const WORKTREE_DIR = '.worktrees';

/**
 * Normalize a path for consistent comparison across platforms.
 * Resolves to absolute path and uses forward slashes on all platforms.
 *
 * @param p - Path to normalize / 正規化するパス
 * @returns Normalized path with forward slashes / フォワードスラッシュに統一した正規化パス
 */
export function normalizePath(p: string): string {
  return resolve(normalize(p)).replace(/\\/g, '/');
}

/**
 * Validate that a path is safely within the managed .worktrees/ directory.
 * Prevents accidental deletion of the main repository or other directories.
 *
 * @param worktreePath - Path to validate / 検証するパス
 * @param baseDir - Main repository root / メインリポジトリのルート
 * @returns true if the path is safe to operate on / 操作が安全な場合true
 */
export function isPathSafeForWorktreeOperation(worktreePath: string, baseDir: string): boolean {
  const normalizedWT = normalizePath(worktreePath);
  const normalizedBase = normalizePath(baseDir);
  const normalizedWorktreeDir = normalizePath(join(baseDir, WORKTREE_DIR));

  // NOTE: Block if path is the main repository root itself — deleting it would destroy .git/
  if (normalizedWT === normalizedBase) {
    logger.error(`[SAFETY] Blocked operation on main repository root: ${worktreePath}`);
    return false;
  }

  // NOTE: Block if path is not under the managed .worktrees/ directory
  if (!normalizedWT.startsWith(normalizedWorktreeDir + '/')) {
    logger.error(
      `[SAFETY] Blocked operation on path outside .worktrees/: ${worktreePath} (expected under ${normalizedWorktreeDir})`,
    );
    return false;
  }

  // NOTE: Block if path contains traversal patterns that could escape the worktree directory
  if (worktreePath.includes('..')) {
    logger.error(`[SAFETY] Blocked operation on path with traversal: ${worktreePath}`);
    return false;
  }

  return true;
}
