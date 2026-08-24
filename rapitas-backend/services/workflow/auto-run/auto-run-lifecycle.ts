/**
 * auto-run-lifecycle
 *
 * Theme lifecycle handling for the auto-run scheduler: stopping/idle/paused
 * theme processing, in-flight execution teardown, and SSE broadcast. Extracted
 * verbatim from ThemeAutoRunScheduler (task 628) as prisma-injected free
 * functions; the scheduler class delegates to these. Not responsible for the
 * running-theme advance logic (see auto-run-advance-active / -select).
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';
import { resolveTaskWorkingDirectory } from '../../task/task-resolver';
import { AgentWorkerManager } from '../../agents/agent-worker-manager';
import { realtimeService } from '../../communication/realtime-service';
import { hasPromotableBacklog } from './backlog-task-promoter';
import { logCycleEvent } from '../../observability';
import { getThemeActiveQueueItems, hasItemAwaitingApproval } from './auto-run-selection';
import {
  resumeAutoRun,
  finalizeStop,
  startAutoRun,
  type ThemeAutoRunState,
} from './theme-auto-run-service';

const log = createLogger('theme-auto-run-scheduler');

/**
 * Handle themes in 'stopping' status: cancel queue items and stop the agent.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param stopping - Themes currently in 'stopping' status / 停止中テーマ一覧
 */
export async function processStoppingThemesImpl(
  prisma: PrismaClient,
  stopping: ThemeAutoRunState[],
): Promise<void> {
  for (const state of stopping) {
    try {
      await stopThemeExecutionImpl(prisma, state.themeId, state.currentTaskId);
      await finalizeStop(state.themeId);
      broadcastAutoRunUpdateImpl(state.themeId);
      log.info(`[ThemeAutoRunScheduler] Theme ${state.themeId} stopped`);
      logCycleEvent('theme.stopped', {
        theme: state.themeId,
        task: state.currentTaskId ?? undefined,
        msg: 'auto-run stopped by user',
      });
    } catch (err) {
      log.error({ err }, `[ThemeAutoRunScheduler] Error stopping theme ${state.themeId}`);
    }
  }
}

/**
 * Auto-resume themes that completed all work and went idle-but-ARMED
 * (enabled:true) once new work appears — a fresh todo task, or a backlog item
 * that can now be promoted (a backlog job added a concern/idea, or a freed cap
 * slot). This is what makes auto-run self-sustaining instead of dying at the
 * first dry. A USER stop leaves enabled:false and is never auto-resumed.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param idle - Themes currently in 'idle' status / アイドル状態のテーマ一覧
 */
export async function processIdleThemesImpl(
  prisma: PrismaClient,
  idle: ThemeAutoRunState[],
): Promise<void> {
  for (const state of idle) {
    if (!state.enabled) continue; // user-stopped → stay stopped
    try {
      // Mirror selectNextTask's eligibility (parentId:null — the scheduler only
      // drives TOP-LEVEL tasks; subtasks are run by AIOrchestra). Counting
      // subtasks here let a stuck todo SUBTASK resume the theme, which then went
      // straight back to all_done because selection skips it — a 12s idle⇄running
      // flap that never made progress.
      const todo = await prisma.task
        .count({ where: { themeId: state.themeId, status: 'todo', parentId: null } })
        .catch(() => 0);
      const hasWork = todo > 0 || (await hasPromotableBacklog(state.themeId));
      if (!hasWork) continue;

      await startAutoRun(state.themeId);
      broadcastAutoRunUpdateImpl(state.themeId);
      log.info(
        { themeId: state.themeId, todo },
        '[ThemeAutoRunScheduler] new work appeared — auto-resumed idle theme',
      );
      logCycleEvent('theme.resumed', {
        theme: state.themeId,
        todo,
        cause: todo > 0 ? 'new_todo' : 'backlog_promotable',
        msg: 'idle theme auto-resumed (new work appeared)',
      });
    } catch (err) {
      log.warn({ err, themeId: state.themeId }, '[ThemeAutoRunScheduler] idle auto-resume failed');
    }
  }
}

