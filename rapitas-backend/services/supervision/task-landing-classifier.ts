/**
 * TaskLandingClassifier
 *
 * Pure classification of how one completed task "landed" against acceptance bar
 * v1 (pre-registered acceptance criteria, independent verification, and a merge
 * the system itself performed). Only `qualified` tasks may count toward the
 * hands-off streak; every other class is surfaced, never silently dropped.
 * Not responsible for reading the DB — see task-landing-evidence.ts.
 */
import type { AcceptanceReasonCode } from './supervision-reason-codes';

export const LANDING_CLASSES = [
  'publish_after_stop',
  'unverified_completion',
  'manual_merge',
  'subtask',
  'criteria_missing',
  'landing_failed',
  'merge_not_requested',
  'landing_pending',
  'policy_unreadable',
  'qualified',
] as const;
export type LandingClass = (typeof LANDING_CLASSES)[number];

/** Transitions in which the system itself merged the task's PR. */
export const PUBLISH_CAUSES: readonly string[] = ['auto_merged', 'auto_merge_recovered'];
/** Independent-verification passes (no-change confirmation is also a verification). */
export const VERIFY_PASS_CAUSES: readonly string[] = [
  'verify_passed',
  'verify_no_change_confirmed',
];
/** Merge attempts that ended without a merge. */
export const LANDING_FAILURE_CAUSES: readonly string[] = [
  'auto_merge_exhausted',
  'auto_merge_blocked',
];
/** PR mirror states that mean GitHub merged it (same set as settle-filing.ts). */
export const MERGED_PR_STATES: readonly string[] = ['merged', 'MERGED'];

/**
 * Stop/interruption causes. Shared with the failure classification so the
 * "publish after stop" check and failure counting use one definition.
 */
export const STOP_CAUSE_PATTERNS: readonly RegExp[] = [
  /_stop_revert$/,
  /shutdown_revert$/,
  /^stale_execution_recovery_revert$/,
];

/**
 * Whether a cause is a stop/interruption revert.
 *
 * @param cause - WorkflowTransition.cause / 遷移のcause
 * @returns true for a stop cause / 停止系なら true
 */
export function isStopCause(cause: string): boolean {
  return STOP_CAUSE_PATTERNS.some((p) => p.test(cause));
}

export interface LandingTransition {
  cause: string;
  toStatus: string;
  createdAt: Date;
}

export interface TaskLandingInput {
  taskId: number;
  parentId: number | null;
  acceptanceCriteriaRaw: string | null;
  transitions: readonly LandingTransition[];
  /** Merged-ness summary of the PR mirror rows linked to the task; null = no row. */
  prState: string | null;
  /** Resolved autoMergePR; null when the policy could not be read. */
  autoMergePR: boolean | null;
}

export interface TaskLandingResult {
  taskId: number;
  landingClass: LandingClass;
  /** Merge-evidence time for `qualified`, otherwise the last completion time. */
  at: Date | null;
  reasonCode: AcceptanceReasonCode | null;
}

const REASON_BY_CLASS: Record<LandingClass, AcceptanceReasonCode | null> = {
  publish_after_stop: 'publish_after_stop_detected',
  unverified_completion: 'unverified_completion_detected',
  manual_merge: 'recent_intervention',
  subtask: 'subtask_not_counted',
  criteria_missing: 'acceptance_criteria_missing',
  landing_failed: 'failure_or_interruption_in_streak',
  merge_not_requested: 'merge_not_requested',
  landing_pending: 'landing_evidence_pending',
  policy_unreadable: 'landing_evidence_unobservable',
  qualified: null,
};

/**
 * Whether acceptance criteria were registered: a non-empty JSON array.
 * Unparseable criteria are not "registered" in any checkable sense.
 *
 * @param raw - Task.acceptanceCriteria / 受入条件の生値
 * @returns true when at least one criterion exists / 1件以上あれば true
 */
export function hasAcceptanceCriteria(raw: string | null): boolean {
  if (!raw || !raw.trim()) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

/**
 * Classifies one completed task. Earlier rules win (see plan §着地判定の仕様定義).
 *
 * @param input - The task's landing evidence / タスクの着地証跡
 * @returns Landing class, its time and reason code / 分類・時刻・理由コード
 */
export function classifyTaskLanding(input: TaskLandingInput): TaskLandingResult {
  const ordered = [...input.transitions].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const completions = ordered.filter((t) => t.toStatus === 'completed');
  const lastCompleted =
    completions.length > 0 ? completions[completions.length - 1].createdAt : null;
  const publishes = ordered.filter((t) => PUBLISH_CAUSES.includes(t.cause));
  const verifies = ordered.filter((t) => VERIFY_PASS_CAUSES.includes(t.cause));
  const prMerged = input.prState != null && MERGED_PR_STATES.includes(input.prState);
  const result = (
    landingClass: LandingClass,
    at: Date | null = lastCompleted,
  ): TaskLandingResult => ({
    taskId: input.taskId,
    landingClass,
    at,
    reasonCode: REASON_BY_CLASS[landingClass],
  });
  const between = (from: Date, to: Date, list: readonly LandingTransition[]) =>
    list.some((t) => t.createdAt > from && t.createdAt < to);

  // 1. Something was published after a stop with no fresh verification in between.
  for (const stop of ordered.filter((t) => isStopCause(t.cause))) {
    for (const publish of publishes) {
      if (
        publish.createdAt > stop.createdAt &&
        !between(stop.createdAt, publish.createdAt, verifies)
      ) {
        return result('publish_after_stop');
      }
    }
  }

  // 2. Completed without any independent verification pass before it.
  if (!lastCompleted || !verifies.some((v) => v.createdAt <= lastCompleted)) {
    return result('unverified_completion');
  }

  // 3. GitHub shows it merged, but not by the system: an approval on its behalf.
  if (prMerged && publishes.length === 0) return result('manual_merge');

  // 4. Subtasks never count, so splitting work cannot inflate the streak.
  if (input.parentId != null) return result('subtask');

  // 5. No pre-registered acceptance criteria.
  if (!hasAcceptanceCriteria(input.acceptanceCriteriaRaw)) return result('criteria_missing');

  // 6. A merge attempt failed after the last completion and nothing merged since.
  const lastFailure = ordered
    .filter((t) => LANDING_FAILURE_CAUSES.includes(t.cause) && t.createdAt > lastCompleted)
    .pop();
  if (lastFailure && !publishes.some((p) => p.createdAt > lastFailure.createdAt)) {
    return result('landing_failed');
  }

  // Merge evidence = system merge transition AND the mirror row says merged.
  if (publishes.length > 0) {
    if (prMerged) return result('qualified', publishes[publishes.length - 1].createdAt);
    // Transition without a merged mirror row: sync lag, not proof (fail-closed).
    return result('landing_pending');
  }

  if (input.autoMergePR === null) return result('policy_unreadable');
  if (input.autoMergePR === false) return result('merge_not_requested');
  return result('landing_pending');
}
