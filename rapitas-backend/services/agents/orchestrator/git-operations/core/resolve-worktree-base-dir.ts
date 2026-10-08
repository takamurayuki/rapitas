/**
 * GitOperations — Worktree Base Directory Resolver
 *
 * Picks the repository root that owns a worktree so removeWorktree's path-safety guard
 * is evaluated against the right baseDir. Never relaxes the guard itself and never runs git.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { WORKTREE_DIR, normalizePath } from './safety';

/**
 * Resolve the baseDir to use when removing a worktree.
 *
 * @param worktreePath - Worktree to remove / 削除対象の worktree パス
 * @param candidates - Preferred baseDirs in priority order; empty values are ignored / 優先順の baseDir 候補（空値は無視）
 * @returns A candidate that contains the worktree, else the parent repo (has `.git`) inferred from the path, else the first candidate / 候補、推定した親リポジトリ、または先頭候補
 */
export function resolveWorktreeBaseDir(
  worktreePath: string,
  candidates: ReadonlyArray<string | null | undefined>,
): string {
  const usable = candidates.filter((c): c is string => typeof c === 'string' && c.length > 0);
  const fallback = usable[0] ?? '';

  // NOTE: Traversal paths are left to the guard; resolving them here would bypass its check.
  if (worktreePath.includes('..')) return fallback;

  const normalizedWT = normalizePath(worktreePath);
  for (const c of usable) {
    if (normalizedWT.startsWith(normalizePath(join(c, WORKTREE_DIR)) + '/')) return c;
  }

  const marker = `/${WORKTREE_DIR}/`;
  const idx = normalizedWT.indexOf(marker);
  if (idx <= 0) return fallback;

  // NOTE: Require a real repo (.git) so an arbitrary directory is never promoted to baseDir.
  const parent = normalizedWT.slice(0, idx);
  return existsSync(join(parent, '.git')) ? parent : fallback;
}
