/**
 * Agent Audit Router
 * Audit log and execution history endpoints.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import { getAgentConfigAuditLogs, getRecentAuditLogs } from '../../../utils/agent/agent-audit-log';

/**
 * Safe cast type for AgentExecution fields that exist in DB but are not in Prisma's generated types.
 */
type ExecutionWithExtras = {
  question?: string | null;
  questionType?: string | null;
  questionDetails?: unknown;
  claudeSessionId?: string | null;
};

export const agentAuditRouter = new Elysia({ prefix: '/agents' })
  // Get audit logs for a specific agent
  .get('/:id/audit-logs', async (context) => {
    const { params, query } = context;
    const { id } = params;
    const limit = query.limit ? parseInt(query.limit) : 50;

    const logs = await getAgentConfigAuditLogs(parseInt(id), limit);
    return { logs };
  })

  // Get recent audit logs (all agents)
  .get('/audit-logs/recent', async (context) => {
    const { query } = context;
    const limit = query.limit ? parseInt(query.limit) : 100;
    const logs = await getRecentAuditLogs(limit);
    return { logs };
  });

export const taskExecutionLogsRouter = new Elysia({ prefix: '/tasks' })
  // Get execution logs (for recovery after app restart)
  .get('/:id/execution-logs', async (context) => {
    const params = context.params as { id: string };
    const query = context.query as {
      executionId?: string;
      afterSequence?: string;
    };
    const taskId = parseInt(params.id);
    const executionId = query.executionId ? parseInt(query.executionId) : undefined;
    const afterSequence = query.afterSequence ? parseInt(query.afterSequence) : undefined;

    // NOTE: When executionId / afterSequence are provided, return logs for a single
    // execution (legacy compat for incremental fetching).
    const singleExecutionMode = !!executionId || typeof afterSequence === 'number';

    const config = await prisma.developerModeConfig.findUnique({
      where: { taskId },
      include: {
        agentSessions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            agentExecutions: {
              where: executionId ? { id: executionId } : {},
              orderBy: { createdAt: 'desc' },
              take: singleExecutionMode ? 1 : 50,
              include: {
                executionLogs: {
                  where: singleExecutionMode
                    ? afterSequence
                      ? { sequenceNumber: { gt: afterSequence } }
                      : {}
                    : {},
                  orderBy: { sequenceNumber: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (!config || !config.agentSessions[0]) {
      return { logs: [], lastSequence: 0, status: 'none' };
    }

    const latestSession = config.agentSessions[0];
    const executions = latestSession.agentExecutions || [];

    if (executions.length === 0) {
      return { logs: [], lastSequence: 0, status: 'none' };
    }

    // Single-execution mode: legacy-compatible response
    if (singleExecutionMode) {
      const latestExecution = executions[0];
      const logs = latestExecution.executionLogs || [];
      const lastSequence = logs.length > 0 ? logs[logs.length - 1].sequenceNumber : 0;

      return {
        executionId: latestExecution.id,
        sessionId: latestSession.id,
        status: latestExecution.status,
        logs: logs.map(
          (log: {
            id: number;
            logChunk: string;
            logType: string;
            sequenceNumber: number;
            timestamp: Date;
          }) => ({
            id: log.id,
            chunk: log.logChunk,
            type: log.logType,
            sequence: log.sequenceNumber,
            timestamp: log.timestamp,
          }),
        ),
        lastSequence,
        output: latestExecution.output,
        errorMessage: latestExecution.errorMessage,
        question: (latestExecution as typeof latestExecution & ExecutionWithExtras).question,
        questionType: (latestExecution as typeof latestExecution & ExecutionWithExtras)
          .questionType,
        questionDetails: (latestExecution as typeof latestExecution & ExecutionWithExtras)
          .questionDetails,
        claudeSessionId: (latestExecution as typeof latestExecution & ExecutionWithExtras)
          .claudeSessionId,
      };
    }

    // Multi-execution mode (for the recovery dashboard)
    const allLogs = executions.flatMap((execution, execIndex) => {
      return (execution.executionLogs || []).map((log, logIndex) => ({
        id: log.id,
        chunk: log.logChunk,
        type: log.logType,
        sequence: log.sequenceNumber,
        timestamp: log.timestamp,
        executionId: execution.id,
        executionIndex: execIndex,
        status: execution.status,
        output: execution.output,
        errorMessage: execution.errorMessage,
        question: (execution as typeof execution & ExecutionWithExtras).question,
        questionType: (execution as typeof execution & ExecutionWithExtras).questionType,
        questionDetails: (execution as typeof execution & ExecutionWithExtras).questionDetails,
        claudeSessionId: (execution as typeof execution & ExecutionWithExtras).claudeSessionId,
      }));
    });

    const lastSequence = allLogs.length > 0 ? allLogs[allLogs.length - 1].sequence : 0;

    return {
      sessionId: latestSession.id,
      status: executions[0]?.status || 'none',
      logs: allLogs,
      lastSequence,
      executionCount: executions.length,
    };
  });
