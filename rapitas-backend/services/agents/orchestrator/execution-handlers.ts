/**
 * Execution Handlers
 *
 * Question detection and output handler setup for agent execution.
 */
import type { BaseAgent } from '../base-agent';
import { DEFAULT_QUESTION_TIMEOUT_SECONDS } from '../question-detection';
import type { QuestionHandlerContext, OutputHandlerContext } from './execution-helpers-types';
import { toJsonString } from './execution-helpers-types';
import type { LogChunkManager } from './log-chunk-manager';
import { extractIdeaMarkers } from './idea-extractor';
import { createLogger } from '../../../config/logger';

const logger = createLogger('execution-handlers');

/**
 * Set up the question detection handler on an agent.
 */
export function setupQuestionDetectedHandler(agent: BaseAgent, ctx: QuestionHandlerContext): void {
  agent.setQuestionDetectedHandler(async (info) => {
    logger.info(`[ExecutionHandlers] Question detected during streaming!`);
    logger.info(`[ExecutionHandlers] Question: ${info.question.substring(0, 100)}`);
    logger.info(`[ExecutionHandlers] Question type: ${info.questionType}`);
    logger.info(`[ExecutionHandlers] Claude Session ID: ${info.claudeSessionId || '(なし)'}`);
    ctx.fileLogger.logQuestionDetected(info.question, info.questionType, info.claudeSessionId);

    try {
      await ctx.prisma.agentExecution.update({
        where: { id: ctx.executionId },
        data: {
          status: 'waiting_for_input',
          question: info.question || null,
          questionType: info.questionType || null,
          questionDetails: toJsonString(info.questionDetails),
          claudeSessionId: info.claudeSessionId || ctx.existingClaudeSessionId || null,
        },
      });
      logger.info(
        `[ExecutionHandlers] DB updated to waiting_for_input for execution ${ctx.executionId}`,
      );

      ctx.state.status = 'waiting_for_input';

      ctx.startQuestionTimeout(ctx.executionId, ctx.taskId, info.questionKey);

      const timeoutInfo = ctx.getQuestionTimeoutInfo(ctx.executionId);

      ctx.emitEvent({
        type: 'execution_output',
        executionId: ctx.executionId,
        sessionId: ctx.sessionId,
        taskId: ctx.taskId,
        data: {
          output: `\n[質問] ${info.question}\n`,
          waitingForInput: true,
          question: info.question,
          questionType: info.questionType,
          questionDetails: info.questionDetails,
          questionKey: info.questionKey,
          questionTimeoutSeconds: timeoutInfo?.remainingSeconds || DEFAULT_QUESTION_TIMEOUT_SECONDS,
          questionTimeoutDeadline: timeoutInfo?.deadline?.toISOString(),
        },
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error({ err: error }, `[ExecutionHandlers] Failed to update DB on question detection`);
    }
  });
}

/**
 * Set up the output handler on an agent.
 */
export function setupOutputHandler(
  agent: BaseAgent,
  ctx: OutputHandlerContext,
  logManager: LogChunkManager,
): void {
  let lastDbUpdate = Date.now();
  const DB_UPDATE_INTERVAL = 200;
  let pendingDbUpdate = false;

  agent.setOutputHandler(async (output, isError) => {
    try {
      ctx.state.output += output;

      ctx.fileLogger.logOutput(output, isError ?? false);

      ctx.agentInfo.lastOutput = ctx.state.output.slice(-2000);
      ctx.agentInfo.lastSavedAt = new Date();

      logManager.addChunk(output, isError ?? false);

      // NOTE: Error output is saved to DB immediately for visibility
      if (isError && output.trim()) {
        try {
          await ctx.prisma.agentExecution.update({
            where: { id: ctx.executionId },
            data: {
              output: ctx.state.output,
              errorMessage: output.slice(-500),
            },
          });
          lastDbUpdate = Date.now();
        } catch (e) {
          logger.error({ err: e }, 'Failed to save error output immediately');
        }
      }

      if (ctx.onOutput) {
        try {
          ctx.onOutput(output, isError);
        } catch (e) {
          logger.error({ err: e }, 'Error in onOutput callback');
        }
      }

      try {
        ctx.emitEvent({
          type: 'execution_output',
          executionId: ctx.executionId,
          sessionId: ctx.sessionId,
          taskId: ctx.taskId,
          data: { output, isError },
          timestamp: new Date(),
        });
      } catch (e) {
        logger.error({ err: e }, 'Error emitting event');
      }

      // Detect [IDEA] markers in agent output and submit to IdeaBox in real-time.
      if (!isError && output.includes('[IDEA]')) {
        extractIdeaMarkers(output, ctx.taskId);
      }

      const now = Date.now();
      if (now - lastDbUpdate > DB_UPDATE_INTERVAL && !pendingDbUpdate) {
        pendingDbUpdate = true;
        lastDbUpdate = now;
        try {
          await ctx.prisma.agentExecution.update({
            where: { id: ctx.executionId },
            data: { output: ctx.state.output },
          });
        } catch (e) {
          logger.error({ err: e }, 'Failed to update execution output');
        } finally {
          pendingDbUpdate = false;
        }
      }
    } catch (e) {
      logger.error({ err: e }, 'Critical error in output handler');
    }
  });
}
