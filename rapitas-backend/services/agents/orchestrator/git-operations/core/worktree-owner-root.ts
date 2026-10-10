/**
 * WorktreeOwnerRoot
 *
 * Derives the repository root that owns a worktree path, so cleanup can be
 * scoped per worktree instead of per caller.
 * Not responsible for deciding whether the path is safe to delete — that stays
 * with isPathSafeForWorktreeOperation in ./safety.ts.
 */

import { WORKTREE_DIR } from './safety';

/** `/.worktrees/` with separators normalised, matched as a whole segment. */
const SEGMENT = `/${WORKTREE_DIR.replace(/\\/g, '/')}/`;

/**
 * The repository root that owns `worktreePath`: everything before its first
 * `/.worktrees/` segment.
 *
 * NOTE: Derived from the path rather than taken from the caller because a
 * single cleanup pass spans several repositories. Measured 2026-10-10:
 * cleanupOrphanedWorktrees passed rapitas's root as the baseDir for EVERY
 * session, so every generated-project worktree was refused by the safety check,
 * its row's worktreePath was never cleared, and the same 70 rows across 5
 * projects were retried on every cycle in every running backend until the
 * event loop saturated. Generated projects also sit under different parents
 * (temporaid under C:\Projects, contextflow under C:\Users\ytaka\Projects), so
 * no single base can cover them.
 *
 * @param worktreePath - A worktree directory path / worktree のパス
 * @returns The owning repository root with forward slashes, or null when the
 *   path has no usable `.worktrees` segment / 所有リポジトリのルート、判定不能なら null
 */
export function resolveWorktreeOwnerRoot(worktreePath: string): string | null {
  if (typeof worktreePath !== 'string') return null;
  const normalized = worktreePath.trim().replace(/\\/g, '/');
  if (!normalized) return null;

  const idx = normalized.indexOf(SEGMENT);
  if (idx <= 0) return null;

  // Require a non-empty child after the segment: a path that stops at
  // `.worktrees` (with or without a trailing slash) names the container, and
  // treating its parent as the root would invite deleting every worktree.
  const child = normalized.slice(idx + SEGMENT.length);
  if (child.replace(/\/+$/, '') === '') return null;

  return normalized.slice(0, idx);
}
