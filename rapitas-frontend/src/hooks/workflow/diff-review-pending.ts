/**
 * diff-review-pending
 *
 * Whether a task is in the 「検証中（差分レビュー）」 phase: its saved verify.md
 * is waiting for the adversarial diff review, or that review is held for a
 * human decision (task 1538). Both keep the workflow at `in_progress`; only the
 * newest transition cause tells them apart from plain verification.
 */

/**
 * Newest-transition causes that mean "the diff review is still deciding".
 * NOTE: Every cause the backend records on an `in_progress` task while the
 * review is undecided, without changing its status, must be listed here —
 * otherwise the label drops while the task is still held. A refused override
 * (`REVIEW_OVERRIDE_REFUSED_CAUSE`, review-hold-resolve.ts) keeps the hold.
 */
const DIFF_REVIEW_PENDING_CAUSES = new Set([
  'verify_review_pending',
  'adversarial_review_awaiting_human',
  'adversarial_review_override_refused',
]);

/**
 * Decide whether the diff-review label applies.
 *
 * @param status - Current workflow status / 現在のワークフロー状態
 * @param cause - Cause of the newest transition / 最新の遷移の cause
 * @returns True while the diff review decides / 差分レビュー中なら true
 */
export function isDiffReviewPending(
  status: string | null | undefined,
  cause: string | null | undefined,
): boolean {
  return status === 'in_progress' && !!cause && DIFF_REVIEW_PENDING_CAUSES.has(cause);
}
