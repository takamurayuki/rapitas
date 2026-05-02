/**
 * TaskExecutor
 *
 * Handles the execution logic for new tasks.
 */
import { agentFactory } from '../agent-factory';
import type { AgentConfigInput } from '../agent-factory';
import type { AgentTask, AgentExecutionResult, BaseAgent } from '../base-agent';
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
  type LogChunkManager,
} from './execution-helpers';

import { appendEvent } from '../../memory/timeline';
import { memoryTaskQueue } from '../../memory';
import { buildTaskRAGContext } from '../../memory/rag/context-builder';

const logger = createLogger('task-executor');

/** Result of resolving agent configuration */
interface ResolvedAgentConfig {
  agentConfig: AgentConfigInput;
  resolvedAgentConfigId: number | undefined;
}

/**
 * Resolve agent configuration from options or database defaults.
 */
async function resolveAgentConfig(
  ctx: OrchestratorContext,
  options: ExecutionOptions,
): Promise<ResolvedAgentConfig> {
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

  // Forward investigation-mode flags onto the agent config
  if (options.investigationMode || options.investigationOutputType) {
    agentConfig = {
      ...agentConfig,
      investigationMode: options.investigationMode ?? agentConfig.investigationMode,
      investigationOutputType:
        options.investigationOutputType ?? agentConfig.investigationOutputType,
      outputLastMessageFile: options.outputLastMessageFile ?? agentConfig.outputLastMessageFile,
    };
  }

  return { agentConfig, resolvedAgentConfigId };
}

/** Execution setup result containing all initialized resources */
interface ExecutionSetup {
  execution: { id: number };
  state: ExecutionState;
  agentInfo: ActiveAgentInfo;
  fileLogger: ExecutionFileLogger;
  logManager: LogChunkManager;
}

/**
 * Create execution record, state, and logger resources.
 */
async function createExecutionResources(
  ctx: OrchestratorContext,
  agent: BaseAgent,
  agentConfig: AgentConfigInput,
  resolvedAgentConfigId: number | undefined,
  task: AgentTask,
  options: ExecutionOptions,
): Promise<ExecutionSetup> {
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

  const logManager = createLogChunkManager({
    prisma: ctx.prisma,
    executionId: execution.id,
    initialSequenceNumber: 0,
  });

  return { execution, state, agentInfo, fileLogger, logManager };
}

/**
 * Setup event handlers for agent output and question detection.
 */
function setupAgentHandlers(
  ctx: OrchestratorContext,
  agent: BaseAgent,
  setup: ExecutionSetup,
  options: ExecutionOptions,
): void {
  const { execution, state, agentInfo, fileLogger, logManager } = setup;

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
}

/**
 * Load previous execution output for continuation mode.
 */
async function loadPreviousOutput(
  ctx: OrchestratorContext,
  executionId: number,
  options: ExecutionOptions,
): Promise<string> {
  if (!options.continueFromPrevious || !options.sessionId) {
    return '';
  }

  try {
    const previousExecution = await ctx.prisma.agentExecution.findFirst({
      where: {
        sessionId: options.sessionId,
        id: { not: executionId },
      },
      orderBy: { createdAt: 'desc' },
      select: { output: true },
    });

    if (previousExecution?.output) {
      logger.info(
        `[TaskExecutor] Previous execution output loaded for continuation (${previousExecution.output.length} chars)`,
      );
      return previousExecution.output;
    }
  } catch (error) {
    logger.error({ err: error }, '[TaskExecutor] Failed to load previous execution output');
  }

  return '';
}

/**
 * Build the initial message shown at execution start.
 */
function buildInitialMessage(
  agentConfig: AgentConfigInput,
  previousOutput: string,
  continueFromPrevious?: boolean,
): string {
  const agentLabel = agentConfig.modelId
    ? `${agentConfig.name} (${agentConfig.type}, model: ${agentConfig.modelId})`
    : `${agentConfig.name} (${agentConfig.type})`;

  if (continueFromPrevious && previousOutput) {
    return previousOutput + '\n[継続実行] 追加指示の実行を開始します...\n';
  }

  return `[実行開始] タスクの実行を開始します...\n[エージェント] ${agentLabel}\n`;
}

/**
 * Build task with RAG context and analysis info.
 */
async function buildTaskWithContext(
  task: AgentTask,
  options: ExecutionOptions,
): Promise<AgentTask> {
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
    investigationMode: options.investigationMode ?? task.investigationMode,
    investigationOutputType: options.investigationOutputType ?? task.investigationOutputType,
    outputLastMessageFile: options.outputLastMessageFile ?? task.outputLastMessageFile,
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

  return taskWithAnalysis;
}

/** Context for fallback execution */
interface FallbackContext {
  ctx: OrchestratorContext;
  execution: { id: number };
  state: ExecutionState;
  agentInfo: ActiveAgentInfo;
  fileLogger: ExecutionFileLogger;
  logManager: LogChunkManager;
  options: ExecutionOptions;
  taskWithAnalysis: AgentTask;
}

/**
 * Check if execution needs fallback based on result and output.
 */
