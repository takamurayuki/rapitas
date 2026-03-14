/**
 * Agent Execution Service
 *
 * Manages agent execution lifecycle and session management.
 */
import { PrismaClient, AgentExecution, AgentSession } from '@prisma/client';
import { orchestrator } from './orchestrator-instance';
import type {
  ExecutionRequest,
  ExecutionResult,
  AgentExecutionWithExtras,
} from '../types/agent-execution-types';
import { createLogger } from '../config/logger';
import {
  gatherSharedKnowledge,
  formatKnowledgeContext,
  updatePatternsFromExecution,
} from './agents/agent-knowledge-sharing';

const log = createLogger('agent-execution-service');

export class AgentExecutionService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /** Starts task execution with an agent. */
  async executeTask(taskId: number, request: ExecutionRequest): Promise<ExecutionResult> {
    const { agentConfigId, useTaskAnalysis = true, optimizedPrompt, sessionId } = request;

    // Fetch task info
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: true,
      },
    });

    if (!task) {
      throw new Error('タスクが見つかりません');
    }

    const session = await this.getOrCreateSession(sessionId, agentConfigId);

    await this.checkExecutionPreconditions(session.id);

    const agentConfig = await this.getAgentConfig(agentConfigId || session.configId);

    // Create DB entry before delegating to orchestrator
    const execution = await this.createExecution(session.id, agentConfig.id);

    try {
      // Delegate execution to orchestrator
      let executionInstruction = this.buildExecutionInstruction(
        task,
        optimizedPrompt,
        useTaskAnalysis,
      );

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
      // Mark execution as error in DB if startup fails
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: 'error',
          errorMessage: error instanceof Error ? error.message : '実行開始エラー',
        },
      });

      throw error;
    }
  }

  /** Returns an existing session or creates a new one. */
  private async getOrCreateSession(sessionId?: number, configId?: number): Promise<AgentSession> {
    if (sessionId) {
      const existingSession = await this.prisma.agentSession.findUnique({
        where: { id: sessionId },
      });

      if (!existingSession) {
        throw new Error('指定されたセッションが見つかりません');
      }

      return existingSession;
    }

    // Create new session
    if (!configId) {
      throw new Error('新規セッション作成にはconfigIdが必要です');
    }

    return await this.prisma.agentSession.create({
      data: {
        configId,
        startedAt: new Date(),
      },
    });
  }

  /** Retrieves an active agent configuration. */
  private async getAgentConfig(agentConfigId: number) {
    const agentConfig = await this.prisma.aIAgentConfig.findUnique({
      where: { id: agentConfigId },
    });

    if (!agentConfig || !agentConfig.isActive) {
      throw new Error('有効なエージェント設定が見つかりません');
    }

    return agentConfig;
  }

  /** Checks that no execution is already running in this session. */
  private async checkExecutionPreconditions(sessionId: number): Promise<void> {
    // Check for an already-running execution in this session
    const runningExecution = await this.prisma.agentExecution.findFirst({
      where: {
        sessionId,
        status: { in: ['running', 'pending', 'waiting_for_input'] },
      },
    });

    if (runningExecution) {
      throw new Error('この実行セッションは既に実行中です');
    }
  }

  /** Creates a new execution database entry. */
  private async createExecution(sessionId: number, agentConfigId: number): Promise<AgentExecution> {
    return await this.prisma.agentExecution.create({
      data: {
        sessionId,
        agentConfigId,
        command: `Agent execution`,
        status: 'pending',
        startedAt: new Date(),
      },
    });
  }

  /** Builds the execution instruction string from task and analysis data. */
  private buildExecutionInstruction(
    task: { description: string | null; workflowFiles?: Array<{ fileType: string }> },
    optimizedPrompt?: string,
    useTaskAnalysis?: boolean,
  ): string {
    let instruction = task.description || '';

    if (optimizedPrompt) {
      instruction = `${optimizedPrompt}\n\n元のタスク内容:\n${instruction}`;
    }

    if (useTaskAnalysis && task.workflowFiles?.some((f) => f.fileType === 'research')) {
      instruction = `## 事前調査済み\n\nこのタスクは事前調査が完了しています。ワークフローファイルを確認してください。\n\n${instruction}`;
    }

    return instruction;
  }

  /** Stops a running execution. */
  async stopExecution(executionId: number): Promise<boolean> {
    try {
      // Attempt to stop via orchestrator
      const stopped = await orchestrator.stopExecution(executionId).catch(() => false);

      // Update execution status in DB
      await this.prisma.agentExecution.update({
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

  /** Stops all executions in a session and marks it as completed. */
  async stopSession(sessionId: number): Promise<void> {
    // Stop all executions in this session via the worker process
    try {
      const { AgentWorkerManager } = await import('./agents/agent-worker-manager');
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

    // Cancel all running/pending executions in DB
    await this.prisma.agentExecution.updateMany({
      where: {
        sessionId,
        status: { in: ['running', 'pending', 'waiting_for_input'] },
      },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });

    // End session
    await this.prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        completedAt: new Date(),
        status: 'completed',
      },
    });
  }

  /** Continues or resumes a previous execution with optional additional instructions. */
  async continueExecution(
    taskId: number,
    options?: {
      additionalInstructions?: string;
      sessionId?: number;
    },
  ): Promise<ExecutionResult> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: true,
      },
    });

    if (!task) {
      throw new Error('タスクが見つかりません');
    }

    // Find previous execution to continue from
    const previousExecution = await this.prisma.agentExecution.findFirst({
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

    // Stop the previous execution if still active
    if (['running', 'pending', 'waiting_for_input'].includes(previousExecution.status)) {
      await orchestrator.stopExecution(previousExecution.id).catch((err) => {
        log.warn(
          { err, executionId: previousExecution.id },
          'Failed to stop previous execution before resume',
        );
      });
    }

    // Create new execution entry for the continuation
    const newExecution = await this.prisma.agentExecution.create({
      data: {
        sessionId: previousExecution.sessionId,
        agentConfigId: previousExecution.agentConfigId,
        command: 'continue_task',
        status: 'pending',
        startedAt: new Date(),
      },
    });

    // Build continuation instruction
    let fullInstruction = task.description || '';

    if (options?.additionalInstructions) {
      fullInstruction = `${options.additionalInstructions}\n\n${fullInstruction}`;
    }

    // Include previous execution output for context
    if (previousExecution.output) {
      const prevOutput = previousExecution.output.slice(0, 3000);
      fullInstruction = `## 前回の実行内容\n\n前回の実行で以下の作業を行いました：\n\n${prevOutput}${previousExecution.output.length > 3000 ? '\n...(省略)' : ''}\n\n${fullInstruction}`;
    }

    try {
      // Execute continuation within the same session
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
      await this.prisma.agentExecution.update({
        where: { id: newExecution.id },
        data: {
          status: 'error',
          errorMessage: error instanceof Error ? error.message : '継続実行エラー',
        },
      });

      throw error;
    }
  }

  /** Returns the execution status with related data. */
  async getExecutionStatus(executionId: number): Promise<AgentExecutionWithExtras | null> {
    return await this.prisma.agentExecution.findUnique({
      where: { id: executionId },
      include: {
        agentConfig: true,
        session: true,
        executionLogs: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });
  }

  /** Retrieves the most recent execution for a task. */
  async getLatestExecution(taskId: number): Promise<AgentExecutionWithExtras | null> {
    return await this.prisma.agentExecution.findFirst({
      where: {
        session: {
          config: {
            taskId: taskId,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
      include: {
        agentConfig: true,
        session: true,
        executionLogs: {
          orderBy: { timestamp: 'asc' },
          take: 10,
        },
      },
    });
  }

  /** Lists all currently active executions. */
  async getExecutingTasks(): Promise<AgentExecutionWithExtras[]> {
    return await this.prisma.agentExecution.findMany({
      where: {
        status: { in: ['running', 'pending', 'waiting_for_input'] },
      },
      include: {
        agentConfig: true,
        session: true,
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  /** Resets the execution state for a task, stopping and cleaning up logs. */
  async resetExecutionState(taskId: number): Promise<void> {
    const latestExecution = await this.prisma.agentExecution.findFirst({
      where: {
        session: {
          config: {
            taskId: taskId,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (!latestExecution) {
      throw new Error('リセット対象の実行が見つかりません');
    }

    // Stop if currently running
    if (['running', 'pending', 'waiting_for_input'].includes(latestExecution.status)) {
      await orchestrator.stopExecution(latestExecution.id).catch((err) => {
        log.warn({ err, executionId: latestExecution.id }, 'Failed to stop execution before reset');
      });
    }

    // Reset execution status
    await this.prisma.agentExecution.update({
      where: { id: latestExecution.id },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
      },
    });

    // Delete associated execution logs
    await this.prisma.agentExecutionLog.deleteMany({
      where: { executionId: latestExecution.id },
    });
  }

  /** Lists interrupted executions that can be resumed (within 24 hours). */
  async getResumableExecutions(): Promise<AgentExecutionWithExtras[]> {
    return await this.prisma.agentExecution.findMany({
      where: {
        status: 'interrupted',
        completedAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // within 24 hours
      },
      include: {
        agentConfig: true,
        session: true,
      },
      orderBy: { completedAt: 'desc' },
    });
  }

  /** Lists failed/interrupted/cancelled executions within the past week. */
  async getInterruptedExecutions(): Promise<AgentExecutionWithExtras[]> {
    return await this.prisma.agentExecution.findMany({
      where: {
        status: { in: ['interrupted', 'error', 'cancelled'] },
        completedAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // within 1 week
      },
      include: {
        agentConfig: true,
        session: true,
      },
      orderBy: { completedAt: 'desc' },
    });
  }
}

// Factory export
export const agentExecutionService = (prisma: PrismaClient) => new AgentExecutionService(prisma);
