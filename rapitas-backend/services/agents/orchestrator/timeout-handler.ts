/**
 * TimeoutHandler
 *
 * Handles automatic continuation of agent executions when a question timeout fires.
 * Does NOT handle the core continuation flow or resume failure fallbacks.
 */
import { createLogger } from '../../../config/logger';
import type { OrchestratorContext } from './types';
import { executeContinuationInternal } from './continuation-executor';

const logger = createLogger('timeout-handler');

/**
 * Handles a fired question timeout by auto-generating a default response and resuming execution.
 * On success, marks the task and session as completed. On failure, reverts to 'todo' / 'failed'.
 *
 * @param ctx - Orchestrator context / オーケストレーターコンテキスト
 * @param executionId - ID of the execution that timed out / タイムアウトした実行ID
 * @param taskId - Associated task ID / 関連するタスクID
 * @param generateDefaultResponse - Factory for the auto-response string / 自動応答文字列のファクトリ
 */
export async function handleQuestionTimeout(
  ctx: OrchestratorContext,
  executionId: number,
  taskId: number,
  generateDefaultResponse: (
    questionKey?: unknown,
    questionText?: string,
    questionDetails?: string | null,
  ) => string,
): Promise<void> {
  try {
    if (!ctx.tryAcquireContinuationLock(executionId, 'auto_timeout')) {
      logger.info(
        `[TimeoutHandler] Skipping timeout handling for execution ${executionId} - already being processed`,
      );
      return;
    }

    try {
      const execution = await ctx.prisma.agentExecution.findUnique({
        where: { id: executionId },
        include: { session: true },
      });

      if (!execution) {
        logger.info(`[TimeoutHandler] Execution ${executionId} not found for timeout handling`);
        return;
      }

      if (execution.status !== 'waiting_for_input') {
        logger.info(
          `[TimeoutHandler] Execution ${executionId} is no longer waiting for input (status: ${execution.status})`,
        );
        return;
      }

      await ctx.prisma.agentExecution.update({
        where: { id: executionId },
        data: { status: 'running' },
      });

      logger.info(`[TimeoutHandler] Auto-continuing execution ${executionId} after timeout`);

      const defaultResponse = generateDefaultResponse(
        undefined,
        execution.question ?? undefined,
        execution.questionDetails ?? undefined,
      );

      ctx.emitEvent({
        type: 'execution_output',
        executionId,
        sessionId: execution.sessionId,
        taskId,
        data: {
          questionTimeoutTriggered: true,
          autoResponse: defaultResponse,
          message: 'タイムアウトにより自動的に継続します',
        },
        timestamp: new Date(),
      });

      const result = await executeContinuationInternal(ctx, executionId, defaultResponse, {
        timeout: 900000,
      });

      if (result.success && !result.waitingForInput) {
        try {
          await ctx.prisma.task.update({
            where: { id: taskId },
            data: { status: 'done', completedAt: new Date() },
          });
          logger.info(
            `[TimeoutHandler] Task ${taskId} updated to 'done' after timeout auto-continue`,
          );

          await ctx.prisma.agentSession.update({
            where: { id: execution.sessionId },
            data: { status: 'completed', completedAt: new Date() },
          });
        } catch (updateError) {
          logger.error(
            { err: updateError },
            `[TimeoutHandler] Failed to update task/session status after timeout`,
          );
        }
      } else if (!result.success && !result.waitingForInput) {
        try {
          await ctx.prisma.task.update({
            where: { id: taskId },
            data: { status: 'todo' },
          });

          await ctx.prisma.agentSession.update({
            where: { id: execution.sessionId },
            data: {
              status: 'failed',
              completedAt: new Date(),
              errorMessage: result.errorMessage || 'Execution failed after timeout auto-continue',
            },
          });
        } catch (updateError) {
          logger.error(
            { err: updateError },
            `[TimeoutHandler] Failed to update task/session status after timeout failure`,
          );
        }
      }
    } catch (error) {
      await ctx.prisma.agentExecution
        .update({
          where: { id: executionId },
          data: { status: 'waiting_for_input' },
        })
        .catch((updateErr) => {
          logger.warn(
            { err: updateErr, executionId },
            'Failed to update execution status to waiting_for_input on error',
          );
        });
      throw error;
    } finally {
      ctx.releaseContinuationLock(executionId);
    }
  } catch (error) {
    logger.error(
      { err: error, executionId },
      `[TimeoutHandler] Error handling question timeout for execution`,
    );
  }
}