async function checkNeedsFallback(
  result: AgentExecutionResult,
  agentType: string,
  disableFallback?: boolean,
  executionId?: number,
): Promise<{ needsFallback: boolean; errorBlob: string }> {
  const successOutput = typeof result.output === 'string' ? result.output : '';
  const errorBlob = `${result.errorMessage ?? ''}\n${successOutput.slice(-4000)}`;
  let needsFallback = !result.success;

  if (!needsFallback && !disableFallback) {
    const { classifyAgentError } = await import('../../ai/agent-error-classifier');
    const { agentTypeToProvider } = await import('../../ai/agent-fallback');
    const hint = agentTypeToProvider(agentType) ?? undefined;
    const classified = classifyAgentError(errorBlob, { hint, strict: true });

    if (classified?.retryWithFallback) {
      needsFallback = true;
      logger.warn(
        {
          executionId,
          agentType,
          classifiedAs: classified.reason,
          providerImplicated: classified.provider,
        },
        '[TaskExecutor] Detected provider error in successful output — forcing fallback',
      );
    }
  }

  return { needsFallback, errorBlob };
}

/**
 * Execute with a fallback agent after primary agent failure.
 */
async function executeWithFallbackAgent(
  fallbackCtx: FallbackContext,
  errorBlob: string,
  originalAgentConfig: AgentConfigInput,
): Promise<{
  result: AgentExecutionResult;
  fallbackSucceeded: boolean;
  newAgentConfig?: AgentConfigInput;
  newConfigId?: number;
}> {
  const { ctx, execution, state, agentInfo, fileLogger, logManager, options, taskWithAnalysis } =
    fallbackCtx;

  const { findFallbackAgentConfig } = await import('../../ai/agent-fallback');
  const fallback = await findFallbackAgentConfig(errorBlob, originalAgentConfig.type);

  if (!fallback?.agentConfig) {
    return { result: {} as AgentExecutionResult, fallbackSucceeded: false };
  }

  const fbType = (fallback.agentConfig as { agentType: string }).agentType;
  const fbName = (fallback.agentConfig as { name: string }).name;
  const fbId = (fallback.agentConfig as { id: number }).id;

  logger.warn(
    {
      originalAgent: originalAgentConfig.name,
      originalType: originalAgentConfig.type,
      fallbackAgent: fbName,
      fallbackType: fbType,
      cooledProvider: fallback.classified.provider,
      reason: fallback.classified.reason,
    },
    '[TaskExecutor] Provider failed — retrying with alternative agent config',
  );

  // Emit fallback banner
  const banner = `\n[フォールバック] ${fallback.classified.reason} を検出。${fbName} (${fbType}) で再実行します...\n`;
  state.output += banner;
  fileLogger.logOutput(banner, false);
  logManager.addChunk(banner, false);
  ctx.emitEvent({
    type: 'execution_output',
    executionId: execution.id,
    sessionId: options.sessionId,
    taskId: options.taskId,
    data: { output: banner, isError: false },
    timestamp: new Date(),
  });

  const newAgentConfig = await ctx.buildAgentConfigFromDb(fallback.agentConfig as never, options);
  const newAgent = agentFactory.createAgent(newAgentConfig);

  try {
    // Wire handlers onto fallback agent
    setupQuestionDetectedHandler(newAgent, {
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

    setupOutputHandler(
      newAgent,
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

    // Update references
    agentInfo.agent = newAgent;
    await ctx.prisma.agentExecution.update({
      where: { id: execution.id },
      data: { agentConfigId: fbId },
    });

    ctx.emitEvent({
      type: 'execution_started',
      executionId: execution.id,
      sessionId: options.sessionId,
      taskId: options.taskId,
      data: {
        agentType: newAgentConfig.type,
        agentName: newAgentConfig.name,
        modelId: newAgentConfig.modelId,
        fallbackFrom: fallback.classified.provider,
      },
      timestamp: new Date(),
    });

    const retryResult = await newAgent.execute(taskWithAnalysis);

    // Check if retry also failed
    const retryBlob = `${retryResult.errorMessage ?? ''}\n${
      typeof retryResult.output === 'string' ? retryResult.output.slice(-4000) : ''
    }`;
    const { classifyAgentError: reclassify } = await import('../../ai/agent-error-classifier');
    const { agentTypeToProvider } = await import('../../ai/agent-fallback');
    const retryHint = agentTypeToProvider(newAgentConfig.type) ?? undefined;
    const retryHasError = !!reclassify(retryBlob, { hint: retryHint, strict: true })
      ?.retryWithFallback;
    const retryActuallySucceeded = retryResult.success && !retryHasError;

    return {
      result: retryResult,
      fallbackSucceeded: retryActuallySucceeded,
      newAgentConfig,
      newConfigId: fbId,
    };
  } finally {
    await agentFactory.removeAgent(newAgent.id);
  }
}

/**
 * Handle successful execution - memory system and auto-complete.
 */
function handleExecutionSuccess(
  ctx: OrchestratorContext,
  execution: { id: number },
  result: AgentExecutionResult,
  agentType: string,
  options: ExecutionOptions,
): void {
  const { investigationMode, autoCompleteTask, taskId } = options;

  // Memory system: timeline event + distillation
  if (result.success && investigationMode) {
    logger.info(
      { executionId: execution.id, taskId },
      '[TaskExecutor] Investigation mode: deferring agent_execution_completed timeline event to post-handler',
    );
  } else {
    const eventType = result.success ? 'agent_execution_completed' : 'agent_execution_failed';
    appendEvent({
      eventType,
      actorType: 'agent',
      actorId: agentType,
      payload: { executionId: execution.id, taskId, success: result.success },
      correlationId: `execution_${execution.id}`,
    }).catch((err) => logger.debug({ err }, '[TaskExecutor] Timeline event failed'));
  }

  if (!result.success) return;

  // Enqueue distillation
  memoryTaskQueue.enqueue('distill', { executionId: execution.id }, 1).catch((err) => {
    logger.debug({ err }, '[TaskExecutor] Distillation enqueue failed');
  });

  // Auto-complete task
  const shouldAutoComplete = autoCompleteTask !== false && taskId && !result.waitingForInput;
  if (shouldAutoComplete) {
    ctx.prisma.task
      .update({
        where: { id: taskId },
        data: { status: 'done', completedAt: new Date() },
      })
      .then(() => {
        logger.info(
          { taskId, executionId: execution.id },
          '[TaskExecutor] Task auto-completed on successful agent execution',
        );
      })
      .catch((err) => {
        logger.warn({ err, taskId }, '[TaskExecutor] Failed to auto-complete task');
      });
  }
}

/**
 * Execute a task.
 */
export async function executeTask(
  ctx: OrchestratorContext,
  task: AgentTask,
  options: ExecutionOptions,
): Promise<AgentExecutionResult> {
  // Resolve agent configuration
  let { agentConfig, resolvedAgentConfigId } = await resolveAgentConfig(ctx, options);
  const agent = agentFactory.createAgent(agentConfig);

  // Create execution resources
  const setup = await createExecutionResources(
    ctx,
    agent,
    agentConfig,
    resolvedAgentConfigId,
    task,
    options,
  );
  const { execution, state, agentInfo, fileLogger, logManager } = setup;

  // Check for shutdown
  if (ctx.isShuttingDown) {
    ctx.activeAgents.delete(execution.id);
    ctx.activeExecutions.delete(execution.id);
    fileLogger.logError('Server is shutting down, cannot start new execution');
    await fileLogger.flush();
    throw new Error('Server is shutting down, cannot start new execution');
  }

  // Setup handlers
  setupAgentHandlers(ctx, agent, setup, options);
  const cleanupLogHandler = logManager.cleanup;

  // Emit start event
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

  // Load previous output for continuation
  const previousOutput = await loadPreviousOutput(ctx, execution.id, options);
  const initialMessage = buildInitialMessage(
    agentConfig,
    previousOutput,
    options.continueFromPrevious,
  );
  state.output = initialMessage;

  await ctx.prisma.agentExecution.update({
    where: { id: execution.id },
    data: { status: 'running', startedAt: new Date(), output: initialMessage },
  });

  try {
    // Build task with context
    const taskWithAnalysis = await buildTaskWithContext(task, options);

    // Execute agent
    let result = await agent.execute(taskWithAnalysis);
    logger.info(
      `[TaskExecutor] Execution result - success: ${result.success}, waitingForInput: ${result.waitingForInput}, questionType: ${result.questionType}, question: ${result.question?.substring(0, 100)}`,
    );

    // Check for fallback need
    const { needsFallback, errorBlob } = await checkNeedsFallback(
      result,
      agentConfig.type,
      options.disableFallback,
      execution.id,
    );

    // Execute fallback if needed
    let fallbackSucceeded = false;
    if (needsFallback && !options.disableFallback) {
      const fallbackResult = await executeWithFallbackAgent(
        { ctx, execution, state, agentInfo, fileLogger, logManager, options, taskWithAnalysis },
        errorBlob,
        agentConfig,
      );

      if (fallbackResult.newAgentConfig) {
        result = fallbackResult.result;
        fallbackSucceeded = fallbackResult.fallbackSucceeded;
        agentConfig = fallbackResult.newAgentConfig;
        resolvedAgentConfigId = fallbackResult.newConfigId;
      }
    }

    // Mark as failed if fallback didn't succeed
    if (needsFallback && !fallbackSucceeded) {
      result = {
        ...result,
        success: false,
        errorMessage:
          result.errorMessage ||
          'Provider failure detected and no fallback agent completed successfully',
      };
    }

    // Save result
    await saveExecutionResult(
      ctx.prisma,
      execution.id,
      options.sessionId,
      state,
      result,
      fileLogger,
      undefined,
      { investigationMode: options.investigationMode },
    );
    emitResultEvent(result, execution.id, options.sessionId, options.taskId, (event) =>
      ctx.emitEvent(event),
    );

    // Handle success (memory, auto-complete)
    handleExecutionSuccess(ctx, execution, result, agentConfig.type, options);

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
