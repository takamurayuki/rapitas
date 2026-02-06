/**
 * 並列実行オーケストレーター
 * すべてのコンポーネントを統合し、サブタスクの並列実行を管理する
 */

import { EventEmitter } from "events";
import {
  DependencyAnalyzer,
  createDependencyAnalyzer,
} from "./dependency-analyzer";
import {
  ParallelScheduler,
  createParallelScheduler,
} from "./parallel-scheduler";
import {
  SubAgentController,
  createSubAgentController,
} from "./sub-agent-controller";
import {
  LogAggregator,
  LogFormatter,
  createLogAggregator,
} from "./log-aggregator";
import { AgentCoordinator, createAgentCoordinator } from "./agent-coordinator";
import type {
  DependencyAnalysisInput,
  DependencyAnalysisResult,
  ParallelExecutionPlan,
  ParallelExecutionSession,
  ParallelExecutionStatus,
  ParallelExecutionConfig,
  TaskNode,
  ExecutionLogEntry,
} from "./types";
import type { AgentTask, AgentExecutionResult } from "../agents/base-agent";

/**
 * 並列実行イベント
 */
type ParallelExecutionEvent = {
  type:
    | "session_started"
    | "session_completed"
    | "session_failed"
    | "task_started"
    | "task_completed"
    | "task_failed"
    | "level_started"
    | "level_completed"
    | "progress_updated";
  sessionId: string;
  taskId?: number;
  level?: number;
  data?: unknown;
  timestamp: Date;
};

type ParallelExecutionEventListener = (event: ParallelExecutionEvent) => void;

/**
 * デフォルト設定
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
 * DB操作用のミューテックス（同時書き込み時の競合防止）
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
 * リトライ付きでDB操作を実行
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
        lastError.message.includes("Socket timeout") ||
        lastError.message.includes("deadlock detected") ||
        lastError.message.includes("could not serialize access");

      if (!isRetryable || attempt === maxRetries - 1) {
        throw lastError;
      }

      // 指数バックオフ
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 100;
      console.log(
        `[ParallelExecutor] DB operation failed, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// グローバルなDBミューテックス
const dbMutex = new DatabaseMutex();

/**
 * 並列実行オーケストレーター
 */
export class ParallelExecutor extends EventEmitter {
  private config: ParallelExecutionConfig;
  private analyzer: DependencyAnalyzer;
  private agentController: SubAgentController;
  private logAggregator: LogAggregator;
  private coordinator: AgentCoordinator;

  // アクティブなセッション
  private sessions: Map<string, ParallelExecutionSession> = new Map();
  private schedulers: Map<string, ParallelScheduler> = new Map();

  // Prismaクライアント
  private prisma: any;

  constructor(prisma: any, config?: Partial<ParallelExecutionConfig>) {
    super();
    this.prisma = prisma;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // コンポーネントを初期化
    this.analyzer = createDependencyAnalyzer();
    this.agentController = createSubAgentController(this.config);
    this.logAggregator = createLogAggregator();
    this.coordinator = createAgentCoordinator();

    // イベントハンドラーを設定
    this.setupEventHandlers();
  }

  // ログシーケンス番号を追跡（executionId -> sequenceNumber）
  private logSequenceNumbers: Map<number, number> = new Map();

