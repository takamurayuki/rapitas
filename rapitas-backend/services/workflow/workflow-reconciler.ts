/**
 * Workflow Reconciler
 *
 * Periodic self-healing for known state-divergence classes that otherwise
 * require a manual reload / backend restart to clear. Runs on a timer (and once
 * after startup). Every repair is conservative, idempotent, and best-effort —
 * it only acts on states that cannot be a legitimately-running phase.
 *
 * Repairs:
 *  1. Zombie session — an `active` AgentSession with no activity for longer than
 *     any possible phase (well beyond the phase timeout), not awaiting user
 *     input → finalize the session + its stuck executions. Fixes the "進行中 /
 *     execution-status returns a running session forever" symptom.
 *  2. Phantom worktree — a terminal session still referencing a worktreePath
 *     that no longer exists on disk → clear it (the next run recreates).
 *  3. Orphan task (detect + notify) — an in-progress task with no live execution
 *     for a long time → surface it so the operator can re-run (no auto-mutation).
 *
 * NOT responsible for selecting/advancing phases — only for clearing divergence.
 */
import { existsSync } from 'fs';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { createNotification } from '../communication/notification-service';
import { recordTransition } from './transition-recorder';

const log = createLogger('workflow-reconciler');

const RECONCILE_INTERVAL_MS = 60_000;
const STARTUP_DELAY_MS = 30_000;
/**
 * A session active with NO activity for this long cannot be a legitimate phase:
 * it exceeds the WorkflowRunner phase timeout (30m) + margin, so it is abandoned.
 * Kept above the phase timeout deliberately to avoid finalizing a live long run.
 */
export const STALE_SESSION_MS = 45 * 60 * 1000;
/** An in-progress task idle this long with no live execution is surfaced. */
export const STALE_TASK_MS = 45 * 60 * 1000;
/**
 * Settle window before healing a status=in-progress / workflowStatus=completed
 * desync. Short (the workflow is already terminal) but non-zero so we never race
 * a task whose completion is still mid-write.
 */
export const COMPLETED_DESYNC_MS = 2 * 60 * 1000;
/** Don't re-queue orphans older than this — ancient ones are likely abandoned. */
const MAX_ORPHAN_REQUEUE_AGE_MS = 2 * 24 * 60 * 60 * 1000;
/** Re-queue an orphan at most this many times before leaving it for notification. */
const MAX_ORPHAN_REQUEUE = 2;
/**
 * Auto-retry a BLOCKED task at most this many times before leaving it blocked for
 * the user. Blocked auto-created tasks otherwise sit forever, holding the backlog
 * promotion cap and starving the loop (observed: 5 blocked tasks = cap 5 → idle
 * with 20 open concerns un-promoted). A bounded retry re-runs them — most were
 * blocked by a since-fixed bug and now pass; genuine failures exhaust the budget
 * and stay blocked. / blocked タスクの自動再試行上限。
 */
const MAX_BLOCKED_RETRY = 2;
/**
 * Wait this long after a task was blocked before auto-retrying — let the dust
 * settle (don't race the run that just blocked it) and avoid hammering a task
 * that re-blocks instantly. / blocked 後この時間待ってから再試行。
 */
const BLOCKED_RETRY_SETTLE_MS = 3 * 60 * 1000;
/** Only inspect worktree rows touched within this window (bound the scan). */
const PHANTOM_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Execution statuses that represent a still-alive agent. */
const ACTIVE_EXEC = ['running', 'pending', 'waiting_for_input'];

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

/**
 * Pure decision: should an active session be finalized as abandoned?
 * Stale beyond the threshold AND not legitimately waiting on the user.
 *
 * @param args.lastActivityAtMs - Session lastActivityAt (ms). / 最終活動時刻
 * @param args.nowMs - Current time (ms). / 現在時刻
 * @param args.latestExecStatus - Latest execution status, if any. / 最新実行status
 * @param args.taskWorkflowStatus - Owning task's workflowStatus. / タスクのworkflowStatus
 * @param args.staleMs - Staleness threshold. / 陳腐化閾値
 * @returns true when safe to finalize. / 終端化してよいか
 */
