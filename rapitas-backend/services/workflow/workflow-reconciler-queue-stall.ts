/**
 * WorkflowReconcilerQueueStall
 *
 * Heal passes for the two silent auto-run stall shapes of task 618:
 *  1. sweepStaleRunningItems — 'running' WorkflowQueueItems nobody reclaims
 *     while the process lives (sweepStaleQueueItems only handles 'queued',
 *     recoverStaleItems only runs at startup). One such residue blocks EVERY
 *     dequeue via the cross-session running count (事例1の主因候補).
 *  2. detectQueueStarvation — `running=0 かつ queued>0` persisting past a
 *     threshold means dispatch is stuck, either because the consumer
 *     (WorkflowRunner) is dead/wedged (kick it with the idempotent
 *     startProcessing()) or because it is alive but something downstream
 *     keeps declining to claim (e.g. an overlap-guard hold outliving its own
 *     ceiling) — the kick is a no-op there, but the stall is just as real and
 *     is now recorded/notified either way (2026-09-17: it previously went
 *     fully silent after one log line — tasks 905/914/937).
 * Deliberately cancel-only (never requeue): a false-negative liveness read must
 * not double-start an agent — requeueBlockedTasks re-tries cancelled work.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { resolveTaskWorkflowState } from '../task/task-resolver';
import { isTaskTerminalForQueue } from './workflow-queue';
import { WorkflowRunner } from './workflow-runner';
import { hasLiveExecution } from './auto-run/auto-run-selection';
import {
  notifyStallReleased,
  notifyQueueStarvation,
  notifyQueueStalledRunnerAlive,
} from './auto-run/auto-run-notifications';
import { logCycleEvent } from '../observability';
import { RUNNING_ITEM_STALE_MS, QUEUE_STARVATION_THRESHOLD_MS } from './queue-stall-policy';

const log = createLogger('workflow-reconciler-queue-stall');

/**
 * Cancel 'running' queue items that are either stale beyond
 * RUNNING_ITEM_STALE_MS or residue of a task that cannot run at all (see
 * {@link collectSweepCandidates}), and that either belong to a terminal task or
 * have NO live (fresh-heartbeat) execution.
 * A non-terminal task with a live execution is a legitimately long phase and is
 * left untouched. CAS on status='running' so a concurrent stop/complete wins.
 *
 * @param nowMs - Current time (ms), injected for testability. / 現在時刻
 * @returns Items cancelled this cycle. / キャンセル件数
 */
/** One 'running' queue item considered by the sweep. */
type SweepCandidate = {
  id: number;
  taskId: number;
  themeId: number | null;
  /** True when the task cannot legitimately be running (halted or blocked). / 実行しえないタスクの残骸 */
  unrunnable: boolean;
};

/**
 * Collect the 'running' items this sweep may cancel: the long-stale ones, plus
 * residue of a task that CANNOT legitimately be running at all.
 *
 * The second set exists because the age filter alone wedges the queue. A halted
 * or blocked task has no legitimate long phase, yet its residue held the only
 * runner slot for the full 40-minute window — measured 2026-09-27, when task
 * 1105's item kept the slot while task 1106 waited 20+ minutes, and each stop
 * attempt pushed `startedAt` forward and so postponed the release further.
 * Liveness is still consulted per item below, so a live agent is never cut.
 *
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns Candidate items, de-duplicated. / 重複排除した候補
 */
async function collectSweepCandidates(nowMs: number): Promise<SweepCandidate[]> {
  const select = { id: true, taskId: true, themeId: true } as const;
  type Row = { id: number; taskId: number; themeId: number | null };
  const stale = await prisma.workflowQueueItem
    .findMany({
      where: { status: 'running', startedAt: { lt: new Date(nowMs - RUNNING_ITEM_STALE_MS) } },
      select,
    })
    .catch(() => [] as Row[]);

  const unrunnable = await prisma.task
    .findMany({
      where: { OR: [{ haltReason: { not: null } }, { status: 'blocked' }] },
      select: { id: true },
    })
    .catch(() => [] as { id: number }[]);
  const residue =
    unrunnable.length === 0
      ? []
      : await prisma.workflowQueueItem
          .findMany({
            where: { status: 'running', taskId: { in: unrunnable.map((t) => t.id) } },
            select,
          })
          .catch(() => [] as Row[]);

  const byId = new Map<number, SweepCandidate>();
  for (const item of stale) byId.set(item.id, { ...item, unrunnable: false });
  // Residue wins the merge: its cause is the more specific explanation.
  for (const item of residue) byId.set(item.id, { ...item, unrunnable: true });
  return [...byId.values()];
}

