/**
 * execution/status-route
 *
 * GET /tasks/:id/execution-status — returns the latest session and execution
 * state for a task, including question timeout metadata when the agent is
 * waiting for user input.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { AgentWorkerManager } from '../../../services/agents/agent-worker-manager';
import type { AgentExecutionWithExtras } from '../../../types/agent-execution-types';

const log = createLogger('routes:agent-execution:status');
const agentWorkerManager = AgentWorkerManager.getInstance();

export const statusRoute = new Elysia().get(
  '/tasks/:id/execution-status',
  async (context) => {
    const { params } = context;
    try {
      const taskId = parseInt(params.id);

      const config = await prisma.developerModeConfig.findUnique({
        where: { taskId },
        include: {
          agentSessions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              agentExecutions: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                include: {
                  agentConfig: {
                    select: {
                      id: true,
                      agentType: true,
                      name: true,
                      modelId: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!config || !config.agentSessions[0]) {
        return { status: 'none', message: 'No execution history' };
      }

      const latestSession = config.agentSessions[0];
      const latestExecution = latestSession.agentExecutions[0];
      const execExtras = latestExecution as typeof latestExecution & AgentExecutionWithExtras;

      // NOTE: For new executions, the query returns a new session (no execution), so the old
      // completed state does not appear. For continued executions (same session), the frontend
      // absorbs this with terminalGraceMs. No backend guard needed here.

      const isWaitingForInput = latestExecution?.status === 'waiting_for_input';
      const questionText = execExtras?.question || null;
      const questionType: 'tool_call' | 'none' =
        execExtras?.questionType === 'tool_call' ? 'tool_call' : 'none';

      let questionTimeoutInfo = null;
      if (isWaitingForInput && latestExecution?.id) {
        const timeoutInfo = await agentWorkerManager.getQuestionTimeoutInfoAsync(
          latestExecution.id,
        );
        if (timeoutInfo) {
          questionTimeoutInfo = {
            remainingSeconds: timeoutInfo.remainingSeconds,
            deadline: timeoutInfo.deadline.toISOString(),
            totalSeconds: timeoutInfo.questionKey?.timeout_seconds || 300,
          };
        }
      }

      const agentConfigInfo = (latestExecution as Record<string, unknown>)?.agentConfig as {
        id: number;
        agentType: string;
        name: string;
        modelId: string | null;
      } | null;

      return {
        sessionId: latestSession.id,
        sessionStatus: latestSession.status,
        sessionMode: latestSession.mode || null,
        executionId: latestExecution?.id,
        executionStatus: latestExecution?.status,
        output: latestExecution?.output,
        errorMessage: latestExecution?.errorMessage,
        startedAt: latestExecution?.startedAt,
        completedAt: latestExecution?.completedAt,
        tokensUsed: latestExecution?.tokensUsed || 0,
        totalSessionTokens: latestSession.totalTokensUsed || 0,
        waitingForInput: isWaitingForInput,
        question: questionText,
        questionType,
        questionTimeout: questionTimeoutInfo,
        // NOTE: questionDetails is stored as JSON string in DB — parse back to object for frontend
        questionDetails: execExtras?.questionDetails
          ? (() => { try { return JSON.parse(execExtras.questionDetails as string); } catch { return null; } })()
          : null,
        claudeSessionId: execExtras?.claudeSessionId || null,
        agentConfig: agentConfigInfo || null,
      };
    } catch (error) {
      log.error({ err: error }, '[execution-status] Error fetching status');
      return {
        status: 'error',
        message: 'An error occurred while retrieving status',
      };
    }
  },
  {
    params: t.Object({
      id: t.String(),
    }),
  },
);
