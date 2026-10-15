/**
 * WorktreeGitList
 *
 * Reads git's own record of which worktrees are registered, for the cleanup
 * sweeps that reconcile it against the filesystem and the database.
 * Not responsible for deciding what may be removed — that stays with
 * ../core/safety.ts and the sweeps themselves.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizePath } from '../core/safety';

// NOTE: execFile (array-args, no shell) instead of exec (shell string) — branch
// names, paths, and other caller-controlled values are passed as literal argv
// elements, so shell metacharacters in them can't be interpreted. See
// services/github/gh-client.ts for the established pattern.
const execFileAsync = promisify(execFile);

/** Bounds a lock-contention or auth-prompt hang so cleanup can't stall startup. */
export const GIT_OP_TIMEOUT_MS = 60_000;

/** One entry of `git worktree list --porcelain`. */
export interface RegisteredWorktree {
  /**
   * The path exactly as git reported it. NOTE: Kept alongside `normalized`
   * because this is what gets handed back to git (and logged); normalizing it
   * first would silently change the argv of every removal.
   */
  path: string;
  /** The same path normalized, for comparison against other paths. */
  normalized: string;
}

/**
 * The worktrees git still has registered for a repository.
 *
 * @param baseDir - Repository root to query / 問い合わせ先のリポジトリルート
 * @returns One entry per registered worktree, in git's order / 登録済み worktree の一覧
 * @throws Whatever execFile rejects with (git missing, timeout, not a repo) / git 実行の失敗をそのまま投げる
 */
export async function listRegisteredWorktrees(baseDir: string): Promise<RegisteredWorktree[]> {
  const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
    cwd: baseDir,
    encoding: 'utf8',
    timeout: GIT_OP_TIMEOUT_MS,
  });

  const result: RegisteredWorktree[] = [];
  // Porcelain separates entries with a blank line; the `worktree <path>` line
  // is always first, but match it anywhere in the record rather than relying on
  // the ordering of the attribute lines that follow.
  for (const entry of stdout.split('\n\n').filter(Boolean)) {
    const path = entry.match(/^worktree\s+(.+)$/m)?.[1];
    if (path) result.push({ path, normalized: normalizePath(path) });
  }
  return result;
}

/**
 * Drop git's records of worktrees whose directory is already gone.
 *
 * @param baseDir - Repository root to prune / 対象のリポジトリルート
 */
export async function pruneWorktrees(baseDir: string): Promise<void> {
  await execFileAsync('git', ['worktree', 'prune'], { cwd: baseDir, timeout: GIT_OP_TIMEOUT_MS });
}
