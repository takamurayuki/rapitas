/**
 * WorkflowReconcilerZeroProgress
 *
 * Detection-only heal pass for the task-653 spin shape: a theme keeps
 * reporting status='running' while its currentTaskId has produced ZERO
 * AgentExecution rows for the whole threshold window. The 2026-08-24 incident
 * (106 enqueue→cancel cycles in 21 min) defeated every existing detector —
 * starvation resets on the transient running>0 blips, stagnation is suppressed
 * while an active queue item exists — because none of them look at the primary
 * evidence: whether executions actually happen. This pass does, and only
 * notifies (self-healing stays with hasRunawayCancelLoop). Never mutates state.
 *
 * The execution count is scoped to the tracked episode's anchor time, not the
 * task's lifetime — a lifetime count is >0 forever after the task's FIRST
 * phase, which made this detector permanently blind to a stall in phase 2+
 * (e.g. an overlap-guard hold outliving its own ceiling before the implementer
 * phase — tasks 905/914/937 never tripped it despite running every 60s the
 * whole time, 2026-09-16/17). The anchor slides forward on real progress, so
 * it always measures "how long since the LAST execution", not "how long since
 * this task first became current".
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { findByStatuses } from './auto-run/theme-auto-run-service';
import { notifyZeroProgressWhileRunning } from './auto-run/auto-run-notifications';
import { logCycleEvent } from '../observability';
import { ZERO_PROGRESS_THRESHOLD_MS } from './queue-stall-policy';
import { checkNoSelectionProgress, resetNoSelectionEpisode } from './auto-run-no-selection-watch';

const log = createLogger('workflow-reconciler-zero-progress');

// Epoch ms anchoring each running theme's zero-progress window: FIRST
// observed with this taskId, then slid forward to `nowMs` on every cycle that
// sees a new execution — so it always means "since the last real progress",
// not "since this task became current" (see module doc comment). In-memory on
// purpose (Prisma schema changes are prohibited, and ThemeAutoRun.lastRunAt is
// overwritten on every re-enqueue so it cannot anchor an elapsed-time measure
// during a spin). A restart resets the episode — same accepted trade-off as
// the starvation tracker.
const zeroProgressSinceMs = new Map<number, { taskId: number; since: number }>();

/** Reset the zero-progress tracker. Test-only — never call from production code. */
export function resetZeroProgressTracker(): void {
  zeroProgressSinceMs.clear();
}

/**
 * The task's most recent execution, for alarm diagnosis only.
 *
 * NOTE: Added after the 2026-10-06 20:18Z alarm, whose log could not tell "never ran"
 * from "ran, then stopped". Any lookup failure yields null — it must never block the alarm.
 *
 * @param taskId - Task under evaluation. / 評価対象タスク
 * @returns Latest execution's createdAt and status, or null. / 直近の実行、無い/取得失敗なら null
 */
async function lastExecutionOf(
  taskId: number,
): Promise<{ createdAt: Date; status: string } | null> {
  try {
    return await prisma.agentExecution.findFirst({
      where: { session: { config: { taskId } } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, status: true },
    });
  } catch {
    return null;
  }
}

/**
 * The task's overlap-hold age while it is still inside the hold ceiling.
 *
 * Fails toward ALERTING: if either lookup throws, the caller treats the task as
 * not held and the zero-progress alarm proceeds.
 *
 * @param taskId - Task under evaluation. / 評価対象タスク
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns Hold age in ms, or null when not held or past the ceiling. / 保留経過ms、非保留/上限超なら null
 */
async function overlapHoldWithinCeiling(taskId: number, nowMs: number): Promise<number | null> {
  try {
    const { overlapHoldAgeMs } = await import('./workflow-orchestrator-overlap-guard');
    const held = overlapHoldAgeMs(taskId, nowMs);
    if (held == null) return null;
    const { getMergeBarrierMaxHoldMs } = await import('../scheduling/merge-barrier/merge-barrier');
    return held < getMergeBarrierMaxHoldMs() ? held : null;
  } catch {
    return null;
  }
}

/**
 * Detect themes that report status='running' while their currentTaskId has had
 * ZERO AgentExecution rows for longer than ZERO_PROGRESS_THRESHOLD_MS, and
 * surface each as a cycle event + user notification. A taskId change or a
 * non-running status re-arms the episode; any execution row (or an unreadable
 * count) suppresses firing — observation failure must never look like a spin.
 *
 * @param nowMs - Current time (ms), injected for testability. / 現在時刻
 * @returns Themes detected as spinning this cycle. / 検出件数
 */
