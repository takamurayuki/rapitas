/**
 * FileSave Verify Review Admission
 *
 * Decides, when a passing verify.md is saved, whether the task moves to
 * `verify_done` right away or stays at its current status until the
 * adversarial diff review passes (task 1538). Not responsible for running the
 * review, applying its verdict or the commit/PR stages.
 *
 * Why: `verify_done` used to be written on save and the review ran after it,
 * so a FAIL showed 「検証完了」 and then sent the task back. Now `verify_done`
 * is written only once nothing is left to decide: right away when there is
 * nothing to review (empty diff, no worktree, conflict-resolution task, review
 * disabled) or the self-verification already passed the same diff; otherwise
 * after the jury passes (verify-post-save-pipeline.ts).
 */
import { prisma } from '../../../../config';
import { createLogger } from '../../../../config/logger';
import type { CompletionReviewReceipt } from '../../../../services/workflow/requirement-replan-commit';
import type { DiffReviewResult } from '../../../../services/agents/verification/adversarial-diff-review-verdict';
import { recordTransition } from '../../../../services/workflow/transition-recorder';
import { VERIFY_REVIEW_PENDING_CAUSE } from '../../../../services/workflow/verify-review-pending';

const log = createLogger('routes:workflow:handlers:files');

/** What the save does with the status, and what the post-save stages need. */
export interface VerifyReviewAdmission {
  /** Receipt to complete with — advanced when verify_done was written now. */
  completionReceipt: CompletionReviewReceipt;
  /** True = still at `reviewFromStatus`; verify_done waits for the jury. */
  reviewPending: boolean;
  /** Status the task stays at while the review is pending. */
  reviewFromStatus?: string;
  /** Matching passing self-verify review; the post-save jury is not called. */
  reuseReview?: DiffReviewResult;
  reusedRunId?: string;
  /** Diff fingerprint / HEAD seen at admission, for the pending marker. */
  pendingKey?: { diffFingerprint: string | null; headSha: string | null };
}

/** Statuses from which the reviewed verify transition may later be written. */
const PENDABLE_STATUSES = new Set(['plan_approved', 'in_progress']);

/**
 * Decide whether to write `verify_done` now or after the diff review.
 *
 * @param p.taskId - Task id / タスクID
 * @param p.currentStatus - Workflow status before the save / 保存前の状態
 * @param p.completionReceipt - Server-held review receipt of this save / 受領証
 * @returns The admission decision / 判定結果
 * @throws {Error} When the receipt is missing, or advancing to verify_done is held / 受領証が無い・遷移が保留された場合
 */
export async function admitVerifyForReview(p: {
  taskId: number;
  currentStatus: string | null | undefined;
  completionReceipt: CompletionReviewReceipt | undefined;
}): Promise<VerifyReviewAdmission> {
  const receipt = p.completionReceipt;
  if (!receipt) throw new Error('Missing server completion review receipt');
  const { advanceReviewedVerify } =
    await import('../../../../services/workflow/requirement-replan-commit');
  const advanceNow = async (
    extra: Partial<VerifyReviewAdmission> = {},
  ): Promise<VerifyReviewAdmission> => ({
    completionReceipt: await advanceReviewedVerify(prisma, receipt),
    reviewPending: false,
    ...extra,
  });

  const currentStatus = p.currentStatus ?? null;
  if (!currentStatus || !PENDABLE_STATUSES.has(currentStatus)) return advanceNow();
  // Read through a promise so an unreadable session/task (or a prisma client
  // without the model) means "nothing to review" instead of failing the save.
  const session = await Promise.resolve()
    .then(() =>
      prisma.agentSession.findFirst({
        where: { config: { taskId: p.taskId }, worktreePath: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { worktreePath: true },
      }),
    )
    .catch(() => null);
  const worktreePath = session?.worktreePath;
  if (!worktreePath) return advanceNow();
  const task = await Promise.resolve()
    .then(() =>
      prisma.task.findUnique({
        where: { id: p.taskId },
        select: { title: true, githubPrId: true },
      }),
    )
    .catch(() => null);
  // Conflict-resolution tasks are outside the jury (verify-completion-gate.ts).
  if (task?.githubPrId != null && /^PR #\d+ の競合を解消/.test(task.title ?? '')) {
    return advanceNow();
  }
  const { isAdversarialReviewEnabled } =
    await import('../../../../services/agents/verification/adversarial-diff-review');
  if (!isAdversarialReviewEnabled()) return advanceNow();

  const { readSelfVerifyReuseKey, findReusableSelfVerifyReview } =
    await import('../../../../services/workflow/self-verify-diff-review');
  const key = await readSelfVerifyReuseKey(p.taskId, worktreePath);
  // The jury does not judge an empty diff; the completion gate owns that case.
  if (key.diffFingerprint === null) return advanceNow();
  const reusable = await findReusableSelfVerifyReview(p.taskId, worktreePath);
  if (reusable) {
    log.info(
      { taskId: p.taskId, runId: reusable.runId, diffFingerprint: key.diffFingerprint },
      '[Workflow] Self-verify diff review passed this exact diff — verify_done without re-review',
    );
    return advanceNow({ reuseReview: reusable.review, reusedRunId: reusable.runId });
  }
  return {
    completionReceipt: receipt,
    reviewPending: true,
    reviewFromStatus: currentStatus,
    pendingKey: { diffFingerprint: key.diffFingerprint, headSha: key.headSha },
  };
}

/**
 * Record the "waiting for the diff review" marker. Written after the save's
 * own `file_saved:verify` row so the newest transition names the wait (the UI
 * shows 「検証中（差分レビュー）」 from it). Status is not changed. Never throws.
 *
 * @param taskId - Task id / タスクID
 * @param admission - Pending admission from {@link admitVerifyForReview} / 判定結果
 */
export async function recordVerifyReviewPending(
  taskId: number,
  admission: VerifyReviewAdmission,
): Promise<void> {
  const status = admission.reviewFromStatus ?? 'in_progress';
  await recordTransition({
    taskId,
    fromStatus: status,
    toStatus: status,
    actor: 'system',
    cause: VERIFY_REVIEW_PENDING_CAUSE,
    phase: 'verify',
    metadata: { ...(admission.pendingKey ?? {}) },
  }).catch((err) => {
    log.warn({ err, taskId }, '[Workflow] Failed to record verify_review_pending');
  });
}