  /**
   * イベントハンドラーを設定
   */
  private setupEventHandlers(): void {
    // エージェント出力をログに集約し、DBに保存
    this.agentController.on("agent_output", async (data) => {
      // ログアグリゲーターにも追加
      this.logAggregator.addLog({
        timestamp: data.timestamp,
        agentId: data.agentId,
        taskId: data.taskId,
        level: data.isError ? "error" : "info",
        message: data.chunk,
      });

      // DBに実行ログを保存
      try {
        const sequenceNumber =
          this.logSequenceNumbers.get(data.executionId) || 0;
        this.logSequenceNumbers.set(data.executionId, sequenceNumber + 1);

        await this.prisma.agentExecutionLog.create({
          data: {
            executionId: data.executionId,
            logChunk: data.chunk,
            logType: data.isError ? "stderr" : "stdout",
            sequenceNumber,
            timestamp: data.timestamp,
          },
        });
      } catch (error) {
        console.error(
          `[ParallelExecutor] Failed to save execution log:`,
          error,
        );
      }

      // イベントを発火（リアルタイム通知用）
      this.emitEvent({
        type: "progress_updated",
        sessionId: "",
        taskId: data.taskId,
        timestamp: data.timestamp,
        data: {
          output: data.chunk,
          isError: data.isError,
          executionId: data.executionId,
        },
      });
    });

    // タスク完了時の処理
    this.agentController.on("task_completed", (data) => {
      const session = this.findSessionByTaskId(data.taskId);
      if (session) {
        this.handleTaskCompletion(session.sessionId, data.taskId, data.result);
      }
    });

    // タスク失敗時の処理
    this.agentController.on("task_failed", (data) => {
      const session = this.findSessionByTaskId(data.taskId);
      if (session) {
        this.handleTaskFailure(
          session.sessionId,
          data.taskId,
          data.error || data.result?.errorMessage,
        );
      }
    });

    // コーディネーターメッセージをログに記録
    this.coordinator.on("message", (message) => {
      this.logAggregator.addLog({
        timestamp: message.timestamp,
        agentId: message.fromAgentId,
        taskId: 0,
        level: "debug",
        message: `[${message.type}] ${JSON.stringify(message.payload).slice(0, 200)}`,
      });
    });
  }

  /**
   * タスクIDからセッションを検索
   */
  private findSessionByTaskId(
    taskId: number,
  ): ParallelExecutionSession | undefined {
    for (const session of this.sessions.values()) {
      const allTaskIds = session.plan.groups.flatMap((g) => g.taskIds);
      if (allTaskIds.includes(taskId)) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * 依存関係を分析してプランを生成
   */
  async analyzeDependencies(
    input: DependencyAnalysisInput,
  ): Promise<DependencyAnalysisResult> {
    console.log(
      `[ParallelExecutor] Analyzing dependencies for parent task ${input.parentTaskId}`,
    );
    console.log(`[ParallelExecutor] Subtasks: ${input.subtasks.length}`);

    const result = this.analyzer.analyze({
      ...input,
      config: this.config,
    });

    console.log(`[ParallelExecutor] Analysis complete:`);
    console.log(
      `[ParallelExecutor] - Parallel groups: ${result.plan.groups.length}`,
    );
    console.log(
      `[ParallelExecutor] - Critical path length: ${result.treeMap.criticalPath.length}`,
    );
    console.log(
      `[ParallelExecutor] - Parallel efficiency: ${result.plan.parallelEfficiency}%`,
    );

    return result;
  }

  /**
   * 並列実行セッションを開始
   */
  async startSession(
    parentTaskId: number,
    plan: ParallelExecutionPlan,
    nodes: Map<number, TaskNode>,
    workingDirectory: string,
  ): Promise<ParallelExecutionSession> {
    const sessionId = `session-${parentTaskId}-${Date.now()}`;

    console.log(`[ParallelExecutor] Starting session ${sessionId}`);
    console.log(
      `[ParallelExecutor] Total tasks: ${plan.groups.flatMap((g) => g.taskIds).length}`,
    );
    console.log(
      `[ParallelExecutor] Max concurrency: ${this.config.maxConcurrentAgents}`,
    );

    // スケジューラーを作成
    const scheduler = createParallelScheduler(plan, nodes, this.config);
    this.schedulers.set(sessionId, scheduler);

    // セッションを作成
    const session: ParallelExecutionSession = {
      sessionId,
      parentTaskId,
      plan,
      status: "running",
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

    // 依存関係をコーディネーターに登録
    for (const node of nodes.values()) {
      this.coordinator.registerDependency(node.id, node.dependencies);
    }

    // セッション開始イベント
    this.emitEvent({
      type: "session_started",
      sessionId,
      timestamp: new Date(),
      data: {
        parentTaskId,
        totalTasks: plan.groups.flatMap((g) => g.taskIds).length,
        estimatedDuration: plan.estimatedTotalDuration,
      },
    });

    // スケジューラーイベントをリッスン
    scheduler.addEventListener((event) => {
      if (event.type === "level_completed") {
        this.emitEvent({
          type: "level_completed",
          sessionId,
          level: event.level,
          timestamp: event.timestamp,
        });
      } else if (event.type === "all_completed") {
        this.completeSession(sessionId);
      }
    });

    // 実行を開始（非同期で実行し、APIレスポンスをブロックしない）
    // setImmediateを使用してイベントループの次のティックで実行を開始
    setImmediate(() => {
      this.executeNextBatch(sessionId, nodes, workingDirectory).catch(
        (error) => {
          console.error(`[ParallelExecutor] Error in executeNextBatch:`, error);
          // エラー発生時はセッションを失敗状態にする
          const session = this.sessions.get(sessionId);
          if (session && session.status === "running") {
            session.status = "failed";
            session.completedAt = new Date();
            this.emitEvent({
              type: "session_failed",
              sessionId,
              timestamp: new Date(),
              data: {
                error: error instanceof Error ? error.message : String(error),
              },
            });
          }
        },
      );
    });

    return session;
  }

  /**
   * 次のバッチを実行
   */
  private async executeNextBatch(
    sessionId: string,
    nodes: Map<number, TaskNode>,
    workingDirectory: string,
  ): Promise<void> {
    const scheduler = this.schedulers.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!scheduler || !session || session.status !== "running") {
      return;
    }

    // 実行可能なタスクを取得
    const executableTasks = scheduler.getNextExecutableTasks();

    if (executableTasks.length === 0) {
      // 実行中のタスクもなければセッション完了
      if (this.agentController.getActiveAgentCount() === 0) {
        this.completeSession(sessionId);
      }
      return;
    }

    console.log(
      `[ParallelExecutor] Executing batch of ${executableTasks.length} tasks`,
    );

    // 並列でタスクを実行
    const promises: Promise<void>[] = [];

    for (const taskId of executableTasks) {
      const node = nodes.get(taskId);
      if (!node) continue;

      // スケジューラーでタスク開始
      if (!scheduler.startTask(taskId)) {
        console.warn(`[ParallelExecutor] Failed to start task ${taskId}`);
        continue;
      }

      // DBからAgentExecutionを作成
      promises.push(
        this.executeTask(sessionId, taskId, node, workingDirectory),
      );
    }

    await Promise.all(promises);
  }

  /**
   * 単一タスクを実行
   */
  private async executeTask(
    sessionId: string,
    taskId: number,
    node: TaskNode,
    workingDirectory: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    console.log(`[ParallelExecutor] Starting task ${taskId}: ${node.title}`);

    try {
      // AgentExecutionをDBに作成（ミューテックスとリトライで保護）
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
            orderBy: { createdAt: "desc" },
          });
        });

