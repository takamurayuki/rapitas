/**
 */

import { PrismaClient } from '@prisma/client';
type PrismaClientInstance = InstanceType<typeof PrismaClient>;
import { EventEmitter } from 'events';
import { DependencyAnalyzer, createDependencyAnalyzer } from './dependency-analyzer';
import { ParallelScheduler, createParallelScheduler } from './parallel-scheduler';
import { SubAgentController, createSubAgentController } from './sub-agent-controller';
import { LogAggregator, LogFormatter, createLogAggregator } from './log-aggregator';
import { AgentCoordinator, createAgentCoordinator } from './agent-coordinator';
import { GitOperations } from '../agents/orchestrator/git-operations';
import type {
  DependencyAnalysisInput,
  DependencyAnalysisResult,
  ParallelExecutionPlan,
  ParallelExecutionSession,
  ParallelExecutionStatus,
  ParallelExecutionConfig,
  TaskNode,
  ExecutionLogEntry,
} from './types';
import type { AgentTask, AgentExecutionResult } from '../agents/base-agent';
import { createLogger } from '../../config/logger';

const logger = createLogger('parallel-executor');

/**
 */
function formatCoordinatorPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return String(payload ?? '');

  const obj = payload as Record<string, unknown>;
  const parts: string[] = [];

  const msg = obj.message || obj.msg || obj.description;
  if (msg && typeof msg === 'string') parts.push(msg);

  if (obj.status && typeof obj.status === 'string') parts.push(`status=${obj.status}`);

  if (obj.taskId) parts.push(`task=${obj.taskId}`);
  if (obj.agentId && typeof obj.agentId === 'string') parts.push(`agent=${obj.agentId}`);

  if (obj.error && typeof obj.error === 'string') parts.push(`error: ${obj.error}`);

  const skipKeys = new Set([
    'message',
    'msg',
    'description',
    'status',
    'taskId',
    'agentId',
    'error',
    'timestamp',
  ]);
  for (const [key, value] of Object.entries(obj)) {
    if (skipKeys.has(key) || value === null || value === undefined) continue;
    if (typeof value === 'object') {
      parts.push(`${key}=${JSON.stringify(value)}`);
    } else {
      parts.push(`${key}=${value}`);
    }
  }

  return parts.length > 0 ? parts.join(', ') : JSON.stringify(payload).slice(0, 200);
}

/**
 */
type ParallelExecutionEvent = {
  type:
    | 'session_started'
    | 'session_completed'
    | 'session_failed'
    | 'task_started'
    | 'task_completed'
    | 'task_failed'
    | 'level_started'
    | 'level_completed'
    | 'progress_updated';
  sessionId: string;
  taskId?: number;
  level?: number;
  data?: unknown;
  timestamp: Date;
};

type ParallelExecutionEventListener = (event: ParallelExecutionEvent) => void;

/**
 * Default settings
 */
const DEFAULT_CONFIG: ParallelExecutionConfig = {
  maxConcurrentAgents: 3,
  questionTimeoutSeconds: 300,
  taskTimeoutSeconds: 300,
  retryOnFailure: true,
  maxRetries: 2,
  logSharing: true,
  coordinationEnabled: true,
};

/**
 * DB（）
 */
class DatabaseMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.locked = false;
    }
  }
}

/**
 * DB
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 100,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isRetryable =
        lastError.message.includes('Socket timeout') ||
        lastError.message.includes('deadlock detected') ||
        lastError.message.includes('could not serialize access');

      if (!isRetryable || attempt === maxRetries - 1) {
        throw lastError;
      }

      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 100;
      logger.info(
        `[ParallelExecutor] DB operation failed, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// DB
const dbMutex = new DatabaseMutex();

/**
 */
export class ParallelExecutor extends EventEmitter {
  private config: ParallelExecutionConfig;
  private analyzer: DependencyAnalyzer;
  private agentController: SubAgentController;
  private logAggregator: LogAggregator;
  private coordinator: AgentCoordinator;
  private gitOps: GitOperations;

