/**
 * workflow-reconciler-requeue
 *
 * Recovery heals that put a stranded task back on the auto-run path: orphaned
 * in-progress tasks, bounded blocked-task retries, and undispatchable
 * status/workflowStatus desyncs. Called only from the workflow-reconciler's
 * periodic pass — NOT responsible for scheduling or detection cadence.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';
// NOTE: Thresholds live in blocked-task-policy (task 615) so the evidence /
// escalation passes share the same constants — behavior here is unchanged.
import {
  BLOCKED_RETRY_SETTLE_MS,
  MAX_ORPHAN_REQUEUE_AGE_MS,
  MAX_BLOCKED_RETRY,
  MAX_PR_RECOVERY_ATTEMPTS,
  ORPHAN_REQUEUE_EXHAUSTED_CAUSE,
  resolveVerifyRepairLimit,
  VERIFY_NON_CONVERGENCE_CAUSE,
  VERIFICATION_UNVERIFIABLE_HOLD_CAUSE,
  MANUAL_CORRECTION_PENDING_CAUSE,
  PR_RETRY_LIGHTWEIGHT_CAUSE,
} from './blocked-task-policy';
import { isAwaitingRequiredMerge } from './verify-settle-artifact-recovery';
import { hasLiveExecution } from './workflow-reconciler-undispatchable';

export { ACTIVE_EXEC, healUndispatchableTodo } from './workflow-reconciler-undispatchable';

const log = createLogger('workflow-reconciler');

/** An in-progress task idle this long with no live execution is surfaced. */
export const STALE_TASK_MS = 45 * 60 * 1000;

/** Re-queue an orphan at most this many times before leaving it for notification. */
const MAX_ORPHAN_REQUEUE = 2;
/**
 * Orphan recovery: re-queue a genuinely-stuck in-progress task (no live agent,
 * stale, non-terminal workflowStatus) back to 'todo' so auto-run reruns it.
 * Guards: skips completed (healed elsewhere) and awaiting_question (paused),
 * skips ANCIENT orphans (likely abandoned), and caps re-queues so an orphan that
 * keeps dying isn't requeued forever — after the cap, flagOrphanTasks notifies.
 *
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns Number of tasks re-queued. / 再キュー数
 */
