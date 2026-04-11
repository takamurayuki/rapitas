/**
 * ParallelExecutor
 *
 * Orchestrates parallel execution of agent tasks: dependency analysis, session lifecycle,
 * and event routing. Delegates batch scheduling to session-manager.ts, task execution to
 * task-runner.ts, DB utilities to db-utils.ts, and event wiring to event-handlers.ts.
 */

import { PrismaClient } from '@prisma/client';
type PrismaClientInstance = InstanceType<typeof PrismaClient>;
import { EventEmitter } from 'events';
import { DependencyAnalyzer, createDependencyAnalyzer } from './dependency-analyzer';
import { ParallelScheduler, createParallelScheduler } from './parallel-scheduler';
import { SubAgentController, createSubAgentController } from './sub-agent-controller';
import { LogAggregator, createLogAggregator } from './log-aggregator';
import { AgentCoordinator, createAgentCoordinator } from './agent-coordinator';
import { ConflictDetector } from './conflict-detector';
import { MergeValidator } from './merge-validator';
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
} from './types-dir/types';
import { createLogger } from '../../config/logger';
import {
  DEFAULT_CONFIG,
  type ParallelExecutionEvent,
  type ParallelExecutionEventListener,
} from './types-dir/executor-types';
import { type TaskRunnerContext } from './task-runner';
import { executeNextBatch, completeSession, type SessionManagerContext } from './session-manager';
import { setupEventHandlers } from './event-handlers';

const logger = createLogger('parallel-executor');

/**
 * Orchestrates parallel execution of agent sub-tasks within a session.
 */
export class ParallelExecutor extends EventEmitter {
  private config: ParallelExecutionConfig;
  private analyzer: DependencyAnalyzer;
  private agentController: SubAgentController;
  private logAggregator: LogAggregator;
  private coordinator: AgentCoordinator;
  private gitOps: GitOperations;
  private conflictDetector: ConflictDetector;
  private mergeValidator: MergeValidator;

  private sessions: Map<string, ParallelExecutionSession> = new Map();
  private schedulers: Map<string, ParallelScheduler> = new Map();
  /** Tracks worktree paths per task for cleanup (taskId -> worktreePath) */
  private taskWorktrees: Map<number, string> = new Map();
  private logSequenceNumbers: Map<number, number> = new Map();
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
    this.conflictDetector = new ConflictDetector(this.coordinator, {
      enabled: this.config.safetyCheckEnabled !== false,
      pollingIntervalMs: this.config.conflictPollingIntervalMs,
      pauseOnCritical: this.config.pauseOnCriticalConflict,
    });
    this.mergeValidator = new MergeValidator();

