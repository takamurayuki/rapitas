/**
 * auto-run-advance-select
 *
 * The no-current-task branch of the auto-run scheduler's advance step:
 * global concurrency gate, resource/merge-barrier holds (auto-run-advance-
 * gates.ts), self-deploy restart checks, next-task selection, all_done/
 * all_blocked idling with gated backlog refill (task 784), and enqueue.
 * Extracted verbatim from ThemeAutoRunScheduler.advanceTheme (task 628).
 * Not responsible for resolving the CURRENT task (see auto-run-advance-active).
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';
import { promoteBacklogForTheme } from './backlog-task-promoter';
import { maybeRestartForUpdate } from './dev-restart-on-dry';
import { logCycleEvent } from '../../observability';
import {
  AUTO_RUN_GLOBAL_MAX_CONCURRENCY,
  overlappingFiles,
  selectNextTask,
  recentThemeSuccessRate,
} from './auto-run-selection';
import { getOpenAutoPrsForTheme } from './open-pr-files-cache';
import { checkResourceContentionGate, checkMergeBarrierGate } from './auto-run-advance-gates';
import { buildScopeOverlapContext } from './auto-run-advance-scope';
import { setCurrentTask } from './theme-auto-run-service';
import {
  getIdleStopMinutes,
  getSelfRefillWindowStart,
  isWithinSelfRefillWindow,
  shouldRefillBacklogNow,
  markSelfRefillSucceeded,
} from './auto-run-idle-timer';
import { notifyAllDone, notifyAllBlocked } from './auto-run-notifications';
import { countEscalatedBlocked } from '../blocked-task-escalation';
import { broadcastAutoRunUpdateImpl } from './auto-run-lifecycle';
import { WorkflowQueueService } from '../workflow-queue';
import { recordTransition } from '../transition-recorder';

const log = createLogger('theme-auto-run-scheduler');

/**
 * Select and enqueue the next eligible task for a running theme that has no
 * current task (the no-current-task branch of advanceTheme).
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme to advance / 進めるテーマID
 * @param order - Task selection order / タスク選択順序
 * @param globalActive - Current global auto-run active count / グローバルアクティブ数
 * @param barrierHoldSince - Per-theme merge-barrier hold start (epoch ms), owned by the scheduler / マージバリア保留開始時刻
 */