  private sessions: Map<string, ParallelExecutionSession> = new Map();
  private schedulers: Map<string, ParallelScheduler> = new Map();
  /** Tracks worktree paths per task for cleanup (taskId -> worktreePath) */
  private taskWorktrees: Map<number, string> = new Map();

  // Prisma
  private prisma: PrismaClientInstance;

  constructor(prisma: PrismaClientInstance, config?: Partial<ParallelExecutionConfig>) {
    super();
    this.prisma = prisma;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.analyzer = createDependencyAnalyzer();
    this.agentController = createSubAgentController(this.config);
    this.logAggregator = createLogAggregator();
    this.coordinator = createAgentCoordinator();
    this.gitOps = new GitOperations();

    this.setupEventHandlers();
  }

  // Tracking（executionId -> sequenceNumber）
  private logSequenceNumbers: Map<number, number> = new Map();

  /**
   */
  private setupEventHandlers(): void {
    // OutputDB
    this.agentController.on('agent_output', async (data) => {
      this.logAggregator.addLog({
        timestamp: data.timestamp,
        agentId: data.agentId,
        taskId: data.taskId,
        level: data.isError ? 'error' : 'info',
        message: data.chunk,
      });

      // DB
      try {
        const sequenceNumber = this.logSequenceNumbers.get(data.executionId) || 0;
        this.logSequenceNumbers.set(data.executionId, sequenceNumber + 1);

        await this.prisma.agentExecutionLog.create({
          data: {
            executionId: data.executionId,
            logChunk: data.chunk,
            logType: data.isError ? 'stderr' : 'stdout',
            sequenceNumber,
            timestamp: data.timestamp,
          },
        });
      } catch (error) {
        logger.error({ err: error }, '[ParallelExecutor] Failed to save execution log');
      }

      this.emitEvent({
        type: 'progress_updated',
        sessionId: '',
        taskId: data.taskId,
        timestamp: data.timestamp,
        data: {
          output: data.chunk,
          isError: data.isError,
          executionId: data.executionId,
        },
      });
    });

    this.agentController.on('task_completed', (data) => {
      const session = this.findSessionByTaskId(data.taskId);
      if (session) {
        this.handleTaskCompletion(session.sessionId, data.taskId, data.result);
      }
    });

    this.agentController.on('task_failed', (data) => {
      const session = this.findSessionByTaskId(data.taskId);
      if (session) {
        this.handleTaskFailure(
          session.sessionId,
          data.taskId,
          data.error || data.result?.errorMessage,
        );
      }
    });

    this.coordinator.on('message', (message) => {
      this.logAggregator.addLog({
        timestamp: message.timestamp,
        agentId: message.fromAgentId,
        taskId: 0,
        level: 'debug',
        message: `[${message.type}] ${formatCoordinatorPayload(message.payload)}`,
      });
    });
  }

