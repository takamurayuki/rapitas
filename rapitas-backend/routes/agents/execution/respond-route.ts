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
import { HTTP_STATUS } from '../../../utils/common/http-status';

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
      context.set.status = HTTP_STATUS.BAD_REQUEST;
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
        context.set.status = HTTP_STATUS.NOT_FOUND;
        return { error: 'No active session found' };
      }

      const session = config.agentSessions[0];
      const latestExecution = session.agentExecutions[0];

      if (!latestExecution) {
        context.set.status = HTTP_STATUS.NOT_FOUND;
        return { error: 'No execution found' };
      }

      if (latestExecution.status === 'running') {
        context.set.status = HTTP_STATUS.CONFLICT;
        return { error: 'Execution is already running' };
      }
      if (latestExecution.status !== 'waiting_for_input') {
        context.set.status = HTTP_STATUS.CONFLICT;
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
        context.set.status = HTTP_STATUS.UNPROCESSABLE_ENTITY;
        return {
          error:
            'Task theme must have workingDirectory configured. Please set the working directory in theme settings.',
        };
      }
      // NOTE: Log warning when workingDirectory overlaps with rapitas project — allowed but flagged
      const projectRoot = getProjectRoot();
      if (
        workingDirectory === projectRoot ||
        workingDirectory.startsWith(join(projectRoot, 'rapitas-'))
      ) {
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
        context.set.status = HTTP_STATUS.CONFLICT;
        return {
          error: 'Another operation is in progress for this execution',
        };
      }

      agentWorkerManager.cancelQuestionTimeout(latestExecution.id);
      log.info(`[agent-respond] Cancelled timeout for execution ${latestExecution.id}`);

      // Restore task status from blocked (waiting) back to in-progress right
      // away — this and the lock acquisition above are the only things the
      // caller needs to wait for. Canonical task.status is hyphenated (see
      // StatusConfig); the underscore form is the separate workflowStatus value.
      await prisma.task
        .update({ where: { id: taskId }, data: { status: 'in-progress' } })
        .catch(() => {});

      // NOTE: fire-and-forget, matching execute-route.ts/continue-route.ts —
      // this used to `await` the ENTIRE next agent turn (potentially minutes)
      // before ever responding to the client. Since executeContinuationInternal
      // already writes AgentExecution.status='running' + question=null to the
      // DB almost immediately (continuation-executor.ts), the frontend's
      // separate status poller sees the real state within ~1s regardless —
      // blocking the HTTP response on the full turn only delayed the client's
      // own optimistic "resumed" UI update by however long the turn took,
      // during which the execution log appeared stuck on the old question.
      // Use executeContinuationWithLock because the lock is already held by
      // this endpoint. executeContinuation() would try to acquire the same
      // lock again and fail immediately.
      agentWorkerManager
        .executeContinuationWithLock(latestExecution.id, response, {
          sessionId: session.id,
          taskId,
          workingDirectory,
        })
        .then((result) => {
          if (!result.success) {
            log.warn(
              { taskId, executionId: latestExecution.id, error: result.errorMessage },
              '[agent-respond] Continuation did not complete successfully',
            );
          }
        })
        .catch((error: unknown) => {
          log.error(
            { err: error, taskId, executionId: latestExecution.id },
            '[agent-respond] Continuation execution error',
          );
        });

      return {
        success: true,
        message: 'Response sent successfully',
        executionId: latestExecution.id,
      };
    } catch (error) {
      log.error({ err: error }, '[agent-respond] Database error');
      context.set.status = HTTP_STATUS.INTERNAL_SERVER_ERROR;
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
