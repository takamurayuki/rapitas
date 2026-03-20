/**
 * execution/respond-route
 *
 * POST /tasks/:id/agent-respond — delivers a user response to a paused agent
 * execution that is waiting for input (status === 'waiting_for_input').
 * Acquires a continuation lock before resuming to prevent duplicate responses.
 */

import { Elysia, t } from 'elysia';
import { join } from 'path';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { getProjectRoot } from '../../../config';
import { AgentWorkerManager } from '../../../services/agents/agent-worker-manager';

const log = createLogger('routes:agent-execution:respond');
const agentWorkerManager = AgentWorkerManager.getInstance();

export const respondRoute = new Elysia().post(
  '/tasks/:id/agent-respond',
  async (context) => {
    const params = context.params as { id: string };
    const body = context.body as { response: string };
    const taskId = parseInt(params.id);
    const { response } = body;

    if (!response?.trim()) {
      return { error: 'Response is required' };
    }

    try {
      const config = await prisma.developerModeConfig.findUnique({
        where: { taskId },
        include: {
          task: { include: { theme: true } },
          agentSessions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              agentExecutions: {
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
        },
      });

      if (!config || !config.agentSessions[0]) {
        return { error: 'No active session found' };
      }

      const session = config.agentSessions[0];
      const latestExecution = session.agentExecutions[0];

      if (!latestExecution) {
        return { error: 'No execution found' };
      }

      if (latestExecution.status === 'running') {
        return { error: 'Execution is already running' };
      }
      if (latestExecution.status !== 'waiting_for_input') {
        return {
          error: `Execution is not waiting for input: ${latestExecution.status}`,
        };
      }

      // NOTE: Validate workingDirectory BEFORE acquiring lock to avoid orphaned locks on early return
      const workingDirectory = config.task.theme?.workingDirectory;
      if (!workingDirectory) {
        log.warn(
          `[agent-respond] Task ${taskId} rejected: workingDirectory not configured for theme "${config.task.theme?.name || 'unknown'}".`,
        );
        return {
          error:
            'Task theme must have workingDirectory configured. Please set the working directory in theme settings.',
        };
      }
      // NOTE: Log warning when workingDirectory overlaps with rapitas project — allowed but flagged
      const projectRoot = getProjectRoot();
      if (workingDirectory === projectRoot || workingDirectory.startsWith(join(projectRoot, 'rapitas-'))) {
        log.warn(
          `[agent-respond] Task ${taskId}: workingDirectory overlaps with rapitas project (${workingDirectory}). Proceeding as user-intended.`,
        );
      }

      if (
        !(await agentWorkerManager.tryAcquireContinuationLockAsync(
          latestExecution.id,
          'user_response',
        ))
      ) {
        return {
          error: 'Another operation is in progress for this execution',
        };
      }

      agentWorkerManager.cancelQuestionTimeout(latestExecution.id);
      log.info(`[agent-respond] Cancelled timeout for execution ${latestExecution.id}`);

      // NOTE: Use executeContinuationWithLock because the lock is already held by this endpoint.
      // executeContinuation() would try to acquire the same lock again and fail immediately.
      const result = await agentWorkerManager.executeContinuationWithLock(latestExecution.id, response, {
        sessionId: session.id,
        taskId,
        workingDirectory,
      });

      if (result.success) {
        return {
          success: true,
          message: 'Response sent successfully',
          executionId: latestExecution.id,
        };
      } else {
        return {
          error: result.errorMessage || 'Failed to send response',
          executionId: latestExecution.id,
        };
      }
    } catch (error) {
      log.error({ err: error }, '[agent-respond] Database error');
      return {
        error: 'Database error occurred. Failed to send response.',
        message: 'Failed to send agent response due to database error',
      };
    }
  },
  {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      response: t.String(),
    }),
  },
);