export async function sweepStaleRunningItems(nowMs: number): Promise<number> {
  const candidates = await collectSweepCandidates(nowMs);
  if (candidates.length === 0) return 0;

  let released = 0;
  for (const item of candidates) {
    const task = await resolveTaskWorkflowState(item.taskId);
    const terminal = isTaskTerminalForQueue(task);
    // Only consult liveness for non-terminal tasks — a terminal task's residue
    // is stale by definition, live agent or not (its work is already resolved).
    if (!terminal && (await hasLiveExecution(prisma, item.taskId))) continue;

    const cause = terminal
      ? 'terminal_task_running_residue'
      : item.unrunnable
        ? 'unrunnable_task_running_residue'
        : 'stale_running_no_live_execution';
    const updated = await prisma.workflowQueueItem
      .updateMany({
        where: { id: item.id, status: 'running' },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
          errorMessage: item.unrunnable
            ? 'タスクが halt / blocked で実行しえない状態のまま running が残っていたため自動キャンセルしました（定期スイープ）'
            : '長時間 running のまま生存実行が確認できないため自動キャンセルしました（定期スイープ）',
        },
      })
      .catch(() => ({ count: 0 }));
    if (updated.count >= 1) {
      released++;
      log.warn(
        { queueItemId: item.id, taskId: item.taskId, cause },
        '[reconciler] Cancelled stale running queue item',
      );
      logCycleEvent('task.stall_released', {
        theme: item.themeId ?? undefined,
        task: item.taskId,
        ok: true,
        cause,
        msg: 'stale running queue item released by periodic sweep',
      });
      await notifyStallReleased(item.themeId ?? null, item.taskId, 1, cause);
    }
  }
  return released;
}

// Epoch ms when `running=0 かつ queued>0` was FIRST observed in the current
// starvation episode; null = not currently starving. In-memory on purpose
// (Prisma schema changes are prohibited): a restart resets the episode, which
// is correct — startup runs recoverStaleItems and restarts the runner anyway.
let starvationSinceMs: number | null = null;

// True once this episode has reported that the runner was already processing.
// Reset with the episode: the condition persists by design, so without this the
// same unactionable line repeats every reconciler cycle.
let noOpKickReported = false;

/** Reset the starvation tracker. Test-only — never call from production code. */
export function resetQueueStarvationTracker(): void {
  starvationSinceMs = null;
  noOpKickReported = false;
}

/** How many queued items to check for a live agent before giving up on the scan. */
const WORKING_SCAN_LIMIT = 20;

/**
 * Whether a queued item's task has a live agent right now.
 *
 * The item statuses alone cannot tell "dispatch is stuck" from "a phase is
 * running": between phases the runner writes its item back to `queued` while
 * the agent works, which reads as `running=0 かつ queued>0` and fired the
 * starvation alert on a perfectly healthy workflow (measured 2026-09-27 on task
 * 1106). A live agent on a QUEUED item's task proves the runner did claim that
 * item, so the reading is an artifact rather than a dispatch failure.
 *
 * @returns true when at least one queued item's task is actively working. / 作業中なら true
 */
async function someQueuedTaskIsWorking(): Promise<boolean> {
  const queued = await prisma.workflowQueueItem
    .findMany({
      where: { status: 'queued' },
      orderBy: { queuedAt: 'asc' },
      take: WORKING_SCAN_LIMIT,
      select: { taskId: true },
    })
    .catch(() => [] as { taskId: number }[]);
  for (const item of queued) {
    if (await hasLiveExecution(prisma, item.taskId)) return true;
  }
  return false;
}