/**
 * For paused themes, check whether approval was granted and auto-resume.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param paused - Themes currently in 'paused' status / 一時停止中テーマ一覧
 */
export async function processPausedThemesImpl(
  prisma: PrismaClient,
  paused: ThemeAutoRunState[],
): Promise<void> {
  for (const state of paused) {
    if (!state.currentTaskId) continue;
    try {
      // If the queue item is no longer 'waiting_approval' (e.g. user approved in UI)
      // AND the ThemeAutoRun was not already resumed by onPlanApproved(), resume now.
      const queueItems = await getThemeActiveQueueItems(prisma, state.themeId);
      const stillWaiting = hasItemAwaitingApproval(queueItems);

      // If queue item is gone (completed during pause) or re-queued after approval
      if (!stillWaiting) {
        const taskItem = await prisma.workflowQueueItem.findFirst({
          where: { taskId: state.currentTaskId, status: 'queued' },
        });
        if (taskItem) {
          // Plan was approved, item is back in queue — resume the theme
          await resumeAutoRun(state.themeId);
          broadcastAutoRunUpdateImpl(state.themeId);
          log.info(
            `[ThemeAutoRunScheduler] Theme ${state.themeId} auto-resumed (plan approved detected)`,
          );
        }
      }
    } catch (err) {
      log.error({ err }, `[ThemeAutoRunScheduler] Error processing paused theme ${state.themeId}`);
    }
  }
}

/**
 * Stop a theme's current execution: cancel queue items and kill the in-flight agent.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme to stop / 停止するテーマID
 * @param currentTaskId - Currently tracked task ID / 現在のタスクID
 */
export async function stopThemeExecutionImpl(
  prisma: PrismaClient,
  themeId: number,
  currentTaskId: number | null,
): Promise<void> {
  // Cancel all auto-run queue items for this theme
  await prisma.workflowQueueItem.updateMany({
    where: {
      themeId,
      status: { in: ['queued', 'running', 'waiting_approval'] },
    },
    data: { status: 'cancelled', completedAt: new Date(), errorMessage: 'Auto-run stopped' },
  });

  if (!currentTaskId) return;

  // Stop the agent execution(s) if any are running
  try {
    const task = await resolveTaskWorkingDirectory(currentTaskId);
    const workDir = task?.workingDirectory ?? task?.theme?.workingDirectory;

    // Kill ALL in-flight agents across the theme — the current task, its
    // subtasks, and any other theme task with a live execution (not just the
    // first found) — and release their locks. A split parent's subtask runs
    // under a different taskId, so a current-task-only stop would orphan it.
    const { stopThemeAgents } = await import('../../agents/stop-task-agents');
    await stopThemeAgents(themeId, currentTaskId, { errorMessage: 'Auto-run stopped' }).catch(
      (err) => {
        log.warn({ err, themeId }, '[ThemeAutoRunScheduler] stopThemeAgents failed');
      },
    );

    // Revert any uncommitted changes
    if (workDir) {
      // NOTE: getInstance() replaces the former scheduler field — same singleton (task 628).
      await AgentWorkerManager.getInstance()
        .revertChanges(workDir)
        .catch((err) => {
          log.warn(
            { err },
            `[ThemeAutoRunScheduler] Failed to revert changes for theme ${themeId}`,
          );
        });
    }

    // Reset task to 'todo'
    await prisma.task
      .update({ where: { id: currentTaskId }, data: { status: 'todo' } })
      .catch(() => {});
  } catch (err) {
    log.error(
      { err },
      `[ThemeAutoRunScheduler] Error stopping execution for task ${currentTaskId}`,
    );
  }
}

/**
 * Broadcast SSE update for a theme's auto-run state change.
 *
 * @param themeId - Theme whose state changed / 状態が変わったテーマID
 */
export function broadcastAutoRunUpdateImpl(themeId: number): void {
  try {
    realtimeService.broadcast('orchestra', 'auto_run_update', {
      themeId,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // SSE unavailable — non-fatal
  }
}
