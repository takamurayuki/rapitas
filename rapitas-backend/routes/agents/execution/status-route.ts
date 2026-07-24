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

/**
 * Convert a Prisma Decimal cost column to a plain JS number for JSON
 * responses. `costUsd`/`totalCostUsd` are stored as Decimal (or already a
 * plain number on the SQLite desktop schema); a bare `Number()` would throw
 * on a Decimal object in some call paths, and would return NaN for the
 * legacy double-JSON-encoded strings a past IPC bug left in this column
 * (see routes/agents/agent-metrics/observation-query.ts) — coerce those
 * unparsable cases to 0 instead of leaking NaN into the response.
 *
 * @param v - Raw Decimal/number/string value from Prisma
 * @returns Finite non-negative cost, or 0 when unparsable
 */
function toCostNumber(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export const statusRoute = new Elysia().get(
  '/tasks/:id/execution-status',
  async (context) => {
    const { params, query } = context;
    try {
      const taskId = parseInt(params.id);
      const outputOffset =
        typeof query.outputOffset === 'string' ? parseInt(query.outputOffset, 10) : NaN;

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

      // A reset (or cancelled) session is terminal/abandoned: a reset cancels the
      // run and reverts the worktree so the task can run again. Restoring it as a
      // live state leaves the panel stuck (the execute button hides on
      // isCancelled). Report idle so the task presents as ready-to-run again.
      if (latestSession.status === 'reset' || latestSession.status === 'cancelled') {
        return {
          status: 'none',
          message: 'No active execution (previous run was reset or cancelled)',
        };
      }

      // Default to the parent session's latest execution.
      let activeExecution = latestSession.agentExecutions[0];

      // Subtask-aware status: when this is a SPLIT parent, the parent's own
      // execution finishes early and the real work continues in the subtasks'
      // separate executions (their own taskId). Reporting the parent's terminal
      // 'completed' here made the log viewer flip to 「完了」 and stop polling
      // while the agent was still running the subtasks. Worse, even when kept
      // 'running', the viewer froze because it streamed the PARENT's (now static)
      // output. Surface the ACTIVE subtask's execution instead so its live output,
      // executionId (drives the frontend phase-rollover), and status flow through.
      let effectiveExecutionStatus = activeExecution?.status;
      if (effectiveExecutionStatus === 'completed') {
        const subtasks = await prisma.task.findMany({
          where: { parentId: taskId },
          select: { id: true },
        });
        if (subtasks.length > 0) {
          const activeSubExecution = await prisma.agentExecution.findFirst({
            where: {
              status: { in: ['running', 'waiting_for_input'] },
              session: { config: { taskId: { in: subtasks.map((s) => s.id) } } },
            },
            orderBy: { createdAt: 'desc' },
            include: {
              agentConfig: { select: { id: true, agentType: true, name: true, modelId: true } },
            },
          });
          if (activeSubExecution) {
            activeExecution = activeSubExecution as typeof activeExecution;
            effectiveExecutionStatus = 'running';
          }
        }
      }

      const latestExecution = activeExecution;
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
      const fullOutput = latestExecution?.output || '';
      const hasOutputOffset = Number.isFinite(outputOffset) && outputOffset >= 0;
      const output = hasOutputOffset ? fullOutput.slice(outputOffset) : fullOutput;

      // Surface the TASK's own status so the poller can finalize the UI when the
      // run has actually completed the whole workflow. Without this, a single
      // dev-mode execution whose sessionMode is an auto-advancing phase
      // (workflow-researcher etc.) kept the UI "running" forever waiting for a
      // next phase that never spawns — the task was already done. (The
      // "PRを開く" button + completed badge only appear after a manual reload.)
      const taskRow = await prisma.task
        .findUnique({ where: { id: taskId }, select: { status: true, workflowStatus: true } })
        .catch(() => null);

      // Surface the auto-created PR so the execution log can show "PR created: …"
      // (and the "PRを開く" button has a URL) without a separate request.
      const prRow = await prisma.gitHubPullRequest
        .findFirst({
          where: { linkedTaskId: taskId },
          orderBy: { createdAt: 'desc' },
          select: { url: true, prNumber: true },
        })
        .catch(() => null);

      return {
        sessionId: latestSession.id,
        sessionStatus: latestSession.status,
        sessionMode: latestSession.mode || null,
        workflowStatus: taskRow?.workflowStatus ?? null,
        taskStatus: taskRow?.status ?? null,
        prUrl: prRow?.url ?? null,
        prNumber: prRow?.prNumber ?? null,
        executionId: latestExecution?.id,
        executionStatus: effectiveExecutionStatus,
        output,
        outputLength: fullOutput.length,
        errorMessage: latestExecution?.errorMessage,
        startedAt: latestExecution?.startedAt,
        // The whole multi-phase run's start (AgentSession spans every phase;
        // AgentExecution is one row PER phase, so its own startedAt resets
        // every time a new phase's row is created). Elapsed-time displays
        // should anchor on this, not the current phase's startedAt, so the
        // timer accumulates across research/plan/implement/verify instead of
        // restarting at each phase boundary.
        sessionStartedAt: latestSession.createdAt,
        completedAt: latestExecution?.completedAt,
        tokensUsed: latestExecution?.tokensUsed || 0,
        totalSessionTokens: latestSession.totalTokensUsed || 0,
        // Accumulated cost across every execution in this session — mirrors
        // totalSessionTokens (see execution-persistence.ts, which increments
        // both fields in lockstep on every usage-bearing execution update).
        totalSessionCostUsd: toCostNumber(latestSession.totalCostUsd),
        waitingForInput: isWaitingForInput,
        question: questionText,
        questionType,
        questionTimeout: questionTimeoutInfo,
        // NOTE: questionDetails is stored as JSON string in DB — parse back to object for frontend
        questionDetails: execExtras?.questionDetails
          ? (() => {
              try {
                return JSON.parse(execExtras.questionDetails as string);
              } catch {
                return null;
              }
            })()
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
    query: t.Object({
      outputOffset: t.Optional(t.String()),
    }),
  },
);