export async function selectAndEnqueueNextTask(
  prisma: PrismaClient,
  themeId: number,
  order: 'priority' | 'created',
  globalActive: number,
  barrierHoldSince: Map<number, number>,
): Promise<void> {
  // No current task — select and enqueue the next one
  if (globalActive >= AUTO_RUN_GLOBAL_MAX_CONCURRENCY) {
    return; // global limit reached
  }

  if (await checkResourceContentionGate(prisma, themeId)) return;

  const openAutoPrs = await getOpenAutoPrsForTheme(prisma, themeId).catch(() => []);
  if (checkMergeBarrierGate(themeId, openAutoPrs, barrierHoldSince)) return;

  const skipIds: number[] = [];
  // Get blocked task IDs to skip
  const blockedTasks = await prisma.task.findMany({
    where: { themeId, status: 'blocked' },
    select: { id: true },
  });
  skipIds.push(...blockedTasks.map((t) => t.id));

  // Self-deploy at the TASK BOUNDARY (event-driven). We reach here only between
  // tasks — the prior one finished and the next is not yet selected — so it is a
  // reliable 0-agent moment. The tick poll and the all_done branch both MISSED
  // continuous auto-run: with auto-create refilling the queue the theme rarely
  // reaches all_done, and the inter-task gap is shorter than the tick can sample
  // (observed: 0 restarts over 30 min while HEAD had moved). Firing it HERE
  // catches every task boundary. No-op unless HEAD moved + no live agents + not
  // rate-limited; if it restarts, the process exits and dev.js relaunches.
  if (await maybeRestartForUpdate(themeId)) return;

  // Merged-code boundary restart: merges NOT touching the loop machinery are
  // batched by the 15-min poller and activated here, at the same task
  // boundary, once every quiescence gate (executions, aux CLI children,
  // auto-merge tick, rate limit, UI quiet) passes. Placed AFTER
  // maybeRestartForUpdate (which returns above on fire) so the two restart
  // paths can never double-fire in one tick. Lazily imported behind the
  // TAURI gate: nothing but dev.js relaunches on exit 75, and test
  // environments must not load the scheduling module graph.
  if (process.env.TAURI_BUILD === 'true') {
    try {
      const { getAutoRestartMergedCodeScheduler } =
        await import('../../scheduling/auto-restart-merged-code');
      if (await getAutoRestartMergedCodeScheduler().evaluateBoundaryRestart()) return;
    } catch (err) {
      log.warn({ err }, '[ThemeAutoRunScheduler] Boundary merged-code restart check failed');
    }
  }

  // Learnable-band tiebreak (R6): recent success rate positions the target
  // complexity band; ties within a priority pick the task closest to it.
  const successRate = await recentThemeSuccessRate(prisma, themeId).catch(() => null);

  // Scope-overlap context (task 573 B): the union of changed files across the
  // theme's open auto-PRs, so selection can defer a candidate whose plan
  // touches the same files. Every failure path degrades to "no context"
  // (legacy selection) — a broken gh/DB must never stop the scheduler.
  const scopeOverlap = await buildScopeOverlapContext(prisma, themeId, openAutoPrs).catch(
    () => undefined,
  );
  const result = await selectNextTask(
    prisma,
    themeId,
    order,
    skipIds,
    globalActive,
    successRate,
    scopeOverlap,
  );

  // Observability (task 573 B3): record WHY each passed-over candidate was
  // deferred — the involved open PRs and the exact overlapping files.
  if (result.found && result.deferred && result.deferred.length > 0 && scopeOverlap) {
    for (const deferredId of result.deferred) {
      const planFiles = await scopeOverlap.getPlanFiles(deferredId).catch(() => []);
      logCycleEvent('task.deferred', {
        theme: themeId,
        task: deferredId,
        cause: 'scope_overlap',
        prNumbers: openAutoPrs.map((p) => p.prNumber),
        files: overlappingFiles(planFiles, scopeOverlap.openPrFiles).slice(0, 20),
        selected: result.taskId,
        msg: 'candidate deferred — plan files overlap an open auto-PR',
      });
    }
  }

  if (!result.found) {
    if (result.reason === 'all_done' || result.reason === 'all_blocked') {
      await handleNoWorkFound(prisma, themeId, result.reason === 'all_blocked');
    }
    return;
  }

  const taskId = result.taskId;

  // A re-run (a 'todo' task whose workflowStatus is a stale terminal state from
  // a prior run) has no forward transition from verify_done/completed — reset
  // it to 'draft' so the workflow actually re-runs (research/plan are reused
  // via isReusableArtifact, so this is cheap). Without this the task would be
  // dequeued and immediately fail "cannot advance from verify_done".
  const picked = await prisma.task
    .findUnique({ where: { id: taskId }, select: { workflowStatus: true } })
    .catch(() => null);
  if (picked?.workflowStatus === 'verify_done' || picked?.workflowStatus === 'completed') {
    const fromStatus = picked.workflowStatus;
    await prisma.task
      .update({ where: { id: taskId }, data: { workflowStatus: 'draft' } })
      .catch(() => {});
    // NOTE (task 755): this reset used to skip recordTransition, leaving no
    // audit trail for how the task got back to draft — the same shape every
    // other reconciler reset (blocked_auto_retry, reconciler_reset_undispatchable)
    // already records. Not added to RECOVERY_REQUEUE_CAUSES — this write moves
    // workflowStatus to 'draft' (the consistent not-started shape), so it never
    // produces the todo×advanced-workflowStatus desync Pattern B watches for.
    await recordTransition({
      taskId,
      fromStatus,
      toStatus: 'draft',
      actor: 'system',
      cause: 'stale_terminal_reset',
      metadata: { reason: 'auto_run_rerun_stale_terminal_workflow_status' },
    }).catch(() => {});
    log.info(
      `[ThemeAutoRunScheduler] Task ${taskId} re-run — reset stale workflowStatus ${fromStatus} → draft`,
    );
  }

  // Enqueue via WorkflowQueueService with themeId set
  try {
    // NOTE: getInstance() replaces the former scheduler `queue` field — same singleton (task 628).
    await WorkflowQueueService.getInstance().enqueue({ taskId, themeId, priority: 50 });
    await setCurrentTask(themeId, taskId);
    broadcastAutoRunUpdateImpl(themeId);
    log.info(`[ThemeAutoRunScheduler] Enqueued task ${taskId} for theme ${themeId}`);
    logCycleEvent('task.enqueued', {
      theme: themeId,
      task: taskId,
      msg: 'next task selected and enqueued',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already in the queue')) {
      // Race: already queued (e.g. by a previous tick that was slightly slow)
      // Set currentTaskId without re-enqueuing
      await setCurrentTask(themeId, taskId);
      log.warn(`[ThemeAutoRunScheduler] Task ${taskId} was already queued; tracking it`);
    } else {
      log.error({ err }, `[ThemeAutoRunScheduler] Failed to enqueue task ${taskId}`);
    }
  }
}

/**
 * No task was found (all_done/all_blocked): try the dev-dry restart (skipped
 * while the idle timer is armed — design point 7, stop takes priority over
 * restart), then a gated backlog refill (task 784), then go idle-but-armed.
 *
 * all_blocked shares the all_done idle path on purpose (task 615): staying
 * 'running' against a fully-wedged theme would spin forever, and a backlog
 * refill is the natural unblocker. Only the REPORTING differs, so a wedged
 * loop is never mistaken for a normal completion.
 */
async function handleNoWorkFound(
  prisma: PrismaClient,
  themeId: number,
  allBlocked: boolean,
): Promise<void> {
  // Design point 7 (task 784): the idle-stop takes priority — when the idle
  // timer is armed this dry point starts the timer instead of restarting
  // (the task-boundary restart above already covered HEAD movement between
  // tasks).
  const idleTimerArmed = (await getIdleStopMinutes()) > 0;
  if (!idleTimerArmed && (await maybeRestartForUpdate(themeId))) return;

  // Before idling, try a gated backlog refill (task 784: held while the idle
  // timer is actively counting, or outside the nightly self-refill window)
  // so a theme that ran out of work keeps progressing when allowed. When
  // tasks were created, stay active — the next tick selects them.
  const now = new Date();
  const canRefill = await shouldRefillBacklogNow(themeId, now);
  let created = 0;
  if (canRefill) {
    created = await promoteBacklogForTheme(themeId).catch((err) => {
      log.warn({ err, themeId }, '[ThemeAutoRunScheduler] Backlog promotion failed');
      return 0;
    });
    if (created > 0) {
      await markSelfRefillSucceeded(themeId, now);
      log.info(
        `[ThemeAutoRunScheduler] Theme ${themeId} — promoted ${created} backlog task(s); staying active`,
      );
      logCycleEvent('backlog.refill', {
        theme: themeId,
        created,
        msg: 'refilled from backlog — staying active',
      });
      broadcastAutoRunUpdateImpl(themeId);
      return;
    }
  }

  // All tasks done and backlog empty/capped/disabled/held — go idle but stay
  // ARMED (enabled:true) so processIdleThemes auto-resumes when new work
  // appears. A USER stop sets enabled:false (finalizeStop) and is therefore
  // never auto-resumed. This closes the perpetual loop. idleSince is set in
  // the SAME write (task 784) — the idle-stop timer's origin.
  await prisma.themeAutoRun.updateMany({
    where: { themeId },
    data: {
      status: 'idle',
      enabled: true,
      currentTaskId: null,
      idleSince: now,
    } as unknown as Parameters<typeof prisma.themeAutoRun.updateMany>[0]['data'],
  });

  // Observability (task 784): why self-refill was skipped, attached to the
  // SAME theme.idle event below instead of a separate cycle-event type.
  const refillSkippedReason = canRefill ? undefined : await computeRefillSkippedReason(now);

  if (allBlocked) {
    // Wedged, not finished: report with a DISTINCT cause + notification so
    // the dead loop is visible (previously indistinguishable from idle).
    // Same 'theme.idle' event as all_done — the machine distinction is the
    // `cause` field ('all_blocked' vs 'all_done_backlog_empty'), keeping
    // the cycle-event taxonomy untouched.
    const blockedCount = await prisma.task
      .count({ where: { themeId, status: 'blocked', parentId: null } })
      .catch(() => 0);
    const escalatedCount = await countEscalatedBlocked(prisma).catch(() => 0);
    log.info(
      `[ThemeAutoRunScheduler] Theme ${themeId} — ALL remaining tasks blocked (${blockedCount}), idle (armed)`,
    );
    logCycleEvent('theme.idle', {
      theme: themeId,
      cause: 'all_blocked',
      blocked: blockedCount,
      escalated: escalatedCount,
      refillSkippedReason,
      msg: 'all runnable tasks are blocked — wedged, idle but armed',
    });
    await notifyAllBlocked(themeId, blockedCount, escalatedCount);
  } else {
    log.info(`[ThemeAutoRunScheduler] Theme ${themeId} — all tasks done, idle (armed)`);
    logCycleEvent('theme.idle', {
      theme: themeId,
      cause: 'all_done_backlog_empty',
      refillSkippedReason,
      msg: 'all tasks done, idle but armed (awaiting new work)',
    });
    await notifyAllDone(themeId);
  }
  broadcastAutoRunUpdateImpl(themeId);
}

/**
 * Best-effort explanation for why shouldRefillBacklogNow returned false at
 * the just-idled instant (idleSince == now), for the theme.idle cycle event
 * (task 784). Re-derives from the same pure predicates rather than changing
 * shouldRefillBacklogNow's boolean contract.
 */
async function computeRefillSkippedReason(
  now: Date,
): Promise<'outside_window' | 'already_refilled_today' | 'timer_active'> {
  // idleSince was just set to `now` in the same write, so at this exact
  // instant the timer (when armed) is always actively counting (elapsed=0).
  if ((await getIdleStopMinutes()) > 0) return 'timer_active';
  const windowStart = await getSelfRefillWindowStart();
  if (!isWithinSelfRefillWindow(now, windowStart)) return 'outside_window';
  return 'already_refilled_today';
}