/**
 * Detect `running=0 かつ queued>0` persisting past QUEUE_STARVATION_THRESHOLD_MS
 * and kick the (idempotent) WorkflowRunner back into processing. The threshold
 * requires ~3 consecutive reconciler observations, so the normal one-tick gap
 * between phases (task 585) and post-restart transients never trip it. A queued
 * item whose task has a live agent is excluded outright (see
 * {@link someQueuedTaskIsWorking}) — a running phase is not a starved queue.
 *
 * @param nowMs - Current time (ms), injected for testability. / 現在時刻
 * @returns 1 when a starvation was detected and acted on, else 0. / 検出件数
 */
export async function detectQueueStarvation(nowMs: number): Promise<number> {
  const runningCount = await prisma.workflowQueueItem
    .count({ where: { status: 'running' } })
    .catch(() => 0);
  const queuedCount = await prisma.workflowQueueItem
    .count({ where: { status: 'queued' } })
    .catch(() => 0);

  if (runningCount > 0 || queuedCount === 0 || (await someQueuedTaskIsWorking())) {
    starvationSinceMs = null;
    noOpKickReported = false;
    return 0;
  }
  if (starvationSinceMs === null) {
    // First observation of this episode — arm the timer, act only on persistence.
    starvationSinceMs = nowMs;
    return 0;
  }
  if (nowMs - starvationSinceMs < QUEUE_STARVATION_THRESHOLD_MS) return 0;

  const waitedMinutes = Math.round((nowMs - starvationSinceMs) / 60000);
  const oldest = await prisma.workflowQueueItem
    .findFirst({
      where: { status: 'queued' },
      orderBy: { queuedAt: 'asc' },
      select: { taskId: true },
    })
    .catch(() => null);
  // Two situations look identical from the queue table, and only one of them
  // this function can fix. A STOPPED runner is what the kick is for. A runner
  // that is alive but not claiming items is a different fault: the kick returns
  // "Already running" and nothing changes, so reporting it as "restarted" every
  // cycle is both false and endless — 78 such pairs on 2026-08-28 alone. That
  // fix (noOpKickReported) rightly silenced the repeat LOG spam, but it also
  // silenced the underlying signal entirely after the first cycle: nothing
  // durable, no notification — a genuinely stuck task (e.g. an overlap-guard
  // hold outliving its own ceiling) then had no path to a human except manual
  // log-grepping (tasks 905/914/937, 2026-09-16/17). Detection and the kick's
  // own action are separate concerns; only the latter should stay suppressed.
  const runner = WorkflowRunner.getInstance();
  const wasRunning = runner.isProcessing();
  runner.startProcessing();
  if (wasRunning) {
    // Side effects (log/cycle-event/notification) fire once per episode, same
    // cadence as before — only their CONTENT changed (durable + user-visible
    // instead of a log line nobody reads). The return value is honest every
    // cycle regardless: the stall is real for as long as this branch runs.
    if (!noOpKickReported) {
      noOpKickReported = true;
      log.warn(
        { queuedCount, waitedMinutes, oldestTaskId: oldest?.taskId ?? null },
        '[reconciler] Queue has items while the runner is already processing — a kick cannot help; recording the stall instead',
      );
      logCycleEvent('queue.starvation_detected', {
        task: oldest?.taskId,
        ok: false,
        cause: 'runner_alive_not_dispatching',
        queued: queuedCount,
        waitedMinutes,
        msg: 'running=0 with queued>0 persisted while the runner poll loop is alive — kick was a no-op',
      });
      await notifyQueueStalledRunnerAlive(oldest?.taskId ?? null, waitedMinutes);
    }
    return 1;
  }
  log.warn(
    { queuedCount, waitedMinutes, oldestTaskId: oldest?.taskId ?? null },
    '[reconciler] Queue starvation detected — restarted WorkflowRunner processing',
  );
  logCycleEvent('queue.starvation_detected', {
    task: oldest?.taskId,
    ok: false,
    cause: 'running_zero_queue_nonzero',
    queued: queuedCount,
    waitedMinutes,
    msg: 'running=0 with queued>0 persisted — runner kicked',
  });
  await notifyQueueStarvation(oldest?.taskId ?? null, waitedMinutes);
  // Keep the episode armed: if the kick did not resolve it, the next cycles
  // keep reporting (notifyOnce dedups the user-facing noise).
  return 1;
}
