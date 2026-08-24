/**
 * GitOperations — Worktree Operations (barrel)
 *
 * Compatibility re-export window for the worktree lifecycle modules; all logic
 * lives in dir-remove-retry.ts / worktree-create.ts / worktree-remove.ts /
 * worktree-cleanup.ts. Kept so existing callers importing from
 * './worktree-ops' keep working unchanged.
 */

export { ensureGitRepository, validateAndSetupRemote } from './repository-setup';
export { rmDirWithRetry } from './dir-remove-retry';
export { createWorktree } from './worktree-create';
export { removeWorktree } from './worktree-remove';
export { cleanupStaleWorktrees, cleanupOrphanedWorktrees } from './worktree-cleanup';
