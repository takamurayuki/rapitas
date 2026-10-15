/**
 * plan-hold-exclusion
 *
 * Decides whether a `todo` × `plan_created` task is a deliberate human wait
 * (auto-approval withheld for a forbidden-change override) rather than stagnation.
 * Pure — the caller supplies the evidence; it does NOT read the DB or notify.
 */

/** Transition cause recorded when auto-approval is withheld for a human override. */
// NOTE: mirrors PLAN_FORBIDDEN_CHANGE_HOLD_CAUSE in forbidden-change-plan-hold.ts (not imported:
// that module pulls in the verification stack); a test pins equality.
export const PLAN_HOLD_CAUSE = 'plan_forbidden_change_hold';

/**
 * How long a recorded plan hold counts as a legitimate human wait. A human override
 * approval is expected within a day; past it, detection resumes so the stale hold surfaces.
 */
export const PLAN_HOLD_EXCLUSION_WINDOW_MS = 24 * 60 * 60_000;

/** Evidence needed to judge a plan hold. */
export interface PlanHoldExclusionInput {
  taskStatus: string;
  workflowStatus: string | null;
  /** Cause of the task's newest transition (null/undefined = unknown). */
  latestTransitionCause?: string | null;
  /** createdAt of the newest plan hold transition, epoch ms (null/undefined = unknown). */
  latestPlanHoldAtMs?: number | null;
  nowMs: number;
}

/**
 * Whether the task sits in a recorded, still-fresh plan hold awaiting a human override.
 * Fails open: any missing evidence returns false so detection continues.
 *
 * @param input - Task snapshot and hold evidence. / タスク状態と保留の証拠
 * @returns True when stagnation must be suppressed. / 停滞検知を見送るなら true
 */
export function isPlanHoldAwaitingHuman(input: PlanHoldExclusionInput): boolean {
  if (input.taskStatus !== 'todo' || input.workflowStatus !== 'plan_created') return false;
  if (input.latestTransitionCause !== PLAN_HOLD_CAUSE) return false;
  if (input.latestPlanHoldAtMs == null) return false;
  return input.nowMs - input.latestPlanHoldAtMs < PLAN_HOLD_EXCLUSION_WINDOW_MS;
}
