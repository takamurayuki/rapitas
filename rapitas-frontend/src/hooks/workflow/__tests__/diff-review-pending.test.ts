/**
 * diff-review-pending.test
 *
 * The 「検証中（差分レビュー）」 label applies while a saved verify.md waits for
 * the diff review, and while that review is held for a human (task 1538).
 */
import { isDiffReviewPending } from '../diff-review-pending';

describe('isDiffReviewPending', () => {
  it.each([
    ['in_progress', 'verify_review_pending', true],
    ['in_progress', 'adversarial_review_awaiting_human', true],
    ['verify_done', 'adversarial_review_awaiting_human', false],
    ['verify_done', 'verify_review_pending', false],
    ['in_progress', 'file_saved:verify', false],
    ['in_progress', null, false],
    [null, 'verify_review_pending', false],
  ] as const)('status=%s cause=%s → %s', (status, cause, expected) => {
    expect(isDiffReviewPending(status, cause)).toBe(expected);
  });
});
