/**
 * auto-run-advance-select
 *
 * The no-current-task branch of the auto-run scheduler's advance step: global
 * concurrency gate, merge barrier, self-deploy restart checks, next-task
 * selection, all_done/all_blocked idling with backlog refill, and enqueue.
 * Extracted verbatim from ThemeAutoRunScheduler.advanceTheme (task 628).
 * Not responsible for resolving the CURRENT task (see auto-run-advance-active).
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';
import { WorkflowQueueService } from '../workflow-queue';
import { promoteBacklogForTheme } from './backlog-task-promoter';
import { maybeRestartForUpdate } from './dev-restart-on-dry';
import { logCycleEvent } from '../../observability';
import {
  AUTO_RUN_GLOBAL_MAX_CONCURRENCY,
  overlappingFiles,
  selectNextTask,
  recentThemeSuccessRate,
  type ScopeOverlapContext,
} from './auto-run-selection';
import { getOpenAutoPrsForTheme, getPrChangedFiles } from './open-pr-files-cache';
import {
  getMergeBarrierMaxHoldMs,
  readMergeBarrierEnabled,
  shouldHoldForBarrier,
} from '../../scheduling/merge-barrier/merge-barrier';
import { setCurrentTask } from './theme-auto-run-service';
import {
  notifyAllDone,
  notifyAllBlocked,
  notifyResourceContentionHold,
} from './auto-run-notifications';
import { countEscalatedBlocked } from '../blocked-task-escalation';
import { broadcastAutoRunUpdateImpl } from './auto-run-lifecycle';
import { getHostCpuBusyPercent } from '../../system/resource-telemetry';
import { evaluateResourceGate, consumeResourceGateOverride } from './resource-contention-gate';

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

  // Resource-contention gate (task 725, default OFF): when a session has
  // intentionally raised concurrency above 1 AND the host CPU is busy, hold
  // next-task selection for one cycle instead of piling on more agents. A
  // pending manual override ("今すぐ実行") bypasses this check entirely for
  // exactly one cycle, so it is consumed before the gate is even evaluated.
  if (
    process.env.RAPITAS_RESOURCE_GATE_ENABLED === 'true' &&
    !consumeResourceGateOverride(themeId)
  ) {
    const thresholdPercent = Number(process.env.RAPITAS_RESOURCE_CPU_THRESHOLD_PERCENT || 85);
    const gate = evaluateResourceGate({
      enabled: true,
      effectiveMaxConcurrency: WorkflowQueueService.getInstance().getMaxConcurrency(),
      hostCpuBusyPercent: getHostCpuBusyPercent(),
      thresholdPercent,
      overridden: false,
    });
    if (gate.hold && gate.cpuBusyPercent !== null) {
      logCycleEvent('task.resource_hold', {
        theme: themeId,
        cause: 'host_cpu_busy',
        cpuBusyPercent: gate.cpuBusyPercent,
        thresholdPercent: gate.thresholdPercent,
        effectiveMaxConcurrency: gate.effectiveMaxConcurrency,
        msg: 'resource-contention gate — holding next-task selection for one cycle',
      });
      await prisma.activityLog
        .create({
          data: {
            taskId: null,
            action: 'auto_run.resource_deferred',
            metadata: JSON.stringify({
              themeId,
              cpuBusyPercent: gate.cpuBusyPercent,
              thresholdPercent: gate.thresholdPercent,
              effectiveMaxConcurrency: gate.effectiveMaxConcurrency,
            }),
          },
        })
        .catch((err) => {
          log.warn({ err, themeId }, '[ThemeAutoRunScheduler] Failed to record resource hold');
        });
      await notifyResourceContentionHold(themeId, gate.cpuBusyPercent, gate.thresholdPercent);
      return;
    }
  }

  // Merge barrier (task 573 C, default OFF): while the theme still has an
  // OPEN auto-created PR, hold next-task selection until it merges/closes —
  // or until the hold ceiling passes (deadlock release for a PR stuck open
  // on red CI / manual review). Open-PR lookup failures fail open (no hold).
  const openAutoPrs = await getOpenAutoPrsForTheme(prisma, themeId).catch(() => []);
  if (readMergeBarrierEnabled()) {
    const holdSince = barrierHoldSince.get(themeId) ?? null;
    if (
      shouldHoldForBarrier(
        true,
        openAutoPrs.length > 0,
        holdSince,
        Date.now(),
        getMergeBarrierMaxHoldMs(),
      )
    ) {
      if (holdSince === null) barrierHoldSince.set(themeId, Date.now());
      logCycleEvent('task.barrier_hold', {
        theme: themeId,
        cause: 'open_pr_wait',
        prNumbers: openAutoPrs.map((p) => p.prNumber),
        holdMs: holdSince === null ? 0 : Date.now() - holdSince,
        msg: 'merge barrier — holding next-task selection until the open auto-PR merges',
      });
      return;
    }
    // Released: PR set went empty (merged/closed) or the hold timed out.
    barrierHoldSince.delete(themeId);
  } else {
    barrierHoldSince.delete(themeId);
  }

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
      // all_blocked shares the all_done idle path on purpose (task 615):
      // staying 'running' against a fully-wedged theme would spin forever,
      // and a backlog refill is the natural unblocker (a promoted todo lets
      // processIdleThemes resume). Only the REPORTING differs below, so a
      // wedged loop is never mistaken for a normal completion.
      const allBlocked = result.reason === 'all_blocked';
      // Optional dev safety: when enabled, this quiet point (no live agents) is
      // the safe moment to restart and pick up committed fixes BEFORE creating
      // more tasks. Only fires when HEAD moved since boot + no agents anywhere +
      // not rate-limited; otherwise it's a no-op. If it restarts, stop here.
      if (await maybeRestartForUpdate(themeId)) return;

      // Before idling, refill from the backlog (open concerns first, then ideas
      // once concerns are clear) up to the per-theme cap, so a theme that ran
      // out of work keeps progressing. When tasks were created, stay active —
      // the next tick selects them.
      const created = await promoteBacklogForTheme(themeId).catch((err) => {
        log.warn({ err, themeId }, '[ThemeAutoRunScheduler] Backlog promotion failed');
        return 0;
      });
      if (created > 0) {
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
      // All tasks done and backlog empty/capped/disabled — go idle but stay
      // ARMED (enabled:true) so processIdleThemes auto-resumes when new work
      // appears (a backlog job adds a concern/idea, or a freed cap slot lets a
      // promotion happen). A USER stop sets enabled:false (finalizeStop) and is
      // therefore never auto-resumed. This closes the perpetual loop.
      await prisma.themeAutoRun.updateMany({
        where: { themeId },
        data: { status: 'idle', enabled: true, currentTaskId: null },
      });
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
          msg: 'all runnable tasks are blocked — wedged, idle but armed',
        });
        await notifyAllBlocked(themeId, blockedCount, escalatedCount);
      } else {
        log.info(`[ThemeAutoRunScheduler] Theme ${themeId} — all tasks done, idle (armed)`);
        logCycleEvent('theme.idle', {
          theme: themeId,
          cause: 'all_done_backlog_empty',
          msg: 'all tasks done, idle but armed (awaiting new work)',
        });
        await notifyAllDone(themeId);
      }
      broadcastAutoRunUpdateImpl(themeId);
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
    await prisma.task
      .update({ where: { id: taskId }, data: { workflowStatus: 'draft' } })
      .catch(() => {});
    log.info(
      `[ThemeAutoRunScheduler] Task ${taskId} re-run — reset stale workflowStatus ${picked.workflowStatus} → draft`,
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
 * Build the scope-overlap selection context (task 573 B): the union of
 * changed files across the theme's open auto-PRs (gh, TTL-cached) plus a
 * plan-file loader (WorkflowFile plan → parsePlanFiles). Returns undefined
 * whenever there is nothing to compare (no open PRs, no cwd, no files) so
 * selection keeps its legacy path.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme being advanced / 対象テーマ
 * @param openAutoPrs - The theme's open auto-created PRs / オープン自動PR一覧
 */
async function buildScopeOverlapContext(
  prisma: PrismaClient,
  themeId: number,
  openAutoPrs: Array<{ prNumber: number }>,
): Promise<ScopeOverlapContext | undefined> {
  if (openAutoPrs.length === 0) return undefined;
  const theme = await prisma.theme
    .findUnique({ where: { id: themeId }, select: { workingDirectory: true } })
    .catch(() => null);
  const cwd = theme?.workingDirectory;
  if (!cwd) return undefined;

  const fileSets = await Promise.all(openAutoPrs.map((pr) => getPrChangedFiles(cwd, pr.prNumber)));
  const openPrFiles = [...new Set(fileSets.flat())];
  if (openPrFiles.length === 0) return undefined; // gh failed for all → fail-open

  return {
    openPrFiles,
    getPlanFiles: async (taskId: number) => {
      // Lazy import keeps the workflow-file module graph out of this
      // scheduler's static test surface.
      const { readWorkflowFile } = await import('../workflow-file-utils');
      const { parsePlanFiles } = await import('../../agents/verification/scope-check');
      const plan = await readWorkflowFile(taskId, 'plan').catch(() => null);
      if (!plan) return []; // no plan (lightweight) → never deferred
      return parsePlanFiles(plan);
    },
  };
}
