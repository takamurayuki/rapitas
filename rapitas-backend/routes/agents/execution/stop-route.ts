/**
 * execution/stop-route
 *
 * POST /tasks/:id/stop-execution — halts the running agent, cancels pending
 * executions, reverts uncommitted git changes, and releases the execution lock.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { orchestrator } from '../../../services/orchestrator-instance';
import { AgentWorkerManager } from '../../../services/agents/agent-worker-manager';
import { releaseTaskExecutionLock } from './execution-lock';

const log = createLogger('routes:agent-execution:stop');
const agentWorkerManager = AgentWorkerManager.getInstance();

export const stopRoute = new Elysia().post(
  '/tasks/:id/stop-execution',
  async (context) => {
    const { params } = context;
    const taskId = parseInt(params.id);

    try {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { workingDirectory: true },
      });

      const config = await prisma.developerModeConfig.findUnique({
        where: { taskId },
        include: {
          agentSessions: {
            where: {
              status: { in: ['running', 'pending'] },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!config || config.agentSessions.length === 0) {
        const runningExecution = await prisma.agentExecution.findFirst({
          where: {
            session: {
              config: {
                taskId,
              },
            },
            status: { in: ['running', 'pending', 'waiting_for_input'] },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (runningExecution) {
          const stopped = await orchestrator
            .stopExecution(runningExecution.id)
            .catch(() => false);

          try {
            await prisma.agentExecutionLog.deleteMany({
              where: { executionId: runningExecution.id },
            });
            log.info(
              `[stop-execution] Deleted execution logs for execution ${runningExecution.id}`,
            );
          } catch (deleteError) {
            log.error(
              { err: deleteError },
              `[stop-execution] Failed to delete execution logs for execution ${runningExecution.id}`,
            );
          }

          if (!stopped) {
            try {
              await prisma.agentExecution.update({
                where: { id: runningExecution.id },
                data: {
                  status: 'cancelled',
                  completedAt: new Date(),
                  errorMessage: 'Cancelled by user',
                },
              });
              log.info(
                `[stop-execution] Updated DB status for execution ${runningExecution.id} (not found in orchestrator)`,
              );
            } catch (updateError) {
              log.error(
                { err: updateError },
                `[stop-execution] Failed to update execution ${runningExecution.id} status`,
              );
            }
          }

          if (task?.workingDirectory) {
            try {
              await agentWorkerManager.revertChanges(task.workingDirectory);
              log.info(`[stop-execution] Reverted changes in ${task.workingDirectory}`);
            } catch (revertError) {
              log.error({ err: revertError }, `[stop-execution] Failed to revert changes`);
            }
          }

          // NOTE: Reset task status to 'todo' so it doesn't stay in a limbo state
          try {
            await prisma.task.update({ where: { id: taskId }, data: { status: 'todo' } });
            log.info(`[stop-execution] Reset task ${taskId} status to 'todo'`);
          } catch (taskErr) {
            log.error({ err: taskErr }, `[stop-execution] Failed to reset task ${taskId} status`);
          }

          return {
            success: true,
            message: 'Execution cancelled and changes reverted',
          };
        }

        return { success: false, message: 'No running execution found' };
      }

      const session = config.agentSessions[0];

      const executions = await agentWorkerManager.getSessionExecutionsAsync(session.id);
      for (const execution of executions) {
        await agentWorkerManager.stopExecution(execution.executionId);
      }

      const pendingExecutions = await prisma.agentExecution.findMany({
        where: {
          sessionId: session.id,
          status: { in: ['running', 'pending', 'waiting_for_input'] },
        },
      });

      for (const execution of pendingExecutions) {
        try {
          await prisma.agentExecutionLog.deleteMany({
            where: { executionId: execution.id },
          });

          await prisma.agentExecution.update({
            where: { id: execution.id },
            data: {
              status: 'cancelled',
              completedAt: new Date(),
              errorMessage: 'Cancelled by user',
            },
          });
        } catch (executionUpdateError) {
          log.error(
            { err: executionUpdateError },
            `[stop-execution] Failed to update execution ${execution.id}`,
          );
        }
      }

      try {
        await prisma.agentSession.update({
          where: { id: session.id },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errorMessage: 'Cancelled by user',
          },
        });
      } catch (sessionUpdateError) {
        log.error(
          { err: sessionUpdateError },
          `[stop-execution] Failed to update session ${session.id} status`,
        );
      }

      if (task?.workingDirectory) {
        try {
          await agentWorkerManager.revertChanges(task.workingDirectory);
          log.info(`[stop-execution] Reverted changes in ${task.workingDirectory}`);
        } catch (revertError) {
          log.error({ err: revertError }, `[stop-execution] Failed to revert changes`);
        }
      }

      // NOTE: Reset task status to 'todo' so it doesn't stay in 'in-progress' or 'waiting' state
      try {
        await prisma.task.update({ where: { id: taskId }, data: { status: 'todo' } });
        log.info(`[stop-execution] Reset task ${taskId} status to 'todo'`);
      } catch (taskErr) {
        log.error({ err: taskErr }, `[stop-execution] Failed to reset task ${taskId} status`);
      }

      releaseTaskExecutionLock(taskId);

      return {
        success: true,
        sessionId: session.id,
        message: 'Execution stopped and changes reverted',
      };
    } catch (error) {
      log.error({ err: error }, '[stop-execution] Database error');
      releaseTaskExecutionLock(taskId);
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
  },
);
