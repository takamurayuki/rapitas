/**
 * blocked-task-policy
 *
 * Single source of truth for blocked-task self-heal thresholds and the pure
 * exclusion classifier shared by the requeue (blind retry) and escalation
 * passes. Not responsible for any DB access or side effects — keeping both
 * passes on the same constants/classification prevents them from drifting
 * apart and double-handling (or double-skipping) the same task.
 */

/**
 * Auto-retry a BLOCKED task at most this many times before leaving it blocked
 * for the user. Blocked auto-created tasks otherwise sit forever, holding the
 * backlog promotion cap and starving the loop (observed: 5 blocked tasks =
 * cap 5 → idle with 20 open concerns un-promoted). A bounded retry re-runs
 * them — most were blocked by a since-fixed bug and now pass; genuine failures
 * exhaust the budget and stay blocked. / blocked タスクの自動再試行上限。
 */
export const MAX_BLOCKED_RETRY = 2;

/**
 * Wait this long after a task was blocked before auto-retrying — let the dust
 * settle (don't race the run that just blocked it) and avoid hammering a task
 * that re-blocks instantly. / blocked 後この時間待ってから再試行。
 */
export const BLOCKED_RETRY_SETTLE_MS = 3 * 60 * 1000;

/**
 * Don't re-queue orphans/blocked tasks older than this — ancient ones are
 * likely abandoned. NOTE: this bounds the RETRY query only. Old blocked tasks
 * must still be visible to evidence correction and escalation (task 615) —
 * excluding them there turns "no retry" into permanent abandonment.
 */
export const MAX_ORPHAN_REQUEUE_AGE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * WorkflowTransition.cause recorded when a verify-repair loop is cut off for
 * NON-CONVERGENCE (task 619): the same acceptance criterion was flagged
 * unaddressed by 2+ repair bounces. Lives here (dependency-free policy module)
 * so verify-self-repair (writer) and both reconciler passes (readers) share
 * one constant without a circular import.
 */
export const VERIFY_NON_CONVERGENCE_CAUSE = 'verify_repair_non_convergence';

/**
 * WorkflowTransition.cause recorded when a lightweight PR-only recovery
 * attempt (task 681) fails for a task blocked by `verify_pr_not_created`.
 * Lives here (dependency-free policy module) so blocked-pr-retry-recovery
 * (writer) and workflow-reconciler-requeue (reader, gating a single attempt
 * per blocked window) share one constant without a circular import. NOT part
 * of {@link classifyBlockedExclusion}'s exclusion set by design — the
 * lightweight retry runs BEFORE the blind-retry/escalation split and either
 * completes the task or falls through unchanged to that existing logic (see
 * plan.md §実装者への申し送り事項 #3).
 */
export const PR_RETRY_LIGHTWEIGHT_CAUSE = 'verify_pr_retry_lightweight';

/** Reason a blocked task is excluded from the blind auto-retry. */
export type BlockedExclusionReason =
  | 'awaiting_question'
  | 'verify_no_convergence'
  | 'abandoned_old'
  | 'verify_repair_exhausted'
  | 'retry_cap_exhausted';

/** Classification of a blocked task: retryable, or an exclusion reason. */
export type BlockedClassification = BlockedExclusionReason | 'retryable';

/** Input facts for {@link classifyBlockedExclusion}. */
export interface BlockedClassificationInput {
  workflowStatus: string | null;
  /** Time since the task row last moved (ms). / 最終更新からの経過時間 */
  ageMs: number;
  /** verify_repair transitions since the last manual retry. / 修復回数 */
  repairs: number;
  verifyRepairLimit: number;
  /** blocked_auto_retry transitions so far. / 自動再試行回数 */
  attempts: number;
  /**
   * True when a VERIFY_NON_CONVERGENCE_CAUSE transition exists in the current
   * repair window — the task was cut off for repeating the same acceptance
   * criterion, so blind retry would just replay the non-converging loop.
   * / 非収束打ち切り済みか
   */
  nonConverged?: boolean;
}

/**
 * Resolve the verify→implement repair budget from user settings, matching
 * verify-self-repair's resolveMaxRepairs (default 3, positive numbers only).
 *
 * @param settings - UserSettings row (or null when unavailable). / 設定行
 * @returns The effective repair limit. / 有効な修復上限
 */
export function resolveVerifyRepairLimit(
  settings: { verifyRepairLimit?: number | null } | null,
): number {
  return typeof settings?.verifyRepairLimit === 'number' && settings.verifyRepairLimit > 0
    ? settings.verifyRepairLimit
    : 3;
}

/**
 * Classify why a blocked task is excluded from blind auto-retry (or that it is
 * retryable). Must stay logically equivalent to requeueBlockedTasks' skip
 * conditions — escalation uses this to pick up exactly the tasks retry leaves
 * behind, so a drift here double-escalates tasks retry is about to handle.
 *
 * @param input - Task facts. / 判定材料
 * @returns Exclusion reason, or 'retryable' when the blind retry applies. / 分類結果
 */
export function classifyBlockedExclusion(input: BlockedClassificationInput): BlockedClassification {
  // Order matters: a paused question ALWAYS wins (never blind-retry it,
  // whatever its age/budget), then age (an ancient task is out of the retry
  // query entirely), then the budget/cap exclusions retry itself applies.
  if (input.workflowStatus === 'awaiting_question') return 'awaiting_question';
  // Non-convergence beats age/budget: the cutoff already established that
  // re-running cannot help (same criterion never progressed), whatever the
  // remaining retry budget says.
  if (input.nonConverged) return 'verify_no_convergence';
  if (input.ageMs > MAX_ORPHAN_REQUEUE_AGE_MS) return 'abandoned_old';
  if (input.repairs >= input.verifyRepairLimit) return 'verify_repair_exhausted';
  if (input.attempts >= MAX_BLOCKED_RETRY) return 'retry_cap_exhausted';
  return 'retryable';
}
