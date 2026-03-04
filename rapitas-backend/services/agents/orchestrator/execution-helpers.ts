/**
 * 実行ヘルパー
 * executeTask, executeContinuationInternal, resumeInterruptedExecution で
 * 重複していた出力ハンドラ・質問検出ハンドラ・ログ管理を共通化
 */
import type { BaseAgent } from "../base-agent";
import type { QuestionKey } from "../question-detection";
import { DEFAULT_QUESTION_TIMEOUT_SECONDS } from "../question-detection";
import type { ExecutionFileLogger } from "../execution-file-logger";
import type {
  ExecutionState,
  OrchestratorEvent,
  ActiveAgentInfo,
  PrismaClientInstance,
} from "./types";
export type { ActiveAgentInfo } from "./types";
import { createLogger } from "../../../config/logger";

const logger = createLogger("execution-helpers");

// JSONフィールドを文字列に変換するヘルパー関数
export function toJsonString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * 質問検出ハンドラの設定に必要なコンテキスト
 */
export type QuestionHandlerContext = {
  prisma: PrismaClientInstance;
  executionId: number;
  sessionId: number;
  taskId: number;
  state: ExecutionState;
  fileLogger: ExecutionFileLogger;
  existingClaudeSessionId?: string | null;
  emitEvent: (event: OrchestratorEvent) => void;
  startQuestionTimeout: (executionId: number, taskId: number, questionKey?: QuestionKey) => void;
  getQuestionTimeoutInfo: (executionId: number) => { remainingSeconds: number; deadline: Date; questionKey?: QuestionKey } | null;
};

/**
 * 出力ハンドラの設定に必要なコンテキスト
 */
export type OutputHandlerContext = {
  prisma: PrismaClientInstance;
  executionId: number;
  sessionId: number;
  taskId: number;
  state: ExecutionState;
  agentInfo: ActiveAgentInfo;
  fileLogger: ExecutionFileLogger;
  onOutput?: (output: string, isError?: boolean) => void;
  emitEvent: (event: OrchestratorEvent) => void;
};

/**
 * ログ管理のコンテキスト
 */
export type LogManagerContext = {
  prisma: PrismaClientInstance;
  executionId: number;
  initialSequenceNumber: number;
};

/**
 * ログチャンク管理を作成
 */
export function createLogChunkManager(ctx: LogManagerContext) {
  let logSequenceNumber = ctx.initialSequenceNumber;
  let pendingLogChunks: { chunk: string; isError: boolean; timestamp: Date }[] = [];
  let pendingLogSave = false;
  const LOG_BATCH_INTERVAL = 500;

  const flushLogChunks = async () => {
    if (pendingLogSave || pendingLogChunks.length === 0) return;
    pendingLogSave = true;
    const chunksToSave = [...pendingLogChunks];
    pendingLogChunks = [];

    try {
      const logEntries = chunksToSave.map((chunk) => ({
        executionId: ctx.executionId,
        logChunk: chunk.chunk,
        logType: chunk.isError ? "stderr" : "stdout",
        sequenceNumber: logSequenceNumber++,
        timestamp: chunk.timestamp,
      }));

      await ctx.prisma.agentExecutionLog.createMany({
        data: logEntries,
      });
    } catch (e) {
      logger.error({ err: e }, "Failed to save log chunks");
      pendingLogChunks = [...chunksToSave, ...pendingLogChunks];
    } finally {
      pendingLogSave = false;
    }
  };

  const logFlushInterval = setInterval(flushLogChunks, LOG_BATCH_INTERVAL);

  const addChunk = (chunk: string, isError: boolean) => {
    pendingLogChunks.push({ chunk, isError, timestamp: new Date() });
  };

  const cleanup = async () => {
    clearInterval(logFlushInterval);
    await flushLogChunks();
  };

  return { addChunk, cleanup, flushLogChunks };
}

/**
 * 質問検出ハンドラを設定
 */
