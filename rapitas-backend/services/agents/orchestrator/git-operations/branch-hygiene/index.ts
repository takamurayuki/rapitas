/**
 * BranchHygiene
 *
 * Barrel for the housekeeping the worktree cleanup scheduler runs: idle
 * worktrees, workflow scratch files and preserved local branches.
 */
export { pruneMergedLocalBranches } from './local-branch-prune';
export type { GitResult, LocalBranchPruneDeps, LocalBranchPruneResult } from './local-branch-prune';
export { sweepIdleWorktrees } from './worktree-sweep';
export type { WorktreeSweepDeps, WorktreeSweepResult, KeptReason } from './worktree-sweep';
export { sweepScratchFiles } from './scratch-sweep';
export type { ScratchSweepResult } from './scratch-sweep';
export { isWorkPreserved } from './work-preserved';
