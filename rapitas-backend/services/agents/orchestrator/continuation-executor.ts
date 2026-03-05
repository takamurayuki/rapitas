/**
 * 継続実行
 * 質問への回答後の継続実行、タイムアウトハンドリングを担当
 */
import { agentFactory } from "../agent-factory";
import type { AgentConfigInput, AgentType } from "../agent-factory";
import type { AgentTask, AgentExecutionResult } from "../base-agent";
import { DEFAULT_QUESTION_TIMEOUT_SECONDS } from "../question-detection";
import { decrypt } from "../../../utils/encryption";
import { ExecutionFileLogger } from "../execution-file-logger";
import { createLogger } from "../../../config/logger";
import type {
  ExecutionOptions,
  ExecutionState,
  ActiveAgentInfo,
  OrchestratorContext,
} from "./types";
import {
  toJsonString,
  createLogChunkManager,
  setupQuestionDetectedHandler,
  setupOutputHandler,
  saveExecutionResult,
  emitResultEvent,
  handleExecutionError,
} from "./execution-helpers";

const logger = createLogger("continuation-executor");

/**
 * フォールバックエージェントにハンドラを設定する共通関数
 */
function setupFallbackAgentHandlers(
  agent: ReturnType<typeof agentFactory.createAgent>,
  ctx: OrchestratorContext,
  executionId: number,
  sessionId: number,
  taskId: number,
  state: ExecutionState,
  agentInfo: ActiveAgentInfo,
  fileLogger: ExecutionFileLogger,
  logManager: ReturnType<typeof createLogChunkManager>,
  existingClaudeSessionId: string | null,
  logPrefix: string,
): void {
  agent.setQuestionDetectedHandler(async (info) => {
    logger.info(`[ContinuationExecutor] Question detected during ${logPrefix}!`);
    fileLogger.logQuestionDetected(
      info.question,
      info.questionType,
      info.claudeSessionId,
    );
    try {
      await ctx.prisma.agentExecution.update({
        where: { id: executionId },
        data: {
          status: "waiting_for_input",
          question: info.question || null,
          questionType: info.questionType || null,
          questionDetails: toJsonString(info.questionDetails),
          claudeSessionId:
            info.claudeSessionId || existingClaudeSessionId || null,
        },
      });
      state.status = "waiting_for_input";
      ctx.startQuestionTimeout(executionId, taskId, info.questionKey);
      const timeoutInfo = ctx.getQuestionTimeoutInfo(executionId);
      ctx.emitEvent({
        type: "execution_output",
        executionId,
        sessionId,
        taskId,
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
        `[ContinuationExecutor] Failed to update DB on question detection (${logPrefix})`,
      );
    }
  });

  agent.setOutputHandler(async (output, isError) => {
    state.output += output;
    fileLogger.logOutput(output, isError ?? false);
    agentInfo.lastOutput = state.output.slice(-2000);
    agentInfo.lastSavedAt = new Date();
    logManager.addChunk(output, isError ?? false);
    try {
      ctx.emitEvent({
        type: "execution_output",
        executionId,
        sessionId,
        taskId,
        data: { output, isError },
        timestamp: new Date(),
      });
    } catch (e) {
      logger.error({ err: e }, `Error emitting ${logPrefix} event`);
    }
  });
}

/**
 * セッション再開失敗かどうかを判定
 */
function isSessionResumeFailure(
  result: AgentExecutionResult,
  claudeSessionId: string | null,
): boolean {
  return (
    !result.success &&
    !result.waitingForInput &&
    !!claudeSessionId &&
    ((result.executionTimeMs !== undefined && result.executionTimeMs < 10000) ||
      (!!result.errorMessage &&
        /session|expired|invalid|not found|code 1/i.test(result.errorMessage)))
  );
}

/**
 * 会話を継続（質問への回答）- 外部API用
 */
export async function executeContinuation(
  ctx: OrchestratorContext,
  executionId: number,
  response: string,
  options: Partial<ExecutionOptions> = {},
): Promise<AgentExecutionResult> {
  if (!ctx.tryAcquireContinuationLock(executionId, "user_response")) {
    logger.info(
      `[ContinuationExecutor] Skipping continuation for execution ${executionId} - already being processed`,
    );
    return {
      success: false,
      output: "",
      errorMessage: "This execution is already being processed",
    };
  }

  try {
    const execution = await ctx.prisma.agentExecution.findUnique({
      where: { id: executionId },
      include: {
        session: {
          include: {
            config: {
              include: {
                task: true,
              },
            },
          },
        },
      },
    });

    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (execution.status === "running") {
      logger.info(
        `[ContinuationExecutor] Execution ${executionId} is already running, skipping`,
      );
      return {
        success: false,
        output: "",
        errorMessage: "Execution is already running",
      };
    }

    if (execution.status !== "waiting_for_input") {
      logger.info(
        `[ContinuationExecutor] Execution ${executionId} is not waiting for input (status: ${execution.status})`,
      );
      return {
        success: false,
        output: "",
        errorMessage: `Execution is not waiting for input: ${execution.status}`,
      };
    }

    ctx.cancelQuestionTimeout(executionId);

    return await executeContinuationInternal(ctx, executionId, response, options);
  } catch (error) {
    throw error;
  } finally {
    ctx.releaseContinuationLock(executionId);
  }
}

/**
 * 会話を継続（質問への回答）- ロック取得済みの場合用
 */
export async function executeContinuationWithLock(
  ctx: OrchestratorContext,
  executionId: number,
  response: string,
  options: Partial<ExecutionOptions> = {},
): Promise<AgentExecutionResult> {
  try {
    return await executeContinuationInternal(ctx, executionId, response, options);
  } finally {
    ctx.releaseContinuationLock(executionId);
  }
}

/**
 * 会話を継続（質問への回答）- 内部用
 */
export async function executeContinuationInternal(
  ctx: OrchestratorContext,
  executionId: number,
  response: string,
  options: Partial<ExecutionOptions> = {},
): Promise<AgentExecutionResult> {
  const execution = await ctx.prisma.agentExecution.findUnique({
    where: { id: executionId },
    include: {
      session: {
        include: {
          config: {
            include: {
              task: true,
            },
          },
        },
      },
    },
  });

  if (!execution) {
    throw new Error(`Execution not found: ${executionId}`);
  }

  const task = execution.session.config?.task;
  const claudeSessionId = execution.claudeSessionId;
  logger.info(
    `[ContinuationExecutor] Resuming execution with claudeSessionId: ${claudeSessionId}`,
  );

  // エージェント設定を取得
  let agentConfig: AgentConfigInput = {
    type: "claude-code",
    name: "Claude Code Agent",
    workingDirectory: task?.workingDirectory || undefined,
    timeout: options.timeout,
    dangerouslySkipPermissions: true,
    resumeSessionId: claudeSessionId || undefined,
    continueConversation: !claudeSessionId,
  };

  if (execution.agentConfigId) {
    const dbConfig = await ctx.prisma.aIAgentConfig.findUnique({
      where: { id: execution.agentConfigId },
    });
    if (dbConfig) {
      let decryptedApiKey: string | undefined;
      if (dbConfig.apiKeyEncrypted) {
        try {
          decryptedApiKey = decrypt(dbConfig.apiKeyEncrypted);
        } catch (e) {
          logger.error(
            { err: e, agentId: dbConfig.id },
            `[ContinuationExecutor] Failed to decrypt API key for agent`,
          );
        }
      }

      agentConfig = {
        type: (dbConfig.agentType as AgentType) || "claude-code",
        name: dbConfig.name,
        endpoint: dbConfig.endpoint || undefined,
        apiKey: decryptedApiKey,
        modelId: dbConfig.modelId || undefined,
        workingDirectory: task?.workingDirectory || undefined,
        timeout: options.timeout,
        dangerouslySkipPermissions: true,
        yoloMode: true,
        resumeSessionId: claudeSessionId || undefined,
        continueConversation: !claudeSessionId,
      };
    }
  }

  let agent = agentFactory.createAgent(agentConfig);
  const taskId = execution.session.config?.taskId || 0;

  // ファイルロガーを初期化
  const fileLogger = new ExecutionFileLogger(
    execution.id,
    execution.sessionId,
    taskId,
    task?.title || `Task ${taskId}`,
    agentConfig.type,
    agentConfig.name,
    agentConfig.modelId,
  );
  fileLogger.logExecutionStart(
    `[Continuation] User response: ${response.substring(0, 200)}`,
    {
      claudeSessionId,
      previousStatus: execution.status,
    },
  );
  fileLogger.logQuestionAnswered(response, "user");

  // 実行状態を追跡
  const state: ExecutionState = {
    executionId: execution.id,
    sessionId: execution.sessionId,
    agentId: agent.id,
    taskId,
    status: "running",
    startedAt: new Date(),
    output: execution.output || "",
  };
  ctx.activeExecutions.set(execution.id, state);

  const agentInfo: ActiveAgentInfo = {
    agent,
    executionId: execution.id,
    sessionId: execution.sessionId,
    taskId,
    state,
    lastOutput: execution.output || "",
    lastSavedAt: new Date(),
    fileLogger,
  };
  ctx.activeAgents.set(execution.id, agentInfo);

  if (ctx.isShuttingDown) {
    ctx.activeAgents.delete(execution.id);
    ctx.activeExecutions.delete(execution.id);
    fileLogger.logError("Server is shutting down, cannot continue execution");
    await fileLogger.flush();
    throw new Error("Server is shutting down, cannot continue execution");
  }

  // 質問検出ハンドラを設定
  setupQuestionDetectedHandler(agent, {
    prisma: ctx.prisma,
    executionId: execution.id,
    sessionId: execution.sessionId,
    taskId,
    state,
    fileLogger,
    existingClaudeSessionId: execution.claudeSessionId,
    emitEvent: (event) => ctx.emitEvent(event),
    startQuestionTimeout: (eid, tid, qk) => ctx.startQuestionTimeout(eid, tid, qk),
    getQuestionTimeoutInfo: (eid) => ctx.getQuestionTimeoutInfo(eid),
  });

  // ログチャンク管理
  const existingLogs = await ctx.prisma.agentExecutionLog.findMany({
    where: { executionId: execution.id },
    orderBy: { sequenceNumber: "desc" },
    take: 1,
  });

  const logManager = createLogChunkManager({
    prisma: ctx.prisma,
    executionId: execution.id,
    initialSequenceNumber: existingLogs.length > 0 ? existingLogs[0].sequenceNumber + 1 : 0,
  });

  const cleanupLogHandler = logManager.cleanup;

  // 出力ハンドラを設定
  setupOutputHandler(agent, {
    prisma: ctx.prisma,
    executionId: execution.id,
    sessionId: execution.sessionId,
    taskId,
    state,
    agentInfo,
    fileLogger,
    onOutput: options.onOutput,
    emitEvent: (event) => ctx.emitEvent(event),
  }, logManager);

  // 継続メッセージを追加
  const continueMessage = `\n[継続] ユーザーからの回答を受け取りました。実行を継続します...\n`;
  state.output += continueMessage;

  await ctx.prisma.agentExecution.update({
    where: { id: execution.id },
    data: {
      status: "running",
      question: null,
      questionType: null,
      questionDetails: null,
      output: state.output,
    },
  });

  try {
    const agentTask: AgentTask = {
      id: taskId,
      title: response,
      description: response,
      workingDirectory: task?.workingDirectory || undefined,
    };

    let result = await agent.execute(agentTask);

    // --resume 失敗時のフォールバック処理
    if (isSessionResumeFailure(result, claudeSessionId)) {
      result = await handleResumeFailureFallbacks(
        ctx, agent, agentConfig, agentTask, agentInfo,
        execution, state, fileLogger, logManager, taskId, claudeSessionId!,
      );
    }

    // 結果をDB保存・イベント発火
    await saveExecutionResult(
      ctx.prisma, execution.id, execution.sessionId, state, result, fileLogger,
      {
        artifacts: execution.artifacts,
        tokensUsed: execution.tokensUsed,
        executionTimeMs: execution.executionTimeMs,
        claudeSessionId: execution.claudeSessionId,
      },
    );
    emitResultEvent(result, execution.id, execution.sessionId, taskId,
      (event) => ctx.emitEvent(event));

    return result;
  } catch (error) {
    await handleExecutionError(
      ctx.prisma, execution.id, execution.sessionId, taskId,
      state, error, fileLogger, (event) => ctx.emitEvent(event), "Continuation",
    );
    throw error;
  } finally {
    await cleanupLogHandler();
    await fileLogger.flush();
    ctx.activeExecutions.delete(execution.id);
    ctx.activeAgents.delete(execution.id);
    await agentFactory.removeAgent(agent.id);
  }
}

/**
 * --resume 失敗時のフォールバック処理
 * --resume リトライ → --continue → 新規セッション の順で試行
 */
async function handleResumeFailureFallbacks(
  ctx: OrchestratorContext,
  currentAgent: ReturnType<typeof agentFactory.createAgent>,
  agentConfig: AgentConfigInput,
  agentTask: AgentTask,
  agentInfo: ActiveAgentInfo,
  execution: { id: number; sessionId: number; claudeSessionId: string | null; output: string | null },
  state: ExecutionState,
  fileLogger: ExecutionFileLogger,
  logManager: ReturnType<typeof createLogChunkManager>,
  taskId: number,
  claudeSessionId: string,
): Promise<AgentExecutionResult> {
  logger.info(
    `[ContinuationExecutor] Session resume failed. Retrying --resume after delay...`,
  );
  fileLogger.logError(
    `Session resume failed with --resume ${claudeSessionId}. Retrying after 3s delay.`,
  );

  await agentFactory.removeAgent(currentAgent.id);
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // --resume で再試行
  const retryAgent = agentFactory.createAgent(agentConfig);
  setupFallbackAgentHandlers(
    retryAgent, ctx, execution.id, execution.sessionId, taskId,
    state, agentInfo, fileLogger, logManager, execution.claudeSessionId, "resume retry",
  );

  agentInfo.agent = retryAgent;

  const retryMessage = `\n[セッション再開] --resume の再試行を行っています...\n`;
  state.output += retryMessage;
  ctx.emitEvent({
    type: "execution_output",
    executionId: execution.id,
    sessionId: execution.sessionId,
    taskId,
    data: { output: retryMessage },
    timestamp: new Date(),
  });

  const retryResult = await retryAgent.execute(agentTask);

  if (!isSessionResumeFailure(retryResult, claudeSessionId)) {
    return retryResult;
  }

  // --continue にフォールバック
  logger.info(
    `[ContinuationExecutor] --resume retry also failed. Attempting fallback with --continue...`,
  );
  fileLogger.logError(`--resume retry also failed. Attempting --continue fallback.`);
  await agentFactory.removeAgent(retryAgent.id);

  const fallbackConfig: AgentConfigInput = {
    ...agentConfig,
    resumeSessionId: undefined,
    continueConversation: true,
  };
  const fallbackAgent = agentFactory.createAgent(fallbackConfig);
  setupFallbackAgentHandlers(
    fallbackAgent, ctx, execution.id, execution.sessionId, taskId,
    state, agentInfo, fileLogger, logManager, execution.claudeSessionId, "continuation fallback",
  );

  agentInfo.agent = fallbackAgent;

  const fallbackMessage = `\n[セッション再開] --resume が失敗したため、--continue で再試行しています...\n`;
  state.output += fallbackMessage;
  ctx.emitEvent({
    type: "execution_output",
    executionId: execution.id,
    sessionId: execution.sessionId,
    taskId,
    data: { output: fallbackMessage },
    timestamp: new Date(),
  });

  const fallbackResult = await fallbackAgent.execute(agentTask);

  if (!isSessionResumeFailure(fallbackResult, claudeSessionId)) {
    return fallbackResult;
  }

  // 新規セッションで最終フォールバック
  logger.info(
    `[ContinuationExecutor] --continue fallback also failed. Starting new session with context...`,
  );
  fileLogger.logError(
    `--continue fallback also failed. Starting new session with context.`,
  );
  await agentFactory.removeAgent(fallbackAgent.id);

  const newSessionConfig: AgentConfigInput = {
    ...agentConfig,
    resumeSessionId: undefined,
    continueConversation: false,
  };
  const newAgent = agentFactory.createAgent(newSessionConfig);
  setupFallbackAgentHandlers(
    newAgent, ctx, execution.id, execution.sessionId, taskId,
    state, agentInfo, fileLogger, logManager, null, "new session",
  );

  agentInfo.agent = newAgent;

  // コンテキスト付きのプロンプトを構築
  const previousContext = (execution.output || "").slice(-2000);
  const contextPrompt = `以下は前回のタスク実行の継続です。前回のコンテキスト（最後の部分）:\n\n${previousContext}\n\n前回の質問に対するユーザーの回答: ${agentTask.title}\n\n上記の回答を踏まえて、タスクの実行を継続してください。`;

  const contextTask: AgentTask = {
    id: taskId,
    title: contextPrompt,
    description: contextPrompt,
    workingDirectory: agentTask.workingDirectory,
  };

  const newSessionMessage = `\n[セッション再開] 新しいセッションでコンテキストを引き継いで実行を継続します...\n`;
  state.output += newSessionMessage;
  ctx.emitEvent({
    type: "execution_output",
    executionId: execution.id,
    sessionId: execution.sessionId,
    taskId,
    data: { output: newSessionMessage },
    timestamp: new Date(),
  });

  return await newAgent.execute(contextTask);
}

/**
 * 質問タイムアウト発生時の処理
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
    if (!ctx.tryAcquireContinuationLock(executionId, "auto_timeout")) {
      logger.info(
        `[ContinuationExecutor] Skipping timeout handling for execution ${executionId} - already being processed`,
      );
      return;
    }

    try {
      const execution = await ctx.prisma.agentExecution.findUnique({
        where: { id: executionId },
        include: { session: true },
      });

      if (!execution) {
        logger.info(
          `[ContinuationExecutor] Execution ${executionId} not found for timeout handling`,
        );
        return;
      }

      if (execution.status !== "waiting_for_input") {
        logger.info(
          `[ContinuationExecutor] Execution ${executionId} is no longer waiting for input (status: ${execution.status})`,
        );
        return;
      }

      await ctx.prisma.agentExecution.update({
        where: { id: executionId },
        data: { status: "running" },
      });

      logger.info(
        `[ContinuationExecutor] Auto-continuing execution ${executionId} after timeout`,
      );

      const defaultResponse = generateDefaultResponse(
        undefined,
        execution.question,
        execution.questionDetails,
      );

      ctx.emitEvent({
        type: "execution_output",
        executionId,
        sessionId: execution.sessionId,
        taskId,
        data: {
          questionTimeoutTriggered: true,
          autoResponse: defaultResponse,
          message: "タイムアウトにより自動的に継続します",
        },
        timestamp: new Date(),
      });

      const result = await executeContinuationInternal(
        ctx,
        executionId,
        defaultResponse,
        { timeout: 900000 },
      );

      // 結果に応じてタスクとセッションのステータスを更新
      if (result.success && !result.waitingForInput) {
        try {
          await ctx.prisma.task.update({
            where: { id: taskId },
            data: { status: "done", completedAt: new Date() },
          });
          logger.info(
            `[ContinuationExecutor] Task ${taskId} updated to 'done' after timeout auto-continue`,
          );

          await ctx.prisma.agentSession.update({
            where: { id: execution.sessionId },
            data: { status: "completed", completedAt: new Date() },
          });
        } catch (updateError) {
          logger.error(
            { err: updateError },
            `[ContinuationExecutor] Failed to update task/session status after timeout`,
          );
        }
      } else if (!result.success && !result.waitingForInput) {
        try {
          await ctx.prisma.task.update({
            where: { id: taskId },
            data: { status: "todo" },
          });

          await ctx.prisma.agentSession.update({
            where: { id: execution.sessionId },
            data: {
              status: "failed",
              completedAt: new Date(),
              errorMessage:
                result.errorMessage ||
                "Execution failed after timeout auto-continue",
            },
          });
        } catch (updateError) {
          logger.error(
            { err: updateError },
            `[ContinuationExecutor] Failed to update task/session status after timeout failure`,
          );
        }
      }
    } catch (error) {
      await ctx.prisma.agentExecution
        .update({
          where: { id: executionId },
          data: { status: "waiting_for_input" },
        })
        .catch(() => {});
      throw error;
    } finally {
      ctx.releaseContinuationLock(executionId);
    }
  } catch (error) {
    logger.error(
      { err: error, executionId },
      `[ContinuationExecutor] Error handling question timeout for execution`,
    );
  }
}