export function setupQuestionDetectedHandler(
  agent: BaseAgent,
  ctx: QuestionHandlerContext,
): void {
  agent.setQuestionDetectedHandler(async (info) => {
    logger.info(`[ExecutionHelpers] Question detected during streaming!`);
    logger.info(`[ExecutionHelpers] Question: ${info.question.substring(0, 100)}`);
    logger.info(`[ExecutionHelpers] Question type: ${info.questionType}`);
    logger.info(`[ExecutionHelpers] Claude Session ID: ${info.claudeSessionId || "(なし)"}`);
    ctx.fileLogger.logQuestionDetected(
      info.question,
      info.questionType,
      info.claudeSessionId,
    );

    try {
      await ctx.prisma.agentExecution.update({
        where: { id: ctx.executionId },
        data: {
          status: "waiting_for_input",
          question: info.question || null,
          questionType: info.questionType || null,
          questionDetails: toJsonString(info.questionDetails),
          claudeSessionId: info.claudeSessionId || ctx.existingClaudeSessionId || null,
        },
      });
      logger.info(
        `[ExecutionHelpers] DB updated to waiting_for_input for execution ${ctx.executionId}`,
      );

      ctx.state.status = "waiting_for_input";

      ctx.startQuestionTimeout(ctx.executionId, ctx.taskId, info.questionKey);

      const timeoutInfo = ctx.getQuestionTimeoutInfo(ctx.executionId);

      ctx.emitEvent({
        type: "execution_output",
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
          questionTimeoutSeconds:
            timeoutInfo?.remainingSeconds || DEFAULT_QUESTION_TIMEOUT_SECONDS,
          questionTimeoutDeadline: timeoutInfo?.deadline?.toISOString(),
        },
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error(
        { err: error },
        `[ExecutionHelpers] Failed to update DB on question detection`,
      );
    }
  });
}

/**
 * 出力ハンドラを設定
 */
export function setupOutputHandler(
  agent: BaseAgent,
  ctx: OutputHandlerContext,
  logManager: ReturnType<typeof createLogChunkManager>,
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

      // エラー出力は即座にDBに保存
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
          logger.error({ err: e }, "Failed to save error output immediately");
        }
      }

      if (ctx.onOutput) {
        try {
          ctx.onOutput(output, isError);
        } catch (e) {
          logger.error({ err: e }, "Error in onOutput callback");
        }
      }

      try {
        ctx.emitEvent({
          type: "execution_output",
          executionId: ctx.executionId,
          sessionId: ctx.sessionId,
          taskId: ctx.taskId,
          data: { output, isError },
          timestamp: new Date(),
        });
      } catch (e) {
        logger.error({ err: e }, "Error emitting event");
      }

      // 定期的にDBを更新
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
          logger.error({ err: e }, "Failed to update execution output");
        } finally {
          pendingDbUpdate = false;
        }
      }
    } catch (e) {
      logger.error({ err: e }, "Critical error in output handler");
    }
  });
}

/**
 * 実行結果のステータス判定とログ記録
 */
export function determineExecutionStatus(
  result: { success: boolean; waitingForInput?: boolean; tokensUsed?: number; executionTimeMs?: number; errorMessage?: string },
  fileLogger: ExecutionFileLogger,
  state: ExecutionState,
): string {
  if (result.waitingForInput) {
    state.status = "waiting_for_input";
    fileLogger.logStatusChange("running", "waiting_for_input", "Question detected");
    return "waiting_for_input";
  } else if (result.success) {
    state.status = "completed";
    fileLogger.logExecutionEnd("completed", {
      success: true,
      tokensUsed: result.tokensUsed,
      executionTimeMs: result.executionTimeMs,
    });
    return "completed";
  } else {
    state.status = "failed";
    fileLogger.logExecutionEnd("failed", {
      success: false,
      tokensUsed: result.tokensUsed,
      executionTimeMs: result.executionTimeMs,
      errorMessage: result.errorMessage,
    });
    return "failed";
  }
}

/**
 * 実行結果をDBに保存（共通処理）
 */