export async function requeueOrphanTasks(
  nowMs: number,
  excludedTaskIds: ReadonlySet<number> = new Set(),
): Promise<number> {
  const staleBefore = new Date(nowMs - STALE_TASK_MS);
  const notOlderThan = new Date(nowMs - MAX_ORPHAN_REQUEUE_AGE_MS);
  const tasks = await prisma.task
    .findMany({
      where: {
        status: 'in-progress',
        parentId: null,
        // halt (iteration budget) leaves status untouched; never re-queue a halted task.
        haltReason: null,
        updatedAt: { lt: staleBefore, gt: notOlderThan },
      },
      select: { id: true, title: true, workflowStatus: true },
    })
    .catch(() => [] as { id: number; title: string; workflowStatus: string | null }[]);

  let requeued = 0;
  for (const t of tasks) {
    // Do not bypass a failed repair receipt check through generic recovery.
    if (excludedTaskIds.has(t.id)) continue;
    if (t.workflowStatus === 'completed' || t.workflowStatus === 'awaiting_question') continue;
    // A task parked at verify_done/in-progress can be legitimately AWAITING the
    // AutoMergeWatcher's confirmation (task 895), not orphaned — its PENDING_TIMEOUT_MS
    // (90 min) is longer than STALE_TASK_MS (45 min), so this scan would otherwise
    // reset it to 'todo' mid-wait and dispatch a duplicate execution while the
    // original PR is still pending CI/merge. Fail-closed: an unreadable policy
    // must not be read as "not awaiting a merge".
    if (
      t.workflowStatus === 'verify_done' &&
      (await isAwaitingRequiredMerge(t.id).catch(() => true))
    ) {
      continue;
    }
    if (await hasLiveExecution(t.id)) continue;
    // A committed repair may just have been delivered by the preceding heal pass.
    if (
      await prisma.workflowQueueItem.findFirst({
        where: {
          taskId: t.id,
          status: { in: ['queued', 'running', 'waiting_approval'] },
        },
        select: { id: true },
      })
    )
      continue;

    const attempts = await prisma.workflowTransition.count({
      where: { taskId: t.id, cause: 'reconciler_requeue' },
    });
    if (attempts >= MAX_ORPHAN_REQUEUE) {
      // Requeue budget exhausted (task 977): leaving this as `continue` strands
      // the task in 'in-progress' forever — no other heal path picks it up
      // (not blocked, so requeueBlockedTasks never sees it), and
      // detectStagnation re-flags it every watch cycle indefinitely. Move it
      // to 'blocked' so it joins the existing blocked-task retry/escalation
      // pipeline instead. workflowStatus is intentionally left unchanged —
      // requeueBlockedTasks' own reset (blocked_auto_retry) is what resets it
      // to 'draft', preserving that existing artifact-reuse behavior.
      await prisma.task.update({
        where: { id: t.id },
        data: { status: 'blocked', updatedAt: new Date() },
      });
      await recordTransition({
        taskId: t.id,
        fromStatus: t.workflowStatus,
        toStatus: t.workflowStatus ?? 'draft',
        actor: 'system',
        cause: ORPHAN_REQUEUE_EXHAUSTED_CAUSE,
        metadata: { reason: 'orphan_requeue_attempts_exhausted', attempts },
      }).catch(() => {});
      log.info(
        { taskId: t.id, attempts, wf: t.workflowStatus },
        '[reconciler] Orphan requeue budget exhausted -> blocked (joins blocked-task retry/escalation pipeline)',
      );
      continue;
    }

    await prisma.task.update({
      where: { id: t.id },
      data: { status: 'todo', updatedAt: new Date() },
    });
    await recordTransition({
      taskId: t.id,
      fromStatus: t.workflowStatus,
      toStatus: t.workflowStatus ?? 'draft',
      actor: 'system',
      cause: 'reconciler_requeue',
      metadata: { reason: 'orphan_in_progress_no_execution', attempt: attempts + 1 },
    }).catch(() => {});
    requeued++;
    log.info(
      { taskId: t.id, attempt: attempts + 1, wf: t.workflowStatus },
      '[reconciler] Re-queued orphaned in-progress task -> todo',
    );
  }
  return requeued;
}

/**
 * Self-healing for the perpetual loop: auto-retry BLOCKED auto-created tasks so
 * a since-fixed bug no longer strands them holding the backlog-promotion cap.
 * Bounded by MAX_BLOCKED_RETRY; armed themes only (a user STOP is respected),
 * after a settle delay. Resets to 'todo' + workflowStatus 'draft' (research/
 * plan are reused via isReusableArtifact, so the re-run is cheap).
 *
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns Number of tasks retried. / 再試行数
 */
