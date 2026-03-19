/**
 * RecoveryManager
 *
 * Detects, recovers, and resumes interrupted executions.
 */
import { join } from 'path';
import { agentFactory } from '../agent-factory';
import type { AgentConfigInput, AgentType } from '../agent-factory';
import type { AgentTask, AgentExecutionResult } from '../base-agent';
import { decrypt } from '../../../utils/encryption';
import { ExecutionFileLogger } from '../execution-file-logger';
import { createLogger, getProjectRoot } from '../../../config';
import type {
  ExecutionState,
  ExecutionOptions,
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

const logger = createLogger('recovery-manager');

/**
 * Get interrupted executions.
 */
export async function getInterruptedExecutions(prisma: OrchestratorContext['prisma']): Promise<
  Array<{
    id: number;
    sessionId: number;
    status: string;
    claudeSessionId: string | null;
    output: string;
    createdAt: Date;
  }>
> {
  return (await prisma.agentExecution.findMany({
    where: { status: 'interrupted' },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })) as Array<{
    id: number;
    sessionId: number;
    status: string;
    claudeSessionId: string | null;
    output: string;
    createdAt: Date;
  }>;
}

/**
 * Recover stale executions on server startup.
 */
export async function recoverStaleExecutions(ctx: OrchestratorContext): Promise<{
  recoveredExecutions: number;
  updatedTasks: number;
  updatedSessions: number;
  interruptedExecutionIds: number[];
}> {
  logger.info('[RecoveryManager] Starting startup recovery of stale executions...');

  let recoveredExecutions = 0;
  let updatedTasks = 0;
  let updatedSessions = 0;
  const interruptedExecutionIds: number[] = [];

  try {
    const activeExecutionIds = Array.from(ctx.activeExecutions.values()).map((e) => e.executionId);

    const staleExecutions = await ctx.prisma.agentExecution.findMany({
      where: {
        status: { in: ['running', 'pending', 'waiting_for_input'] },
        id: { notIn: activeExecutionIds },
        createdAt: { lt: ctx.serverStartedAt },
      },
      include: {
        session: {
          include: {
            config: {
              include: {
                task: {
                  select: { id: true, title: true, status: true },
                },
              },
            },
          },
        },
      },
    });

    if (staleExecutions.length === 0) {
      logger.info('[RecoveryManager] No stale executions found. Recovery complete.');
      return {
        recoveredExecutions: 0,
        updatedTasks: 0,
        updatedSessions: 0,
        interruptedExecutionIds: [],
      };
    }

    logger.info(`[RecoveryManager] Found ${staleExecutions.length} stale executions to recover`);

    const affectedSessionIds = new Set<number>();
    const affectedTaskIds = new Set<number>();

    for (const exec of staleExecutions) {
      try {
        await ctx.prisma.agentExecution.update({
          where: { id: exec.id },
          data: {
            status: 'interrupted',
            completedAt: new Date(),
            errorMessage: `サーバー再起動により中断されました。\n\n【最後の出力】\n${(exec.output || '').slice(-1000)}`,
          },
        });
        recoveredExecutions++;
        interruptedExecutionIds.push(exec.id);

        affectedSessionIds.add(exec.sessionId);

        const taskId = exec.session?.config?.task?.id;
        if (taskId) {
          affectedTaskIds.add(taskId);
        }

        logger.info(`[RecoveryManager] Execution ${exec.id} marked as interrupted`);
      } catch (error) {
        logger.error(
          { err: error, executionId: exec.id },
          `[RecoveryManager] Failed to recover execution`,
        );
      }
    }

    for (const sessionId of affectedSessionIds) {
      try {
        const activeCount = await ctx.prisma.agentExecution.count({
          where: {
            sessionId,
            status: { in: ['running', 'pending', 'waiting_for_input'] },
          },
        });

        if (activeCount === 0) {
          await ctx.prisma.agentSession.update({
            where: { id: sessionId },
            data: {
              status: 'interrupted',
              lastActivityAt: new Date(),
            },
          });
          updatedSessions++;
          logger.info(`[RecoveryManager] Session ${sessionId} marked as interrupted`);
        }
      } catch (error) {
        logger.error({ err: error, sessionId }, `[RecoveryManager] Failed to update session`);
      }
    }

    for (const taskId of affectedTaskIds) {
      try {
        const task = await ctx.prisma.task.findUnique({
          where: { id: taskId },
          select: { id: true, status: true },
        });

        if (task && task.status === 'in-progress') {
          await ctx.prisma.task.update({
            where: { id: taskId },
            data: { status: 'todo' },
          });
          updatedTasks++;
          logger.info(`[RecoveryManager] Task ${taskId} reverted to 'todo'`);
        }
      } catch (error) {
        logger.error({ err: error, taskId }, `[RecoveryManager] Failed to update task`);
      }
    }

    if (recoveredExecutions > 0) {
      try {
        await ctx.prisma.notification.create({
          data: {
            type: 'agent_execution_interrupted',
            title: 'サーバー再起動による中断',
            message: `サーバー再起動により${recoveredExecutions}件のエージェント実行が中断されました。バナーから再開できます。`,
            link: '/',
            metadata: JSON.stringify({
              recoveredExecutions,
              updatedTasks,
              updatedSessions,
            }),
          },
        });
      } catch (error) {
        logger.error({ err: error }, '[RecoveryManager] Failed to create recovery notification');
      }
    }

    logger.info(
      `[RecoveryManager] Recovery complete: ${recoveredExecutions} executions, ${updatedTasks} tasks, ${updatedSessions} sessions updated`,
    );
  } catch (error) {
    logger.error({ err: error }, '[RecoveryManager] Startup recovery failed');
  }

  return {
    recoveredExecutions,
    updatedTasks,
    updatedSessions,
    interruptedExecutionIds,
  };
}

/**
 * Resume an interrupted execution.
 */
export async function resumeInterruptedExecution(
  ctx: OrchestratorContext,
  executionId: number,
  options: Partial<ExecutionOptions> = {},
): Promise<AgentExecutionResult> {
  const execution = await ctx.prisma.agentExecution.findUnique({
    where: { id: executionId },
    include: {
      session: {
        include: {
          config: {
            include: {
              task: {
                include: { theme: true },
              },
            },
          },
        },
      },
      executionLogs: {
        orderBy: { sequenceNumber: 'asc' },
      },
    },
  });

  if (!execution) {
    throw new Error(`Execution not found: ${executionId}`);
  }

  if (execution.status !== 'interrupted') {
    throw new Error(`Execution is not in interrupted state: ${execution.status}`);
  }

  const task = execution.session.config?.task;
  if (!task) {
    throw new Error(`Task not found for execution: ${executionId}`);
  }

  // CRITICAL: Require explicit workingDirectory to prevent accidental modification of rapitas source
  const workingDirectory =
    task.theme?.workingDirectory || options.workingDirectory;
  if (!workingDirectory) {
    throw new Error(
      `Task ${task.id} rejected: workingDirectory not configured for theme "${task.theme?.name || 'unknown'}". Please set the working directory in theme settings.`,
    );
  }
  const projectRoot = getProjectRoot();
  if (workingDirectory === projectRoot || workingDirectory.startsWith(join(projectRoot, 'rapitas-'))) {
    throw new Error(
      `Task ${task.id} rejected: workingDirectory points to rapitas project itself (${workingDirectory}).`,
    );
  }
  const claudeSessionId = execution.claudeSessionId;

  logger.info(`[RecoveryManager] Resuming interrupted execution ${executionId}`);
  logger.info(`[RecoveryManager] Task: ${task.title} (ID: ${task.id})`);
  logger.info(
    `[RecoveryManager] Claude Session ID: ${claudeSessionId || '(なし - 新規セッションで開始)'}`,
  );
  logger.info(`[RecoveryManager] Working Directory: ${workingDirectory}`);

  if (!claudeSessionId) {
    logger.warn(
      `[RecoveryManager] WARNING: No Claude session ID found for execution ${executionId}. Starting as new session.`,
    );
  }

  const previousOutput = execution.output || '';
  const lastOutput = previousOutput.slice(-3000);

  const logSummary = execution.executionLogs
    .slice(-50)
    .map((log: { logChunk: string }) => log.logChunk)
    .join('');

  const resumePrompt = buildResumePrompt(
    task,
    lastOutput,
    logSummary.slice(-2000),
    execution.errorMessage,
  );

  let agentConfig: AgentConfigInput = {
    type: 'claude-code',
    name: 'Claude Code Agent',
    workingDirectory,
    timeout: options.timeout || 900000,
    dangerouslySkipPermissions: true,
    resumeSessionId: claudeSessionId || undefined,
    continueConversation: false,
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
            `[RecoveryManager] Failed to decrypt API key for agent`,
          );
        }
      }

      agentConfig = {
        type: (dbConfig.agentType as AgentType) || 'claude-code',
        name: dbConfig.name,
        endpoint: dbConfig.endpoint || undefined,
        apiKey: decryptedApiKey,
        modelId: dbConfig.modelId || undefined,
        workingDirectory,
        timeout: options.timeout || 900000,
        dangerouslySkipPermissions: true,
        yoloMode: true,
        resumeSessionId: claudeSessionId || undefined,
        continueConversation: false,
      };
    }
  }

  const agent = agentFactory.createAgent(agentConfig);
  const taskId = task.id;

  const fileLogger = new ExecutionFileLogger(
    execution.id,
    execution.sessionId,
    taskId,
    task.title,
    agentConfig.type,
    agentConfig.name,
    agentConfig.modelId,
  );
  fileLogger.logExecutionStart(`[Resume] Resuming interrupted execution`, {
    claudeSessionId,
    workingDirectory,
    previousOutputLength: previousOutput.length,
    errorMessage: execution.errorMessage,
  });

  const state: ExecutionState = {
    executionId: execution.id,
    sessionId: execution.sessionId,
    agentId: agent.id,
    taskId,
    status: 'running',
    startedAt: new Date(),
    output: previousOutput,
  };
  ctx.activeExecutions.set(execution.id, state);

  const agentInfo: ActiveAgentInfo = {
    agent,
    executionId: execution.id,
    sessionId: execution.sessionId,
    taskId,
    state,
    lastOutput: lastOutput,
    lastSavedAt: new Date(),
    fileLogger,
  };
  ctx.activeAgents.set(execution.id, agentInfo);

  if (ctx.isShuttingDown) {
    ctx.activeAgents.delete(execution.id);
    ctx.activeExecutions.delete(execution.id);
    fileLogger.logError('Server is shutting down, cannot resume execution');
    await fileLogger.flush();
    throw new Error('Server is shutting down, cannot resume execution');
  }

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

  const existingLogs = await ctx.prisma.agentExecutionLog.findMany({
    where: { executionId: execution.id },
    orderBy: { sequenceNumber: 'desc' },
    take: 1,
  });

  const logManager = createLogChunkManager({
    prisma: ctx.prisma,
    executionId: execution.id,
    initialSequenceNumber: existingLogs.length > 0 ? existingLogs[0].sequenceNumber + 1 : 0,
  });

  const cleanupLogHandler = logManager.cleanup;

  setupOutputHandler(
    agent,
    {
      prisma: ctx.prisma,
      executionId: execution.id,
      sessionId: execution.sessionId,
      taskId,
      state,
      agentInfo,
      fileLogger,
      onOutput: options.onOutput,
      emitEvent: (event) => ctx.emitEvent(event),
    },
    logManager,
  );

  const resumeMessage = `\n[再開] 中断された作業を再開します...\n`;
  state.output += resumeMessage;

  await ctx.prisma.agentExecution.update({
    where: { id: execution.id },
    data: {
      status: 'running',
      errorMessage: null,
      output: state.output,
    },
  });

  ctx.emitEvent({
    type: 'execution_started',
    executionId: execution.id,
    sessionId: execution.sessionId,
    taskId,
    data: { resumed: true },
    timestamp: new Date(),
  });

  try {
    const agentTask: AgentTask = {
      id: taskId,
      title: task.title,
      description: resumePrompt,
      workingDirectory,
    };

    const result = await agent.execute(agentTask);

    await saveExecutionResult(
      ctx.prisma,
      execution.id,
      execution.sessionId,
      state,
      result,
      fileLogger,
      {
        artifacts: execution.artifacts,
        tokensUsed: execution.tokensUsed,
        executionTimeMs: execution.executionTimeMs,
        claudeSessionId: execution.claudeSessionId,
      },
    );
    emitResultEvent(result, execution.id, execution.sessionId, taskId, (event) =>
      ctx.emitEvent(event),
    );

    return result;
  } catch (error) {
    await handleExecutionError(
      ctx.prisma,
      execution.id,
      execution.sessionId,
      taskId,
      state,
      error,
      fileLogger,
      (event) => ctx.emitEvent(event),
      'Resume execution',
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
 * Build a resume prompt with context from the previous execution.
 */
export function buildResumePrompt(
  task: { title: string; description: string | null },
  lastOutput: string,
  logSummary: string,
  errorMessage: string | null,
): string {
  let prompt = `# 作業再開

このタスクは以前のセッションで中断されました。作業を途中から再開してください。

## タスク情報
- タイトル: ${task.title}
- 説明: ${task.description || 'なし'}

## 前回の作業状況
以下は中断前の出力の最後の部分です：

\`\`\`
${lastOutput}
\`\`\`
`;

  if (errorMessage) {
    prompt += `
## 中断理由
${errorMessage}
`;
  }

  prompt += `
## 指示
上記の情報を基に、中断されたタスクを続行してください。
- 既に完了した作業は繰り返さないでください
- 中断された地点から作業を再開してください
- 不明な点があれば質問してください
`;

  return prompt;
}
