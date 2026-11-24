/**
 * verify-fallback-jury-reuse
 *
 * Reuse of a passing self-verify diff review on the CLI epilogue's fallback
 * jury (task 1538): the lookup made under the jury lock, and the re-check made
 * right before the reused verdict is applied. Not responsible for running the
 * jury or applying any verdict (verify-fallback-jury-gate.ts).
 *
 * Why the re-check: the DB jury lock serialises reviewers but cannot stop the
 * worktree's git state from changing. A pass matched at the start of the run
 * must still be the newest pass for the same diff when it is applied, or an
 * old verdict would be recorded for a diff nobody judged.
 */
import { createLogger } from '../../config/logger';
import type { JuryRunHandle } from './jury-review-run';
import type { DiffReviewResult } from '../agents/verification/adversarial-diff-review-verdict';

// NOTE: Same logger name as verify-fallback-jury-gate.ts (moved from there).
const log = createLogger('workflow-cli-executor');

/** A self-verify pass matched under the jury lock. */
export interface LockedReuse {
  review: DiffReviewResult;
  runId: string;
}

/**
 * A self-verify pass for exactly this diff, looked up only once the jury lock
 * is held: a lookup before it could match keys that change before the lock.
 * The pass must also be for the criteria revision the run recorded, or it
 * would be stored under criteria it never judged. The caller looks it up only
 * after the HTTP records, so a `stopped` outcome is never overridden.
 *
 * @param taskId - Task id / タスクID
 * @param worktreePath - The task's worktree / worktree のパス
 * @param run - The jury run holding the lock / ロックを持つ陪審の run
 * @returns The reusable pass and its job runId, or undefined / 再利用できる合格（無ければ undefined）
 */
export async function reusableUnderLock(
  taskId: number,
  worktreePath: string,
  run: JuryRunHandle,
): Promise<LockedReuse | undefined> {
  const { findReusableSelfVerifyReview } = await import('./self-verify-diff-review');
  const reusable = await findReusableSelfVerifyReview(taskId, worktreePath);
  if (!reusable || reusable.criteriaRevision !== run.criteriaRevision) return undefined;
  log.info(
    { taskId, runId: reusable.runId, diffFingerprint: reusable.review.diffFingerprint },
    '[WorkflowCLIExecutor] Self-verify diff review passed this exact diff — reusing it on the epilogue path',
  );
  return { review: reusable.review, runId: reusable.runId };
}

/**
 * Whether a pass matched under the lock is still the one to apply: the newest
 * self-verify pass is the same job, for the same diff fingerprint (HEAD and
 * criteria are re-read inside the lookup), under the run's criteria revision.
 * Never throws; an unreadable state means "not current".
 *
 * @param taskId - Task id / タスクID
 * @param worktreePath - The task's worktree / worktree のパス
 * @param run - The jury run holding the lock / ロックを持つ陪審の run
 * @param first - The pass matched under the lock / ロック内で照合した合格
 * @returns True when the reuse may still be applied / まだ再利用してよければ true
 */
export async function reuseStillCurrent(
  taskId: number,
  worktreePath: string,
  run: JuryRunHandle,
  first: LockedReuse,
): Promise<boolean> {
  try {
    const { findReusableSelfVerifyReview } = await import('./self-verify-diff-review');
    const now = await findReusableSelfVerifyReview(taskId, worktreePath);
    return (
      !!now &&
      now.runId === first.runId &&
      now.review.diffFingerprint === first.review.diffFingerprint &&
      now.criteriaRevision === run.criteriaRevision
    );
  } catch (err) {
    log.warn({ err, taskId }, '[WorkflowCLIExecutor] Reuse re-check failed — reviewing instead');
    return false;
  }
}
