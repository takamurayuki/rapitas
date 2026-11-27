/**
 * auto-run-selection-types
 *
 * Result and context types of the theme auto-run task selection. Split out of
 * auto-run-selection.ts (file-size limit); contains no logic and is re-exported from there.
 */
import type { ParallelRejection } from './parallel/parallel-types';

/**
 * Reason the selection returned no task. `all_blocked` = work EXISTS but every
 * task is stuck at status 'blocked' (a wedged loop, task 615) — distinct from
 * `all_done` (genuinely nothing left to do).
 */
export type NoTaskReason =
  | 'all_done'
  | 'all_blocked'
  | 'concurrency_limit'
  | 'awaiting_approval'
  /** The whole workflow is switched off; no task in any theme can be advanced. */
  | 'workflow_disabled_globally'
  /**
   * Every candidate was refused by the parallel-safety filter (task 1552): work
   * exists but would collide with a task already running. Never all_done — that
   * path refills the backlog.
   */
  | 'parallel_conflict'
  /**
   * Task 1568: a task of the theme waits for CI and every candidate overlaps its still-open PR.
   * Work exists, the CI result (merge or repair) always resolves the wait — never all_done.
   */
  | 'all_overlap_deferred';

export type SelectionResult =
  | {
      found: true;
      taskId: number;
      /**
       * Task ids passed over because their plan files overlap an open auto-PR's
       * changed files (task 573 B). Present only when a LATER candidate was
       * selected instead; the all-overlap fallback picks the head without it.
       */
      deferred?: number[];
      /** Candidates refused by the parallel-safety filter before this one (task 1552). */
      rejected?: ParallelRejection[];
    }
  | {
      found: false;
      reason: NoTaskReason;
      rejected?: ParallelRejection[];
      /** Candidates passed over by a strict overlap wait (task 1568). */
      deferred?: number[];
    };

/**
 * Scope-overlap context for {@link selectNextTask} (task 573 B). `openPrFiles`
 * is the union of changed files across the theme's OPEN auto-created PRs;
 * `getPlanFiles` loads a candidate's plan file list (empty = no plan =
 * lightweight task, never deferred per spec).
 */
export interface ScopeOverlapContext {
  openPrFiles: string[];
  getPlanFiles: (taskId: number) => Promise<string[]>;
  /**
   * Task 1568: set while a task of the theme waits for CI. When every candidate overlaps the open
   * PRs, wait (`all_overlap_deferred`) instead of falling back to the head — a CI wait always
   * ends (merge or repair), so this cannot starve the theme the way an abandoned PR could.
   */
  strict?: boolean;
}