  /**
   * ID
   */
  private findSessionByTaskId(taskId: number): ParallelExecutionSession | undefined {
    for (const session of this.sessions.values()) {
      const allTaskIds = session.plan.groups.flatMap((g) => g.taskIds);
      if (allTaskIds.includes(taskId)) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * Dependencies
   */
  async analyzeDependencies(input: DependencyAnalysisInput): Promise<DependencyAnalysisResult> {
    logger.info(`[ParallelExecutor] Analyzing dependencies for parent task ${input.parentTaskId}`);
    logger.info(`[ParallelExecutor] Subtasks: ${input.subtasks.length}`);

    const result = this.analyzer.analyze({
      ...input,
      config: this.config,
    });

    logger.info(`[ParallelExecutor] Analysis complete:`);
    logger.info(`[ParallelExecutor] - Parallel groups: ${result.plan.groups.length}`);
    logger.info(`[ParallelExecutor] - Critical path length: ${result.treeMap.criticalPath.length}`);
    logger.info(`[ParallelExecutor] - Parallel efficiency: ${result.plan.parallelEfficiency}%`);

    return result;
  }

  /**
   * Parallel execution session
   */
  async startSession(
    parentTaskId: number,
    plan: ParallelExecutionPlan,
    nodes: Map<number, TaskNode>,
    workingDirectory: string,
  ): Promise<ParallelExecutionSession> {
    const sessionId = `session-${parentTaskId}-${Date.now()}`;

    logger.info(`[ParallelExecutor] Starting session ${sessionId}`);
    logger.info(`[ParallelExecutor] Total tasks: ${plan.groups.flatMap((g) => g.taskIds).length}`);
    logger.info(`[ParallelExecutor] Max concurrency: ${this.config.maxConcurrentAgents}`);

    const scheduler = createParallelScheduler(plan, nodes, this.config);
    this.schedulers.set(sessionId, scheduler);

    const session: ParallelExecutionSession = {
      sessionId,
      parentTaskId,
      plan,
      status: 'running',
      currentLevel: 0,
      activeAgents: new Map(),
      completedTasks: [],
      failedTasks: [],
      nodes,
      workingDirectory,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      totalTokensUsed: 0,
      totalExecutionTimeMs: 0,
    };

    this.sessions.set(sessionId, session);

    // Dependencies
    for (const node of nodes.values()) {
      this.coordinator.registerDependency(node.id, node.dependencies);
    }

    this.emitEvent({
      type: 'session_started',
      sessionId,
      timestamp: new Date(),
      data: {
        parentTaskId,
        totalTasks: plan.groups.flatMap((g) => g.taskIds).length,
        estimatedDuration: plan.estimatedTotalDuration,
      },
    });

    scheduler.addEventListener((event) => {
      if (event.type === 'level_completed') {
        this.emitEvent({
          type: 'level_completed',
          sessionId,
          level: event.level,
          timestamp: event.timestamp,
        });
      } else if (event.type === 'all_completed') {
        this.completeSession(sessionId);
      }
    });

    // （API）
    // setImmediate
    setImmediate(() => {
      this.executeNextBatch(sessionId, nodes, workingDirectory).catch((error) => {
        logger.error({ err: error }, '[ParallelExecutor] Error in executeNextBatch');
        const session = this.sessions.get(sessionId);
        if (session && session.status === 'running') {
          session.status = 'failed';
          session.completedAt = new Date();
          this.emitEvent({
            type: 'session_failed',
            sessionId,
            timestamp: new Date(),
            data: {
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
      });
    });

    return session;
  }

  /**
   */
  private async executeNextBatch(
    sessionId: string,
    nodes: Map<number, TaskNode>,
    workingDirectory: string,
  ): Promise<void> {
    const scheduler = this.schedulers.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!scheduler || !session || session.status !== 'running') {
      return;
    }

    const executableTasks = scheduler.getNextExecutableTasks();

    if (executableTasks.length === 0) {
      if (this.agentController.getActiveAgentCount() === 0) {
        this.completeSession(sessionId);
      }
      return;
    }

    logger.info(`[ParallelExecutor] Executing batch of ${executableTasks.length} tasks`);

    const promises: Promise<void>[] = [];

    for (const taskId of executableTasks) {
      const node = nodes.get(taskId);
      if (!node) continue;

      if (!scheduler.startTask(taskId)) {
        logger.warn(`[ParallelExecutor] Failed to start task ${taskId}`);
        continue;
      }

      // DBAgentExecution
      promises.push(this.executeTask(sessionId, taskId, node, workingDirectory));
    }

    await Promise.all(promises);
  }

  /**
   */
  private async executeTask(
    sessionId: string,
    taskId: number,
    node: TaskNode,
    workingDirectory: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    logger.info(`[ParallelExecutor] Starting task ${taskId}: ${node.title}`);

    try {
      // NOTE: Create isolated worktree for this task to prevent git conflicts
      let taskWorkDir = workingDirectory;
      try {
        const branchName = `feature/task-${taskId}-parallel`;
        taskWorkDir = await this.gitOps.createWorktree(workingDirectory, branchName, taskId);
        this.taskWorktrees.set(taskId, taskWorkDir);
        logger.info(`[ParallelExecutor] Created worktree for task ${taskId}: ${taskWorkDir}`);
      } catch (wtError) {
        logger.error(
          { err: wtError },
          `[ParallelExecutor] Worktree creation failed for task ${taskId}, using shared directory`,
        );
        // HACK(agent): Fallback to shared directory if worktree creation fails
        taskWorkDir = workingDirectory;
      }

      // AgentExecutionDB（）
      await dbMutex.acquire();
      let agentSession;
      let execution;
      try {
        agentSession = await withRetry(async () => {
          return await this.prisma.agentSession.findFirst({
            where: {
              config: {
                taskId: session.parentTaskId,
              },
            },
            orderBy: { createdAt: 'desc' },
          });
        });

        if (!agentSession) {
          throw new Error(`No agent session found for parent task ${session.parentTaskId}`);
        }

        execution = await withRetry(async () => {
          return await this.prisma.agentExecution.create({
            data: {
              sessionId: agentSession!.id,
              command: node.description || node.title,
              status: 'running',
              startedAt: new Date(),
            },
          });
        });
      } finally {
        dbMutex.release();
      }

      const agentId = this.agentController.createAgent(taskId, execution.id, taskWorkDir);

      session.activeAgents.set(agentId, {
        agentId,
        taskId,
        executionId: execution.id,
        status: 'running',
        startedAt: new Date(),
        lastActivityAt: new Date(),
        output: '',
        artifacts: [],
        tokensUsed: 0,
        executionTimeMs: 0,
        watingForInput: false,
      });

      this.emitEvent({
        type: 'task_started',
        sessionId,
        taskId,
        timestamp: new Date(),
      });

      // DB（）
      try {
        await dbMutex.acquire();
        await withRetry(async () => {
          await this.prisma.task.update({
            where: { id: taskId },
            data: { status: 'in-progress' },
          });
        });
        logger.info(`[ParallelExecutor] Updated task ${taskId} status to 'in-progress'`);
      } catch (error) {
        logger.error({ err: error }, '[ParallelExecutor] Failed to update task status');
      } finally {
        dbMutex.release();
      }

      // ID（）
      let previousSessionId: string | null = null;
      try {
        const previousExecution = await this.prisma.agentExecution.findFirst({
          where: {
            session: {
              config: {
                taskId: taskId, // The subtask's own ID
              },
            },
            claudeSessionId: { not: null },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (previousExecution?.claudeSessionId) {
          previousSessionId = previousExecution.claudeSessionId;
          logger.info(
            `[ParallelExecutor] Found previous session for task ${taskId}: ${previousSessionId}`,
          );
        }
      } catch (error) {
        logger.info(`[ParallelExecutor] No previous session found for task ${taskId}`);
      }

      const task: AgentTask = {
        id: taskId,
        title: node.title,
        description: node.description,
        workingDirectory: taskWorkDir,
        resumeSessionId: previousSessionId || undefined,
      };

      const result = await this.agentController.executeTask(agentId, task);

      // DB（）
      try {
        await dbMutex.acquire();
        // 'waiting_for_input'
        const executionStatus = result.waitingForInput
          ? 'waiting_for_input'
          : result.success
            ? 'completed'
            : 'failed';
        await withRetry(async () => {
          await this.prisma.agentExecution.update({
            where: { id: execution.id },
            data: {
              status: executionStatus,
              output: result.output,
              completedAt: result.waitingForInput ? null : new Date(),
              tokensUsed: result.tokensUsed || 0,
              executionTimeMs: result.executionTimeMs,
              errorMessage: result.errorMessage,
              claudeSessionId: result.claudeSessionId || null,
            },
          });
        });
        logger.info(
          `[ParallelExecutor] Saved execution status for task ${taskId}: ${executionStatus}, claudeSessionId: ${result.claudeSessionId || 'none'}`,
        );
      } finally {
        dbMutex.release();
      }

      if (result.waitingForInput) {
        logger.info(`[ParallelExecutor] Task ${taskId} is waiting for user input`);
        logger.info(`[ParallelExecutor] Question: ${result.question?.substring(0, 200)}`);

        // DB
        try {
          await dbMutex.acquire();
          await withRetry(async () => {
            await this.prisma.task.update({
              where: { id: taskId },
              data: { status: 'waiting' },
            });
          });
          logger.info(`[ParallelExecutor] Updated task ${taskId} status to 'waiting'`);
        } catch (error) {
          logger.error({ err: error }, '[ParallelExecutor] Failed to update task status');
        } finally {
          dbMutex.release();
        }

        this.emitEvent({
          type: 'task_failed', // Emitted as 'task_failed' so the UI can display the question
          sessionId,
          taskId,
          timestamp: new Date(),
          data: {
            waitingForInput: true,
            question: result.question,
            questionDetails: result.questionDetails,
            claudeSessionId: result.claudeSessionId,
          },
        });

        return;
      }

      if (result.success) {
        this.handleTaskCompletion(sessionId, taskId, result);
      } else {
        this.handleTaskFailure(sessionId, taskId, result.errorMessage);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ errorMessage }, `[ParallelExecutor] Task ${taskId} failed`);
      this.handleTaskFailure(sessionId, taskId, errorMessage);
    }
  }

  /**
   */
  private async handleTaskCompletion(
    sessionId: string,
    taskId: number,
    result: AgentExecutionResult,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    const scheduler = this.schedulers.get(sessionId);

    if (!session || !scheduler) return;

    logger.info(`[ParallelExecutor] Task ${taskId} completed`);

    scheduler.completeTask(taskId);

    // Dependencies
    this.coordinator.resolveDependency(taskId);

    session.completedTasks.push(taskId);
    session.lastActivityAt = new Date();
    session.totalTokensUsed += result.tokensUsed || 0;
    session.totalExecutionTimeMs += result.executionTimeMs || 0;

    // NOTE: Clean up worktree after successful execution (branch is preserved on remote)
    await this.cleanupTaskWorktree(taskId, session.workingDirectory);

    // DB（）
    try {
      await dbMutex.acquire();
      await withRetry(async () => {
        await this.prisma.task.update({
          where: { id: taskId },
          data: {
            status: 'done',
            actualHours: result.executionTimeMs ? result.executionTimeMs / 3600000 : undefined,
          },
        });
      });
      logger.info(`[ParallelExecutor] Updated task ${taskId} status to 'done'`);
    } catch (error) {
      logger.error({ err: error }, '[ParallelExecutor] Failed to update task status');
    } finally {
      dbMutex.release();
    }

    this.emitEvent({
      type: 'task_completed',
      sessionId,
      taskId,
      timestamp: new Date(),
      data: {
        executionTimeMs: result.executionTimeMs,
        tokensUsed: result.tokensUsed,
      },
    });

    const status = scheduler.getStatus();
    this.emitEvent({
      type: 'progress_updated',
      sessionId,
      timestamp: new Date(),
      data: {
        progress: status.progress,
        completed: status.completed.length,
        running: status.running.length,
        pending: status.pending.length,
        failed: status.failed.length,
      },
    });

    // （nodes/workingDirectory）
    await this.executeNextBatch(sessionId, session.nodes, session.workingDirectory);
  }

  /**
   */
  private async handleTaskFailure(
    sessionId: string,
    taskId: number,
    errorMessage?: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    const scheduler = this.schedulers.get(sessionId);

    if (!session || !scheduler) return;

    logger.error(`[ParallelExecutor] Task ${taskId} failed: ${errorMessage}`);

    scheduler.failTask(taskId);

    session.failedTasks.push(taskId);
    session.lastActivityAt = new Date();

    // DB（）
    try {
      await dbMutex.acquire();
      await withRetry(async () => {
        await this.prisma.task.update({
          where: { id: taskId },
          data: { status: 'todo' },
        });
      });
      logger.info(`[ParallelExecutor] Reverted task ${taskId} status to 'todo' due to failure`);
    } catch (error) {
      logger.error({ err: error }, '[ParallelExecutor] Failed to update task status');
    } finally {
      dbMutex.release();
    }

    this.emitEvent({
      type: 'task_failed',
      sessionId,
      taskId,
      timestamp: new Date(),
      data: { errorMessage },
    });

    // Retry configuration（）
    const status = scheduler.getStatus();
    this.emitEvent({
      type: 'progress_updated',
      sessionId,
      timestamp: new Date(),
      data: {
        progress: status.progress,
        completed: status.completed.length,
        running: status.running.length,
        pending: status.pending.length,
        failed: status.failed.length,
      },
    });

    await this.executeNextBatch(sessionId, session.nodes, session.workingDirectory);
  }

  /**
   */
  private completeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const success = session.failedTasks.length === 0;
    session.status = success ? 'completed' : 'failed';
    session.completedAt = new Date();

    logger.info(`[ParallelExecutor] Session ${sessionId} ${session.status}`);
    logger.info(`[ParallelExecutor] - Completed: ${session.completedTasks.length}`);
    logger.info(`[ParallelExecutor] - Failed: ${session.failedTasks.length}`);
    logger.info(`[ParallelExecutor] - Total time: ${session.totalExecutionTimeMs}ms`);

    this.emitEvent({
      type: success ? 'session_completed' : 'session_failed',
      sessionId,
      timestamp: new Date(),
      data: {
        completedTasks: session.completedTasks.length,
        failedTasks: session.failedTasks.length,
        totalTokensUsed: session.totalTokensUsed,
        totalExecutionTimeMs: session.totalExecutionTimeMs,
      },
    });
  }

  /**
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    logger.info(`[ParallelExecutor] Stopping session ${sessionId}`);

    for (const [agentId] of session.activeAgents) {
      this.agentController.stopAgent(agentId);
    }

    session.status = 'cancelled';
    session.completedAt = new Date();

    this.emitEvent({
      type: 'session_failed',
      sessionId,
      timestamp: new Date(),
      data: { reason: 'cancelled' },
    });
  }

  /**
   */
  getSessionStatus(sessionId: string): {
    status: ParallelExecutionStatus;
    progress: number;
    completed: number[];
    running: number[];
    pending: number[];
    failed: number[];
    blocked: number[];
  } | null {
    const session = this.sessions.get(sessionId);
    const scheduler = this.schedulers.get(sessionId);

    if (!session || !scheduler) return null;

    const schedulerStatus = scheduler.getStatus();

    return {
      status: session.status,
      progress: schedulerStatus.progress,
      completed: schedulerStatus.completed,
      running: schedulerStatus.running,
      pending: schedulerStatus.pending,
      failed: schedulerStatus.failed,
      blocked: schedulerStatus.blocked,
    };
  }

  /**
   */
  getLogs(filter?: {
    sessionId?: string;
    taskId?: number;
    level?: ('debug' | 'info' | 'warn' | 'error')[];
    limit?: number;
  }): ExecutionLogEntry[] {
    return this.logAggregator.query(
      {
        taskIds: filter?.taskId ? [filter.taskId] : undefined,
        levels: filter?.level,
      },
      filter?.limit,
    );
  }

  /**
   */
  private emitEvent(event: ParallelExecutionEvent): void {
    this.emit('event', event);
    this.emit(event.type, event);
  }

  /**
   */
  addEventListener(listener: ParallelExecutionEventListener): void {
    this.on('event', listener);
  }

  /**
   */
  removeEventListener(listener: ParallelExecutionEventListener): void {
    this.off('event', listener);
  }

  /**
   * Clean up worktree for a specific task.
   *
   * @param taskId - Task whose worktree to remove / 削除対象のタスクID
   * @param baseDir - Main repository root / メインリポジトリルート
   */
  private async cleanupTaskWorktree(taskId: number, baseDir: string): Promise<void> {
    const worktreePath = this.taskWorktrees.get(taskId);
    if (!worktreePath) return;

    try {
      await this.gitOps.removeWorktree(baseDir, worktreePath);
      this.taskWorktrees.delete(taskId);
      logger.info(`[ParallelExecutor] Cleaned up worktree for task ${taskId}: ${worktreePath}`);
    } catch (error) {
      logger.warn(
        { err: error },
        `[ParallelExecutor] Failed to cleanup worktree for task ${taskId}`,
      );
    }
  }

  /**
   * Clean up.
   */
  cleanup(): void {
    this.agentController.stopAllAgents();
    this.sessions.clear();
    this.schedulers.clear();
    this.coordinator.reset();
    this.taskWorktrees.clear();
  }
}

/**
 */
export function createParallelExecutor(
  prisma: PrismaClientInstance,
  config?: Partial<ParallelExecutionConfig>,
): ParallelExecutor {
  return new ParallelExecutor(prisma, config);
}
