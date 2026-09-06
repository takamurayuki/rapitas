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
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { findByStatuses } from './auto-run/theme-auto-run-service';
import { notifyZeroProgressWhileRunning } from './auto-run/auto-run-notifications';
import { logCycleEvent } from '../observability';
import { ZERO_PROGRESS_THRESHOLD_MS } from './queue-stall-policy';

const log = createLogger('workflow-reconciler-zero-progress');

// Epoch ms when each running theme's current task was FIRST observed with this
// taskId; keyed by themeId. In-memory on purpose (Prisma schema changes are
// prohibited, and ThemeAutoRun.lastRunAt is overwritten on every re-enqueue so
// it cannot anchor an elapsed-time measure during a spin). A restart resets the
// episode — same accepted trade-off as the starvation tracker.
const zeroProgressSinceMs = new Map<number, { taskId: number; since: number }>();

/** Reset the zero-progress tracker. Test-only — never call from production code. */
export function resetZeroProgressTracker(): void {
  zeroProgressSinceMs.clear();
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
      // No execution subject — nothing to measure against.
      zeroProgressSinceMs.delete(theme.themeId);
      continue;
    }

    const tracked = zeroProgressSinceMs.get(theme.themeId);
    if (!tracked || tracked.taskId !== taskId) {
      // First observation of this (theme, task) episode — arm, act on persistence.
      zeroProgressSinceMs.set(theme.themeId, { taskId, since: nowMs });
      continue;
    }
    if (nowMs - tracked.since < ZERO_PROGRESS_THRESHOLD_MS) continue;

    const executionCount = await prisma.agentExecution
      .count({ where: { session: { config: { taskId } } } })
      .catch(() => null);
    // Fail-open on an unreadable count; any real execution means this is a
    // legitimately long phase, not a spin.
    if (executionCount == null || executionCount > 0) continue;

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

    detected++;
    const elapsedMinutes = Math.round((nowMs - tracked.since) / 60000);
    log.warn(
      { themeId: theme.themeId, taskId, elapsedMinutes },
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
