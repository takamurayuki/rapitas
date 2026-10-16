/**
 * auto-run-hang-backstop-stop
 *
 * The one action the hang backstop takes once `auto-run-active-decision` has
 * ruled out every exemption: force-stop the task's agents, block the task,
 * notify, and advance the theme to the next task.
 *
 * Extracted verbatim from `advanceActiveTaskLocked` so the DECISION (which
 * exemption applies, and whether the tenure wall was even crossed) stays
 * separable from this EXECUTION. Not responsible for deciding that the wall was
 * exceeded, nor for any exemption — every caller must have already cleared
 * those.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';
import { resolveTaskWorkflowState } from '../../task/task-resolver';
import { logCycleEvent } from '../../observability';
import { stopTaskTreeAgents } from '../../agents/stop-task-agents';
import { writeBlockedTask } from '../blocked-task-write';
import { COOLDOWN_MS, MAX_TASK_WALL_MS } from './auto-run-selection';
import { setCurrentTask, onTaskFailed } from './theme-auto-run-service';
import { notifyHangBackstop } from './auto-run-notifications';
import { broadcastAutoRunUpdateImpl } from './auto-run-lifecycle';
import { selectAndEnqueueNextTask } from './auto-run-advance-select';
import { recordHangBackstopBlock } from './auto-run-hang-backstop-transition';

const log = createLogger('theme-auto-run-scheduler');

/** Everything the force-stop needs, including the diagnostics for its log line. */
export interface HangBackstopStop {
  /** Prisma client. / Prismaクライアント */
  prisma: PrismaClient;
  /** Theme being advanced. / 対象テーマID */
  themeId: number;
  /** The wedged current task. / 停止対象タスクID */
  taskId: number;
  /** Selection order for the next task. / 次タスクの選定順 */
  order: 'priority' | 'created';
  /** Global auto-run active count BEFORE this stop. / 停止前のグローバルアクティブ数 */
  globalActive: number;
  /** Per-theme merge-barrier hold starts, forwarded to selection. / マージバリア保留開始時刻 */
  barrierHoldSince: Map<number, number>;
  /** Whether the task never executed in this tenure. / 当該在任中に一度も実行がなかったか */
  neverExecuted: boolean;
  /** Whether a live/queued-behind execution was found. / 生存実行または枠待ちが見つかったか */
  executionIsLive: boolean;
  /** Whether tenure was still inside the 3x hard ceiling. / 3倍の上限内だったか */
  withinHardCeiling: boolean;
  /** Milliseconds since the last evidence of progress. / 最後の前進からの経過ms */
  sinceProgressMs: number;
}

/**
 * Force-stop a task that exceeded the tenure wall with no exemption left, then
 * advance the theme.
 *
 * @param p - Stop context and diagnostics. / 停止に必要な文脈と診断値
 */
export async function forceStopOverWallBudget(p: HangBackstopStop): Promise<void> {
  const wallMinutes = Math.round(MAX_TASK_WALL_MS / 60000);
  log.warn(
    `[ThemeAutoRunScheduler] Task ${p.taskId} exceeded wall budget (${wallMinutes}min) — force-stopping (theme ${p.themeId}; neverExecuted=${p.neverExecuted}, queueWaitOrLive=${p.executionIsLive}, withinHardCeiling=${p.withinHardCeiling}, sinceProgress=${Math.round(p.sinceProgressMs / 1000)}s)`,
  );
  logCycleEvent('task.hang_backstop', {
    theme: p.themeId,
    task: p.taskId,
    ok: false,
    cause: 'wall_budget_exceeded',
    wallMinutes,
    msg: 'task force-stopped by hang backstop',
  });
  // NOTE: logCycleEvent only writes the NDJSON cycle log — invisible unless
  // an operator is tailing it. Persist a Notification too so a stalled run
  // surfaces in the NotificationBell (same pattern as the other auto-run
  // lifecycle notifications).
  await notifyHangBackstop(p.themeId, p.taskId, wallMinutes);
  await stopTaskTreeAgents(p.taskId);
  // Read the row BEFORE the blocked write so the transition carries the pre-stop status.
  const wallBudgetState = await resolveTaskWorkflowState(p.taskId);
  await writeBlockedTask(p.prisma, p.taskId).catch(() => {});
  // Task 793: leave a transition row so retro analysis can tell why it went blocked.
  // Task 1166: flag a never-executed (queue-wait) block so the reconciler skips the draft reset.
  await recordHangBackstopBlock(p.taskId, wallBudgetState, wallMinutes, p.neverExecuted);
  await onTaskFailed(p.themeId, `Task ${p.taskId} timed out (auto-run hang guard)`);
  broadcastAutoRunUpdateImpl(p.themeId);
  await new Promise((r) => setTimeout(r, COOLDOWN_MS));
  // NOTE: was `this.advanceTheme(themeId, null, ...)` — a null currentTaskId always
  // took the selection branch, so this direct call is equivalent (task 628).
  await selectAndEnqueueNextTask(
    p.prisma,
    p.themeId,
    p.order,
    Math.max(0, p.globalActive - 1),
    p.barrierHoldSince,
  );
}

/** Reset the current task to itself, resetting the tenure clock. / 在任タイマーのリセット */
export async function requeueAndResetTenure(themeId: number, taskId: number): Promise<void> {
  log.warn(
    `[ThemeAutoRunScheduler] Task ${taskId} never executed within the hard ceiling — requeued instead of blocked (theme ${themeId})`,
  );
  logCycleEvent('task.skipped', {
    theme: themeId,
    task: taskId,
    cause: 'backstop_unstarted_requeue',
    msg: 'never-executed task requeued by hang backstop',
  });
  await setCurrentTask(themeId, taskId);
  broadcastAutoRunUpdateImpl(themeId);
}
