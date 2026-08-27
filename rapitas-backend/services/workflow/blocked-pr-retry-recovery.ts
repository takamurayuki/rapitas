/**
 * blocked-pr-retry-recovery
 *
 * Lightweight recovery for a task blocked by `verify_pr_not_created` (task
 * 673): retry PR creation ONCE, in place, instead of the full
 * `workflowStatus:'draft'` reset that discards the already-completed
 * implementation and commit. Not responsible for the blind full-reset
 * fallback itself — see workflow-reconciler-requeue.ts's requeueBlockedTasks,
 * which calls {@link attemptPrOnlyRecovery} before that fallback and falls
 * through unchanged on failure.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { readWorkflowFile } from './workflow-file-utils';
import { recordTransition } from './transition-recorder';
import { taskHasLinkedPr } from './workflow-cli-executor-helpers';
import { PR_RETRY_LIGHTWEIGHT_CAUSE } from './blocked-task-policy';

const log = createLogger('workflow:blocked-pr-retry-recovery');

/**
 * Retry PR creation for a task blocked by `verify_pr_not_created`, without
 * resetting workflowStatus or re-running research/plan/implement. Reuses the
 * existing verify.md body and the same commit/PR pipeline the verify gates
 * already call (performAutoCommitAndPR), so this is exactly what those gates
 * would have done on a second attempt — just without duplicating the attempt
 * across two independent gate implementations (see verify-self-repair.ts's
 * hasFreshVerifyRejection, which now vetoes that duplication going forward).
 *
 * NOTE: This recovery path is NOT part of `classifyBlockedExclusion`'s
 * exclusion set (blocked-task-policy.ts) — it runs BEFORE that blind-retry
 * split and either completes the task (returns true) or leaves state
 * unchanged for the caller's existing fallback (returns false). No sync
 * contract with classifyBlockedExclusion applies here.
 *
 * @param taskId - Task blocked by a failed PR-creation attempt. / PR作成失敗でblockedになったタスク
 * @returns True when the task was completed by this recovery. / このリカバリで完了させたか
 */
export async function attemptPrOnlyRecovery(taskId: number): Promise<boolean> {
  // Another process may have already landed the PR (e.g. a concurrent manual
  // retry) — avoid a redundant second PR-creation attempt.
  if (await taskHasLinkedPr(taskId)) {
    const completed = await prisma.task
      .updateMany({
        where: { id: taskId, workflowStatus: 'verify_done' },
        data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
      })
      .catch(() => ({ count: 0 }));
    if (completed.count > 0) {
      await recordTransition({
        taskId,
        fromStatus: 'verify_done',
        toStatus: 'completed',
        actor: 'system',
        cause: 'verify_passed',
        phase: 'verify',
        metadata: { lightweightRetry: true, reason: 'PR already linked' },
      });
      log.info({ taskId }, '[blocked-pr-retry-recovery] PR already linked — completed in place');
    }
    return true;
  }

  const verifyContent = (await readWorkflowFile(taskId, 'verify')) ?? '';

  // Dynamic import avoids a routes↔services import cycle (mirrors
  // workflow-cli-executor-verify-gate.ts's own performAutoCommitAndPR call).
  const { performAutoCommitAndPR } = await import('../../routes/workflow/workflow-auto-commit');
  const acpr = await performAutoCommitAndPR(taskId, verifyContent).catch(
    () => ({}) as Awaited<ReturnType<typeof performAutoCommitAndPR>>,
  );
  const prSatisfied = acpr.autoPRResult?.success === true || (await taskHasLinkedPr(taskId));

  if (!prSatisfied) {
    await recordTransition({
      taskId,
      fromStatus: 'verify_done',
      toStatus: 'verify_done',
      actor: 'system',
      cause: PR_RETRY_LIGHTWEIGHT_CAUSE,
      phase: 'verify',
      metadata: {
        commit: acpr.autoCommitResult?.success,
        prError: acpr.autoPRResult?.error,
        error: acpr.error,
      },
    });
    log.warn(
      { taskId, prError: acpr.autoPRResult?.error, error: acpr.error },
      '[blocked-pr-retry-recovery] Lightweight PR retry failed — falling through to existing fallback',
    );
    return false;
  }

  // Compare-and-swap on verify_done (verify-commit-pr-pipeline.ts's
  // noChangeCompletion pattern): a concurrent HTTP pipeline run may complete
  // the same task between the checks above and here.
  const completed = await prisma.task
    .updateMany({
      where: { id: taskId, workflowStatus: 'verify_done' },
      data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
    })
    .catch(() => ({ count: 0 }));
  if (completed.count === 0) {
    log.warn(
      { taskId },
      '[blocked-pr-retry-recovery] Task already completed by a concurrent run — skipping duplicate transition',
    );
    return true;
  }

  await recordTransition({
    taskId,
    fromStatus: 'verify_done',
    toStatus: 'completed',
    actor: 'system',
    cause: 'verify_passed',
    phase: 'verify',
    metadata: {
      lightweightRetry: true,
      commit: acpr.autoCommitResult?.success,
      pr: acpr.autoPRResult?.success,
    },
  });
  log.info(
    { taskId, prUrl: acpr.autoPRResult?.prUrl },
    '[blocked-pr-retry-recovery] Lightweight PR retry succeeded — task completed without a full reset',
  );
  return true;
}
