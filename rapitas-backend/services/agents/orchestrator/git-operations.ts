/**
 * GitOperations — Public Entry Point
 *
 * Re-exports all public symbols from the git-operations sub-module
 * to maintain backward compatibility with existing imports.
 * Implementation has been split into:
 *   - git-operations/safety.ts        (path safety helpers)
 *   - git-operations/core-ops.ts      (diff, commit operations)
 *   - git-operations/branch-pr-ops.ts (branch, PR, merge, revert)
 *   - git-operations/worktree-ops.ts  (worktree lifecycle + remote setup)
 *   - git-operations/index.ts         (GitOperations class)
 */

export { GitOperations } from './git-operations/index';
export {
  getGitDiff,
  getFullGitDiff,
  commitChanges,
  getDiff,
  createCommit,
  createBranch,
  createPullRequest,
  mergePullRequest,
  revertChanges,
  ensureGitRepository,
  validateAndSetupRemote,
  createWorktree,
  removeWorktree,
  cleanupStaleWorktrees,
} from './git-operations/index';
