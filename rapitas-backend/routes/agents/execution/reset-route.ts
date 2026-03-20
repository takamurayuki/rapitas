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
          },
        },
      });

      if (!config) {
        return { error: 'No developer mode config found for this task' };
      }

      if (config.agentSessions.length > 0) {
        const latestSession = config.agentSessions[0];

        if (['running', 'pending'].includes(latestSession.status)) {
          const executions = await agentWorkerManager.getSessionExecutionsAsync(latestSession.id);
          for (const execution of executions) {
            await agentWorkerManager.stopExecution(execution.executionId);
          }

          const pendingExecutions = await prisma.agentExecution.findMany({
            where: {
              sessionId: latestSession.id,
              status: { in: ['running', 'pending', 'waiting_for_input'] },
            },
          });

          for (const execution of pendingExecutions) {
            await prisma.agentExecutionLog.deleteMany({
              where: { executionId: execution.id },
            });

            await prisma.agentExecution.update({
              where: { id: execution.id },
              data: {
                status: 'cancelled',
                completedAt: new Date(),
                errorMessage: 'Reset by user',
              },
            });
          }

          await prisma.agentSession.update({
            where: { id: latestSession.id },
            data: {
              status: 'cancelled',
              completedAt: new Date(),
              errorMessage: 'Reset by user',
            },
          });
        }
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