export function shouldFinalizeSession(args: {
  lastActivityAtMs: number;
  nowMs: number;
  latestExecStatus?: string | null;
  taskWorkflowStatus?: string | null;
  staleMs?: number;
}): boolean {
  const stale = args.nowMs - args.lastActivityAtMs >= (args.staleMs ?? STALE_SESSION_MS);
  if (!stale) return false;
  if (args.latestExecStatus === 'waiting_for_input') return false; // awaiting user answer
  if (args.taskWorkflowStatus === 'awaiting_question') return false; // awaiting clarification
  return true;
}

/** Finalize abandoned active sessions (and their stuck executions). */
async function healZombieSessions(nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - STALE_SESSION_MS);
  const sessions = await prisma.agentSession
    .findMany({
      // Heal BOTH 'active' AND 'running' zombies. verification-retry sets a
      // session to status:'running'; if that run then crashes/is interrupted, the
      // session stays 'running' forever — the reconciler used to only finalize
      // 'active', so a 'running' zombie blocked auto-run permanently (it waits on
      // the dead session and never advances; e.g. task 253 stuck at plan_approved
      // with a running session but no live agent process).
      where: { status: { in: ['active', 'running'] }, lastActivityAt: { lt: cutoff } },
      select: {
        id: true,
        lastActivityAt: true,
        config: { select: { taskId: true } },
        agentExecutions: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
      },
    })
    .catch(() => []);

  let healed = 0;
  for (const s of sessions) {
    const taskId = s.config?.taskId;
    const task = taskId
      ? await prisma.task
          .findUnique({ where: { id: taskId }, select: { workflowStatus: true } })
          .catch(() => null)
      : null;
    if (
      !shouldFinalizeSession({
        lastActivityAtMs: s.lastActivityAt.getTime(),
        nowMs,
        latestExecStatus: s.agentExecutions[0]?.status,
        taskWorkflowStatus: task?.workflowStatus,
      })
    ) {
      continue;
    }
    await prisma.agentSession
      .update({
        where: { id: s.id },
        data: {
          status: 'cancelled',
          errorMessage: 'Reconciler: abandoned active session (>45m idle)',
        },
      })
      .catch(() => {});
    await prisma.agentExecution
      .updateMany({
        where: { sessionId: s.id, status: { in: ACTIVE_EXEC } },
        data: { status: 'failed', completedAt: new Date(), errorMessage: 'Reconciler: abandoned' },
      })
      .catch(() => {});
    healed++;
  }
  return healed;
}

/** Clear worktreePath on terminal sessions whose worktree no longer exists. */
async function clearPhantomWorktrees(nowMs: number): Promise<number> {
  const sessions = await prisma.agentSession
    .findMany({
      where: {
        worktreePath: { not: null },
        status: { notIn: ['active', 'pending'] },
        updatedAt: { gte: new Date(nowMs - PHANTOM_LOOKBACK_MS) },
      },
      select: { id: true, worktreePath: true },
    })
    .catch(() => []);

  let cleared = 0;
  for (const s of sessions) {
    if (s.worktreePath && !existsSync(s.worktreePath)) {
      await prisma.agentSession
        .update({ where: { id: s.id }, data: { worktreePath: null } })
        .catch(() => {});
      cleared++;
    }
  }
  return cleared;
}

/** Surface (notify once) in-progress tasks that have no live execution. */
async function flagOrphanTasks(nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - STALE_TASK_MS);
  const tasks = await prisma.task
    .findMany({
      where: { status: 'in-progress', parentId: null, updatedAt: { lt: cutoff } },
      select: { id: true, title: true, workflowStatus: true },
    })
    .catch(() => []);

  let flagged = 0;
  for (const t of tasks) {
    if (t.workflowStatus === 'completed' || t.workflowStatus === 'awaiting_question') continue;
    const liveExec = await prisma.agentExecution
      .findFirst({
        where: { session: { config: { taskId: t.id } }, status: { in: ACTIVE_EXEC } },
        select: { id: true },
      })
      .catch(() => null);
    if (liveExec) continue;

    // Dedup: skip if we already surfaced this task recently.
    const recent = await prisma.notification
      .findFirst({
        where: {
          link: `/tasks?taskId=${t.id}`,
          title: 'タスクが停滞しています',
          createdAt: { gt: new Date(nowMs - 6 * 60 * 60 * 1000) },
        },
        select: { id: true },
      })
      .catch(() => null);
    if (recent) continue;

    await createNotification({
      type: 'system',
      title: 'タスクが停滞しています',
      message: `#${t.id}「${t.title}」が長時間「進行中」のまま実行が見当たりません。再実行をご検討ください。`,
      link: `/tasks?taskId=${t.id}`,
      metadata: { taskId: t.id, reason: 'reconciler_orphan' },
    }).catch(() => {});
    flagged++;
  }
  return flagged;
}

