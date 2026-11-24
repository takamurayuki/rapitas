/**
 * diff-review-pending
 *
 * Whether a task is in the 「検証中（差分レビュー）」 phase: its saved verify.md
 * is waiting for the adversarial diff review, or that review is held for a
 * human decision (task 1538). Both keep the workflow at `in_progress`; only the
 * newest transition cause tells them apart from plain verification.
 */

/** Newest-transition causes that mean "the diff review is still deciding". */
const DIFF_REVIEW_PENDING_CAUSES = new Set([
  'verify_review_pending',
  'adversarial_review_awaiting_human',
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
