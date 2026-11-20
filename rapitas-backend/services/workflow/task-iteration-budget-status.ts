/**
 * task-iteration-budget-status
 *
 * Pure counting of non-advancing workflowStatus transitions (no-progress
 * condition ①) for task-iteration-budget. Not responsible for DB access or
 * the halt decision itself.
 */

import { WF_STATUS_RANK } from './workflow-cli-executor-helpers';

/**
 * Causes written when the system deliberately re-runs a task from an earlier
 * status (stale-terminal reset, blocked auto-retry, manual retry, reconciler
 * requeue). They are rewinds by design, not evidence of a stuck loop, so they
 * must not feed the no-progress signal (task 994: 984/986 were halted right
 * after verify_done because each re-run passed the same statuses again).
 */
const RESET_TRANSITION_CAUSES = new Set([
  'stale_terminal_reset',
  'blocked_auto_retry',
  'task_retried',
  'reconciler_requeue',
  'reconciler_reset_undispatchable',
]);

/**
 * Whether a transition cause is an intentional reset/re-run.
 *
 * @param cause - WorkflowTransition.cause value. / 遷移の原因
 * @returns True for reset-family causes. / reset 系の原因なら true
 */
export function isResetTransitionCause(cause: string | null | undefined): boolean {
  return cause != null && RESET_TRANSITION_CAUSES.has(cause);
}

/**
 * Same-status records written by the system's own checks and ledgers, never
 * by a task failing: a critic that could not judge, the spend notice, the
 * verifier-eligibility settle. Task 514 was counted twice for two
 * plan_critic_incomplete records — the critic's limit, not the task's.
 */
const BOOKKEEPING_CAUSE = /_critic_incomplete$|^task_spend_notice$|^verifier_eligibility_/;

/** Minimal transition shape needed by {@link countNonAdvancingTransitions}. */
export interface StatusTransitionSample {
  fromStatus: string | null;
  toStatus: string;
  cause: string | null;
  /** Why the system sent the task back (verify_repair reason, etc.), when recorded. / 差し戻しの理由 */
  reason?: string | null;
  /** WorkflowTransition.metadata (JSON string or object); its reason/instruction is read when `reason` is absent. / 遷移のメタデータ */
  metadata?: unknown;
}

/** The recorded reason of a bounce: verify_repair's `reason`, a critic's `reasons`, plan revision's `instruction`. */
function reasonOf(t: StatusTransitionSample): string {
  if (t.reason) return t.reason;
  let meta: unknown = t.metadata;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      return '';
    }
  }
  if (!meta || typeof meta !== 'object') return '';
  const m = meta as { reason?: unknown; instruction?: unknown; reasons?: unknown };
  if (Array.isArray(m.reasons)) return m.reasons.filter((x) => typeof x === 'string').join(' / ');
  return typeof m.reason === 'string'
    ? m.reason
    : typeof m.instruction === 'string'
      ? m.instruction
      : '';
}

/**
 * The identity of a bounce, for telling a repeated failure from a new one.
 * Digits are dropped: 「テスト 12 件が失敗」 and 「テスト 13 件が失敗」 are
 * the same failure, re-measured.
 */
function bounceSignature(t: StatusTransitionSample): string | null {
  const reason = reasonOf(t).replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  return reason ? `${t.cause ?? ''}|${reason}` : null;
}

/**
 * Count transitions that show the task is stuck: a step back or same-status
 * record repeating one already seen in the window, or a step back with no
 * recorded reason. Reset-family and halt-side causes, and the first of each
 * cause and reason, are not counted. A task progressing through draft→…→verify_done yields 0 no
 * matter how many re-runs happened.
 *
 * @param transitions - Transitions in the window. / 窓内の遷移
 * @param isExcludedCause - Extra cause filter (halt side). / 追加の除外条件
 * @returns Non-advancing count; unknown/null statuses are not counted. / 前進しなかった遷移数
 */
export function countNonAdvancingTransitions(
  transitions: StatusTransitionSample[],
  isExcludedCause: (cause: string | null) => boolean = () => false,
): number {
  let count = 0;
  const seen = new Set<string>();
  for (const t of transitions) {
    if (isResetTransitionCause(t.cause) || isExcludedCause(t.cause)) continue;
    if (t.fromStatus == null) continue;
    const from = WF_STATUS_RANK[t.fromStatus];
    const to = WF_STATUS_RANK[t.toStatus];
    if (from === undefined || to === undefined) continue;
    if (to > from) continue;
    // A question pauses for a person, and the answer resets the window: it is
    // not a step back. Five of task 514's eight remaining counts were these.
    if (t.toStatus === 'awaiting_question') continue;
    if (to === from && BOOKKEEPING_CAUSE.test(t.cause ?? '')) continue;
    // NOTE: Only a repeat counts. A same-status record seen once
    // (plan_critic_incomplete, task_spend_notice, verifier_eligibility_deferred)
    // is bookkeeping — four of task 514's nine were these (2026-11-20) — while
    // the same one again and again (verify_pr_not_created ×51) is a stuck
    // task. A step back for a reason not seen before is a new finding being
    // fixed: task 514 was halted while each jury bounce named a different
    // defect. A step back with no recorded reason still counts every time.
    const signature = to === from ? `${t.cause ?? ''}|${reasonOf(t)}` : bounceSignature(t);
    if (signature !== null && !seen.has(signature)) {
      seen.add(signature);
      continue;
    }
    count++;
  }
  return count;
}
