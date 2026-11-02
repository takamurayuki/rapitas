/**
 * execution/stop-route
 *
 * POST /tasks/:id/stop-execution — halts ALL running agents for the task,
 * cancels pending executions/queue items, reverts uncommitted git changes,
 * cleans up worktrees, and releases the execution lock.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../../../config/database';
import { createLogger } from '../../../../config/logger';
import { AgentWorkerManager } from '../../../../services/agents/agent-worker-manager';
import { stopTaskAgents } from '../../../../services/agents/stop-task-agents';
import {
  getAutoRunState,
  finalizeStop,
  isAutoRunHandlingTask,
} from '../../../../services/workflow/auto-run/theme-auto-run-service';
import { releaseTaskExecutionLock } from '../shared/execution-lock';
import { incrementTaskGenerationId } from '../../../../services/agents/task-execution-lock';
import { removeWorktree } from '../../../../services/agents/orchestrator/git-operations/worktree/worktree-ops';
import { resolveTaskWorkingDirectory } from '../../../../services/task/task-resolver';
import { recordTransition } from '../../../../services/workflow/transition-recorder';
import { MANUAL_STOP_WITHDRAW_CAUSE } from '../../../../services/workflow/incident-signature-detectors';
import { parseId } from '../../../../middleware/error-handler';

const log = createLogger('routes:agent-execution:stop');
const agentWorkerManager = AgentWorkerManager.getInstance();

export const stopRoute = new Elysia().post(
  '/tasks/:id/stop-execution',
  async (context) => {
    const { params, body } = context;
    // NOTE(#1349): parseId rejects a non-numeric id; parseInt returned what
    // it had read so far. Reproduced on the running server before this fix:
    // POST /tasks/1475abc/stop-execution answered 200, forced row 1475 from
    // in_progress to 'todo' and bumped its executionGenerationId 0 -> 1 —
    // the write that stops a live agent being revived. The suffix was never
    // reported to the caller.
    const taskId = parseId(params.id, 'task ID');
    const withdraw = body?.withdraw === true;

    try {
      // Bump the durable execution generation FIRST (task 881) — this is the
      // signal stale-recovery-helpers.ts checks before reviving a session, so
      // it must be visible to any recovery pass that races this stop as early
      // as possible. haltReason/resumeCondition are NOT written here: those
      // fields describe an AUTOMATIC iteration-budget halt, not a user stop
      // (see task-iteration-budget.ts and plan.md §実装者への申し送り事項 #1).
      await incrementTaskGenerationId(taskId);

      const task = await resolveTaskWorkingDirectory(taskId);
      const workingDirectory = task?.workingDirectory || task?.theme?.workingDirectory || null;

      // Cancel any pending/queued workflow items so the runner won't re-pick the
      // task right after we stop it.
      await prisma.workflowQueueItem
        .updateMany({
          where: {
            taskId,
            status: { in: ['queued', 'running', 'waiting_approval'] },
          },
          data: {
            status: 'cancelled',
            completedAt: new Date(),
            errorMessage: 'Cancelled by user',
          },
        })
        .catch((err) => {
          log.warn({ err, taskId }, '[stop-execution] Failed to cancel workflow queue items');
        });

      // Collect the worktree-bearing sessions BEFORE stopping, so we can clean
      // them up after the agents are killed.
      const sessionsToClean = await prisma.agentSession
        .findMany({
          where: { config: { taskId }, worktreePath: { not: null } },
          select: { id: true, worktreePath: true },
        })
        .catch(() => [] as { id: number; worktreePath: string | null }[]);

      // Kill EVERY in-flight agent for the task (not just the first found) and
      // release the execution lock. This is the single source of truth shared
      // with the auto-run scheduler and the workflow runner.
      const { stoppedCount } = await stopTaskAgents(taskId, { errorMessage: 'Cancelled by user' });

      // Mark the task's active sessions cancelled so the FE doesn't show them
      // as live after the agents are gone.
      await prisma.agentSession
        .updateMany({
          where: { config: { taskId }, status: { in: ['active', 'running', 'pending'] } },
          data: { status: 'cancelled', completedAt: new Date(), errorMessage: 'Cancelled by user' },
        })
        .catch((err) => {
          log.warn({ err, taskId }, '[stop-execution] Failed to cancel agent sessions');
        });

      // If the theme's auto-run is the actor driving THIS task, halt the loop
      // now (before the status reset below). Otherwise the scheduler either
      // re-selects the just-reset 'todo' task or advances to the next task and
      // launches a fresh agent mid-stop — the "press stop, it runs again" bug.
      // finalizeStop is immediate (idle + disabled + currentTaskId=null), so it
      // doesn't depend on the next scheduler tick. Only fires when auto-run is
      // actually running this task — a manual single-task stop is unaffected.
      if (task?.themeId != null) {
        const autoRunState = await getAutoRunState(task.themeId).catch(() => null);
        if (isAutoRunHandlingTask(autoRunState, taskId)) {
          await finalizeStop(task.themeId).catch((err) =>
            log.warn(
              { err, taskId, themeId: task.themeId },
              '[stop-execution] Failed to halt theme auto-run',
            ),
          );
          log.info(
            `[stop-execution] Halted theme ${task.themeId} auto-run (was running task ${taskId})`,
          );
        }
      }

      // Revert uncommitted changes in the task's working directory.
      if (workingDirectory) {
        try {
          await agentWorkerManager.revertChanges(workingDirectory);
          log.info(`[stop-execution] Reverted changes in ${workingDirectory}`);
        } catch (revertError) {
          log.error({ err: revertError }, '[stop-execution] Failed to revert changes');
        }
      }

      // Clean up any worktrees the sessions created.
      if (workingDirectory) {
        for (const session of sessionsToClean) {
          if (!session.worktreePath) continue;
          try {
            const removed = await removeWorktree(workingDirectory, session.worktreePath);
            if (removed) {
              await prisma.agentSession.update({
                where: { id: session.id },
                data: { worktreePath: null },
              });
              log.info(`[stop-execution] Cleaned up worktree: ${session.worktreePath}`);
            } else {
              log.warn(`[stop-execution] removeWorktree refused: ${session.worktreePath}`);
            }
          } catch (worktreeError) {
            log.error(
              { err: worktreeError },
              `[stop-execution] Failed to clean up worktree: ${session.worktreePath}`,
            );
          }
        }
      }

      // NOTE: Reset task status to 'todo' so it doesn't stay in a limbo state.
      // NOTE(#1330): The outcome is REPORTED. This failure used to be logged
      // and dropped while the route still answered `success: true`, so a task
      // left in-progress with no execution behind it looked stopped to the
      // caller. Seen for real in #1000's CI log, on a run whose own summary
      // recorded HTTP 200 for the same stop.
      let statusResetFailed = false;
      try {
        const current = await prisma.task
          .findUnique({ where: { id: taskId }, select: { workflowStatus: true } })
          .catch(() => null);
        const workflowStatus = current?.workflowStatus ?? null;
        await prisma.task.update({ where: { id: taskId }, data: { status: 'todo' } });
        log.info(`[stop-execution] Reset task ${taskId} status to 'todo'`);
        // Record the revert so isWithinRecoveryGrace (incident-signature-detectors.ts)
        // can grant this deliberate `status='todo'` × advanced `workflowStatus`
        // shape its recovery grace period (task 709: previously unrecorded,
        // causing an immediate Pattern B false positive — task #602).
        await recordTransition({
          taskId,
          fromStatus: workflowStatus,
          toStatus: workflowStatus ?? 'draft',
          actor: 'user',
          cause: withdraw ? MANUAL_STOP_WITHDRAW_CAUSE : 'manual_execution_stop_revert',
          metadata: {
            reason: withdraw ? 'manual_stop_execution_withdraw' : 'manual_stop_execution',
          },
        }).catch(() => {});
      } catch (taskErr) {
        statusResetFailed = true;
        log.error({ err: taskErr }, `[stop-execution] Failed to reset task ${taskId} status`);
      }

      // stopTaskAgents already releases the lock, but call again defensively in
      // case no execution row existed yet a lock was somehow held.
      releaseTaskExecutionLock(taskId);

      // The executions really were stopped, so this is not a failed stop — but
      // it is not a clean one either, and the caller has to be able to tell.
      // The flag is absent on the normal path rather than false, so nothing
      // existing has to change to keep reading `success`.
      const partial = statusResetFailed ? { statusResetFailed: true } : {};

      if (stoppedCount === 0) {
        return {
          success: true,
          stoppedCount,
          withdrawn: withdraw,
          ...partial,
          message: statusResetFailed
            ? '実行は停止しましたが、タスクのステータスを戻せませんでした'
            : 'No running execution found; cleaned up queue items and worktrees',
        };
      }

      return {
        success: true,
        stoppedCount,
        withdrawn: withdraw,
        ...partial,
        message: statusResetFailed
          ? '実行は停止しましたが、タスクのステータスを戻せませんでした'
          : 'Execution(s) stopped and changes reverted',
      };
    } catch (error) {
      log.error({ err: error }, '[stop-execution] Database error');
      releaseTaskExecutionLock(taskId);
      // NOTE(#1335): the status is set. This returned a body saying
      // success:false under HTTP 200, so a caller reading only the status was
      // told the stop had worked when nothing had been stopped. #1332 taught
      // the panel to read the body — which is the right place for the
      // authority — but a status code that contradicts its own body is not a
      // contract any other caller should have to know about.
      //
      // Distinct from a failed status reset: that path keeps its 200, because
      // the executions genuinely did stop (#1330). This one means the stop
      // cannot be reported as complete — NOT that nothing happened. Work
      // before the throw may well have landed: incrementTaskGenerationId runs
      // first, and queue withdrawal or worktree cleanup may be partly done.
      // That is precisely why it cannot be a 200: the caller has no way to
      // know how far it got, so it must not be told the stop succeeded.
      context.set.status = 500;
      return {
        success: false,
        error: 'Database error occurred. Failed to stop execution.',
        message: 'Failed to stop execution due to database error',
      };
    }
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Optional(
      t.Object({
        withdraw: t.Optional(t.Boolean()),
      }),
    ),
  },
);
