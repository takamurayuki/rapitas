/**
 * verify-settle-artifact-recovery
 *
 * Last line of defence before the WorkflowRunner declares a `verify_done` task
 * stuck: checks the DB's primary evidence (a PR linked to the task) and, when
 * the work has demonstrably landed, completes the task instead of blocking it.
 * Not responsible for deciding whether the automation is still running — that
 * is verify-completion-inflight; this only rescues a task whose success is
 * already on record but whose status row never caught up.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
import {
  resolveAutomationPolicy,
  resolveLandingMode,
  isStagedCompletionEnabled,
} from './automation-policy';

const log = createLogger('workflow:verify-settle-artifact-recovery');

/** A recorded PR with a required merge belongs to the merge watcher. */
export async function isAwaitingRequiredMerge(taskId: number): Promise<boolean> {
  const policy = await resolveAutomationPolicy(prisma, taskId);
  return policy.autoMergePR && !!(await findLandedPullRequest(taskId));
}

/**
 * Whether the merge watcher has filed a conflict-resolution task for this
 * task's PR since its latest verify.md save. That resolver needs the theme's
 * single execution slot — the slot the runner is holding while it waits for
 * this very merge (task 1053, 2026-09-25: PR #813 DIRTY, resolver #1078 filed
 * at 02:17, theme spun "zero progress" for an hour behind the 90-minute hold).
 *
 * @param taskId - Task sitting at verify_done. / verify_done のタスクID
 * @returns True when a resolver task is pending for the current PR. / 解消タスク待ちなら true
 */
export async function hasConflictResolutionPending(taskId: number): Promise<boolean> {
  const lastVerify = await prisma.workflowTransition.findFirst({
    where: { taskId, cause: 'file_saved:verify' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const filed = await prisma.workflowTransition.findFirst({
    where: {
      taskId,
      cause: 'auto_merge_conflict_filed',
      ...(lastVerify ? { createdAt: { gte: lastVerify.createdAt } } : {}),
    },
    select: { id: true },
  });
  return filed !== null;
}

/**
 * Whether a `pr`-mode task (autoCreatePR without autoMergePR) is waiting for
 * its PR's CI to go green before completion, under staged completion. Mirrors
 * {@link isAwaitingRequiredMerge}'s shape but for the CI-green (not merge)
 * landing point — the gap that let task 873 complete on PR creation alone.
 *
 * @param taskId - Task to evaluate. / 対象タスクID
 * @returns True when in `pr` mode, staged completion is enabled, and a PR is on record. / pr モード×staged有効×PR実在の場合true
 */
export async function isAwaitingStagedPrCompletion(taskId: number): Promise<boolean> {
  const policy = await resolveAutomationPolicy(prisma, taskId);
  if (resolveLandingMode(policy) !== 'pr') return false;
  if (!isStagedCompletionEnabled()) return false;
  return !!(await findLandedPullRequest(taskId));
}

/**
 * Whether a pull request is on record for the task, via the app-linked
 * `GitHubPullRequest.linkedTaskId` first and `Task.githubPrId` as fallback —
 * the same two-step lookup the commit/PR pipeline's PR-required gate uses.
 *
 * @param taskId - Task to look up. / 対象タスクID
 * @returns The PR reference found, or null when none is on record. / 見つかったPR参照
 */
async function findLandedPullRequest(
  taskId: number,
): Promise<{ source: 'linked_pr' | 'task_github_pr_id'; ref: number } | null> {
  const linked = await prisma.gitHubPullRequest.findFirst({
    where: { linkedTaskId: taskId },
    select: { id: true },
  });
  if (linked) return { source: 'linked_pr', ref: linked.id };
  const taskRow = await prisma.task.findUnique({
    where: { id: taskId },
    select: { githubPrId: true },
  });
  if (taskRow?.githubPrId != null) return { source: 'task_github_pr_id', ref: taskRow.githubPrId };
  return null;
}

/**
 * Complete a `verify_done` task whose PR already exists, so it is not judged
 * stuck. Compare-and-swap on `workflowStatus: 'verify_done'` — a concurrent
 * completion (the pipeline itself finishing, a duplicate save) wins and this
 * returns false rather than recording a second completion.
 *
 * Every failure path — no PR on record, the CAS losing, any DB error — yields
 * false so the caller falls through to its normal `stuck` verdict: this is a
 * safety net for a success that was already recorded, never an optimistic
 * completion of unknown work.
 *
 * @param taskId - Task the runner is about to declare stuck. / stuck 判定直前のタスクID
 * @returns True when the task was completed here from landed evidence. / 実在確認で完了させた場合 true
 */
export async function recoverFromLandedArtifact(taskId: number): Promise<boolean> {
  try {
    // PR existence cannot satisfy a required merge. The watcher confirms GitHub.
    const policy = await resolveAutomationPolicy(prisma, taskId);
    if (policy.autoMergePR) return false;
    const landed = await findLandedPullRequest(taskId);
    if (!landed) return false;

    const flipped = await prisma.task.updateMany({
      where: {
        id: taskId,
        workflowStatus: 'verify_done',
        status: { in: ['todo', 'in-progress', 'in_progress'] },
      },
      data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
    });
    if (flipped.count === 0) {
      log.info(
        { taskId, ...landed },
        '[VerifySettle] PR on record but the task already left verify_done — no recovery needed',
      );
      return false;
    }

    await recordTransition({
      taskId,
      fromStatus: 'verify_done',
      toStatus: 'completed',
      actor: 'system',
      cause: 'verify_settle_artifact_recovered',
      phase: 'verify',
      metadata: { prSource: landed.source, prRef: landed.ref },
    });
    log.warn(
      { taskId, ...landed },
      '[VerifySettle] Task was about to be judged stuck, but its PR already exists — completed from landed evidence instead of blocking',
    );
    return true;
  } catch (err) {
    log.warn(
      { err, taskId },
      '[VerifySettle] Landed-artifact check failed — falling through to the normal stuck verdict',
    );
    return false;
  }
}