export async function detectZeroProgressWhileRunning(nowMs: number): Promise<number> {
  const runningThemes = await findByStatuses(['running']).catch(() => []);

  let detected = 0;
  const seenThemeIds = new Set<number>();
  for (const theme of runningThemes) {
    seenThemeIds.add(theme.themeId);
    const taskId = theme.currentTaskId;
    if (taskId == null) {
      // No execution subject for THIS pass — but "running with nothing selected"
      // is itself a stall shape, and giving up here is what let a four-hour
      // outage go unreported (2026-09-27). Hand it to the watch that measures
      // exactly that state.
      zeroProgressSinceMs.delete(theme.themeId);
      if ((await checkNoSelectionProgress(theme.themeId, nowMs)) === 'reported') detected++;
      continue;
    }
    // Selection is happening again — drop any no-selection episode for the theme.
    resetNoSelectionEpisode(theme.themeId);

    const tracked = zeroProgressSinceMs.get(theme.themeId);
    if (!tracked || tracked.taskId !== taskId) {
      // First observation of this (theme, task) episode — arm, act on persistence.
      zeroProgressSinceMs.set(theme.themeId, { taskId, since: nowMs });
      continue;
    }
    if (nowMs - tracked.since < ZERO_PROGRESS_THRESHOLD_MS) continue;

    // Scoped to executions created SINCE this episode's anchor — not the
    // task's lifetime total. A lifetime count can only ever be 0 during a
    // task's very FIRST phase: by the second phase onward it is already >0
    // forever, so the whole detector goes permanently blind to a later stall
    // (e.g. an overlap-guard hold outliving its own ceiling before the
    // implementer phase — tasks 905/914/937, 2026-09-16/17, none of which
    // this detector ever caught despite running every 60s the whole time).
    // "Since the anchor" must include an execution that STARTED before the
    // anchor and is still alive: the anchor slides forward on the cycle that
    // first sees a new row, so a long single phase (task 1031's 19-minute
    // implementer run, 2026-09-22) was created before the slid anchor, counted
    // as zero, and raised a spin alarm while it was heartbeating. Count any
    // row created, heartbeating, or completed after the anchor.
    const since = new Date(tracked.since);
    const executionCount = await prisma.agentExecution
      .count({
        where: {
          session: { config: { taskId } },
          OR: [
            { createdAt: { gte: since } },
            { heartbeatAt: { gte: since } },
            { completedAt: { gte: since } },
          ],
        },
      })
      .catch(() => null);
    // Fail-open on an unreadable count; any real execution means this is a
    // legitimately long phase, not a spin.
    if (executionCount == null || executionCount > 0) {
      // Progress happened inside the window — slide the anchor forward so the
      // NEXT window measures from here, not from whenever this task first
      // became current (otherwise a task with occasional real progress but a
      // stuck phase 3 or 4 stays permanently exempt too, same shape of bug).
      zeroProgressSinceMs.set(theme.themeId, { taskId, since: nowMs });
      continue;
    }

    // Zero executions because the slot is occupied by another task's live
    // execution is WAITING, not spinning — task 856 drew 25 minutes of
    // zero-progress alarms while queued behind task 847's ci_repair
    // (2026-09-05). Log it as a distinct, quiet cycle event.
    const { liveOrQueuedBehind } = await import('./auto-run/queue-wait-exemption');
    if (await liveOrQueuedBehind(prisma, taskId)) {
      logCycleEvent('theme.waiting_for_slot', {
        theme: theme.themeId,
        task: taskId,
        ok: true,
        cause: 'slot_occupied_by_other_task',
        waitedMinutes: Math.round((nowMs - tracked.since) / 60000),
        msg: 'current task has no execution yet because another task holds the runner slot',
      });
      continue;
    }

    // Same shape again, one layer up: the overlap guard deliberately runs no
    // execution while a file this task will touch is still open in another
    // auto-PR. Task 1111 drew 17 zero-progress alarms across one 30-minute hold
    // (2026-09-27 15:00-15:15Z) before the ceiling released it and the task
    // finished in 10 minutes. But a hold that OUTLIVES its ceiling is exactly
    // the 905/914/937 bug this detector exists to catch, so only a hold still
    // inside its ceiling is quiet — past it, the alarm below still fires.
    const holdMs = await overlapHoldWithinCeiling(taskId, nowMs);
    if (holdMs != null) {
      logCycleEvent('theme.waiting_for_overlap_hold', {
        theme: theme.themeId,
        task: taskId,
        ok: true,
        cause: 'implement_overlap_hold_active',
        holdMs,
        msg: 'current task has no execution because the overlap guard is holding its implementer',
      });
      continue;
    }

    detected++;
    const elapsedMinutes = Math.round((nowMs - tracked.since) / 60000);
    const last = await lastExecutionOf(taskId);
    log.warn(
      {
        themeId: theme.themeId,
        taskId,
        elapsedMinutes,
        lastExecutionAt: last?.createdAt.toISOString() ?? null,
        lastExecutionStatus: last?.status ?? null,
      },
      '[reconciler] Zero-progress spin detected — theme running with no executions',
    );
    logCycleEvent('theme.zero_progress_detected', {
      theme: theme.themeId,
      task: taskId,
      ok: false,
      cause: 'running_with_zero_executions',
      waitedMinutes: elapsedMinutes,
      msg: 'theme reports running but its current task has produced no AgentExecution',
    });
    await notifyZeroProgressWhileRunning(theme.themeId, taskId, elapsedMinutes);
    // Keep the episode armed: if the spin persists, later cycles keep counting
    // it (notifyOnce dedups the user-facing noise) — same as starvation.
  }

  // Drop tracking for themes no longer running: a pause/stop is a normal
  // transition and a later resume must count from a fresh first observation.
  for (const themeId of zeroProgressSinceMs.keys()) {
    if (!seenThemeIds.has(themeId)) zeroProgressSinceMs.delete(themeId);
  }
  return detected;
}