    setupEventHandlers({
      prisma: this.prisma,
      agentController: this.agentController,
      logAggregator: this.logAggregator,
      coordinator: this.coordinator,
      logSequenceNumbers: this.logSequenceNumbers,
      sessions: this.sessions,
      emitEvent: (event) => this.emitEvent(event),
      buildRunnerContext: () => this.buildRunnerContext(),
    });
  }

  /** Build the TaskRunnerContext for use in task-runner functions. */
  private buildRunnerContext(): TaskRunnerContext {
    return {
      sessions: this.sessions,
      schedulers: this.schedulers,
      taskWorktrees: this.taskWorktrees,
      agentController: this.agentController,
      logAggregator: this.logAggregator,
      coordinator: this.coordinator,
      conflictDetector: this.conflictDetector,
      gitOps: this.gitOps,
      logSequenceNumbers: this.logSequenceNumbers,
      prisma: this.prisma,
      emitEvent: (event) => this.emitEvent(event),
      executeNextBatch: (sessionId, nodes, workingDirectory) =>
        executeNextBatch(this.buildSessionManagerContext(), sessionId, nodes, workingDirectory),
    };
  }

  /** Build the SessionManagerContext for use in session-manager functions. */
  private buildSessionManagerContext(): SessionManagerContext {
    return {
      sessions: this.sessions,
      schedulers: this.schedulers,
      agentController: this.agentController,
      coordinator: this.coordinator,
      mergeValidator: this.mergeValidator,
      conflictDetector: this.conflictDetector,
      config: this.config,
      emitEvent: (event) => this.emitEvent(event),
      buildRunnerContext: () => this.buildRunnerContext(),
    };
  }

  /**
   * Analyze task dependencies and produce an execution plan.
   * @param input - Dependency analysis input / 依存関係解析の入力
   * @returns Analysis result including execution plan and tree map
   */
  async analyzeDependencies(input: DependencyAnalysisInput): Promise<DependencyAnalysisResult> {
    logger.info(`[ParallelExecutor] Analyzing dependencies for parent task ${input.parentTaskId}`);
    const result = this.analyzer.analyze({ ...input, config: this.config });
    logger.info(
      `[ParallelExecutor] - Groups: ${result.plan.groups.length}, Efficiency: ${result.plan.parallelEfficiency}%`,
    );
    return result;
  }

  /**
   * Start a parallel execution session and kick off the first task batch.
   * @param parentTaskId - Parent task ID / 親タスクID
   * @param plan - Execution plan / 実行計画
   * @param nodes - Task node map / タスクノードマップ
   * @param workingDirectory - Repository working directory / ワーキングディレクトリ
   * @returns Created session object
   */
  async startSession(
    parentTaskId: number,
    plan: ParallelExecutionPlan,
    nodes: Map<number, TaskNode>,
    workingDirectory: string,
  ): Promise<ParallelExecutionSession> {
    const sessionId = `session-${parentTaskId}-${Date.now()}`;
    logger.info(`[ParallelExecutor] Starting session ${sessionId}`);

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
      taskBranches: new Map(),
      nodes,
      workingDirectory,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      totalTokensUsed: 0,
      totalExecutionTimeMs: 0,
    };

    this.sessions.set(sessionId, session);

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
        void completeSession(this.buildSessionManagerContext(), sessionId);
      }
    });

    // NOTE: setImmediate defers first batch so the session object is returned before execution starts
    setImmediate(() => {
      executeNextBatch(this.buildSessionManagerContext(), sessionId, nodes, workingDirectory).catch(
        (error) => {
          logger.error({ err: error }, '[ParallelExecutor] Error in executeNextBatch');
          const s = this.sessions.get(sessionId);
          if (s && s.status === 'running') {
            s.status = 'failed';
            s.completedAt = new Date();
            this.emitEvent({
              type: 'session_failed',
              sessionId,
              timestamp: new Date(),
              data: { error: error instanceof Error ? error.message : String(error) },
            });
          }
        },
      );
    });

    return session;
  }

  /**
   * Stop a running session and cancel all active agents.
   * @param sessionId - Session ID to stop / 停止するセッションID
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    logger.info(`[ParallelExecutor] Stopping session ${sessionId}`);

    // Stop all active agents
    for (const [agentId] of session.activeAgents) {
      this.agentController.stopAgent(agentId);
    }

    // Clean up worktrees for active tasks in this session
    for (const [taskId, worktreePath] of this.taskWorktrees.entries()) {
      if (session.nodes.has(taskId)) {
        try {
          await this.gitOps.removeWorktree(session.workingDirectory, worktreePath);
          this.taskWorktrees.delete(taskId);
          logger.info(`[ParallelExecutor] Cleaned up worktree for task ${taskId}: ${worktreePath}`);
        } catch (error) {
          logger.warn(
            { err: error },
            `[ParallelExecutor] Failed to clean up worktree for task ${taskId}: ${worktreePath}`,
          );
        }
      }
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
   * Get the current status of a session.
   * @param sessionId - Session ID to query / 照会するセッションID
   * @returns Status object or null if not found
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
    const s = scheduler.getStatus();
    return {
      status: session.status,
      progress: s.progress,
      completed: s.completed,
      running: s.running,
      pending: s.pending,
      failed: s.failed,
      blocked: s.blocked,
    };
  }

  /**
   * Query execution log entries.
   * @param filter - Optional filter for taskId, level, and result limit
   * @returns Array of log entries
   */
  getLogs(filter?: {
    sessionId?: string;
    taskId?: number;
    level?: ('debug' | 'info' | 'warn' | 'error')[];
    limit?: number;
  }): ExecutionLogEntry[] {
    return this.logAggregator.query(
      { taskIds: filter?.taskId ? [filter.taskId] : undefined, levels: filter?.level },
      filter?.limit,
    );
  }

  private emitEvent(event: ParallelExecutionEvent): void {
    this.emit('event', event);
    this.emit(event.type, event);
  }

  /**
   * Register a listener for all parallel execution events.
   * @param listener - Callback for each event / 各イベントのコールバック
   */
  addEventListener(listener: ParallelExecutionEventListener): void {
    this.on('event', listener);
  }

  /**
   * Remove a previously registered event listener.
   * @param listener - Listener to remove / 削除するリスナー
   */
  removeEventListener(listener: ParallelExecutionEventListener): void {
    this.off('event', listener);
  }

  /** Clean up all sessions, agents, and resources. */
  cleanup(): void {
    this.agentController.stopAllAgents();
    this.conflictDetector.cleanup();
    this.sessions.clear();
    this.schedulers.clear();
    this.coordinator.reset();
    this.taskWorktrees.clear();
  }
}

/**
 * Factory function to create a ParallelExecutor instance.
 * @param prisma - Prisma client instance / Prismaクライアントインスタンス
 * @param config - Optional configuration overrides / オプションの設定上書き
 * @returns New ParallelExecutor instance
 */
export function createParallelExecutor(
  prisma: PrismaClientInstance,
  config?: Partial<ParallelExecutionConfig>,
): ParallelExecutor {
  return new ParallelExecutor(prisma, config);
}