export async function saveExecutionResult(
  prisma: PrismaClientInstance,
  executionId: number,
  sessionId: number,
  state: ExecutionState,
  result: {
    success: boolean;
    waitingForInput?: boolean;
    output?: string;
    artifacts?: unknown;
    tokensUsed?: number;
    executionTimeMs?: number;
    errorMessage?: string;
    question?: string;
    questionType?: string;
    questionDetails?: unknown;
    claudeSessionId?: string;
    questionKey?: QuestionKey;
    commits?: Array<{
      hash: string;
      message: string;
      branch?: string;
      filesChanged?: number;
      additions?: number;
      deletions?: number;
    }>;
  },
  fileLogger: ExecutionFileLogger,
  existingData?: {
    artifacts?: string | null;
    tokensUsed?: number | null;
    executionTimeMs?: number | null;
    claudeSessionId?: string | null;
  },
): Promise<void> {
  const executionStatus = determineExecutionStatus(result, fileLogger, state);

  await prisma.agentExecution.update({
    where: { id: executionId },
    data: {
      status: executionStatus,
      output: state.output || result.output,
      artifacts: result.artifacts
        ? toJsonString(result.artifacts)
        : existingData?.artifacts || null,
      completedAt: result.waitingForInput ? null : new Date(),
      tokensUsed: (existingData?.tokensUsed || 0) + (result.tokensUsed || 0),
      executionTimeMs:
        (existingData?.executionTimeMs || 0) + (result.executionTimeMs || 0),
      errorMessage: result.errorMessage,
      question: result.question || null,
      questionType: result.questionType || null,
      questionDetails: toJsonString(result.questionDetails),
      claudeSessionId:
        result.claudeSessionId || existingData?.claudeSessionId || null,
    },
  });

  // セッションのトークン使用量を更新
  if (result.tokensUsed) {
    await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        totalTokensUsed: {
          increment: result.tokensUsed,
        },
        lastActivityAt: new Date(),
      },
    });
  }

  // Gitコミットを記録
  if (result.commits && result.commits.length > 0) {
    for (const commit of result.commits) {
      fileLogger.logGitCommit({
        hash: commit.hash,
        message: commit.message,
        branch: commit.branch,
        filesChanged: commit.filesChanged,
        additions: commit.additions,
        deletions: commit.deletions,
      });
      await prisma.gitCommit.create({
        data: {
          executionId,
          commitHash: commit.hash,
          message: commit.message,
          branch: commit.branch,
          filesChanged: commit.filesChanged,
          additions: commit.additions,
          deletions: commit.deletions,
        },
      });
    }
  }
}

/**
 * 実行結果に応じたイベントを発火
 */
export function emitResultEvent(
  result: {
    success: boolean;
    waitingForInput?: boolean;
    output?: string;
    question?: string;
    questionType?: string;
    questionDetails?: unknown;
    questionKey?: QuestionKey;
  },
  executionId: number,
  sessionId: number,
  taskId: number,
  emitEvent: (event: OrchestratorEvent) => void,
): void {
  if (result.waitingForInput) {
    emitEvent({
      type: "execution_output",
      executionId,
      sessionId,
      taskId,
      data: {
        output: result.output,
        waitingForInput: true,
        question: result.question,
        questionType: result.questionType,
        questionDetails: result.questionDetails,
        questionKey: result.questionKey,
      },
      timestamp: new Date(),
    });
  } else {
    emitEvent({
      type: result.success ? "execution_completed" : "execution_failed",
      executionId,
      sessionId,
      taskId,
      data: result,
      timestamp: new Date(),
    });
  }
}

/**
 * 実行エラー時の共通処理
 */
export async function handleExecutionError(
  prisma: PrismaClientInstance,
  executionId: number,
  sessionId: number,
  taskId: number,
  state: ExecutionState,
  error: unknown,
  fileLogger: ExecutionFileLogger,
  emitEvent: (event: OrchestratorEvent) => void,
  errorContext: string,
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  state.status = "failed";

  fileLogger.logError(
    `${errorContext} failed with uncaught error`,
    error instanceof Error ? error : new Error(errorMessage),
  );
  fileLogger.logExecutionEnd("failed", {
    success: false,
    errorMessage,
  });

  await prisma.agentExecution.update({
    where: { id: executionId },
    data: {
      status: "failed",
      output: state.output,
      completedAt: new Date(),
      errorMessage,
    },
  });

  emitEvent({
    type: "execution_failed",
    executionId,
    sessionId,
    taskId,
    data: { errorMessage },
    timestamp: new Date(),
  });
}
