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
 * Make a Windows-style path parseable on either platform.
 *
 * NOTE: normalizePath converts backslashes AFTER resolve(), and on POSIX
 * resolve() treats `\` as an ordinary filename character — so a Windows path
 * arrives as ONE relative segment and gets prefixed with the cwd, which makes
 * every subsequent `.worktrees` inference point at a directory that cannot
 * exist. Worktree paths come from the database, recorded by whichever host
 * created them, so the input spelling is not tied to the running platform.
 * Measured 2026-10-11: this is why `handles backslash separators` passed on
 * Windows and failed on Linux CI.
 *
 * @param p - Possibly Windows-spelled path / Windows 形式を含みうるパス
 * @returns The same path with forward slashes / スラッシュに統一したパス
 */
function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

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

  const normalizedWT = normalizePath(toForwardSlashes(worktreePath));

  // NOTE: Refuse a path that names the `.worktrees` container itself rather than
  // a worktree inside it. Its parent IS a repo, so every check below would pass
  // and the caller would be handed a baseDir whose removal target is the whole
  // container — every worktree of that repo at once.
  // (normalizePath resolves away any trailing slash, so one endsWith covers both spellings.)
  if (normalizedWT.endsWith(`/${WORKTREE_DIR}`)) return fallback;

  for (const c of usable) {
    // Candidates come from the same database rows, so they get the same treatment.
    if (normalizedWT.startsWith(normalizePath(toForwardSlashes(join(c, WORKTREE_DIR))) + '/'))
      return c;
  }

  const marker = `/${WORKTREE_DIR}/`;
  const idx = normalizedWT.indexOf(marker);
  if (idx <= 0) return fallback;

  // NOTE: Require a real repo (.git) so an arbitrary directory is never promoted to baseDir.
  const parent = normalizedWT.slice(0, idx);
  return existsSync(join(parent, '.git')) ? parent : fallback;
}
