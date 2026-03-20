/**
 * ParallelExecution — EventHandlers
 *
 * Sets up internal event handler wiring for the ParallelExecutor:
 * agent output persistence to DB, task completion/failure routing,
 * and coordinator message logging.
 * Not responsible for session lifecycle or batch scheduling.
 */

import { PrismaClient } from '@prisma/client';
type PrismaClientInstance = InstanceType<typeof PrismaClient>;

import { SubAgentController } from './sub-agent-controller';
import { LogAggregator } from './log-aggregator';
import { AgentCoordinator } from './agent-coordinator';
import type { ParallelExecutionSession } from './types';
import type { ParallelExecutionEvent } from './executor-types';
import { formatCoordinatorPayload } from './executor-types';
import { handleTaskCompletion, handleTaskFailure, type TaskRunnerContext } from './task-runner';
import { createLogger } from '../../config/logger';

const logger = createLogger('parallel-executor:event-handlers');

/** Context provided by ParallelExecutor for event handler setup. */
export interface EventHandlerContext {
  prisma: PrismaClientInstance;
  agentController: SubAgentController;
  logAggregator: LogAggregator;
  coordinator: AgentCoordinator;
  logSequenceNumbers: Map<number, number>;
  sessions: Map<string, ParallelExecutionSession>;
  emitEvent: (event: ParallelExecutionEvent) => void;
  buildRunnerContext: () => TaskRunnerContext;
}

/**
 * Wire up internal event handlers for agent output and task lifecycle events.
 *
 * @param ctx - Event handler context / イベントハンドラコンテキスト
 */
export function setupEventHandlers(ctx: EventHandlerContext): void {
  // Persist agent output to DB and forward as progress_updated events
  ctx.agentController.on('agent_output', async (data) => {
    ctx.logAggregator.addLog({
      timestamp: data.timestamp,
      agentId: data.agentId,
      taskId: data.taskId,
      level: data.isError ? 'error' : 'info',
      message: data.chunk,
    });

    try {
      const sequenceNumber = ctx.logSequenceNumbers.get(data.executionId) || 0;
      ctx.logSequenceNumbers.set(data.executionId, sequenceNumber + 1);

      await ctx.prisma.agentExecutionLog.create({
        data: {
          executionId: data.executionId,
          logChunk: data.chunk,
          logType: data.isError ? 'stderr' : 'stdout',
          sequenceNumber,
          timestamp: data.timestamp,
        },
      });
    } catch (error) {
      logger.error({ err: error }, '[ParallelExecutor] Failed to save execution log');
    }

    ctx.emitEvent({
      type: 'progress_updated',
      sessionId: '',
      taskId: data.taskId,
      timestamp: data.timestamp,
      data: { output: data.chunk, isError: data.isError, executionId: data.executionId },
    });
  });

  ctx.agentController.on('task_completed', (data) => {
    const session = findSessionByTaskId(ctx.sessions, data.taskId);
    if (session) {
      handleTaskCompletion(ctx.buildRunnerContext(), session.sessionId, data.taskId, data.result);
    }
  });

  ctx.agentController.on('task_failed', (data) => {
    const session = findSessionByTaskId(ctx.sessions, data.taskId);
    if (session) {
      handleTaskFailure(
        ctx.buildRunnerContext(),
        session.sessionId,
        data.taskId,
        data.error || data.result?.errorMessage,
      );
    }
  });

  ctx.coordinator.on('message', (message) => {
    ctx.logAggregator.addLog({
      timestamp: message.timestamp,
      agentId: message.fromAgentId,
      taskId: 0,
      level: 'debug',
      message: `[${message.type}] ${formatCoordinatorPayload(message.payload)}`,
    });
  });
}

/**
 * Find the session containing the given task ID.
 *
 * @param sessions - Map of all sessions / 全セッションマップ
 * @param taskId - Task ID to locate / 検索するタスクID
 * @returns Matching session or undefined
 */
function findSessionByTaskId(
  sessions: Map<string, ParallelExecutionSession>,
  taskId: number,
): ParallelExecutionSession | undefined {
  for (const session of sessions.values()) {
    const allTaskIds = session.plan.groups.flatMap((g) => g.taskIds);
    if (allTaskIds.includes(taskId)) return session;
  }
  return undefined;
}
