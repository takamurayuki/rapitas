/**
 * タスク実行
 * 新規タスクの実行ロジックを担当
 */
import { agentFactory } from '../agent-factory';
import type { AgentConfigInput } from '../agent-factory';
import type { AgentTask, AgentExecutionResult } from '../base-agent';
import { ExecutionFileLogger } from '../execution-file-logger';
import { createLogger } from '../../../config/logger';
import type {
  ExecutionOptions,
  ExecutionState,
  ActiveAgentInfo,
  OrchestratorContext,
} from './types';
import {
  createLogChunkManager,
  setupQuestionDetectedHandler,
  setupOutputHandler,
  saveExecutionResult,
  emitResultEvent,
  handleExecutionError,
} from './execution-helpers';

import { appendEvent } from '../../memory/timeline';
import { memoryTaskQueue } from '../../memory';
import { buildTaskRAGContext } from '../../memory/rag/context-builder';

const logger = createLogger('task-executor');

/**
 * タスクを実行
 */
export async function executeTask(
  ctx: OrchestratorContext,
  task: AgentTask,
  options: ExecutionOptions,
): Promise<AgentExecutionResult> {
  // エージェント設定を取得
  let agentConfig: AgentConfigInput = {
    type: 'claude-code',
    name: 'Claude Code Agent',
    workingDirectory: options.workingDirectory,
    timeout: options.timeout,
    dangerouslySkipPermissions: true,
  };
  let resolvedAgentConfigId = options.agentConfigId;

  if (options.agentConfigId) {
    const dbConfig = await ctx.prisma.aIAgentConfig.findUnique({
      where: { id: options.agentConfigId },
    });
    if (dbConfig) {
      agentConfig = ctx.buildAgentConfigFromDb(dbConfig, options);
      resolvedAgentConfigId = dbConfig.id;
    }
  } else {
    const defaultDbConfig = await ctx.prisma.aIAgentConfig.findFirst({
      where: { isDefault: true, isActive: true },
    });
    if (defaultDbConfig) {
      agentConfig = ctx.buildAgentConfigFromDb(defaultDbConfig, options);
      resolvedAgentConfigId = defaultDbConfig.id;
      logger.info(
        `[TaskExecutor] Using default agent from DB: ${defaultDbConfig.name} (type: ${defaultDbConfig.agentType})`,
      );
    } else {
      logger.info(`[TaskExecutor] No default agent in DB, falling back to Claude Code`);
    }
  }

  // エージェントを作成
  const agent = agentFactory.createAgent(agentConfig);

  // 実行レコードを作成
  const execution = await ctx.prisma.agentExecution.create({
    data: {
      sessionId: options.sessionId,
      agentConfigId: resolvedAgentConfigId,
      command: task.description || task.title,
      status: 'pending',
    },
  });

  // 実行状態を追跡
  const state: ExecutionState = {
    executionId: execution.id,
    sessionId: options.sessionId,
    agentId: agent.id,
    taskId: options.taskId,
    status: 'idle',
    startedAt: new Date(),
    output: '',
  };
  ctx.activeExecutions.set(execution.id, state);

  // ファイルロガーを初期化
  const fileLogger = new ExecutionFileLogger(
    execution.id,
    options.sessionId,
    options.taskId,
    task.title,
    agentConfig.type,
    agentConfig.name,
    agentConfig.modelId,
  );
  fileLogger.logExecutionStart(task.description || task.title, {
    workingDirectory: options.workingDirectory,
    timeout: options.timeout,
    requireApproval: options.requireApproval,
    agentConfigId: options.agentConfigId,
    hasAnalysisInfo: !!options.analysisInfo,
  });

  // アクティブエージェントを登録
  const agentInfo: ActiveAgentInfo = {
    agent,
    executionId: execution.id,
    sessionId: options.sessionId,
    taskId: options.taskId,
    state,
    lastOutput: '',
    lastSavedAt: new Date(),
    fileLogger,
  };
  ctx.activeAgents.set(execution.id, agentInfo);

  // シャットダウン中は新しい実行を拒否
  if (ctx.isShuttingDown) {
    ctx.activeAgents.delete(execution.id);
    ctx.activeExecutions.delete(execution.id);
    fileLogger.logError('Server is shutting down, cannot start new execution');
    await fileLogger.flush();
    throw new Error('Server is shutting down, cannot start new execution');
  }

  // 質問検出ハンドラを設定
  setupQuestionDetectedHandler(agent, {
    prisma: ctx.prisma,
    executionId: execution.id,
    sessionId: options.sessionId,
    taskId: options.taskId,
    state,
    fileLogger,
    emitEvent: (event) => ctx.emitEvent(event),
    startQuestionTimeout: (eid, tid, qk) => ctx.startQuestionTimeout(eid, tid, qk),
    getQuestionTimeoutInfo: (eid) => ctx.getQuestionTimeoutInfo(eid),
  });

  // ログチャンク管理
  const logManager = createLogChunkManager({
    prisma: ctx.prisma,
    executionId: execution.id,
    initialSequenceNumber: 0,
  });

  // 出力ハンドラを設定
  setupOutputHandler(
    agent,
    {
      prisma: ctx.prisma,
      executionId: execution.id,
      sessionId: options.sessionId,
      taskId: options.taskId,
      state,
      agentInfo,
      fileLogger,
      onOutput: options.onOutput,
      emitEvent: (event) => ctx.emitEvent(event),
    },
    logManager,
  );

  const cleanupLogHandler = logManager.cleanup;

  // 実行開始イベント
  ctx.emitEvent({
    type: 'execution_started',
    executionId: execution.id,
    sessionId: options.sessionId,
    taskId: options.taskId,
    data: {
      agentType: agentConfig.type,
      agentName: agentConfig.name,
      modelId: agentConfig.modelId,
    },
    timestamp: new Date(),
  });

  // 継続実行の場合は前回のログを取得
  let previousOutput = '';
  if (options.continueFromPrevious && options.sessionId) {
    try {
      const previousExecution = await ctx.prisma.agentExecution.findFirst({
        where: {
          sessionId: options.sessionId,
          id: { not: execution.id },
        },
        orderBy: { createdAt: 'desc' },
        select: { output: true },
      });

      if (previousExecution?.output) {
        previousOutput = previousExecution.output;
        logger.info(
          `[TaskExecutor] Previous execution output loaded for continuation (${previousOutput.length} chars)`,
        );
      }
    } catch (error) {
      logger.error({ err: error }, '[TaskExecutor] Failed to load previous execution output');
    }
  }

  // 初期メッセージを設定
  const agentLabel = agentConfig.modelId
    ? `${agentConfig.name} (${agentConfig.type}, model: ${agentConfig.modelId})`
    : `${agentConfig.name} (${agentConfig.type})`;

  const initialMessage =
    options.continueFromPrevious && previousOutput
      ? previousOutput + '\n[継続実行] 追加指示の実行を開始します...\n'
      : `[実行開始] タスクの実行を開始します...\n[エージェント] ${agentLabel}\n`;

  state.output = initialMessage;

  // 実行レコードを更新
  await ctx.prisma.agentExecution.update({
    where: { id: execution.id },
    data: {
      status: 'running',
      startedAt: new Date(),
      output: initialMessage,
    },
  });

  try {
    // RAGコンテキストを注入
    let ragContext = '';
    try {
      ragContext = await buildTaskRAGContext({
        title: task.title,
        description: task.description,
        themeId: task.themeId,
      });
    } catch (err) {
      logger.debug({ err }, '[TaskExecutor] RAG context build failed, continuing without');
    }

    const taskWithAnalysis: AgentTask = {
      ...task,
      analysisInfo: options.analysisInfo,
      ...(ragContext ? { description: `${task.description ?? ''}\n\n${ragContext}` } : {}),
    };

    if (options.analysisInfo) {
      logger.info(`[TaskExecutor] AI task analysis enabled`);
      logger.info(
        `[TaskExecutor] Analysis summary: ${options.analysisInfo.summary?.substring(0, 100)}`,
      );
      logger.info(`[TaskExecutor] Subtasks count: ${options.analysisInfo.subtasks?.length || 0}`);
    } else {
      logger.info(`[TaskExecutor] AI task analysis not provided`);
    }

    // エージェントを実行
    const result = await agent.execute(taskWithAnalysis);

    logger.info(
      `[TaskExecutor] Execution result - success: ${result.success}, waitingForInput: ${result.waitingForInput}, questionType: ${result.questionType}, question: ${result.question?.substring(0, 100)}`,
    );

    // 結果をDB保存・イベント発火
    await saveExecutionResult(
      ctx.prisma,
      execution.id,
      options.sessionId,
      state,
      result,
      fileLogger,
    );
    emitResultEvent(result, execution.id, options.sessionId, options.taskId, (event) =>
      ctx.emitEvent(event),
    );

    // メモリシステム: タイムラインイベント + distillation
    const eventType = result.success ? 'agent_execution_completed' : 'agent_execution_failed';
    appendEvent({
      eventType,
      actorType: 'agent',
      actorId: agentConfig.type,
      payload: { executionId: execution.id, taskId: options.taskId, success: result.success },
      correlationId: `execution_${execution.id}`,
    }).catch((err) => logger.debug({ err }, '[TaskExecutor] Timeline event failed'));

    if (result.success) {
      memoryTaskQueue.enqueue('distill', { executionId: execution.id }, 1).catch((err) => {
        logger.debug({ err }, '[TaskExecutor] Distillation enqueue failed');
      });
    }

    return result;
  } catch (error) {
    await handleExecutionError(
      ctx.prisma,
      execution.id,
      options.sessionId,
      options.taskId,
      state,
      error,
      fileLogger,
      (event) => ctx.emitEvent(event),
      'Execution',
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
