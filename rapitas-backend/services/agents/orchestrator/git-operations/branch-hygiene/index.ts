/**
 * BranchHygiene
 *
 * Barrel for local-branch housekeeping run by the worktree cleanup scheduler.
 */
export { pruneMergedLocalBranches } from './local-branch-prune';
export type { GitResult, LocalBranchPruneDeps, LocalBranchPruneResult } from './local-branch-prune';
