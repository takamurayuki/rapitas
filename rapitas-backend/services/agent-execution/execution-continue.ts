/**
 * Execution Continuation
 *
 * Handles resuming a previous task execution with optional additional context.
 * Shared helpers live in execution-helpers.ts.
 * Core start/stop operations live in execution-core.ts.
 */
import { PrismaClient } from '@prisma/client';
import { orchestrator } from '../core/orchestrator-instance';
import type { ExecutionResult } from '../../types/agent-execution-types';
import { createLogger } from '../../config/logger';

const log = createLogger('agent-execution-service');

/**
 * Continues or resumes a previous execution with optional additional instructions.
 * Stops any currently active execution in the same session before resuming.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param taskId - Task to continue / 継続するタスクID
 * @param options - Continuation options including extra instructions or specific session / 継続オプション
 * @returns Execution result for the new continuation entry / 新規継続実行の結果
 * @throws {Error} When task or a resumable previous execution is not found
 */
export async function continueExecution(
  prisma: PrismaClient,
  taskId: number,
  options?: {
    additionalInstructions?: string;
    sessionId?: number;
  },
): Promise<ExecutionResult> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { theme: true },
  });

  if (!task) {
    throw new Error('タスクが見つかりません');
  }

  const previousExecution = await prisma.agentExecution.findFirst({
    where: {
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
      session: {
        config: {
          taskId: taskId,
        },
      },
    },
    orderBy: { startedAt: 'desc' },
    include: { agentConfig: true },
  });

  if (!previousExecution) {
    throw new Error('継続可能な実行が見つかりません');
  }

  // Stop the previous execution if still active before creating a continuation
  if (['running', 'pending', 'waiting_for_input'].includes(previousExecution.status)) {
    await orchestrator.stopExecution(previousExecution.id).catch((err) => {
      log.warn(
        { err, executionId: previousExecution.id },
        'Failed to stop previous execution before resume',
      );
    });
  }

  const newExecution = await prisma.agentExecution.create({
    data: {
      sessionId: previousExecution.sessionId,
      agentConfigId: previousExecution.agentConfigId,
      command: 'continue_task',
      status: 'pending',
      startedAt: new Date(),
    },
  });

  let fullInstruction = task.description || '';

  if (options?.additionalInstructions) {
    fullInstruction = `${options.additionalInstructions}\n\n${fullInstruction}`;
  }

  // Prepend previous output as context, truncated to avoid excessive prompt length
  if (previousExecution.output) {
    const prevOutput = previousExecution.output.slice(0, 3000);
    fullInstruction = `## 前回の実行内容\n\n前回の実行で以下の作業を行いました：\n\n${prevOutput}${previousExecution.output.length > 3000 ? '\n...(省略)' : ''}\n\n${fullInstruction}`;
  }

  try {
    orchestrator.executeTask(
      {
        id: taskId,
        title: task.title,
        description: fullInstruction,
        context: task.executionInstructions || undefined,
      },
      {
        taskId,
        sessionId: previousExecution.sessionId,
      },
    );

    return {
      success: true,
      executionId: newExecution.id,
      sessionId: previousExecution.sessionId,
      message: 'エージェントが継続実行を開始しました',
    };
  } catch (error) {
    await prisma.agentExecution.update({
      where: { id: newExecution.id },
      data: {
        status: 'error',
        errorMessage: error instanceof Error ? error.message : '継続実行エラー',
      },
    });

    throw error;
  }
}