/**
 * Heal the completion desync: a task left at status='in-progress' while its
 * workflowStatus has already reached 'completed'. This happens when an
 * execution-start path (continue / execute / respond / post-review) sets
 * status='in-progress' without syncing workflowStatus, or a re-selection
 * re-flips an already-completed task. `flagOrphanTasks` deliberately skips
 * wf=completed, so without this heal these tasks stay stuck "進行中" forever
 * with no live execution. The workflow is terminal, so finalize to 'done'.
 */
async function healCompletedDesync(nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - COMPLETED_DESYNC_MS);
  const tasks = await prisma.task
    .findMany({
      where: { status: 'in-progress', workflowStatus: 'completed', updatedAt: { lt: cutoff } },
      select: { id: true, title: true, completedAt: true },
    })
    .catch(() => [] as { id: number; title: string; completedAt: Date | null }[]);

  let healed = 0;
  for (const t of tasks) {
    // A live agent means the completion may still be settling — leave it alone.
    const liveExec = await prisma.agentExecution
      .findFirst({
        where: { session: { config: { taskId: t.id } }, status: { in: ACTIVE_EXEC } },
        select: { id: true },
      })
      .catch(() => null);
    if (liveExec) continue;

    await prisma.task
      .update({
        where: { id: t.id },
        data: { status: 'done', completedAt: t.completedAt ?? new Date() },
      })
      .catch(() => {});
    healed++;
    log.info(
      { taskId: t.id },
      '[reconciler] Healed completion desync (in-progress + wf=completed) -> done',
    );
  }
  return healed;
}

/**
 * Orphan recovery: re-queue a genuinely-stuck in-progress task (no live agent,
 * stale, non-terminal workflowStatus) back to 'todo' so auto-run reruns it.
 * Guards: skips completed (healed elsewhere) and awaiting_question (paused),
 * skips ANCIENT orphans (likely abandoned), and caps re-queues so an orphan that
 * keeps dying isn't requeued forever — after the cap, flagOrphanTasks notifies.
 */
