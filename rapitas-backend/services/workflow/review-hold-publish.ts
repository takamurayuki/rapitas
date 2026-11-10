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
 * The override is bound to the verify.md version and diff the human looked
 * at: publication re-reads both first and, on any mismatch or when either
 * cannot be read, re-parks the task on the review hold instead of publishing.
 * Completion also requires the requested commit to have succeeded and no
 * stop/error from commit/PR — a failed local save never completes the task.
 *
 * NOTE: Like blocked-pr-retry-recovery, completion here is a CAS on
 * verify_done, not the requirement-replan receipt path: the receipt belongs to
 * the verify.md save that was held, and re-running the replan review on a
 * human override would put an LLM back in front of the human's decision.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import { holdForHumanReview, type ReviewHoldDetails } from './review-hold';
import { readVerifySha256 } from './verify-jury-completion';
import { currentDiffFingerprint } from '../agents/verification/review-diff-fingerprint';
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
  | 'binding_mismatch'
  | 'publication_failed'
  | 'already_moved';

/** The verify.md version + diff a human override was given for. */
export interface OverrideBinding {
  verifySha256: string;
  diffFingerprint: string;
  /** Worktree the fingerprint was taken from. */
  worktreePath: string;
}

/**
 * Whether the task still shows exactly the artifact + diff the override was
 * given for. Null when it does; otherwise the reason (unreadable counts as a
 * mismatch — an override cannot be proven to cover what we cannot identify).
 */
async function bindingMismatch(taskId: number, b: OverrideBinding): Promise<string | null> {
  const [sha, fp] = await Promise.all([
    readVerifySha256(taskId).catch(() => null),
    currentDiffFingerprint(taskId, b.worktreePath).catch(() => null),
  ]);
  if (!sha) return 'verify.md の識別子（sha256）を取得できません';
  if (!fp) return '差分の識別子（fingerprint）を取得できません';
  if (sha !== b.verifySha256) return '上書きした後に verify.md が変わりました';
  if (fp !== b.diffFingerprint) return '上書きした後に差分が変わりました';
  return null;
}

/**
 * Publish an overridden task. Never throws for publication errors.
 *
 * @param taskId - Task at verify_done whose hold was overridden / 上書きされたタスク
 * @param verifyContent - The verify.md body / verify.md 本文
 * @param ctx.binding - Artifact + diff the override covers / 上書きの対象
 * @param ctx.hold - The hold that was overridden (re-parked on mismatch) / 上書きされた保留
 * @returns How it ended / 結果
 */
export async function publishAfterReviewOverride(
  taskId: number,
  verifyContent: string,
  ctx: { binding: OverrideBinding; hold: ReviewHoldDetails },
): Promise<OverridePublication> {
  const mismatch = await bindingMismatch(taskId, ctx.binding);
  if (mismatch) {
    await holdForHumanReview({
      taskId,
      reason: ctx.hold.reason,
      detail: `${mismatch}。上書きの対象と一致しないため公開していません。`,
      findings: ctx.hold.findings,
      severity: ctx.hold.severity,
      source: 'review_override_binding',
      extra: { overrideBinding: ctx.binding, bindingMismatch: mismatch },
    });
    log.warn({ taskId, mismatch }, '[review-hold] Override no longer matches — re-held');
    return 'binding_mismatch';
  }

  const { performAutoCommitAndPR, isNoChangeCompletion } =
    await import('../../routes/workflow/workflow-auto-commit');
  const acpr = await performAutoCommitAndPR(taskId, verifyContent).catch(
    (err: unknown) =>
      ({
        error: `commit/PR が例外で終了しました: ${err instanceof Error ? err.message : String(err)}`,
      }) as Awaited<ReturnType<typeof performAutoCommitAndPR>>,
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
  const commitRequested = acpr.requested ? acpr.requested.autoCommit : true;
  const prSatisfied =
    !prRequested || acpr.autoPRResult?.success === true || (await taskHasLinkedPr(taskId));
  const commitSatisfied = !commitRequested || acpr.autoCommitResult?.success === true;
  const noChange =
    ((prRequested && !prSatisfied) || !commitSatisfied) &&
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

  // A stop, an error or a failed requested commit is not a publication, even
  // when an earlier PR is already linked — never complete on top of it.
  const failure = noChange
    ? null
    : !acpr.requested
      ? (acpr.error ?? 'commit/PR の結果を取得できません')
      : (acpr.error ??
        (commitSatisfied ? null : (acpr.autoCommitResult?.error ?? 'コミットに失敗しました')));
  if (failure) {
    await writeBlockedTask(prisma, taskId).catch(() => {});
    await recordTransition({
      taskId,
      fromStatus: 'verify_done',
      toStatus: 'verify_done',
      actor: 'system',
      cause: 'verify_publication_failed',
      phase: 'verify',
      metadata: { reason: failure, reviewOverride: true },
      invariantViolation: true,
      invariantMessage: '上書き後の commit/PR が成功しなかったため、完了にしません。',
    }).catch(() => {});
    log.warn(
      { taskId, failure },
      '[review-hold] Publication after override failed — not completed',
    );
    return 'publication_failed';
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
