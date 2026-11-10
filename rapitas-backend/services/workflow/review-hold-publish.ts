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
 * The override is bound to the worktree, verify.md version and diff the human
 * looked at. Publication checks them first, and passes the binding to
 * performAutoCommitAndPR, which checks again right before and after it commits
 * in the worktree it actually uses. Any mismatch, or an identifier that cannot
 * be read, re-parks the task on the review hold instead of publishing.
 * Completion also requires the requested commit to have succeeded and no
 * stop/error from commit/PR, overall or from any single step (PR, merge). A
 * "no change" completion needs a step's own "nothing to publish" report:
 * filesChanged 0 also means "already committed", not "nothing to publish".
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
import {
  publishBindingDrift,
  type PublishBinding,
} from '../../routes/workflow/workflow-auto-commit-binding';
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

/** The worktree + verify.md version + diff a human override was given for. */
export type OverrideBinding = PublishBinding;

/** Put the task back on the hold it was overridden from, recording why. */
async function reHold(
  taskId: number,
  ctx: { binding: OverrideBinding; hold: ReviewHoldDetails },
  mismatch: string,
): Promise<'binding_mismatch'> {
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
  // Early, cheap refusal; the commit side repeats this check where it commits.
  const mismatch = await publishBindingDrift(taskId, ctx.binding.worktreePath, ctx.binding);
  if (mismatch) return reHold(taskId, ctx, mismatch);

  const { performAutoCommitAndPR, isNoChangeCompletion } =
    await import('../../routes/workflow/workflow-auto-commit');
  const acpr = await performAutoCommitAndPR(taskId, verifyContent, {
    binding: ctx.binding,
  }).catch(
    (err: unknown) =>
      ({
        error: `commit/PR が例外で終了しました: ${err instanceof Error ? err.message : String(err)}`,
      }) as Awaited<ReturnType<typeof performAutoCommitAndPR>>,
  );

  if (acpr.bindingMismatch) return reHold(taskId, ctx, acpr.bindingMismatch);

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
  // "Nothing to publish" must be CONFIRMED by a step's own report (git's "No
  // commits between" / "nothing to commit"). NOTE: filesChanged 0 alone is not
  // a confirmation — it also comes from an already-committed tree, where a
  // failed PR step (auth, network) still means work was never published. It
  // is passed only to veto (a commit that changed files is never "no change").
  const filesChanged = acpr.autoCommitResult?.filesChanged;
  const noChange =
    ((prRequested && !prSatisfied) || !commitSatisfied) &&
    isNoChangeCompletion({
      errorBlob: `${acpr.autoPRResult?.error ?? ''} ${acpr.autoCommitResult?.error ?? ''} ${acpr.error ?? ''}`,
      filesChanged: typeof filesChanged === 'number' && filesChanged > 0 ? filesChanged : undefined,
    });

  const blockPublication = async (failure: string): Promise<'publication_failed'> => {
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
  };

  // A stop or an overall error is not a publication, even when an earlier PR
  // is already linked or nothing seems to have changed. Checked BEFORE the
  // missing-PR branch: a stopped task must not be handed to the PR-only retry.
  const overall = acpr.requested ? acpr.error : (acpr.error ?? 'commit/PR の結果を取得できません');
  if (overall) return blockPublication(overall);

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

  // Each step's own failure blocks too: a requested commit that failed, a PR
  // step that failed (e.g. the push to an already-linked PR), or a merge that
  // was attempted and failed (a watcher hand-off is `deferred`, not a failure).
  const stepFailure =
    (commitSatisfied || noChange
      ? null
      : (acpr.autoCommitResult?.error ?? 'コミットに失敗しました')) ??
    (acpr.autoPRResult?.success === false && !noChange
      ? (acpr.autoPRResult.error ?? 'PR の作成または更新に失敗しました')
      : null) ??
    (acpr.autoMergeResult?.success === false && !acpr.autoMergeResult.deferred
      ? (acpr.autoMergeResult.error ?? 'マージに失敗しました')
      : null);
  if (stepFailure) return blockPublication(stepFailure);

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