async function requeueOrphanTasks(nowMs: number): Promise<number> {
  const staleBefore = new Date(nowMs - STALE_TASK_MS);
  const notOlderThan = new Date(nowMs - MAX_ORPHAN_REQUEUE_AGE_MS);
  const tasks = await prisma.task
    .findMany({
      where: {
        status: 'in-progress',
        parentId: null,
        updatedAt: { lt: staleBefore, gt: notOlderThan },
      },
      select: { id: true, title: true, workflowStatus: true },
    })
    .catch(() => [] as { id: number; title: string; workflowStatus: string | null }[]);

  let requeued = 0;
  for (const t of tasks) {
    if (t.workflowStatus === 'completed' || t.workflowStatus === 'awaiting_question') continue;

    const live = await prisma.agentExecution
      .findFirst({
        where: { session: { config: { taskId: t.id } }, status: { in: ACTIVE_EXEC } },
        select: { id: true },
      })
      .catch(() => null);
    if (live) continue;

    const attempts = await prisma.workflowTransition
      .count({ where: { taskId: t.id, cause: 'reconciler_requeue' } })
      .catch(() => 0);
    if (attempts >= MAX_ORPHAN_REQUEUE) continue;

    await prisma.task
      .update({ where: { id: t.id }, data: { status: 'todo', updatedAt: new Date() } })
      .catch(() => {});
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
 * Self-healing for the perpetual loop: auto-retry BLOCKED auto-created tasks so a
 * since-fixed bug (the common cause — e.g. a verify-gate false-positive resolved
 * by a deploy) no longer strands them, and they stop permanently holding the
 * backlog-promotion cap. Bounded by MAX_BLOCKED_RETRY; only touches tasks whose
 * theme auto-run is still ARMED (enabled) so a user STOP is respected, and only
 * after a settle delay so we don't race the run that just blocked it.
 *
 * Reset to 'todo' + workflowStatus 'draft' (research/plan are reused via
 * isReusableArtifact, so the re-run is cheap) so the scheduler re-selects and
 * actually re-runs it rather than failing "cannot advance from <terminal>".
 */
async function requeueBlockedTasks(nowMs: number): Promise<number> {
  const settleBefore = new Date(nowMs - BLOCKED_RETRY_SETTLE_MS);
  const notOlderThan = new Date(nowMs - MAX_ORPHAN_REQUEUE_AGE_MS);

  // Respect user stops: only retry blocked tasks in themes that are still armed.
  const armed = await prisma.themeAutoRun
    .findMany({ where: { enabled: true }, select: { themeId: true } })
    .catch(() => [] as { themeId: number }[]);
  const armedThemeIds = armed.map((a) => a.themeId);
  if (armedThemeIds.length === 0) return 0;

  // The verify->implement repair budget. A task that EXHAUSTED it is genuinely
  // failing verification — blindly re-queuing it just repeats the same doomed
  // implement→verify cycle. Such tasks need splitting / human attention, not
  // auto-retry. Read via cast (column pending client regen), matching
  // verify-self-repair's resolveMaxRepairs.
  const settings = (await prisma.userSettings.findFirst().catch(() => null)) as {
    verifyRepairLimit?: number | null;
  } | null;
  const verifyRepairLimit =
    typeof settings?.verifyRepairLimit === 'number' && settings.verifyRepairLimit > 0
      ? settings.verifyRepairLimit
      : 3;

  const tasks = await prisma.task
    .findMany({
      where: {
        status: 'blocked',
        parentId: null,
        themeId: { in: armedThemeIds },
        updatedAt: { lt: settleBefore, gt: notOlderThan },
      },
      select: { id: true, workflowStatus: true },
    })
    .catch(() => [] as { id: number; workflowStatus: string | null }[]);

  let retried = 0;
  for (const t of tasks) {
    // A live agent means it's not really stuck — skip.
    const live = await prisma.agentExecution
      .findFirst({
        where: { session: { config: { taskId: t.id } }, status: { in: ACTIVE_EXEC } },
        select: { id: true },
      })
      .catch(() => null);
    if (live) continue;

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

/** Run one reconciliation pass. Single-flight; never throws. */
export async function reconcileOnce(): Promise<{
  zombieSessions: number;
  phantomWorktrees: number;
  orphanTasks: number;
  completedDesyncs: number;
  requeuedOrphans: number;
  retriedBlocked: number;
}> {
  const empty = {
    zombieSessions: 0,
    phantomWorktrees: 0,
    orphanTasks: 0,
    completedDesyncs: 0,
    requeuedOrphans: 0,
    retriedBlocked: 0,
  };
  if (inFlight) return empty;
  inFlight = true;
  const nowMs = Date.now();
  try {
    const zombieSessions = await healZombieSessions(nowMs);
    const phantomWorktrees = await clearPhantomWorktrees(nowMs);
    const completedDesyncs = await healCompletedDesync(nowMs);
    // Try to recover orphans (re-queue) BEFORE flagging — a successful re-queue
    // means we don't also notify the user about the same task.
    const requeuedOrphans = await requeueOrphanTasks(nowMs);
    // Auto-retry blocked tasks so the perpetual loop self-heals instead of idling
    // with a cap full of permanently-blocked tasks.
    const retriedBlocked = await requeueBlockedTasks(nowMs);
    const orphanTasks = await flagOrphanTasks(nowMs);
    if (
      zombieSessions ||
      phantomWorktrees ||
      orphanTasks ||
      completedDesyncs ||
      requeuedOrphans ||
      retriedBlocked
    ) {
      log.info(
        {
          zombieSessions,
          phantomWorktrees,
          orphanTasks,
          completedDesyncs,
          requeuedOrphans,
          retriedBlocked,
        },
        '[reconciler] repaired divergences',
      );
    }
    return {
      zombieSessions,
      phantomWorktrees,
      orphanTasks,
      completedDesyncs,
      requeuedOrphans,
      retriedBlocked,
    };
  } catch (err) {
    log.warn({ err }, '[reconciler] pass failed');
    return empty;
  } finally {
    inFlight = false;
  }
}

/** Start the periodic reconciler (idempotent). */
export function startWorkflowReconciler(): void {
  if (timer) return;
  setTimeout(() => void reconcileOnce(), STARTUP_DELAY_MS);
  timer = setInterval(() => void reconcileOnce(), RECONCILE_INTERVAL_MS);
  log.info('[reconciler] started');
}

/** Stop the periodic reconciler. */
export function stopWorkflowReconciler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
