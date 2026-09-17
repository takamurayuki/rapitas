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
 * Cancel 'running' queue items that are stale beyond RUNNING_ITEM_STALE_MS and
 * either belong to a terminal task or have NO live (fresh-heartbeat) execution.
 * A non-terminal task with a live execution is a legitimately long phase and is
 * left untouched. CAS on status='running' so a concurrent stop/complete wins.
 *
 * @param nowMs - Current time (ms), injected for testability. / 現在時刻
 * @returns Items cancelled this cycle. / キャンセル件数
 */
export async function sweepStaleRunningItems(nowMs: number): Promise<number> {
  const candidates = await prisma.workflowQueueItem
    .findMany({
      where: { status: 'running', startedAt: { lt: new Date(nowMs - RUNNING_ITEM_STALE_MS) } },
      select: { id: true, taskId: true, themeId: true },
    })
    .catch(() => []);
  if (candidates.length === 0) return 0;

  let released = 0;
  for (const item of candidates) {
    const task = await resolveTaskWorkflowState(item.taskId);
    const terminal = isTaskTerminalForQueue(task);
    // Only consult liveness for non-terminal tasks — a terminal task's residue
    // is stale by definition, live agent or not (its work is already resolved).
    if (!terminal && (await hasLiveExecution(prisma, item.taskId))) continue;

    const cause = terminal ? 'terminal_task_running_residue' : 'stale_running_no_live_execution';
    const updated = await prisma.workflowQueueItem
      .updateMany({
        where: { id: item.id, status: 'running' },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
          errorMessage:
            '長時間 running のまま生存実行が確認できないため自動キャンセルしました（定期スイープ）',
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

/**
 * Detect `running=0 かつ queued>0` persisting past QUEUE_STARVATION_THRESHOLD_MS
 * and kick the (idempotent) WorkflowRunner back into processing. The threshold
 * requires ~3 consecutive reconciler observations, so the normal one-tick gap
 * between phases (task 585) and post-restart transients never trip it.
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

  if (runningCount > 0 || queuedCount === 0) {
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
