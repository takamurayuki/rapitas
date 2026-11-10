/**
 * review-hold-publish
 *
 * Commit / PR / merge for a task whose review hold a human overrode. Mirrors
 * the existing in-place publication from `verify_done` (blocked-pr-retry-
 * recovery.ts) and the HTTP pipeline's outcome handling: the verification
 * gate inside performAutoCommitAndPR still decides (a gate failure goes to
 * the bounded repair loop), a missing PR blocks with `verify_pr_not_created`
 * (which the reconciler's PR-only retry already handles), a requested merge or
 * staged completion holds for the watcher, otherwise the task completes.
 * Not responsible for clearing the hold (review-hold-resolve.ts).
 *
 * NOTE: Like blocked-pr-retry-recovery, completion here is a CAS on
 * verify_done, not the requirement-replan receipt path: the receipt belongs to
 * the verify.md save that was held, and re-running the replan review on a
 * human override would put an LLM back in front of the human's decision.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import { writeBlockedTask } from './blocked-task-write';
import { taskHasLinkedPr } from './workflow-cli-executor-helpers';
import { holdForRequiredMerge } from './required-merge-hold';
import {
  isAwaitingRequiredMerge,
  isAwaitingStagedPrCompletion,
} from './verify-settle-artifact-recovery';

const log = createLogger('workflow:review-hold-publish');

/** How a publication after an override ended. */
export type OverridePublication =
  | 'completed'
  | 'held_for_merge'
  | 'gate_blocked'
  | 'pr_not_created'
  | 'unverifiable'
  | 'already_moved';

/**
 * Publish an overridden task. Never throws for publication errors.
 *
 * @param taskId - Task at verify_done whose hold was overridden / 上書きされたタスク
 * @param verifyContent - The verify.md body / verify.md 本文
 * @returns How it ended / 結果
 */
export async function publishAfterReviewOverride(
  taskId: number,
  verifyContent: string,
): Promise<OverridePublication> {
  const { performAutoCommitAndPR, isNoChangeCompletion } =
    await import('../../routes/workflow/workflow-auto-commit');
  const acpr = await performAutoCommitAndPR(taskId, verifyContent).catch(
    () => ({}) as Awaited<ReturnType<typeof performAutoCommitAndPR>>,
  );

  if (acpr.verificationBlocked) {
    // Unverifiable: the gate already persisted the blocked task and evidence.
    if (acpr.verificationUnverifiable) return 'unverifiable';
    const { handleVerifyGateBlocked } =
      await import('../../routes/workflow/handlers/file-save/verify-commit-pr-gate-blocked');
    await handleVerifyGateBlocked({
      taskId,
      gateReason: acpr.error ?? '自動検証に失敗しました（lint/型/テスト/スコープ）。',
      gateRecoveryBlocked: null,
      savedContent: verifyContent,
    });
    return 'gate_blocked';
  }

  const prRequested = acpr.requested ? acpr.requested.autoCreatePR : true;
  const prSatisfied =
    !prRequested || acpr.autoPRResult?.success === true || (await taskHasLinkedPr(taskId));
  const noChange =
    prRequested &&
    !prSatisfied &&
    isNoChangeCompletion({
      errorBlob: `${acpr.autoPRResult?.error ?? ''} ${acpr.autoCommitResult?.error ?? ''} ${acpr.error ?? ''}`,
      filesChanged: acpr.autoCommitResult?.filesChanged,
    });

  if (prRequested && !prSatisfied && !noChange) {
    await writeBlockedTask(prisma, taskId).catch(() => {});
    await recordTransition({
      taskId,
      fromStatus: 'verify_done',
      toStatus: 'verify_done',
      actor: 'system',
      cause: 'verify_pr_not_created',
      phase: 'verify',
      metadata: {
        reason: acpr.autoPRResult?.error ?? acpr.error ?? 'PRが作成されませんでした',
        reviewOverride: true,
      },
      invariantViolation: true,
      invariantMessage: '検証通過後にPRが作成されませんでした。PR作成成功まで完了にしません。',
    }).catch(() => {});
    return 'pr_not_created';
  }

  if (!noChange) {
    // Fail closed on an unreadable policy, as every other completion path does.
    const awaitMerge = await isAwaitingRequiredMerge(taskId).catch(() => true);
    const awaitStaged =
      awaitMerge || (await isAwaitingStagedPrCompletion(taskId).catch(() => true));
    if (awaitMerge || awaitStaged) {
      const held = await holdForRequiredMerge({
        taskId,
        fromStatus: 'verify_done',
        source: 'review-hold-override',
        metadata: { reviewOverride: true },
      });
      return held ? 'held_for_merge' : 'already_moved';
    }
  }

  const cause = noChange ? 'verify_no_change_confirmed' : 'verify_passed';
  const completed = await prisma.task
    .updateMany({
      where: { id: taskId, workflowStatus: 'verify_done' },
      data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
    })
    .catch(() => ({ count: 0 }));
  if (completed.count === 0) return 'already_moved';
  await recordTransition({
    taskId,
    fromStatus: 'verify_done',
    toStatus: 'completed',
    actor: 'system',
    cause,
    phase: 'verify',
    metadata: { reviewOverride: true },
  }).catch(() => {});
  log.info({ taskId, cause }, '[review-hold] Overridden review published and completed');
  return 'completed';
}