        if (!agentSession) {
          throw new Error(
            `No agent session found for parent task ${session.parentTaskId}`,
          );
        }

        execution = await withRetry(async () => {
          return await this.prisma.agentExecution.create({
            data: {
              sessionId: agentSession!.id,
              command: node.description || node.title,
              status: "running",
              startedAt: new Date(),
            },
          });
        });
      } finally {
        dbMutex.release();
      }

      // サブエージェントを作成
      const agentId = this.agentController.createAgent(
        taskId,
        execution.id,
        workingDirectory,
      );

      // セッションにエージェントを追加
      session.activeAgents.set(agentId, {
        agentId,
        taskId,
        executionId: execution.id,
        status: "running",
        startedAt: new Date(),
        lastActivityAt: new Date(),
        output: "",
        artifacts: [],
        tokensUsed: 0,
        executionTimeMs: 0,
        watingForInput: false,
      });

      // タスク開始イベント
      this.emitEvent({
        type: "task_started",
        sessionId,
        taskId,
        timestamp: new Date(),
      });

      // DBのサブタスクステータスを「進行中」に更新（ミューテックスとリトライで保護）
      try {
        await dbMutex.acquire();
        await withRetry(async () => {
          await this.prisma.task.update({
            where: { id: taskId },
            data: { status: "in-progress" },
          });
        });
        console.log(
          `[ParallelExecutor] Updated task ${taskId} status to 'in-progress'`,
        );
      } catch (error) {
        console.error(
          `[ParallelExecutor] Failed to update task status:`,
          error,
        );
      } finally {
        dbMutex.release();
      }

      // 以前の実行からセッションIDを取得（再実行の場合）
      let previousSessionId: string | null = null;
      try {
        const previousExecution = await this.prisma.agentExecution.findFirst({
          where: {
            session: {
              config: {
                taskId: taskId, // サブタスク自体のID
              },
            },
            claudeSessionId: { not: null },
          },
          orderBy: { createdAt: "desc" },
        });
        if (previousExecution?.claudeSessionId) {
          previousSessionId = previousExecution.claudeSessionId;
          console.log(
            `[ParallelExecutor] Found previous session for task ${taskId}: ${previousSessionId}`,
          );
        }
      } catch (error) {
        console.log(
          `[ParallelExecutor] No previous session found for task ${taskId}`,
        );
      }

      // タスクを実行
      const task: AgentTask = {
        id: taskId,
        title: node.title,
        description: node.description,
        workingDirectory,
        resumeSessionId: previousSessionId || undefined,
      };

      const result = await this.agentController.executeTask(agentId, task);

      // 結果をDBに保存（ミューテックスとリトライで保護）
      try {
        await dbMutex.acquire();
        // 質問待ち状態の場合は'waiting_for_input'ステータス
        const executionStatus = result.waitingForInput
          ? "waiting_for_input"
          : result.success
            ? "completed"
            : "failed";
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
        console.log(
          `[ParallelExecutor] Saved execution status for task ${taskId}: ${executionStatus}, claudeSessionId: ${result.claudeSessionId || "none"}`,
        );
      } finally {
        dbMutex.release();
      }

      // 質問待ち状態の場合は特別な処理
      if (result.waitingForInput) {
        console.log(
          `[ParallelExecutor] Task ${taskId} is waiting for user input`,
        );
        console.log(
          `[ParallelExecutor] Question: ${result.question?.substring(0, 200)}`,
        );

        // DBのサブタスクステータスを「質問待ち」に更新
        try {
          await dbMutex.acquire();
          await withRetry(async () => {
            await this.prisma.task.update({
              where: { id: taskId },
              data: { status: "waiting" },
            });
          });
          console.log(
            `[ParallelExecutor] Updated task ${taskId} status to 'waiting'`,
          );
        } catch (error) {
          console.error(
            `[ParallelExecutor] Failed to update task status:`,
            error,
          );
        } finally {
          dbMutex.release();
        }

        // 質問待ちイベントを発火
        this.emitEvent({
          type: "task_failed", // UIで質問を表示するため
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

        // 質問待ちのタスクは失敗扱いにしない（他のタスクは続行）
        // ただしスケジューラーには通知しない（依存タスクをブロックするため）
        return;
      }

      if (result.success) {
        this.handleTaskCompletion(sessionId, taskId, result);
      } else {
        this.handleTaskFailure(sessionId, taskId, result.errorMessage);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[ParallelExecutor] Task ${taskId} failed:`, errorMessage);
      this.handleTaskFailure(sessionId, taskId, errorMessage);
    }
  }

  /**
   * タスク完了を処理
   */
  private async handleTaskCompletion(
    sessionId: string,
    taskId: number,
    result: AgentExecutionResult,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    const scheduler = this.schedulers.get(sessionId);

    if (!session || !scheduler) return;

    console.log(`[ParallelExecutor] Task ${taskId} completed`);

    // スケジューラーを更新
    scheduler.completeTask(taskId);

    // 依存関係を解決
    this.coordinator.resolveDependency(taskId);

    // セッションを更新
    session.completedTasks.push(taskId);
    session.lastActivityAt = new Date();
    session.totalTokensUsed += result.tokensUsed || 0;
    session.totalExecutionTimeMs += result.executionTimeMs || 0;

    // DBのサブタスクステータスを「完了」に更新（ミューテックスとリトライで保護）
    try {
      await dbMutex.acquire();
      await withRetry(async () => {
        await this.prisma.task.update({
          where: { id: taskId },
          data: {
            status: "done",
            actualHours: result.executionTimeMs
              ? result.executionTimeMs / 3600000
              : undefined,
          },
        });
      });
      console.log(`[ParallelExecutor] Updated task ${taskId} status to 'done'`);
    } catch (error) {
      console.error(`[ParallelExecutor] Failed to update task status:`, error);
    } finally {
      dbMutex.release();
    }

    // タスク完了イベント
    this.emitEvent({
      type: "task_completed",
      sessionId,
      taskId,
      timestamp: new Date(),
      data: {
        executionTimeMs: result.executionTimeMs,
        tokensUsed: result.tokensUsed,
      },
    });

    // 進捗更新イベント
    const status = scheduler.getStatus();
    this.emitEvent({
      type: "progress_updated",
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

    // 次のバッチを実行（セッションからnodes/workingDirectoryを取得）
    await this.executeNextBatch(
      sessionId,
      session.nodes,
      session.workingDirectory,
    );
  }

  /**
   * タスク失敗を処理
   */
  private async handleTaskFailure(
    sessionId: string,
    taskId: number,
    errorMessage?: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    const scheduler = this.schedulers.get(sessionId);

    if (!session || !scheduler) return;

    console.error(`[ParallelExecutor] Task ${taskId} failed: ${errorMessage}`);

    // スケジューラーを更新
    scheduler.failTask(taskId);

    // セッションを更新
    session.failedTasks.push(taskId);
    session.lastActivityAt = new Date();

    // DBのサブタスクステータスを「未着手」に戻す（失敗時は元の状態に戻す、ミューテックスとリトライで保護）
    try {
      await dbMutex.acquire();
      await withRetry(async () => {
        await this.prisma.task.update({
          where: { id: taskId },
          data: { status: "todo" },
        });
      });
      console.log(
        `[ParallelExecutor] Reverted task ${taskId} status to 'todo' due to failure`,
      );
    } catch (error) {
      console.error(`[ParallelExecutor] Failed to update task status:`, error);
    } finally {
      dbMutex.release();
    }

    // タスク失敗イベント
    this.emitEvent({
      type: "task_failed",
      sessionId,
      taskId,
      timestamp: new Date(),
      data: { errorMessage },
    });

    // リトライ設定がある場合はリトライ（未実装）
    // 進捗更新イベント
    const status = scheduler.getStatus();
    this.emitEvent({
      type: "progress_updated",
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

    // 失敗しても他のタスクは続行（依存タスクはスケジューラーでブロック）
    await this.executeNextBatch(
      sessionId,
      session.nodes,
      session.workingDirectory,
    );
  }

  /**
   * セッションを完了
   */
  private completeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const success = session.failedTasks.length === 0;
    session.status = success ? "completed" : "failed";
    session.completedAt = new Date();

    console.log(`[ParallelExecutor] Session ${sessionId} ${session.status}`);
    console.log(
      `[ParallelExecutor] - Completed: ${session.completedTasks.length}`,
    );
    console.log(`[ParallelExecutor] - Failed: ${session.failedTasks.length}`);
    console.log(
      `[ParallelExecutor] - Total time: ${session.totalExecutionTimeMs}ms`,
    );

    this.emitEvent({
      type: success ? "session_completed" : "session_failed",
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
   * セッションを停止
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    console.log(`[ParallelExecutor] Stopping session ${sessionId}`);

    // すべてのアクティブなエージェントを停止
    for (const [agentId] of session.activeAgents) {
      this.agentController.stopAgent(agentId);
    }

    session.status = "cancelled";
    session.completedAt = new Date();

    this.emitEvent({
      type: "session_failed",
      sessionId,
      timestamp: new Date(),
      data: { reason: "cancelled" },
    });
  }

  /**
   * セッションの状態を取得
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
   * ログを取得
   */
  getLogs(filter?: {
    sessionId?: string;
    taskId?: number;
    level?: ("debug" | "info" | "warn" | "error")[];
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
   * イベントを発火
   */
  private emitEvent(event: ParallelExecutionEvent): void {
    this.emit("event", event);
    this.emit(event.type, event);
  }

  /**
   * イベントリスナーを追加
   */
  addEventListener(listener: ParallelExecutionEventListener): void {
    this.on("event", listener);
  }

  /**
   * イベントリスナーを削除
   */
  removeEventListener(listener: ParallelExecutionEventListener): void {
    this.off("event", listener);
  }

  /**
   * クリーンアップ
   */
  cleanup(): void {
    this.agentController.stopAllAgents();
    this.sessions.clear();
    this.schedulers.clear();
    this.coordinator.reset();
  }
}

/**
 * 並列実行オーケストレーターのファクトリー関数
 */
export function createParallelExecutor(
  prisma: any,
  config?: Partial<ParallelExecutionConfig>,
): ParallelExecutor {
  return new ParallelExecutor(prisma, config);
}
