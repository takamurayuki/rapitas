import { REPEAT_LOOP_WINDOW_MS } from './incident-signature-repeat-loop';

/** Lifecycle admission for a reviewed replan; callers must supply fresh transactional reads. */
export interface ReplanLifecycleSnapshot {
  status: string;
  workflowStatus: string | null;
  updatedAt: Date;
  latestExecutionStatus: string | null;
  latestStopCause: string | null;
  themeStatus: string | null;
  priorReplans: number;
}

/** Fail closed for unavailable/invalid counters, protected states, and stale evaluation. */
export function rejectReplanLifecycle(
  current: ReplanLifecycleSnapshot,
  evaluatedUpdatedAt: Date,
): string | null {
  if (current.updatedAt.getTime() !== evaluatedUpdatedAt.getTime()) return 'stale_task';
  if (current.status !== 'in-progress') return 'protected_task_status';
  if (!['plan_approved', 'in_progress', 'verify_done'].includes(current.workflowStatus ?? '')) {
    return 'protected_workflow_status';
  }
  if (
    ['cancelled', 'canceled', 'canceling', 'cancelling'].includes(
      current.latestExecutionStatus ?? '',
    )
  ) {
    return 'execution_stopped';
  }
  if (current.latestStopCause !== null) return 'stop_not_resumed';
  if (current.themeStatus === 'stopping' || current.themeStatus?.startsWith('paused')) {
    return 'theme_paused';
  }
  if (!Number.isSafeInteger(current.priorReplans) || current.priorReplans < 0)
    return 'invalid_budget';
  if (current.priorReplans >= 3) return 'budget_exhausted';
  return null;
}

/** A single `requirement_evidence_replan` transition, reduced to its timestamp. */
export interface ReplanTransitionTimestamp {
  createdAtMs: number;
}

/**
 * Early-stop guard for requirement-replan mismatch cycles (task 956).
 *
 * The repeat-loop detector's 60-minute window (see
 * {@link REPEAT_LOOP_WINDOW_MS}) can flag 3 `phase_completed:implementer`
 * transitions before the absolute `priorReplans >= 3` budget in
 * {@link rejectReplanLifecycle} is ever exhausted: task #917's timeline hit 2
 * `requirement_evidence_replan` bounces within the window, each
 * re-authorizing one `phase_completed:implementer` firing, and the THIRD
 * firing crossed the detector's minCount=3 — well before a 3rd replan (the
 * absolute cap) ever ran. This lets the caller stop before that 3rd firing by
 * treating 2 window-local replans as exhausted, one less than the lifetime
 * cap.
 *
 * @param replans - `requirement_evidence_replan` transition timestamps (any order). / 対象タスクの requirement_evidence_replan 遷移時刻一覧
 * @param nowMs - Current time (ms). / 現在時刻
 * @param windowMs - Lookback window (default: the repeat-loop detector's window). / 集計窓
 * @returns true once 2 or more replans occurred within the window. / 窓内2回以上でtrue
 */
export function isRequirementReplanWindowExhausted(
  replans: ReplanTransitionTimestamp[],
  nowMs: number,
  windowMs: number = REPEAT_LOOP_WINDOW_MS,
): boolean {
  const windowStart = nowMs - windowMs;
  const count = replans.filter(
    (r) => r.createdAtMs >= windowStart && r.createdAtMs <= nowMs,
  ).length;
  return count >= 2;
}
