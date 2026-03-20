/**
 * Execution Core
 *
 * Primary execution lifecycle: starting, stopping, and ending sessions.
 * Shared helpers live in execution-helpers.ts.
 * Continuation logic lives in execution-continue.ts.
 * Read-only queries live in execution-queries.ts.
 */
import { PrismaClient } from '@prisma/client';
import { orchestrator } from '../core/orchestrator-instance';
import type { ExecutionRequest, ExecutionResult } from '../../types/agent-execution-types';
import { createLogger } from '../../config/logger';
import {
  gatherSharedKnowledge,
  formatKnowledgeContext,
} from '../agents/agent-knowledge-sharing';
import {
  getOrCreateSession,
  getAgentConfig,
  checkExecutionPreconditions,
  createExecution,
  buildExecutionInstruction,
} from './execution-helpers';

const log = createLogger('agent-execution-service');

/**
 * Starts task execution with an agent.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param taskId - Task to execute / 実行対象タスクID
 * @param request - Execution parameters / 実行パラメータ
 * @returns Execution result with IDs / 実行結果（IDを含む）
 * @throws {Error} When task not found or preconditions fail
 */
export async function executeTask(
  prisma: PrismaClient,
  taskId: number,
  request: ExecutionRequest,
): Promise<ExecutionResult> {
  const { agentConfigId, useTaskAnalysis = true, optimizedPrompt, sessionId } = request;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { theme: true },
  });

  if (!task) {
    throw new Error('タスクが見つかりません');
  }

  const session = await getOrCreateSession(prisma, sessionId, agentConfigId);
  await checkExecutionPreconditions(prisma, session.id);
  const agentConfig = await getAgentConfig(prisma, agentConfigId || session.configId);
  const execution = await createExecution(prisma, session.id, agentConfig.id);

  try {
    let executionInstruction = buildExecutionInstruction(task, optimizedPrompt, useTaskAnalysis);

    // Inject additional instructions from AgentExecutionConfig if available
    try {
      const executionConfig = await prisma.agentExecutionConfig.findUnique({
        where: { taskId },
      });

      if (executionConfig?.additionalInstructions) {
        executionInstruction = `${executionConfig.additionalInstructions}\n\n${executionInstruction}`;
        log.info(
          { taskId, additionalInstructionsLength: executionConfig.additionalInstructions.length },
          'Additional instructions injected',
        );
      }
    } catch (configErr) {
      log.warn(
        { err: configErr, taskId },
        'Failed to load execution config, proceeding without additional instructions',
      );
    }

    // Inject shared knowledge context from previous executions
    try {
      const sharedKnowledge = await gatherSharedKnowledge(taskId);
      const contextText = formatKnowledgeContext(sharedKnowledge);
      if (contextText) {
        executionInstruction = `${executionInstruction}\n${contextText}`;
        log.info(
          {
            taskId,
            patterns: sharedKnowledge.patterns.length,
            warnings: sharedKnowledge.warnings.length,
          },
          'Shared knowledge context injected',
        );
      }
    } catch (knowledgeErr) {
      log.warn(
        { err: knowledgeErr, taskId },
        'Failed to inject shared knowledge, proceeding without',
      );
    }

    orchestrator.executeTask(
      {
        id: taskId,
        title: task.title,
        description: executionInstruction,
        context: task.executionInstructions || undefined,
      },
      {
        taskId,
        sessionId: session.id,
        agentConfigId: agentConfig.id,
      },
    );

    return {
      success: true,
      executionId: execution.id,
      sessionId: session.id,
      message: 'エージェントが実行を開始しました',
    };
  } catch (error) {
    await prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: 'error',
        errorMessage: error instanceof Error ? error.message : '実行開始エラー',
      },
    });

    throw error;
  }
}

/**
 * Stops a running execution by ID.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param executionId - Execution to stop / 停止対象の実行ID
 * @returns Whether the orchestrator confirmed a stop / オーケストレーターが停止を確認したか
 */
export async function stopExecution(prisma: PrismaClient, executionId: number): Promise<boolean> {
  try {
    const stopped = await orchestrator.stopExecution(executionId).catch(() => false);

    await prisma.agentExecution.update({
      where: { id: executionId },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });

    return stopped;
  } catch (error) {
    log.error({ err: error }, 'Failed to stop execution');
    return false;
  }
}

/**
 * Stops all executions in a session and marks the session as completed.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param sessionId - Session to terminate / 終了するセッションID
 */
export async function stopSession(prisma: PrismaClient, sessionId: number): Promise<void> {
  try {
    const { AgentWorkerManager } = await import('../agents/agent-worker-manager');
    const executions =
      await AgentWorkerManager.getInstance().getSessionExecutionsAsync(sessionId);
    for (const execution of executions) {
      await orchestrator.stopExecution(execution.executionId).catch((err) => {
        log.warn(
          { err, executionId: execution.executionId },
          'Failed to stop execution during session stop',
        );
      });
    }
  } catch (err) {
    log.warn(
      { err },
      'Failed to get session executions from worker, falling back to DB-only stop',
    );
  }

  await prisma.agentExecution.updateMany({
    where: {
      sessionId,
      status: { in: ['running', 'pending', 'waiting_for_input'] },
    },
    data: {
      status: 'cancelled',
      completedAt: new Date(),
    },
  });

  await prisma.agentSession.update({
    where: { id: sessionId },
    data: {
      completedAt: new Date(),
      status: 'completed',
    },
  });
}
