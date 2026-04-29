/**
 * execution/reset-route
 *
 * POST /tasks/:id/reset-execution-state — cancels any running or pending
 * executions and resets the task back to 'todo' status, clearing started/
 * completed timestamps. Also releases the in-memory execution lock.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { AgentWorkerManager } from '../../../services/agents/agent-worker-manager';
import { releaseTaskExecutionLock } from './execution-lock';
import { removeWorktree } from '../../../services/agents/orchestrator/git-operations/worktree-ops';

const log = createLogger('routes:agent-execution:reset');
const agentWorkerManager = AgentWorkerManager.getInstance();

export const resetRoute = new Elysia().post(
  '/tasks/:id/reset-execution-state',
  async (context) => {
    const { params } = context;
    const taskId = parseInt(params.id);

    try {
      const config = await prisma.developerModeConfig.findUnique({
        where: { taskId },
        include: {
          agentSessions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              agentExecutions: {
                select: { id: true, status: true },
              },
            },
          },
        },
      });

      if (!config) {
        await prisma.task.update({
          where: { id: taskId },
          data: {
            status: 'todo',
            startedAt: null,
            completedAt: null,
          },
        });
        releaseTaskExecutionLock(taskId);
        return {
          success: true,
          message: 'No execution history found; task state reset to todo',
          taskId,
          taskStatus: 'todo',
        };
      }

      if (config.agentSessions.length > 0) {
        const latestSession = config.agentSessions[0];
        const executionIds = latestSession.agentExecutions.map((execution) => execution.id);

        if (['active', 'running', 'pending'].includes(latestSession.status)) {
          const executions = await agentWorkerManager.getSessionExecutionsAsync(latestSession.id);
          for (const execution of executions) {
            await agentWorkerManager.stopExecution(execution.executionId);
          }
        }

        if (executionIds.length > 0) {
          await prisma.agentExecutionLog.deleteMany({
            where: { executionId: { in: executionIds } },
          });

          await prisma.agentExecution.updateMany({
            where: { id: { in: executionIds } },
            data: {
              status: 'cancelled',
              output: '',
              errorMessage: 'Reset by user',
              question: null,
              questionType: null,
              questionDetails: null,
              completedAt: new Date(),
            },
          });
        }

        let revertedChanges = false;
        let revertSkippedReason: string | undefined;
        const taskForWorktree = await prisma.task.findUnique({
          where: { id: taskId },
          select: {
            workingDirectory: true,
            theme: { select: { workingDirectory: true } },
          },
        });
        const workingDirectory =
          taskForWorktree?.workingDirectory || taskForWorktree?.theme?.workingDirectory || null;

        if (latestSession.worktreePath && workingDirectory) {
          try {
            await removeWorktree(workingDirectory, latestSession.worktreePath);
            revertedChanges = true;
          } catch (revertError) {
            log.warn(
              { err: revertError, taskId, worktreePath: latestSession.worktreePath },
              '[reset-execution-state] Failed to remove worktree during reset',
            );
            revertSkippedReason = 'worktree cleanup failed';
          }
        } else if (!latestSession.worktreePath) {
          revertSkippedReason =
            'No worktree was associated with the latest execution; skipped broad git revert to avoid discarding unrelated uncommitted changes.';
        } else {
          revertSkippedReason = 'Task working directory is not configured.';
        }

        await prisma.agentSession.update({
          where: { id: latestSession.id },
          data: {
            status: 'cancelled',
            completedAt: new Date(),
            errorMessage: 'Reset by user',
            worktreePath: null,
          },
        });

        await prisma.workflowQueueItem
          .updateMany({
            where: {
              taskId,
              status: { in: ['queued', 'running', 'waiting_approval'] },
            },
            data: {
              status: 'cancelled',
              completedAt: new Date(),
              errorMessage: 'Reset by user',
            },
          })
          .catch((err) => {
            log.warn({ err, taskId }, '[reset-execution-state] Failed to cancel queue items');
          });

        log.info(
          { taskId, revertedChanges, revertSkippedReason },
          '[reset-execution-state] Reset latest execution session',
        );
      }

      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: 'todo',
          startedAt: null,
          completedAt: null,
        },
      });

      log.info(`[reset-execution-state] Reset execution state for task ${taskId}`);

      releaseTaskExecutionLock(taskId);

      return {
        success: true,
        message: 'Execution state reset successfully',
        taskId,
        taskStatus: 'todo',
      };
    } catch (error) {
      log.error({ err: error }, `[reset-execution-state] Error`);
      releaseTaskExecutionLock(taskId);
      return { error: 'Failed to reset execution state' };
    }
  },
  {
    params: t.Object({
      id: t.String(),
    }),
  },
);
