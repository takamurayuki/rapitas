/**
 * TaskExecutor
 *
 * Handles the execution logic for new tasks.
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
 * Execute a task.
 */
export async function executeTask(
  ctx: OrchestratorContext,
  task: AgentTask,
  options: ExecutionOptions,
): Promise<AgentExecutionResult> {
  // eslint-disable-next-line prefer-const
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
      agentConfig = await ctx.buildAgentConfigFromDb(dbConfig, options);
      resolvedAgentConfigId = dbConfig.id;
    }
  } else {
    const defaultDbConfig = await ctx.prisma.aIAgentConfig.findFirst({
      where: { isDefault: true, isActive: true },
    });
    if (defaultDbConfig) {
      agentConfig = await ctx.buildAgentConfigFromDb(defaultDbConfig, options);
      resolvedAgentConfigId = defaultDbConfig.id;
      logger.info(
        `[TaskExecutor] Using default agent from DB: ${defaultDbConfig.name} (type: ${defaultDbConfig.agentType})`,
      );
    } else {
      logger.info(`[TaskExecutor] No default agent in DB, falling back to Claude Code`);
    }
  }
  if (options.modelIdOverride) {
    agentConfig = { ...agentConfig, modelId: options.modelIdOverride };
  }

  const agent = agentFactory.createAgent(agentConfig);

  const execution = await ctx.prisma.agentExecution.create({
    data: {
      sessionId: options.sessionId,
      agentConfigId: resolvedAgentConfigId,
      command: task.description || task.title,
      status: 'pending',
    },
  });

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

  if (ctx.isShuttingDown) {
    ctx.activeAgents.delete(execution.id);
    ctx.activeExecutions.delete(execution.id);
    fileLogger.logError('Server is shutting down, cannot start new execution');
    await fileLogger.flush();
    throw new Error('Server is shutting down, cannot start new execution');
  }

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

  const logManager = createLogChunkManager({
    prisma: ctx.prisma,
    executionId: execution.id,
    initialSequenceNumber: 0,
  });

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

  const agentLabel = agentConfig.modelId
    ? `${agentConfig.name} (${agentConfig.type}, model: ${agentConfig.modelId})`
    : `${agentConfig.name} (${agentConfig.type})`;

  const initialMessage =
    options.continueFromPrevious && previousOutput
      ? previousOutput + '\n[継続実行] 追加指示の実行を開始します...\n'
      : `[実行開始] タスクの実行を開始します...\n[エージェント] ${agentLabel}\n`;

  state.output = initialMessage;

  await ctx.prisma.agentExecution.update({
    where: { id: execution.id },
    data: {
      status: 'running',
      startedAt: new Date(),
      output: initialMessage,
    },
  });

  try {
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

    let result = await agent.execute(taskWithAnalysis);

    logger.info(
      `[TaskExecutor] Execution result - success: ${result.success}, waitingForInput: ${result.waitingForInput}, questionType: ${result.questionType}, question: ${result.question?.substring(0, 100)}`,
    );

    // If the agent failed — OR succeeded but its output contains a known
    // provider-quota / rate-limit error — classify, place that provider
    // into cooldown, and retry once with a different active AIAgentConfig.
    //
    // Why we also inspect successful output: some CLIs (notably Codex)
    // print "ERROR: You've hit your usage limit..." but still exit with
    // code 0, so result.success would be true. The user sees the error in
    // the log panel without any automatic recovery. Treating that as a
    // failure for fallback purposes plugs that gap.
    const successOutput = typeof result.output === 'string' ? result.output : '';
    const errorBlob = `${result.errorMessage ?? ''}\n${successOutput.slice(-4000)}`;
    let needsFallback = !result.success;
    if (!needsFallback && !options.disableFallback) {
      const { classifyAgentError } = await import('../../ai/agent-error-classifier');
      const { agentTypeToProvider } = await import('../../ai/agent-fallback');
      const hint = agentTypeToProvider(agentConfig.type) ?? undefined;
      const classified = classifyAgentError(errorBlob, hint);
      if (classified?.retryWithFallback) {
        needsFallback = true;
        logger.warn(
          {
            executionId: execution.id,
            agentType: agentConfig.type,
            classifiedAs: classified.reason,
            providerImplicated: classified.provider,
          },
          '[TaskExecutor] Detected provider error in successful output — forcing fallback',
        );
      }
    }

    if (needsFallback && !options.disableFallback) {
      const { findFallbackAgentConfig } = await import('../../ai/agent-fallback');
      const fallback = await findFallbackAgentConfig(errorBlob, agentConfig.type);
      if (fallback?.agentConfig) {
        const fbType = (fallback.agentConfig as { agentType: string }).agentType;
        const fbName = (fallback.agentConfig as { name: string }).name;
        const fbId = (fallback.agentConfig as { id: number }).id;
        logger.warn(
          {
            originalAgent: agentConfig.name,
            originalType: agentConfig.type,
            fallbackAgent: fbName,
            fallbackType: fbType,
            cooledProvider: fallback.classified.provider,
            reason: fallback.classified.reason,
          },
          '[TaskExecutor] Provider failed — retrying with alternative agent config',
        );
        ctx.emitEvent({
          type: 'execution_output',
          executionId: execution.id,
          sessionId: options.sessionId,
          taskId: options.taskId,
          data: {
            output: `\n[フォールバック] ${fallback.classified.reason} を検出。${fbName} (${fbType}) で再実行します...\n`,
            isError: false,
          },
          timestamp: new Date(),
        });

        // Build a new agentConfig from the fallback DB record and run the
        // same task with `disableFallback` so we never recurse more than once.
        const newAgentConfig = await ctx.buildAgentConfigFromDb(
          fallback.agentConfig as never,
          options,
        );
        const newAgent = agentFactory.createAgent(newAgentConfig);
        try {
          // Replace the active agent reference so subsequent UI events match.
          agentInfo.agent = newAgent;
          const retryResult = await newAgent.execute(taskWithAnalysis);
          if (retryResult.success) {
            agentConfig = newAgentConfig;
            resolvedAgentConfigId = fbId;
            result = retryResult;
            await ctx.prisma.agentExecution.update({
              where: { id: execution.id },
              data: { agentConfigId: fbId },
            });
          }
        } finally {
          await agentFactory.removeAgent(newAgent.id);
        }
      }
    }

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

    // Memory system: timeline event + distillation
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

      // NOTE: Auto-complete task when agent execution succeeds — connects AgentExecution → Task.status.
      const shouldAutoCompleteTask = options.autoCompleteTask !== false;
      if (shouldAutoCompleteTask && options.taskId && !result.waitingForInput) {
        ctx.prisma.task
          .update({
            where: { id: options.taskId },
            data: { status: 'done', completedAt: new Date() },
          })
          .then(() => {
            logger.info(
              { taskId: options.taskId, executionId: execution.id },
              '[TaskExecutor] Task auto-completed on successful agent execution',
            );
          })
          .catch((err) => {
            logger.warn(
              { err, taskId: options.taskId },
              '[TaskExecutor] Failed to auto-complete task',
            );
          });
      }
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