export async function requeueBlockedTasks(nowMs: number): Promise<number> {
  const settleBefore = new Date(nowMs - BLOCKED_RETRY_SETTLE_MS);
  const notOlderThan = new Date(nowMs - MAX_ORPHAN_REQUEUE_AGE_MS);

  // Respect user stops: only retry blocked tasks in themes that are still armed.
  const armed = await prisma.themeAutoRun
    .findMany({ where: { enabled: true, status: 'running' }, select: { themeId: true } })
    .catch(() => [] as { themeId: number }[]);
  const armedThemeIds = armed.map((a) => a.themeId);
  if (armedThemeIds.length === 0) return 0;

  // The verify->implement repair budget: a task that EXHAUSTED it needs
  // splitting / human attention, not auto-retry (re-queuing repeats the same
  // doomed cycle). Read via cast (column pending client regen).
  const settings = (await prisma.userSettings.findFirst().catch(() => null)) as {
    verifyRepairLimit?: number | null;
  } | null;
  const verifyRepairLimit = resolveVerifyRepairLimit(settings);

  const tasks = await prisma.task
    .findMany({
      where: {
        status: 'blocked',
        parentId: null,
        themeId: { in: armedThemeIds },
        // halted tasks stay excluded until explicitly resumed (mirrors auto-run-advance-select).
        haltReason: null,
        updatedAt: { lt: settleBefore, gt: notOlderThan },
      },
      select: { id: true, workflowStatus: true },
    })
    .catch(() => [] as { id: number; workflowStatus: string | null }[]);

  let retried = 0;
  for (const t of tasks) {
    // A live agent means it's not really stuck — skip.
    if (await hasLiveExecution(t.id)) continue;

    // Skip tasks PAUSED for the USER's answer. A blocked task whose workflowStatus
    // is 'awaiting_question' is not "stuck-blocked" — it is waiting for human input.
    // Auto-retrying it resets the workflow to draft, DESTROYS the pending question,
    // re-raises it, and loops (intake_question → blocked_auto_retry → intake_question
    // …, observed: task 363). It resumes via the answer-question endpoint, never a
    // blind retry — so leave it paused.
    if (t.workflowStatus === 'awaiting_question') continue;

    // Skip tasks that exhausted verify-repair — re-running repeats the same
    // failing implement→verify cycle (the task is too hard, needs splitting, not
    // blind retry). Count since the last manual retry so a user re-try grants a
    // fresh budget (mirrors verify-self-repair's countPriorRepairs).
    const lastRetry = await prisma.activityLog
      .findFirst({
        where: { taskId: t.id, action: 'task_retried' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      .catch(() => null);
    const repairs = await prisma.workflowTransition
      .count({
        where: {
          taskId: t.id,
          cause: 'verify_repair',
          ...(lastRetry ? { createdAt: { gt: lastRetry.createdAt } } : {}),
        },
      })
      .catch(() => 0);
    if (repairs >= verifyRepairLimit) {
      log.info(
        { taskId: t.id, repairs, verifyRepairLimit },
        '[reconciler] Blocked task exhausted verify-repair — leaving blocked (needs split/manual), not auto-retrying',
      );
      continue;
    }

    // Skip tasks CUT OFF for non-convergence (task 619): the same acceptance
    // criterion was flagged by 2+ repair bounces, so a blind retry would just
    // replay the treading-water loop and re-trigger the same cutoff. Same
    // window as the repair budget (reset by a manual retry).
    const nonConverged = await prisma.workflowTransition
      .count({
        where: {
          taskId: t.id,
          cause: VERIFY_NON_CONVERGENCE_CAUSE,
          ...(lastRetry ? { createdAt: { gt: lastRetry.createdAt } } : {}),
        },
      })
      .catch(() => 0);
    if (nonConverged > 0) {
      log.info(
        { taskId: t.id, nonConverged },
        '[reconciler] Blocked task was cut off for non-convergence — leaving blocked (needs split/spec revision), not auto-retrying',
      );
      continue;
    }

    // Skip tasks HELD because verification could not run (2026-09-13, task
    // 912): the hold is an infrastructure state a full reset cannot change —
    // it would only re-dispatch an implementer into the same UNVERIFIED gate.
    // Same window as the repair budget: a manual retry re-admits the task.
    const unverifiableHeld = await prisma.workflowTransition
      .count({
        where: {
          taskId: t.id,
          cause: VERIFICATION_UNVERIFIABLE_HOLD_CAUSE,
          ...(lastRetry ? { createdAt: { gt: lastRetry.createdAt } } : {}),
        },
      })
      .catch(() => 0);
    if (unverifiableHeld > 0) {
      log.info(
        { taskId: t.id, unverifiableHeld },
        '[reconciler] Blocked task is held as unverifiable — leaving blocked (restore verification / manual retry), not auto-retrying',
      );
      continue;
    }

    // Skip tasks whose blocked status was set by a manual/system correction
    // determining the landed PR did NOT merge (task 873/948): a blind reset
    // would discard that determination and either re-run stale work or race
    // the follow-up task it spawned. Same window as the repair budget (a
    // manual retry re-admits the task).
    const manualCorrectionPending = await prisma.workflowTransition
      .count({
        where: {
          taskId: t.id,
          cause: MANUAL_CORRECTION_PENDING_CAUSE,
          ...(lastRetry ? { createdAt: { gt: lastRetry.createdAt } } : {}),
        },
      })
      .catch(() => 0);
    if (manualCorrectionPending > 0) {
      log.info(
        { taskId: t.id, manualCorrectionPending },
        '[reconciler] Blocked task has a pending manual correction (PR did not land) — leaving blocked, not auto-retrying',
      );
      continue;
    }

    // PR-creation-recovery exhaustion (task 713): unwindowed, so a full reset
    // does not reset this count — the PR-creation failure pattern persists
    // across resets even though the implementation gets discarded. Checked
    // BEFORE the lightweight retry below so an exhausted task stops
    // attempting PR creation entirely (matches classifyBlockedExclusion's
    // pr_recovery_exhausted, which then escalates it on the next pass).
    const totalPrNotCreated = await prisma.workflowTransition
      .count({ where: { taskId: t.id, cause: 'verify_pr_not_created' } })
      .catch(() => 0);
    if (totalPrNotCreated >= MAX_PR_RECOVERY_ATTEMPTS) {
      log.info(
        { taskId: t.id, totalPrNotCreated },
        '[reconciler] Blocked task exhausted PR-creation recovery — leaving blocked for escalation, not auto-retrying',
      );
      continue;
    }

    // Lightweight PR-only recovery (task 673/681): before the full reset
    // below discards an already-completed implementation, try ONE lightweight
    // PR retry for a task blocked purely by a failed PR-creation attempt.
    // Runs BEFORE the attempts/MAX_BLOCKED_RETRY check so it never consumes
    // that (full-reset) budget, and still applies once that budget is
    // exhausted — an exhausted full-reset budget says nothing about whether
    // the PR-only path was ever tried. Gated to exactly one attempt per
    // window via the PR_RETRY_LIGHTWEIGHT_CAUSE count.
    const prNotCreated = await prisma.workflowTransition
      .count({
        where: {
          taskId: t.id,
          cause: 'verify_pr_not_created',
          ...(lastRetry ? { createdAt: { gt: lastRetry.createdAt } } : {}),
        },
      })
      .catch(() => 0);
    if (prNotCreated > 0) {
      const lightweightAttempted = await prisma.workflowTransition
        .count({
          where: {
            taskId: t.id,
            cause: PR_RETRY_LIGHTWEIGHT_CAUSE,
            ...(lastRetry ? { createdAt: { gt: lastRetry.createdAt } } : {}),
          },
        })
        .catch(() => 0);
      if (lightweightAttempted === 0) {
        const { attemptPrOnlyRecovery } = await import('./blocked-pr-retry-recovery');
        const outcome = await attemptPrOnlyRecovery(t.id).catch((err) => {
          log.warn({ err, taskId: t.id }, '[reconciler] Lightweight PR retry threw');
          return 'failed' as const;
        });
        if (outcome === 'held' || outcome === 'completed') {
          retried++;
          log.info(
            { taskId: t.id, outcome },
            '[reconciler] Lightweight PR retry recovered blocked task (no full reset)',
          );
          continue;
        }
        // 'declined_stopped' (theme/task stopped) and 'cas_lost' (row already
        // moved on concurrently) must NOT fall through to the blind full reset
        // below — resetting either would re-dispatch a brand-new execution,
        // which is exactly the post-stop automatic action AGENTS.md forbids, or
        // would overwrite whatever state the row concurrently moved to (task
        // 895 verifier finding, 2nd repair round). Only a genuine 'failed'
        // (real PR-creation failure) is safe for the existing fallback below.
        if (outcome === 'declined_stopped' || outcome === 'cas_lost') {
          log.info(
            { taskId: t.id, outcome },
            '[reconciler] Lightweight PR retry declined (stop-derived or concurrent state change) — leaving blocked untouched, not falling through to full reset',
          );
          continue;
        }
      }
    }

    const attempts = await prisma.workflowTransition
      .count({ where: { taskId: t.id, cause: 'blocked_auto_retry' } })
      .catch(() => 0);
    if (attempts >= MAX_BLOCKED_RETRY) continue;

    await prisma.task
      .update({
        where: { id: t.id },
        data: { status: 'todo', workflowStatus: 'draft', updatedAt: new Date() },
      })
      .catch(() => {});
    await recordTransition({
      taskId: t.id,
      fromStatus: t.workflowStatus,
      toStatus: 'draft',
      actor: 'system',
      cause: 'blocked_auto_retry',
      metadata: { reason: 'blocked_task_auto_retry', attempt: attempts + 1 },
    }).catch(() => {});
    retried++;
    log.info(
      { taskId: t.id, attempt: attempts + 1, wf: t.workflowStatus },
      '[reconciler] Auto-retried blocked task -> todo (draft)',
    );
  }
  return retried;
}
