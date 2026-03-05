/**
 * エージェントオーケストレーター
 * エージェントの実行管理、状態追跡、イベント配信を担当
 */
import { PrismaClient } from "@prisma/client";
type PrismaClientInstance = InstanceType<typeof PrismaClient>;
import { exec } from "child_process";
import { promisify } from "util";
import { agentFactory } from "./agent-factory";
import type { AgentConfigInput, AgentType } from "./agent-factory";
import { decrypt } from "../../utils/encryption";
import type {
  AgentTask,
  AgentExecutionResult,
  AgentOutputHandler,
  AgentStatus,
  TaskAnalysisInfo,
} from "./base-agent";
import {
  DEFAULT_QUESTION_TIMEOUT_SECONDS,
  type QuestionKey,
} from "./question-detection";
import { ExecutionFileLogger } from "./execution-file-logger";
import { createLogger } from "../../config/logger";

const execAsync = promisify(exec);
const logger = createLogger("agent-orchestrator");

// JSONフィールドを文字列に変換するヘルパー関数
function toJsonString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export type ExecutionOptions = {
  taskId: number;
  sessionId: number;
  agentConfigId?: number;
  workingDirectory?: string;
  timeout?: number;
  requireApproval?: boolean;
  onOutput?: AgentOutputHandler;
  /** AIタスク分析結果（有効な場合に渡される） */
  analysisInfo?: TaskAnalysisInfo;
  /** 前回の実行からの継続であることを示すフラグ */
  continueFromPrevious?: boolean;
  branchName?: string;
};

export type ExecutionState = {
  executionId: number;
  sessionId: number;
  agentId: string;
  taskId: number;
  status: AgentStatus;
  startedAt: Date;
  output: string;
};

export type OrchestratorEvent = {
  type:
    | "execution_started"
    | "execution_output"
    | "execution_completed"
    | "execution_failed"
    | "execution_cancelled";
  executionId: number;
  sessionId: number;
  taskId: number;
  data?: unknown;
  timestamp: Date;
};

export type EventListener = (event: OrchestratorEvent) => void;

/**
 * アクティブなエージェントの追跡情報
 */
type ActiveAgentInfo = {
  agent: import("./base-agent").BaseAgent;
  executionId: number;
  sessionId: number;
  taskId: number;
  state: ExecutionState;
  lastOutput: string;
  lastSavedAt: Date;
  fileLogger?: ExecutionFileLogger;
};

/**
 * 質問タイムアウト管理情報
 */
type QuestionTimeoutInfo = {
  executionId: number;
  taskId: number;
  questionKey?: QuestionKey;
  questionStartedAt: Date;
  timeoutTimer: NodeJS.Timeout;
};

/**
 * 継続実行のロック状態を管理
 * 同一executionIdに対する重複実行を防止
 */
type ContinuationLockInfo = {
  executionId: number;
  lockedAt: Date;
  source: "user_response" | "auto_timeout";
};

/**
 * エージェントオーケストレータークラス
 */
export class AgentOrchestrator {
  private static instance: AgentOrchestrator;
  private prisma: PrismaClientInstance;
  private activeExecutions: Map<number, ExecutionState> = new Map();
  private activeAgents: Map<number, ActiveAgentInfo> = new Map();
  private eventListeners: Set<EventListener> = new Set();
  private isShuttingDown: boolean = false;
  private shutdownPromise: Promise<void> | null = null;
  /** サーバー起動時刻（リカバリ時にこの時刻以前の実行のみをstaleとして扱う） */
  private serverStartedAt: Date = new Date();
  /** サーバー停止コールバック（リスニングソケットを正しく閉じるため） */
  private serverStopCallback: (() => Promise<void> | void) | null = null;
  /** 質問タイムアウト管理用マップ（executionId -> QuestionTimeoutInfo） */
  private questionTimeouts: Map<number, QuestionTimeoutInfo> = new Map();
  /** 継続実行のロック管理用マップ（executionId -> ContinuationLockInfo）*/
  private continuationLocks: Map<number, ContinuationLockInfo> = new Map();

  private constructor(prisma: PrismaClientInstance) {
    this.prisma = prisma;
    this.setupSignalHandlers();
  }

  static getInstance(prisma: PrismaClientInstance): AgentOrchestrator {
    if (!AgentOrchestrator.instance) {
      AgentOrchestrator.instance = new AgentOrchestrator(prisma);
    }
    return AgentOrchestrator.instance;
  }

  /**
   * シグナルハンドラーを設定（グレースフルシャットダウン用）
   */
  private setupSignalHandlers(): void {
    const handleShutdown = async (signal: string) => {
      logger.info(
        `[Orchestrator] Received ${signal}, initiating graceful shutdown...`,
      );
      await this.gracefulShutdown();
    };

    // プロセス終了シグナルをキャッチ
    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));

    // 未処理の例外やリジェクションでもシャットダウン
    process.on("uncaughtException", async (error) => {
      logger.error({ err: error }, "[Orchestrator] Uncaught exception");
      await this.gracefulShutdown();
      process.exit(1);
    });

    process.on("unhandledRejection", async (reason) => {
      logger.error({ err: reason }, "[Orchestrator] Unhandled rejection");
      // シャットダウンはしないが、実行中のエージェントの状態を保存
      await this.saveAllAgentStates();
    });

    logger.info(
      "[Orchestrator] Signal handlers registered for graceful shutdown",
    );
  }

  /**
   * グレースフルシャットダウン
   * 全てのアクティブなエージェントを停止し、状態を保存
   * @param options.skipServerStop - trueの場合、サーバーのリスニングソケット停止をスキップ（シャットダウンAPIから呼ばれた場合用）
   */
  async gracefulShutdown(options?: {
    skipServerStop?: boolean;
  }): Promise<void> {
    if (this.isShuttingDown) {
      logger.info("[Orchestrator] Shutdown already in progress, waiting...");
      return this.shutdownPromise || Promise.resolve();
    }

    this.isShuttingDown = true;
    logger.info(
      `[Orchestrator] Starting graceful shutdown with ${this.activeAgents.size} active agents`,
    );

    this.shutdownPromise = (async () => {
      const shutdownTimeout = 30000; // 30秒のタイムアウト
      const startTime = Date.now();

      try {
        // 全ての質問タイムアウトをキャンセル
        for (const [executionId, timeoutInfo] of this.questionTimeouts) {
          clearTimeout(timeoutInfo.timeoutTimer);
          logger.info(
            `[Orchestrator] Cancelled question timeout for execution ${executionId}`,
          );
        }
        this.questionTimeouts.clear();

        // 全ての継続ロックを解放
        this.continuationLocks.clear();

        // 全てのアクティブなエージェントを停止
        const stopPromises = Array.from(this.activeAgents.entries()).map(
          async ([executionId, info]) => {
            try {
              logger.info(
                `[Orchestrator] Stopping agent for execution ${executionId}...`,
              );

              // エージェントを停止
              await Promise.race([
                info.agent.stop(),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error("Stop timeout")), 10000),
                ),
              ]);

              // 最終状態をDBに保存
              await this.saveAgentState(executionId, info, "interrupted");
              logger.info(
                `[Orchestrator] Agent for execution ${executionId} stopped and state saved`,
              );
            } catch (error) {
              logger.error(
                { err: error, executionId },
                `[Orchestrator] Error stopping agent`,
              );
              // エラーでも状態保存を試みる
              try {
                await this.saveAgentState(executionId, info, "interrupted");
              } catch (saveError) {
                logger.error(
                  { err: saveError, executionId },
                  `[Orchestrator] Failed to save state`,
                );
              }
            }
          },
        );

        // タイムアウト付きで全エージェントの停止を待機
        await Promise.race([
          Promise.all(stopPromises),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Shutdown timeout")),
              shutdownTimeout - (Date.now() - startTime),
            ),
          ),
        ]);

        logger.info("[Orchestrator] Graceful shutdown completed");
      } catch (error) {
        logger.error({ err: error }, "[Orchestrator] Graceful shutdown error");
        // 強制的に状態を保存
        await this.saveAllAgentStates();
      } finally {
        this.activeAgents.clear();
        this.activeExecutions.clear();

        // サーバーのリスニングソケットを正しく閉じる（シャットダウンAPIからの呼び出し時はスキップ）
        if (this.serverStopCallback && !options?.skipServerStop) {
          try {
            logger.info("[Orchestrator] Stopping server listener...");
            await this.serverStopCallback();
            logger.info("[Orchestrator] Server listener stopped");
          } catch (error) {
            logger.error(
              { err: error },
              "[Orchestrator] Failed to stop server listener",
            );
          }
        }
      }
    })();

    return this.shutdownPromise;
  }

  /**
   * 特定のエージェントの状態をDBに保存
   * 実行のステータスだけでなく、関連するセッションとタスクのステータスも更新する
   */
  private async saveAgentState(
    executionId: number,
    info: ActiveAgentInfo,
    status: "interrupted" | "failed",
  ): Promise<void> {
    const errorMessage =
      status === "interrupted"
        ? `プロセスが中断されました。\n\n【最後の出力】\n${info.lastOutput.slice(-1000)}`
        : `プロセスが異常終了しました。\n\n【最後の出力】\n${info.lastOutput.slice(-1000)}`;

    await this.prisma.agentExecution.update({
      where: { id: executionId },
      data: {
        status,
        output: info.state.output,
        errorMessage,
        completedAt: new Date(),
      },
    });

    // セッションのステータスも更新
    try {
      await this.prisma.agentSession.update({
        where: { id: info.sessionId },
        data: {
          status: "interrupted",
          lastActivityAt: new Date(),
        },
      });
    } catch (error) {
      logger.error(
        { err: error, sessionId: info.sessionId },
        `[Orchestrator] Failed to update session`,
      );
    }

    // タスクのステータスを todo に戻す
    try {
      const task = await this.prisma.task.findUnique({
        where: { id: info.taskId },
        select: { id: true, status: true },
      });
      if (task && task.status === "in-progress") {
        await this.prisma.task.update({
          where: { id: info.taskId },
          data: { status: "todo" },
        });
        logger.info(
          `[Orchestrator] Task ${info.taskId} reverted to 'todo' during shutdown`,
        );
      }
    } catch (error) {
      logger.error(
        { err: error, taskId: info.taskId },
        `[Orchestrator] Failed to update task`,
      );
    }
  }

  /**
   * 全てのアクティブなエージェントの状態を保存
   */
  private async saveAllAgentStates(): Promise<void> {
    logger.info(
      `[Orchestrator] Saving state for ${this.activeAgents.size} active agents...`,
    );

    for (const [executionId, info] of this.activeAgents) {
      try {
        await this.saveAgentState(executionId, info, "interrupted");
      } catch (error) {
        logger.error(
          { err: error, executionId },
          `[Orchestrator] Failed to save state for execution`,
        );
      }
    }
  }

  /**
   * 中断されたセッションを取得
   */
  async getInterruptedExecutions(): Promise<
    Array<{
      id: number;
      sessionId: number;
      status: string;
      claudeSessionId: string | null;
      output: string;
      createdAt: Date;
    }>
  > {
    return await this.prisma.agentExecution.findMany({
      where: {
        status: "interrupted",
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  /**
   * サーバー起動時のリカバリ処理
   * running/pending のまま残っている実行を interrupted に更新し、
   * 関連する Task と AgentSession のステータスも適切に更新する
   */
  async recoverStaleExecutions(): Promise<{
    recoveredExecutions: number;
    updatedTasks: number;
    updatedSessions: number;
    interruptedExecutionIds: number[];
  }> {
    logger.info(
      "[Orchestrator] Starting startup recovery of stale executions...",
    );

    let recoveredExecutions = 0;
    let updatedTasks = 0;
    let updatedSessions = 0;
    const interruptedExecutionIds: number[] = [];

    try {
      // メモリ上でアクティブな実行IDを取得（起動直後は空のはず）
      const activeExecutionIds = this.getActiveExecutions().map(
        (e) => e.executionId,
      );

      // running/pending/waiting_for_input のままDB上に残っている実行を検索
      // サーバー起動以前に作成された実行のみを対象にする（起動後の新規実行を誤検出しない）
      const staleExecutions = await this.prisma.agentExecution.findMany({
        where: {
          status: { in: ["running", "pending", "waiting_for_input"] },
          id: { notIn: activeExecutionIds },
          createdAt: { lt: this.serverStartedAt },
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
        logger.info(
          "[Orchestrator] No stale executions found. Recovery complete.",
        );
        return {
          recoveredExecutions: 0,
          updatedTasks: 0,
          updatedSessions: 0,
          interruptedExecutionIds: [],
        };
      }

      logger.info(
        `[Orchestrator] Found ${staleExecutions.length} stale executions to recover`,
      );

      // 影響を受けるセッションIDとタスクIDを追跡
      const affectedSessionIds = new Set<number>();
      const affectedTaskIds = new Set<number>();

      for (const exec of staleExecutions) {
        try {
          // 実行ステータスを interrupted に更新
          await this.prisma.agentExecution.update({
            where: { id: exec.id },
            data: {
              status: "interrupted",
              completedAt: new Date(),
              errorMessage: `サーバー再起動により中断されました。\n\n【最後の出力】\n${(exec.output || "").slice(-1000)}`,
            },
          });
          recoveredExecutions++;
          interruptedExecutionIds.push(exec.id);

          affectedSessionIds.add(exec.sessionId);

          const taskId = exec.session?.config?.task?.id;
          if (taskId) {
            affectedTaskIds.add(taskId);
          }

          logger.info(
            `[Orchestrator] Execution ${exec.id} marked as interrupted`,
          );
        } catch (error) {
          logger.error(
            { err: error, executionId: exec.id },
            `[Orchestrator] Failed to recover execution`,
          );
        }
      }

      // 影響を受けたセッションのステータスを更新
      for (const sessionId of affectedSessionIds) {
        try {
          // このセッションにまだ running/pending の実行が残っていないか確認
          const activeCount = await this.prisma.agentExecution.count({
            where: {
              sessionId,
              status: { in: ["running", "pending", "waiting_for_input"] },
            },
          });

          if (activeCount === 0) {
            await this.prisma.agentSession.update({
              where: { id: sessionId },
              data: {
                status: "interrupted",
                lastActivityAt: new Date(),
              },
            });
            updatedSessions++;
            logger.info(
              `[Orchestrator] Session ${sessionId} marked as interrupted`,
            );
          }
        } catch (error) {
          logger.error(
            { err: error, sessionId },
            `[Orchestrator] Failed to update session`,
          );
        }
      }

      // 影響を受けたタスクのステータスを更新
      for (const taskId of affectedTaskIds) {
        try {
          const task = await this.prisma.task.findUnique({
            where: { id: taskId },
            select: { id: true, status: true },
          });

          // in-progress のタスクのみ更新（他のステータスは影響しない）
          if (task && task.status === "in-progress") {
            await this.prisma.task.update({
              where: { id: taskId },
              data: { status: "todo" },
            });
            updatedTasks++;
            logger.info(`[Orchestrator] Task ${taskId} reverted to 'todo'`);
          }
        } catch (error) {
          logger.error(
            { err: error, taskId },
            `[Orchestrator] Failed to update task`,
          );
        }
      }

      // 通知を作成
      if (recoveredExecutions > 0) {
        try {
          await this.prisma.notification.create({
            data: {
              type: "agent_execution_interrupted",
              title: "サーバー再起動による中断",
              message: `サーバー再起動により${recoveredExecutions}件のエージェント実行が中断されました。バナーから再開できます。`,
              link: "/",
              metadata: JSON.stringify({
                recoveredExecutions,
                updatedTasks,
                updatedSessions,
              }),
            },
          });
        } catch (error) {
          logger.error(
            { err: error },
            "[Orchestrator] Failed to create recovery notification",
          );
        }
      }

      logger.info(
        `[Orchestrator] Recovery complete: ${recoveredExecutions} executions, ${updatedTasks} tasks, ${updatedSessions} sessions updated`,
      );
    } catch (error) {
      logger.error({ err: error }, "[Orchestrator] Startup recovery failed");
    }

    return {
      recoveredExecutions,
      updatedTasks,
      updatedSessions,
      interruptedExecutionIds,
    };
  }

  /**
   * シャットダウン中かどうか
   */
  isInShutdown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * サーバー停止コールバックを設定
   * index.tsから呼び出し、gracefulShutdown時にリスニングソケットを正しく閉じるために使用
   */
  setServerStopCallback(callback: () => Promise<void> | void): void {
    this.serverStopCallback = callback;
  }

  /**
   * サーバーのリスニングソケットを停止する
   * シャットダウンAPIからレスポンス送信後に呼び出すために使用
   */
  async stopServer(): Promise<void> {
    if (this.serverStopCallback) {
      try {
        logger.info("[Orchestrator] Stopping server listener...");
        await this.serverStopCallback();
        logger.info("[Orchestrator] Server listener stopped");
      } catch (error) {
        logger.error({ err: error }, "[Orchestrator] Failed to stop server listener");
      }
    }
  }

  /**
   * アクティブな実行数を取得
   */
  getActiveExecutionCount(): number {
    return this.activeAgents.size;
  }

  /**
   * アクティブなエージェント情報一覧を取得（グレースフルシャットダウン用）
   */
  getActiveAgentInfos(): Array<{
    executionId: number;
    sessionId: number;
    taskId: number;
    startedAt: Date;
    lastOutput: string;
  }> {
    return Array.from(this.activeAgents.values()).map((info) => ({
      executionId: info.executionId,
      sessionId: info.sessionId,
      taskId: info.taskId,
      startedAt: info.state.startedAt,
      lastOutput: info.lastOutput,
    }));
  }

  /**
   * イベントリスナーを追加
   */
  addEventListener(listener: EventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * イベントリスナーを削除
   */
  removeEventListener(listener: EventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   * DB設定からAgentConfigInputを構築するヘルパー
   */
  private buildAgentConfigFromDb(
    dbConfig: {
      id: number;
      agentType: string;
      name: string;
      apiKeyEncrypted: string | null;
      endpoint: string | null;
      modelId: string | null;
    },
    options: { workingDirectory?: string; timeout?: number },
  ): AgentConfigInput {
    let decryptedApiKey: string | undefined;
    if (dbConfig.apiKeyEncrypted) {
      try {
        decryptedApiKey = decrypt(dbConfig.apiKeyEncrypted);
      } catch (e) {
        logger.error(
          { err: e, agentId: dbConfig.id },
          `[Orchestrator] Failed to decrypt API key for agent`,
        );
      }
    }

    return {
      type: (dbConfig.agentType as AgentType) || "claude-code",
      name: dbConfig.name,
      endpoint: dbConfig.endpoint || undefined,
      apiKey: decryptedApiKey,
      modelId: dbConfig.modelId || undefined,
      workingDirectory: options.workingDirectory,
      timeout: options.timeout,
      dangerouslySkipPermissions: true, // Claude Code用
      yoloMode: true, // Gemini CLI / Codex CLI用: 自動承認モード
    };
  }

  /**
   * イベントを発火
   */
  private emitEvent(event: OrchestratorEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error({ err: error }, "Error in event listener");
      }
    }
  }

  // ==================== 質問タイムアウト管理 ====================

  /**
   * 質問タイムアウトを開始
   * @param executionId 実行ID
   * @param taskId タスクID
   * @param questionKey 質問キー情報
   */
  startQuestionTimeout(
    executionId: number,
    taskId: number,
    questionKey?: QuestionKey,
  ): void {
    // 既存のタイムアウトがあればキャンセル
    this.cancelQuestionTimeout(executionId);

    const timeoutSeconds =
      questionKey?.timeout_seconds || DEFAULT_QUESTION_TIMEOUT_SECONDS;
    const timeoutMs = timeoutSeconds * 1000;

    logger.info(
      `[Orchestrator] Starting question timeout for execution ${executionId}: ${timeoutSeconds}s`,
    );

    const timeoutTimer = setTimeout(async () => {
      logger.info(
        `[Orchestrator] Question timeout triggered for execution ${executionId}`,
      );
      await this.handleQuestionTimeout(executionId, taskId);
    }, timeoutMs);

    this.questionTimeouts.set(executionId, {
      executionId,
      taskId,
      questionKey,
      questionStartedAt: new Date(),
      timeoutTimer,
    });

    // タイムアウトイベントを発火（フロントエンドでカウントダウン表示用）
    this.emitEvent({
      type: "execution_output",
      executionId,
      sessionId: 0, // セッションIDは後で取得
      taskId,
      data: {
        questionTimeoutStarted: true,
        questionTimeoutSeconds: timeoutSeconds,
        questionTimeoutDeadline: new Date(Date.now() + timeoutMs).toISOString(),
      },
      timestamp: new Date(),
    });
  }

  /**
   * 質問タイムアウトをキャンセル
   * @param executionId 実行ID
   */
  cancelQuestionTimeout(executionId: number): void {
    const timeoutInfo = this.questionTimeouts.get(executionId);
    if (timeoutInfo) {
      clearTimeout(timeoutInfo.timeoutTimer);
      this.questionTimeouts.delete(executionId);
      logger.info(
        `[Orchestrator] Question timeout cancelled for execution ${executionId}`,
      );
    }
  }

  /**
   * 継続実行のロックを取得
   * @returns ロック取得に成功した場合はtrue、既にロックされている場合はfalse
   */
  tryAcquireContinuationLock(
    executionId: number,
    source: "user_response" | "auto_timeout",
  ): boolean {
    const existingLock = this.continuationLocks.get(executionId);
    if (existingLock) {
      logger.info(
        `[Orchestrator] Continuation lock already held for execution ${executionId} by ${existingLock.source}`,
      );
      return false;
    }

    this.continuationLocks.set(executionId, {
      executionId,
      lockedAt: new Date(),
      source,
    });
    logger.info(
      `[Orchestrator] Continuation lock acquired for execution ${executionId} by ${source}`,
    );
    return true;
  }

  /**
   * 継続実行のロックを解放
   */
  releaseContinuationLock(executionId: number): void {
    const lock = this.continuationLocks.get(executionId);
    if (lock) {
      this.continuationLocks.delete(executionId);
      logger.info(
        `[Orchestrator] Continuation lock released for execution ${executionId}`,
      );
    }
  }

  /**
   * 継続実行のロックが取得されているか確認
   */
  hasContinuationLock(executionId: number): boolean {
    return this.continuationLocks.has(executionId);
  }

  /**
   * 質問タイムアウト発生時の処理
   * エージェントに自動的に継続を指示
   */
  private async handleQuestionTimeout(
    executionId: number,
    taskId: number,
  ): Promise<void> {
    try {
      // タイムアウト情報を取得して削除
      const timeoutInfo = this.questionTimeouts.get(executionId);
      this.questionTimeouts.delete(executionId);

      // ロックを取得（既に処理中なら早期リターン）
      if (!this.tryAcquireContinuationLock(executionId, "auto_timeout")) {
        logger.info(
          `[Orchestrator] Skipping timeout handling for execution ${executionId} - already being processed`,
        );
        return;
      }

      try {
        // 実行状態を確認
        const execution = await this.prisma.agentExecution.findUnique({
          where: { id: executionId },
          include: {
            session: true,
          },
        });

        if (!execution) {
          logger.info(
            `[Orchestrator] Execution ${executionId} not found for timeout handling`,
          );
          return;
        }

        // まだ waiting_for_input 状態かどうか確認
        if (execution.status !== "waiting_for_input") {
          logger.info(
            `[Orchestrator] Execution ${executionId} is no longer waiting for input (status: ${execution.status})`,
          );
          return;
        }

        // DBステータスを running に更新（競合防止）
        await this.prisma.agentExecution.update({
          where: { id: executionId },
          data: { status: "running" },
        });

        logger.info(
          `[Orchestrator] Auto-continuing execution ${executionId} after timeout`,
        );

        // 質問のタイプに応じてデフォルト回答を生成
        const defaultResponse = this.generateDefaultResponse(
          timeoutInfo?.questionKey,
          execution.question,
          execution.questionDetails,
        );

        // タイムアウトイベントを発火（フロントエンドに通知）
        this.emitEvent({
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

        // 自動継続を実行（内部でロックは解放される）
        const result = await this.executeContinuationInternal(
          executionId,
          defaultResponse,
          {
            timeout: 900000,
          },
        );

        // 結果に応じてタスクとセッションのステータスを更新
        if (result.success && !result.waitingForInput) {
          // タスクのステータスを完了に更新
          try {
            await this.prisma.task.update({
              where: { id: taskId },
              data: {
                status: "done",
                completedAt: new Date(),
              },
            });
            logger.info(
              `[Orchestrator] Task ${taskId} updated to 'done' after timeout auto-continue`,
            );

            // セッションのステータスも完了に更新
            await this.prisma.agentSession.update({
              where: { id: execution.sessionId },
              data: {
                status: "completed",
                completedAt: new Date(),
              },
            });
          } catch (updateError) {
            logger.error(
              { err: updateError },
              `[Orchestrator] Failed to update task/session status after timeout`,
            );
          }
        } else if (!result.success && !result.waitingForInput) {
          // 失敗時はタスクステータスを todo に戻す
          try {
            await this.prisma.task.update({
              where: { id: taskId },
              data: { status: "todo" },
            });

            await this.prisma.agentSession.update({
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
              `[Orchestrator] Failed to update task/session status after timeout failure`,
            );
          }
        }
      } catch (error) {
        // エラー時はステータスを元に戻す
        await this.prisma.agentExecution
          .update({
            where: { id: executionId },
            data: { status: "waiting_for_input" },
          })
          .catch(() => {});
        throw error;
      } finally {
        // ロックを解放
        this.releaseContinuationLock(executionId);
      }
    } catch (error) {
      logger.error(
        { err: error, executionId },
        `[Orchestrator] Error handling question timeout for execution`,
      );
    }
  }

  /**
   * 質問タイプに応じたデフォルト回答を生成
   */
  private generateDefaultResponse(
    questionKey?: QuestionKey,
    questionText?: string,
    questionDetails?: string | null,
  ): string {
    // 質問詳細からオプションがある場合は最初の選択肢を使用
    if (questionDetails) {
      let details: {
        options?: Array<{ label: string; description?: string }>;
      } | null = null;
      try {
        details = JSON.parse(questionDetails) as {
          options?: Array<{ label: string; description?: string }>;
        };
      } catch {
        details = null;
      }

      if (
        details?.options &&
        Array.isArray(details.options) &&
        details.options.length > 0
      ) {
        // 最初の選択肢（通常は推奨オプション）を選択
        const firstOption = details.options[0];
        return firstOption.label || "1";
      }
    }

    // 質問カテゴリに応じたデフォルト回答
    if (questionKey?.question_type) {
      switch (questionKey.question_type) {
        case "confirmation":
          // 確認系の質問には「はい」で回答
          return "はい";
        case "selection":
          // 選択系の質問には最初の選択肢
          return "1";
        case "clarification":
        default:
          // 明確化の質問には「デフォルトの設定で続行してください」
          return "デフォルトの設定で続行してください";
      }
    }

    // 質問テキストから推測
    if (questionText) {
      const text = questionText.toLowerCase();

      // Yes/No系の質問
      if (
        text.includes("y/n") ||
        text.includes("[y/n]") ||
        text.includes("(yes/no)")
      ) {
        return "y";
      }

      // 確認系のキーワード
      if (
        text.includes("よろしいですか") ||
        text.includes("続けますか") ||
        text.includes("proceed") ||
        text.includes("continue")
      ) {
        return "はい";
      }
    }

    // デフォルト: 続行を指示
    return "続行してください";
  }

  /**
   * 特定の実行の質問タイムアウト情報を取得
   */
  getQuestionTimeoutInfo(executionId: number): {
    remainingSeconds: number;
    deadline: Date;
    questionKey?: QuestionKey;
  } | null {
    const timeoutInfo = this.questionTimeouts.get(executionId);
    if (!timeoutInfo) {
      return null;
    }

    const timeoutSeconds =
      timeoutInfo.questionKey?.timeout_seconds ||
      DEFAULT_QUESTION_TIMEOUT_SECONDS;
    const deadline = new Date(
      timeoutInfo.questionStartedAt.getTime() + timeoutSeconds * 1000,
    );
    const remainingSeconds = Math.max(
      0,
      Math.ceil((deadline.getTime() - Date.now()) / 1000),
    );

    return {
      remainingSeconds,
      deadline,
      questionKey: timeoutInfo.questionKey,
    };
  }

  /**
   * タスクを実行
   */
  async executeTask(
    task: AgentTask,
    options: ExecutionOptions,
  ): Promise<AgentExecutionResult> {
    // エージェント設定を取得
    // 優先順: 1) 指定されたagentConfigId → 2) DBのisDefault=true → 3) ハードコードのClaude Code
    let agentConfig: AgentConfigInput = {
      type: "claude-code",
      name: "Claude Code Agent",
      workingDirectory: options.workingDirectory,
      timeout: options.timeout,
      dangerouslySkipPermissions: true, // 自動実行モード: ファイル変更を許可
    };
    let resolvedAgentConfigId = options.agentConfigId;

    // agentConfigIdが指定されている場合はそれを使用
    if (options.agentConfigId) {
      const dbConfig = await this.prisma.aIAgentConfig.findUnique({
        where: { id: options.agentConfigId },
      });
      if (dbConfig) {
        agentConfig = this.buildAgentConfigFromDb(dbConfig, options);
        resolvedAgentConfigId = dbConfig.id;
      }
    } else {
      // agentConfigIdが未指定の場合、DBでisDefault=trueのエージェントを検索
      const defaultDbConfig = await this.prisma.aIAgentConfig.findFirst({
        where: { isDefault: true, isActive: true },
      });
      if (defaultDbConfig) {
        agentConfig = this.buildAgentConfigFromDb(defaultDbConfig, options);
        resolvedAgentConfigId = defaultDbConfig.id;
        logger.info(
          `[Orchestrator] Using default agent from DB: ${defaultDbConfig.name} (type: ${defaultDbConfig.agentType})`,
        );
      } else {
        logger.info(
          `[Orchestrator] No default agent in DB, falling back to Claude Code`,
        );
      }
    }

    // エージェントを作成
    const agent = agentFactory.createAgent(agentConfig);

    // 実行レコードを作成（resolvedAgentConfigIdを使用）
    const execution = await this.prisma.agentExecution.create({
      data: {
        sessionId: options.sessionId,
        agentConfigId: resolvedAgentConfigId,
        command: task.description || task.title,
        status: "pending",
      },
    });

    // 実行状態を追跡
    const state: ExecutionState = {
      executionId: execution.id,
      sessionId: options.sessionId,
      agentId: agent.id,
      taskId: options.taskId,
      status: "idle",
      startedAt: new Date(),
      output: "",
    };
    this.activeExecutions.set(execution.id, state);

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

    // アクティブエージェントを登録（グレースフルシャットダウン用）
    const agentInfo: ActiveAgentInfo = {
      agent,
      executionId: execution.id,
      sessionId: options.sessionId,
      taskId: options.taskId,
      state,
      lastOutput: "",
      lastSavedAt: new Date(),
      fileLogger,
    };
    this.activeAgents.set(execution.id, agentInfo);

    // シャットダウン中は新しい実行を拒否
    if (this.isShuttingDown) {
      this.activeAgents.delete(execution.id);
      this.activeExecutions.delete(execution.id);
      fileLogger.logError(
        "Server is shutting down, cannot start new execution",
      );
      await fileLogger.flush();
      throw new Error("Server is shutting down, cannot start new execution");
    }

    // 質問検出ハンドラを設定（質問が検出されたら即座にDBを更新）
    agent.setQuestionDetectedHandler(async (info) => {
      logger.info(`[Orchestrator] Question detected during streaming!`);
      logger.info(
        `[Orchestrator] Question: ${info.question.substring(0, 100)}`,
      );
      logger.info(`[Orchestrator] Question type: ${info.questionType}`);
      logger.info(
        `[Orchestrator] Claude Session ID: ${info.claudeSessionId || "(なし)"}`,
      );
      fileLogger.logQuestionDetected(
        info.question,
        info.questionType,
        info.claudeSessionId,
      );

      try {
        // 即座にDBステータスを waiting_for_input に更新（セッションIDも保存）
        await this.prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: "waiting_for_input",
            question: info.question || null,
            questionType: info.questionType || null,
            questionDetails: toJsonString(info.questionDetails),
            claudeSessionId: info.claudeSessionId || null,
          },
        });
        logger.info(
          `[Orchestrator] DB updated to waiting_for_input for execution ${execution.id}`,
        );

        // 状態も更新
        state.status = "waiting_for_input";

        // 質問タイムアウトを開始
        this.startQuestionTimeout(
          execution.id,
          options.taskId,
          info.questionKey,
        );

        // タイムアウト情報を取得
        const timeoutInfo = this.getQuestionTimeoutInfo(execution.id);

        // イベントを発火（リアルタイム通知用）
        this.emitEvent({
          type: "execution_output",
          executionId: execution.id,
          sessionId: options.sessionId,
          taskId: options.taskId,
          data: {
            output: `\n[質問] ${info.question}\n`,
            waitingForInput: true,
            question: info.question,
            questionType: info.questionType,
            questionDetails: info.questionDetails,
            questionKey: info.questionKey,
            // タイムアウト情報を追加
            questionTimeoutSeconds:
              timeoutInfo?.remainingSeconds || DEFAULT_QUESTION_TIMEOUT_SECONDS,
            questionTimeoutDeadline: timeoutInfo?.deadline?.toISOString(),
          },
          timestamp: new Date(),
        });
      } catch (error) {
        logger.error(
          { err: error },
          `[Orchestrator] Failed to update DB on question detection`,
        );
      }
    });

    // 出力ハンドラを設定（リアルタイムでDBに保存）
    let lastDbUpdate = Date.now();
    const DB_UPDATE_INTERVAL = 200; // 0.2秒ごとにDBを更新（リアルタイム表示のため）
    let pendingDbUpdate = false;
    let logSequenceNumber = 0; // ログのシーケンス番号
    let pendingLogChunks: {
      chunk: string;
      isError: boolean;
      timestamp: Date;
    }[] = [];
    let pendingLogSave = false;
    const LOG_BATCH_INTERVAL = 500; // 0.5秒ごとにログを一括保存

    // ログチャンクを一括保存する関数
    const flushLogChunks = async () => {
      if (pendingLogSave || pendingLogChunks.length === 0) return;
      pendingLogSave = true;
      const chunksToSave = [...pendingLogChunks];
      pendingLogChunks = [];

      try {
        const logEntries = chunksToSave.map((chunk) => ({
          executionId: execution.id,
          logChunk: chunk.chunk,
          logType: chunk.isError ? "stderr" : "stdout",
          sequenceNumber: logSequenceNumber++,
          timestamp: chunk.timestamp,
        }));

        await this.prisma.agentExecutionLog.createMany({
          data: logEntries,
        });
      } catch (e) {
        logger.error({ err: e }, "Failed to save log chunks");
        // 失敗した場合はチャンクを戻す（再試行のため）
        pendingLogChunks = [...chunksToSave, ...pendingLogChunks];
      } finally {
        pendingLogSave = false;
      }
    };

    // 定期的にログを一括保存
    const logFlushInterval = setInterval(flushLogChunks, LOG_BATCH_INTERVAL);

    agent.setOutputHandler(async (output, isError) => {
      try {
        state.output += output;

        // ファイルロガーに出力を記録
        fileLogger.logOutput(output, isError ?? false);

        // アクティブエージェント情報を更新（グレースフルシャットダウン用）
        if (agentInfo) {
          agentInfo.lastOutput = state.output.slice(-2000); // 最後の2000文字を保持
          agentInfo.lastSavedAt = new Date();
        }

        // ログチャンクをキューに追加
        pendingLogChunks.push({
          chunk: output,
          isError: isError ?? false,
          timestamp: new Date(),
        });

        // エラー出力は即座にDBに保存（重要な情報のため）
        if (isError && output.trim()) {
          try {
            await this.prisma.agentExecution.update({
              where: { id: execution.id },
              data: {
                output: state.output,
                errorMessage: output.slice(-500), // 最後の500文字をエラーメッセージに
              },
            });
            lastDbUpdate = Date.now();
          } catch (e) {
            logger.error({ err: e }, "Failed to save error output immediately");
          }
        }

        if (options.onOutput) {
          try {
            options.onOutput(output, isError);
          } catch (e) {
            logger.error({ err: e }, "Error in onOutput callback");
          }
        }

        // イベントを発火（リアルタイム通知用）
        try {
          this.emitEvent({
            type: "execution_output",
            executionId: execution.id,
            sessionId: options.sessionId,
            taskId: options.taskId,
            data: { output, isError },
            timestamp: new Date(),
          });
        } catch (e) {
          logger.error({ err: e }, "Error emitting event");
        }

        // 定期的にDBを更新（ポーリング用）
        const now = Date.now();
        if (now - lastDbUpdate > DB_UPDATE_INTERVAL && !pendingDbUpdate) {
          pendingDbUpdate = true;
          lastDbUpdate = now;
          try {
            await this.prisma.agentExecution.update({
              where: { id: execution.id },
              data: { output: state.output },
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

    // クリーンアップ時にログをフラッシュ
    const cleanupLogHandler = async () => {
      clearInterval(logFlushInterval);
      await flushLogChunks(); // 残りのログを保存
    };

    // 実行開始イベント（エージェント情報を含む）
    this.emitEvent({
      type: "execution_started",
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
    let previousOutput = "";
    if (options.continueFromPrevious && options.sessionId) {
      try {
        // 同じセッションの前回の実行を取得
        const previousExecution = await this.prisma.agentExecution.findFirst({
          where: {
            sessionId: options.sessionId,
            id: { not: execution.id }, // 現在の実行を除外
          },
          orderBy: { createdAt: "desc" },
          select: { output: true },
        });

        if (previousExecution?.output) {
          previousOutput = previousExecution.output;
          logger.info(
            `[Orchestrator] Previous execution output loaded for continuation (${previousOutput.length} chars)`,
          );
        }
      } catch (error) {
        logger.error(
          { err: error },
          "[Orchestrator] Failed to load previous execution output",
        );
      }
    }

    // 初期メッセージを設定（使用エージェント名を明示）
    const agentLabel = agentConfig.modelId
      ? `${agentConfig.name} (${agentConfig.type}, model: ${agentConfig.modelId})`
      : `${agentConfig.name} (${agentConfig.type})`;

    // 継続実行の場合は前回のログから継続、新規実行の場合は新しいメッセージから開始
    const initialMessage =
      options.continueFromPrevious && previousOutput
        ? previousOutput + "\n[継続実行] 追加指示の実行を開始します...\n"
        : `[実行開始] タスクの実行を開始します...\n[エージェント] ${agentLabel}\n`;

    state.output = initialMessage;

    // 実行レコードを更新（初期出力も保存）
    await this.prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "running",
        startedAt: new Date(),
        output: initialMessage,
      },
    });

    try {
      // AIタスク分析結果がある場合はタスクに追加
      const taskWithAnalysis: AgentTask = {
        ...task,
        analysisInfo: options.analysisInfo,
      };

      // 分析情報の有無をログ出力
      if (options.analysisInfo) {
        logger.info(`[Orchestrator] AI task analysis enabled`);
        logger.info(
          `[Orchestrator] Analysis summary: ${options.analysisInfo.summary?.substring(0, 100)}`,
        );
        logger.info(
          `[Orchestrator] Subtasks count: ${options.analysisInfo.subtasks?.length || 0}`,
        );
      } else {
        logger.info(`[Orchestrator] AI task analysis not provided`);
      }

      // エージェントを実行
      const result = await agent.execute(taskWithAnalysis);

      logger.info(
        `[Orchestrator] Execution result - success: ${result.success}, waitingForInput: ${result.waitingForInput}, questionType: ${result.questionType}, question: ${result.question?.substring(0, 100)}`,
      );

      // ステータス判定: 質問待ちの場合は waiting_for_input
      let executionStatus: string;
      if (result.waitingForInput) {
        executionStatus = "waiting_for_input";
        state.status = "waiting_for_input";
        logger.info(`[Orchestrator] Setting status to waiting_for_input`);
        fileLogger.logStatusChange(
          "running",
          "waiting_for_input",
          "Question detected",
        );
      } else if (result.success) {
        executionStatus = "completed";
        state.status = "completed";
        logger.info(`[Orchestrator] Setting status to completed`);
        fileLogger.logExecutionEnd("completed", {
          success: true,
          tokensUsed: result.tokensUsed,
          executionTimeMs: result.executionTimeMs,
        });
      } else {
        executionStatus = "failed";
        state.status = "failed";
        logger.info(`[Orchestrator] Setting status to failed`);
        fileLogger.logExecutionEnd("failed", {
          success: false,
          tokensUsed: result.tokensUsed,
          executionTimeMs: result.executionTimeMs,
          errorMessage: result.errorMessage,
        });
      }

      // 実行レコードを更新（claudeSessionIdを含む）
      // state.outputは前回の出力を含む蓄積済み出力（継続実行時にpreviousOutput + 新出力）
      // result.outputはエージェントの新規出力のみ。state.outputを使って完全なログを保存する
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: executionStatus,
          output: state.output || result.output,
          artifacts: toJsonString(result.artifacts),
          completedAt: result.waitingForInput ? null : new Date(),
          tokensUsed: result.tokensUsed || 0,
          executionTimeMs: result.executionTimeMs,
          errorMessage: result.errorMessage,
          question: result.question || null,
          questionType: result.questionType || null,
          questionDetails: toJsonString(result.questionDetails),
          claudeSessionId: result.claudeSessionId || null,
        },
      });

      // セッションのトークン使用量を更新
      if (result.tokensUsed) {
        await this.prisma.agentSession.update({
          where: { id: options.sessionId },
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
          await this.prisma.gitCommit.create({
            data: {
              executionId: execution.id,
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

      // イベント発火
      if (result.waitingForInput) {
        // 質問待ちイベント（新しい構造化キー情報を含む）
        this.emitEvent({
          type: "execution_output",
          executionId: execution.id,
          sessionId: options.sessionId,
          taskId: options.taskId,
          data: {
            output: result.output,
            waitingForInput: true,
            question: result.question,
            questionType: result.questionType,
            questionDetails: result.questionDetails,
            questionKey: result.questionKey, // 新しい構造化キー情報
          },
          timestamp: new Date(),
        });
      } else {
        // 完了イベント
        this.emitEvent({
          type: result.success ? "execution_completed" : "execution_failed",
          executionId: execution.id,
          sessionId: options.sessionId,
          taskId: options.taskId,
          data: result,
          timestamp: new Date(),
        });
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      state.status = "failed";

      // ファイルロガーにエラーを記録
      fileLogger.logError(
        "Execution failed with uncaught error",
        error instanceof Error ? error : new Error(errorMessage),
      );
      fileLogger.logExecutionEnd("failed", {
        success: false,
        errorMessage,
      });

      // エラー時の更新
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: "failed",
          output: state.output,
          completedAt: new Date(),
          errorMessage,
        },
      });

      this.emitEvent({
        type: "execution_failed",
        executionId: execution.id,
        sessionId: options.sessionId,
        taskId: options.taskId,
        data: { errorMessage },
        timestamp: new Date(),
      });

      throw error;
    } finally {
      // クリーンアップ
      await cleanupLogHandler(); // ログをフラッシュ
      await fileLogger.flush(); // ファイルロガーをフラッシュ
      this.activeExecutions.delete(execution.id);
      this.activeAgents.delete(execution.id); // アクティブエージェントから削除
      await agentFactory.removeAgent(agent.id);
    }
  }

  /**
   * 会話を継続（質問への回答）- 外部API用
   * ロック取得とステータス確認を行い、重複実行を防止する
   */
  async executeContinuation(
    executionId: number,
    response: string,
    options: Partial<ExecutionOptions> = {},
  ): Promise<AgentExecutionResult> {
    // ロックを取得（既に処理中なら早期リターン）
    if (!this.tryAcquireContinuationLock(executionId, "user_response")) {
      logger.info(
        `[Orchestrator] Skipping continuation for execution ${executionId} - already being processed`,
      );
      return {
        success: false,
        output: "",
        errorMessage: "This execution is already being processed",
      };
    }

    try {
      // 既存の実行を取得
      const execution = await this.prisma.agentExecution.findUnique({
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

      // ステータスチェック: running の場合は既に処理中
      if (execution.status === "running") {
        logger.info(
          `[Orchestrator] Execution ${executionId} is already running, skipping continuation`,
        );
        return {
          success: false,
          output: "",
          errorMessage: "Execution is already running",
        };
      }

      if (execution.status !== "waiting_for_input") {
        logger.info(
          `[Orchestrator] Execution ${executionId} is not waiting for input (status: ${execution.status})`,
        );
        return {
          success: false,
          output: "",
          errorMessage: `Execution is not waiting for input: ${execution.status}`,
        };
      }

      // ユーザーからの応答があったので、既存の質問タイムアウトをキャンセル
      this.cancelQuestionTimeout(executionId);

      // 内部処理を実行（ロックは継承）
      return await this.executeContinuationInternal(
        executionId,
        response,
        options,
      );
    } catch (error) {
      throw error;
    } finally {
      // ロックを解放
      this.releaseContinuationLock(executionId);
    }
  }

  /**
   * 会話を継続（質問への回答）- ロック取得済みの場合用
   * APIルートで既にロックを取得している場合に使用
   */
  async executeContinuationWithLock(
    executionId: number,
    response: string,
    options: Partial<ExecutionOptions> = {},
  ): Promise<AgentExecutionResult> {
    try {
      // 内部処理を実行
      return await this.executeContinuationInternal(
        executionId,
        response,
        options,
      );
    } finally {
      // ロックを解放
      this.releaseContinuationLock(executionId);
    }
  }

  /**
   * 会話を継続（質問への回答）- 内部用
   * ロック取得済みの状態で呼び出される
   */
  private async executeContinuationInternal(
    executionId: number,
    response: string,
    options: Partial<ExecutionOptions> = {},
  ): Promise<AgentExecutionResult> {
    // 既存の実行を取得
    const execution = await this.prisma.agentExecution.findUnique({
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

    // この時点ではステータスは running（タイムアウトハンドラ）または waiting_for_input（API経由）
    // どちらでも処理を続行する

    // タスク情報を取得
    const task = execution.session.config?.task;

    // 保存されているClaudeセッションIDを取得
    const claudeSessionId = execution.claudeSessionId;
    logger.info(
      `[Orchestrator] Resuming execution with claudeSessionId: ${claudeSessionId}`,
    );

    // エージェント設定を取得（--resumeでセッションを再開）
    let agentConfig: AgentConfigInput = {
      type: "claude-code",
      name: "Claude Code Agent",
      workingDirectory: task?.workingDirectory || undefined,
      timeout: options.timeout,
      dangerouslySkipPermissions: true,
      resumeSessionId: claudeSessionId || undefined, // --resumeで使用
      continueConversation: !claudeSessionId, // セッションIDがない場合のフォールバック
    };

    if (execution.agentConfigId) {
      const dbConfig = await this.prisma.aIAgentConfig.findUnique({
        where: { id: execution.agentConfigId },
      });
      if (dbConfig) {
        // APIキーが暗号化されて保存されている場合は復号
        let decryptedApiKey: string | undefined;
        if (dbConfig.apiKeyEncrypted) {
          try {
            decryptedApiKey = decrypt(dbConfig.apiKeyEncrypted);
          } catch (e) {
            logger.error(
              { err: e, agentId: dbConfig.id },
              `[Orchestrator] Failed to decrypt API key for agent`,
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
          resumeSessionId: claudeSessionId || undefined, // --resumeで使用
          continueConversation: !claudeSessionId, // セッションIDがない場合のフォールバック
        };
      }
    }

    // エージェントを作成
    let agent = agentFactory.createAgent(agentConfig);

    // タスクIDを取得
    const taskId = execution.session.config?.taskId || 0;

    // ファイルロガーを初期化（継続実行用）
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
    this.activeExecutions.set(execution.id, state);

    // アクティブエージェントを登録（グレースフルシャットダウン用）
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
    this.activeAgents.set(execution.id, agentInfo);

    // シャットダウン中は新しい実行を拒否
    if (this.isShuttingDown) {
      this.activeAgents.delete(execution.id);
      this.activeExecutions.delete(execution.id);
      fileLogger.logError("Server is shutting down, cannot continue execution");
      await fileLogger.flush();
      throw new Error("Server is shutting down, cannot continue execution");
    }

    // 質問検出ハンドラを設定（質問が検出されたら即座にDBを更新）
    agent.setQuestionDetectedHandler(async (info) => {
      logger.info(`[Orchestrator] Question detected during continuation!`);
      logger.info(
        `[Orchestrator] Question: ${info.question.substring(0, 100)}`,
      );
      logger.info(`[Orchestrator] Question type: ${info.questionType}`);
      logger.info(
        `[Orchestrator] Claude Session ID: ${info.claudeSessionId || "(なし)"}`,
      );
      fileLogger.logQuestionDetected(
        info.question,
        info.questionType,
        info.claudeSessionId,
      );

      try {
        // 即座にDBステータスを waiting_for_input に更新（セッションIDも保存）
        await this.prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: "waiting_for_input",
            question: info.question || null,
            questionType: info.questionType || null,
            questionDetails: toJsonString(info.questionDetails),
            claudeSessionId:
              info.claudeSessionId || execution.claudeSessionId || null,
          },
        });
        logger.info(
          `[Orchestrator] DB updated to waiting_for_input for execution ${execution.id}`,
        );

        // 状態も更新
        state.status = "waiting_for_input";

        // 質問タイムアウトを開始
        this.startQuestionTimeout(execution.id, taskId, info.questionKey);

        // タイムアウト情報を取得
        const timeoutInfo = this.getQuestionTimeoutInfo(execution.id);

        // イベントを発火（リアルタイム通知用）
        this.emitEvent({
          type: "execution_output",
          executionId: execution.id,
          sessionId: execution.sessionId,
          taskId,
          data: {
            output: `\n[質問] ${info.question}\n`,
            waitingForInput: true,
            question: info.question,
            questionType: info.questionType,
            questionDetails: info.questionDetails,
            questionKey: info.questionKey,
            // タイムアウト情報を追加
            questionTimeoutSeconds:
              timeoutInfo?.remainingSeconds || DEFAULT_QUESTION_TIMEOUT_SECONDS,
            questionTimeoutDeadline: timeoutInfo?.deadline?.toISOString(),
          },
          timestamp: new Date(),
        });
      } catch (error) {
        logger.error(
          { err: error },
          `[Orchestrator] Failed to update DB on question detection`,
        );
      }
    });

    // 出力ハンドラを設定（ログ保存機能付き）
    let lastDbUpdate = Date.now();
    const DB_UPDATE_INTERVAL = 200; // 0.2秒ごとにDBを更新
    let pendingDbUpdate = false;

    // 既存のログのシーケンス番号を取得
    const existingLogs = await this.prisma.agentExecutionLog.findMany({
      where: { executionId: execution.id },
      orderBy: { sequenceNumber: "desc" },
      take: 1,
    });
    let logSequenceNumber =
      existingLogs.length > 0 ? existingLogs[0].sequenceNumber + 1 : 0;
    let pendingLogChunks: {
      chunk: string;
      isError: boolean;
      timestamp: Date;
    }[] = [];
    let pendingLogSave = false;
    const LOG_BATCH_INTERVAL = 500;

    const flushLogChunks = async () => {
      if (pendingLogSave || pendingLogChunks.length === 0) return;
      pendingLogSave = true;
      const chunksToSave = [...pendingLogChunks];
      pendingLogChunks = [];

      try {
        const logEntries = chunksToSave.map((chunk) => ({
          executionId: execution.id,
          logChunk: chunk.chunk,
          logType: chunk.isError ? "stderr" : "stdout",
          sequenceNumber: logSequenceNumber++,
          timestamp: chunk.timestamp,
        }));

        await this.prisma.agentExecutionLog.createMany({
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

    const cleanupLogHandler = async () => {
      clearInterval(logFlushInterval);
      await flushLogChunks();
    };

    agent.setOutputHandler(async (output, isError) => {
      try {
        state.output += output;

        // ファイルロガーに出力を記録
        fileLogger.logOutput(output, isError ?? false);

        // アクティブエージェント情報を更新（グレースフルシャットダウン用）
        if (agentInfo) {
          agentInfo.lastOutput = state.output.slice(-2000); // 最後の2000文字を保持
          agentInfo.lastSavedAt = new Date();
        }

        // ログチャンクをキューに追加
        pendingLogChunks.push({
          chunk: output,
          isError: isError ?? false,
          timestamp: new Date(),
        });

        // エラー出力は即座にDBに保存（重要な情報のため）
        if (isError && output.trim()) {
          try {
            await this.prisma.agentExecution.update({
              where: { id: execution.id },
              data: {
                output: state.output,
                errorMessage: output.slice(-500), // 最後の500文字をエラーメッセージに
              },
            });
            lastDbUpdate = Date.now();
          } catch (e) {
            logger.error({ err: e }, "Failed to save error output immediately");
          }
        }

        if (options.onOutput) {
          try {
            options.onOutput(output, isError);
          } catch (e) {
            logger.error({ err: e }, "Error in onOutput callback");
          }
        }

        try {
          this.emitEvent({
            type: "execution_output",
            executionId: execution.id,
            sessionId: execution.sessionId,
            taskId,
            data: { output, isError },
            timestamp: new Date(),
          });
        } catch (e) {
          logger.error({ err: e }, "Error emitting event");
        }

        const now = Date.now();
        if (now - lastDbUpdate > DB_UPDATE_INTERVAL && !pendingDbUpdate) {
          pendingDbUpdate = true;
          lastDbUpdate = now;
          try {
            await this.prisma.agentExecution.update({
              where: { id: execution.id },
              data: { output: state.output },
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

    // 継続メッセージを追加
    const continueMessage = `\n[継続] ユーザーからの回答を受け取りました。実行を継続します...\n`;
    state.output += continueMessage;

    // 実行レコードを更新（再開）
    await this.prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "running",
        question: null, // 質問をクリア
        questionType: null, // 質問タイプもクリア
        questionDetails: null, // 質問詳細もクリア
        output: state.output,
      },
    });

    try {
      // タスクを作成（回答をプロンプトとして使用）
      const agentTask: AgentTask = {
        id: taskId,
        title: response,
        description: response,
        workingDirectory: task?.workingDirectory || undefined,
      };

      // エージェントを実行
      let result = await agent.execute(agentTask);

      // --resume でセッション再開に失敗した場合のフォールバック
      // 実行時間が短い（10秒未満）場合、またはエラーメッセージがセッション関連の場合は
      // セッション再開失敗と判断してフォールバックを試みる
      const isSessionResumeFailure =
        !result.success &&
        !result.waitingForInput &&
        claudeSessionId &&
        ((result.executionTimeMs !== undefined &&
          result.executionTimeMs < 10000) ||
          (result.errorMessage &&
            /session|expired|invalid|not found|code 1/i.test(
              result.errorMessage,
            )));
      if (isSessionResumeFailure) {
        logger.info(
          `[Orchestrator] Session resume failed (executionTime: ${result.executionTimeMs}ms, error: ${result.errorMessage?.substring(0, 100)}). Retrying --resume after delay...`,
        );
        fileLogger.logError(
          `Session resume failed with --resume ${claudeSessionId}. Retrying after 3s delay.`,
        );

        // 前のエージェントをクリーンアップ
        await agentFactory.removeAgent(agent.id);

        // セッションの保存が完了するまで待機してからリトライ
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // --resume で再試行（同じセッションIDを使用）
        const retryAgent = agentFactory.createAgent(agentConfig);

        // ハンドラを再設定（リトライ用）
        retryAgent.setQuestionDetectedHandler(async (info) => {
          logger.info(`[Orchestrator] Question detected during resume retry!`);
          fileLogger.logQuestionDetected(
            info.question,
            info.questionType,
            info.claudeSessionId,
          );
          try {
            await this.prisma.agentExecution.update({
              where: { id: execution.id },
              data: {
                status: "waiting_for_input",
                question: info.question || null,
                questionType: info.questionType || null,
                questionDetails: toJsonString(info.questionDetails),
                claudeSessionId:
                  info.claudeSessionId || execution.claudeSessionId || null,
              },
            });
            state.status = "waiting_for_input";
            this.startQuestionTimeout(execution.id, taskId, info.questionKey);
            const timeoutInfo = this.getQuestionTimeoutInfo(execution.id);
            this.emitEvent({
              type: "execution_output",
              executionId: execution.id,
              sessionId: execution.sessionId,
              taskId,
              data: {
                output: `\n[質問] ${info.question}\n`,
                waitingForInput: true,
                question: info.question,
                questionType: info.questionType,
                questionDetails: info.questionDetails,
                questionKey: info.questionKey,
                questionTimeoutSeconds:
                  timeoutInfo?.remainingSeconds ||
                  DEFAULT_QUESTION_TIMEOUT_SECONDS,
                questionTimeoutDeadline: timeoutInfo?.deadline?.toISOString(),
              },
              timestamp: new Date(),
            });
          } catch (error) {
            logger.error(
              { err: error },
              `[Orchestrator] Failed to update DB on question detection (resume retry)`,
            );
          }
        });

        retryAgent.setOutputHandler(async (output, isError) => {
          state.output += output;
          fileLogger.logOutput(output, isError ?? false);
          if (agentInfo) {
            agentInfo.lastOutput = state.output.slice(-2000);
            agentInfo.lastSavedAt = new Date();
          }
          pendingLogChunks.push({
            chunk: output,
            isError: isError ?? false,
            timestamp: new Date(),
          });
          try {
            this.emitEvent({
              type: "execution_output",
              executionId: execution.id,
              sessionId: execution.sessionId,
              taskId,
              data: { output, isError },
              timestamp: new Date(),
            });
          } catch (e) {
            logger.error({ err: e }, "Error emitting resume retry event");
          }
        });

        agent = retryAgent;
        agentInfo.agent = retryAgent;

        const retryMessage = `\n[セッション再開] --resume の再試行を行っています...\n`;
        state.output += retryMessage;
        this.emitEvent({
          type: "execution_output",
          executionId: execution.id,
          sessionId: execution.sessionId,
          taskId,
          data: { output: retryMessage },
          timestamp: new Date(),
        });

        const retryResult = await retryAgent.execute(agentTask);

        // リトライも失敗した場合は --continue にフォールバック
        const isRetryFailure =
          !retryResult.success &&
          !retryResult.waitingForInput &&
          ((retryResult.executionTimeMs !== undefined &&
            retryResult.executionTimeMs < 10000) ||
            (retryResult.errorMessage &&
              /session|expired|invalid|not found|code 1/i.test(
                retryResult.errorMessage,
              )));

        if (!isRetryFailure) {
          // リトライ成功
          result = retryResult;
        } else {
          logger.info(
            `[Orchestrator] --resume retry also failed. Attempting fallback with --continue...`,
          );
          fileLogger.logError(
            `--resume retry also failed. Attempting --continue fallback.`,
          );
          await agentFactory.removeAgent(retryAgent.id);

          // --continue でフォールバック（最新の会話を継続）
          const fallbackConfig: AgentConfigInput = {
            ...agentConfig,
            resumeSessionId: undefined,
            continueConversation: true,
          };
          const fallbackAgent = agentFactory.createAgent(fallbackConfig);

          // ハンドラを再設定
          fallbackAgent.setQuestionDetectedHandler(async (info) => {
            logger.info(
              `[Orchestrator] Question detected during continuation fallback!`,
            );
            fileLogger.logQuestionDetected(
              info.question,
              info.questionType,
              info.claudeSessionId,
            );
            try {
              await this.prisma.agentExecution.update({
                where: { id: execution.id },
                data: {
                  status: "waiting_for_input",
                  question: info.question || null,
                  questionType: info.questionType || null,
                  questionDetails: toJsonString(info.questionDetails),
                  claudeSessionId:
                    info.claudeSessionId || execution.claudeSessionId || null,
                },
              });
              state.status = "waiting_for_input";
              this.startQuestionTimeout(execution.id, taskId, info.questionKey);
              const timeoutInfo = this.getQuestionTimeoutInfo(execution.id);
              this.emitEvent({
                type: "execution_output",
                executionId: execution.id,
                sessionId: execution.sessionId,
                taskId,
                data: {
                  output: `\n[質問] ${info.question}\n`,
                  waitingForInput: true,
                  question: info.question,
                  questionType: info.questionType,
                  questionDetails: info.questionDetails,
                  questionKey: info.questionKey,
                  questionTimeoutSeconds:
                    timeoutInfo?.remainingSeconds ||
                    DEFAULT_QUESTION_TIMEOUT_SECONDS,
                  questionTimeoutDeadline: timeoutInfo?.deadline?.toISOString(),
                },
                timestamp: new Date(),
              });
            } catch (error) {
              logger.error(
                { err: error },
                `[Orchestrator] Failed to update DB on question detection (fallback)`,
              );
            }
          });

          fallbackAgent.setOutputHandler(async (output, isError) => {
            state.output += output;
            fileLogger.logOutput(output, isError ?? false);
            if (agentInfo) {
              agentInfo.lastOutput = state.output.slice(-2000);
              agentInfo.lastSavedAt = new Date();
            }
            // ログチャンクをキューに追加（リアルタイム通知用）
            pendingLogChunks.push({
              chunk: output,
              isError: isError ?? false,
              timestamp: new Date(),
            });
            // イベントを発火してフロントエンドにリアルタイム通知
            try {
              this.emitEvent({
                type: "execution_output",
                executionId: execution.id,
                sessionId: execution.sessionId,
                taskId,
                data: { output, isError },
                timestamp: new Date(),
              });
            } catch (e) {
              logger.error({ err: e }, "Error emitting fallback event");
            }
          });

          // アクティブエージェントを更新
          agent = fallbackAgent;
          agentInfo.agent = fallbackAgent;

          // フォールバック通知
          const fallbackMessage = `\n[セッション再開] --resume が失敗したため、--continue で再試行しています...\n`;
          state.output += fallbackMessage;
          this.emitEvent({
            type: "execution_output",
            executionId: execution.id,
            sessionId: execution.sessionId,
            taskId,
            data: { output: fallbackMessage },
            timestamp: new Date(),
          });

          const fallbackResult = await fallbackAgent.execute(agentTask);

          // --continue でも失敗した場合は、新規セッションでリトライ
          const isContinueFallbackFailure =
            !fallbackResult.success &&
            !fallbackResult.waitingForInput &&
            ((fallbackResult.executionTimeMs !== undefined &&
              fallbackResult.executionTimeMs < 10000) ||
              (fallbackResult.errorMessage &&
                /session|expired|invalid|not found|code 1/i.test(
                  fallbackResult.errorMessage,
                )));
          if (isContinueFallbackFailure) {
            logger.info(
              `[Orchestrator] --continue fallback also failed (executionTime: ${fallbackResult.executionTimeMs}ms). Attempting new session with context...`,
            );
            fileLogger.logError(
              `--continue fallback also failed. Starting new session with context.`,
            );

            await agentFactory.removeAgent(fallbackAgent.id);

            // 新規セッションで前回のコンテキストを引き継ぐ
            const newSessionConfig: AgentConfigInput = {
              ...agentConfig,
              resumeSessionId: undefined,
              continueConversation: false,
            };
            const newAgent = agentFactory.createAgent(newSessionConfig);

            // ハンドラを再設定
            newAgent.setQuestionDetectedHandler(async (info) => {
              logger.info(
                `[Orchestrator] Question detected during new session retry!`,
              );
              fileLogger.logQuestionDetected(
                info.question,
                info.questionType,
                info.claudeSessionId,
              );
              try {
                await this.prisma.agentExecution.update({
                  where: { id: execution.id },
                  data: {
                    status: "waiting_for_input",
                    question: info.question || null,
                    questionType: info.questionType || null,
                    questionDetails: toJsonString(info.questionDetails),
                    claudeSessionId: info.claudeSessionId || null,
                  },
                });
                state.status = "waiting_for_input";
                this.startQuestionTimeout(
                  execution.id,
                  taskId,
                  info.questionKey,
                );
                const timeoutInfo = this.getQuestionTimeoutInfo(execution.id);
                this.emitEvent({
                  type: "execution_output",
                  executionId: execution.id,
                  sessionId: execution.sessionId,
                  taskId,
                  data: {
                    output: `\n[質問] ${info.question}\n`,
                    waitingForInput: true,
                    question: info.question,
                    questionType: info.questionType,
                    questionDetails: info.questionDetails,
                    questionKey: info.questionKey,
                    questionTimeoutSeconds:
                      timeoutInfo?.remainingSeconds ||
                      DEFAULT_QUESTION_TIMEOUT_SECONDS,
                    questionTimeoutDeadline:
                      timeoutInfo?.deadline?.toISOString(),
                  },
                  timestamp: new Date(),
                });
              } catch (error) {
                logger.error(
                  { err: error },
                  `[Orchestrator] Failed to update DB on question detection (new session)`,
                );
              }
            });

            newAgent.setOutputHandler(async (output, isError) => {
              state.output += output;
              fileLogger.logOutput(output, isError ?? false);
              if (agentInfo) {
                agentInfo.lastOutput = state.output.slice(-2000);
                agentInfo.lastSavedAt = new Date();
              }
              // ログチャンクをキューに追加（リアルタイム通知用）
              pendingLogChunks.push({
                chunk: output,
                isError: isError ?? false,
                timestamp: new Date(),
              });
              // イベントを発火してフロントエンドにリアルタイム通知
              try {
                this.emitEvent({
                  type: "execution_output",
                  executionId: execution.id,
                  sessionId: execution.sessionId,
                  taskId,
                  data: { output, isError },
                  timestamp: new Date(),
                });
              } catch (e) {
                logger.error({ err: e }, "Error emitting new session event");
              }
            });

            agent = newAgent;
            agentInfo.agent = newAgent;

            // コンテキスト付きのプロンプトを構築
            const previousContext = (execution.output || "").slice(-2000);
            const contextPrompt = `以下は前回のタスク実行の継続です。前回のコンテキスト（最後の部分）:\n\n${previousContext}\n\n前回の質問に対するユーザーの回答: ${response}\n\n上記の回答を踏まえて、タスクの実行を継続してください。`;

            const contextTask: AgentTask = {
              id: taskId,
              title: contextPrompt,
              description: contextPrompt,
              workingDirectory: task?.workingDirectory || undefined,
            };

            const newSessionMessage = `\n[セッション再開] 新しいセッションでコンテキストを引き継いで実行を継続します...\n`;
            state.output += newSessionMessage;
            this.emitEvent({
              type: "execution_output",
              executionId: execution.id,
              sessionId: execution.sessionId,
              taskId,
              data: { output: newSessionMessage },
              timestamp: new Date(),
            });

            result = await newAgent.execute(contextTask);
          } else {
            result = fallbackResult;
          }
        }
      }

      // ステータス判定
      let executionStatus: string;
      if (result.waitingForInput) {
        executionStatus = "waiting_for_input";
        state.status = "waiting_for_input";
        fileLogger.logStatusChange(
          "running",
          "waiting_for_input",
          "Question detected during continuation",
        );
      } else if (result.success) {
        executionStatus = "completed";
        state.status = "completed";
        fileLogger.logExecutionEnd("completed", {
          success: true,
          tokensUsed: result.tokensUsed,
          executionTimeMs: result.executionTimeMs,
        });
      } else {
        executionStatus = "failed";
        state.status = "failed";
        fileLogger.logExecutionEnd("failed", {
          success: false,
          tokensUsed: result.tokensUsed,
          executionTimeMs: result.executionTimeMs,
          errorMessage: result.errorMessage,
        });
      }

      // 実行レコードを更新（claudeSessionIdを更新して会話継続に備える）
      // state.outputにはexecution.output（既存出力）+ 新しい出力チャンクが蓄積済み
      // result.outputはエージェントの生出力のみなので、state.outputを使用する
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: executionStatus,
          output: state.output,
          artifacts: result.artifacts
            ? toJsonString(result.artifacts)
            : execution.artifacts,
          completedAt: result.waitingForInput ? null : new Date(),
          tokensUsed: (execution.tokensUsed || 0) + (result.tokensUsed || 0),
          executionTimeMs:
            (execution.executionTimeMs || 0) + (result.executionTimeMs || 0),
          errorMessage: result.errorMessage,
          question: result.question || null,
          questionType: result.questionType || null,
          questionDetails: toJsonString(result.questionDetails),
          // セッションIDを更新（新しいセッションが作成された場合）
          claudeSessionId:
            result.claudeSessionId || execution.claudeSessionId || null,
        },
      });

      // セッションのトークン使用量を更新
      if (result.tokensUsed) {
        await this.prisma.agentSession.update({
          where: { id: execution.sessionId },
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
          await this.prisma.gitCommit.create({
            data: {
              executionId: execution.id,
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

      // イベント発火
      if (result.waitingForInput) {
        this.emitEvent({
          type: "execution_output",
          executionId: execution.id,
          sessionId: execution.sessionId,
          taskId,
          data: {
            output: result.output,
            waitingForInput: true,
            question: result.question,
            questionType: result.questionType,
            questionDetails: result.questionDetails,
            questionKey: result.questionKey, // 新しい構造化キー情報
          },
          timestamp: new Date(),
        });
      } else {
        this.emitEvent({
          type: result.success ? "execution_completed" : "execution_failed",
          executionId: execution.id,
          sessionId: execution.sessionId,
          taskId,
          data: result,
          timestamp: new Date(),
        });
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      state.status = "failed";

      fileLogger.logError(
        "Continuation failed with uncaught error",
        error instanceof Error ? error : new Error(errorMessage),
      );
      fileLogger.logExecutionEnd("failed", {
        success: false,
        errorMessage,
      });

      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: "failed",
          output: state.output,
          completedAt: new Date(),
          errorMessage,
        },
      });

      this.emitEvent({
        type: "execution_failed",
        executionId: execution.id,
        sessionId: execution.sessionId,
        taskId,
        data: { errorMessage },
        timestamp: new Date(),
      });

      throw error;
    } finally {
      await cleanupLogHandler(); // ログをフラッシュ
      await fileLogger.flush(); // ファイルロガーをフラッシュ
      this.activeExecutions.delete(execution.id);
      this.activeAgents.delete(execution.id); // アクティブエージェントから削除
      await agentFactory.removeAgent(agent.id);
    }
  }

  /**
   * 実行を停止
   */
  async stopExecution(executionId: number): Promise<boolean> {
    // 質問タイムアウトがあればキャンセル
    this.cancelQuestionTimeout(executionId);

    // 継続ロックがあれば解放
    this.releaseContinuationLock(executionId);

    const state = this.activeExecutions.get(executionId);
    if (!state) {
      logger.info(
        `[Orchestrator] stopExecution: No active execution found for ${executionId}`,
      );
      return false;
    }

    const agent = agentFactory.getAgent(state.agentId);
    if (!agent) {
      logger.info(
        `[Orchestrator] stopExecution: No agent found for ${state.agentId}`,
      );
      // エージェントが見つからなくてもDBとマップはクリーンアップ
      this.activeExecutions.delete(executionId);
      this.activeAgents.delete(executionId);
      return false;
    }

    try {
      await agent.stop();
    } catch (error) {
      logger.error({ err: error }, `[Orchestrator] Error stopping agent`);
    }

    // 実行レコードを更新
    await this.prisma.agentExecution.update({
      where: { id: executionId },
      data: {
        status: "cancelled",
        output: state.output,
        completedAt: new Date(),
        errorMessage: "Cancelled by user",
      },
    });

    // マップからクリーンアップ
    this.activeExecutions.delete(executionId);
    this.activeAgents.delete(executionId);
    await agentFactory.removeAgent(state.agentId);

    this.emitEvent({
      type: "execution_cancelled",
      executionId,
      sessionId: state.sessionId,
      taskId: state.taskId,
      timestamp: new Date(),
    });

    logger.info(
      `[Orchestrator] Execution ${executionId} stopped and cleaned up`,
    );
    return true;
  }

  /**
   * 中断された実行を再開する
   * 前回の実行ログとタスク情報を基に、エージェントに作業再開を指示
   */
  async resumeInterruptedExecution(
    executionId: number,
    options: Partial<ExecutionOptions> = {},
  ): Promise<AgentExecutionResult> {
    // 中断された実行を取得
    const execution = await this.prisma.agentExecution.findUnique({
      where: { id: executionId },
      include: {
        session: {
          include: {
            config: {
              include: {
                task: {
                  include: {
                    theme: true,
                  },
                },
              },
            },
          },
        },
        executionLogs: {
          orderBy: { sequenceNumber: "asc" },
        },
      },
    });

    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (execution.status !== "interrupted") {
      throw new Error(
        `Execution is not in interrupted state: ${execution.status}`,
      );
    }

    const task = execution.session.config?.task;
    if (!task) {
      throw new Error(`Task not found for execution: ${executionId}`);
    }

    const workingDirectory =
      task.theme?.workingDirectory || options.workingDirectory || process.cwd();
    const claudeSessionId = execution.claudeSessionId;

    logger.info(`[Orchestrator] Resuming interrupted execution ${executionId}`);
    logger.info(`[Orchestrator] Task: ${task.title} (ID: ${task.id})`);
    logger.info(
      `[Orchestrator] Claude Session ID: ${claudeSessionId || "(なし - 新規セッションで開始)"}`,
    );
    logger.info(`[Orchestrator] Working Directory: ${workingDirectory}`);

    // セッションIDがない場合の警告
    if (!claudeSessionId) {
      logger.warn(
        `[Orchestrator] WARNING: No Claude session ID found for execution ${executionId}. Starting as new session.`,
      );
    }

    // 前回の実行ログを取得して要約を作成
    const previousOutput = execution.output || "";
    const lastOutput = previousOutput.slice(-3000); // 最後の3000文字

    // 実行ログからコンテキストを構築
    const logSummary = execution.executionLogs
      .slice(-50) // 最後の50件のログ
      .map((log: { logChunk: string }) => log.logChunk)
      .join("");

    // 再開用のプロンプトを構築
    const resumePrompt = this.buildResumePrompt(
      task,
      lastOutput,
      logSummary.slice(-2000),
      execution.errorMessage,
    );

    // エージェント設定を取得
    // 注意: セッションIDがない場合は --continue を使わず新規セッションで開始
    // --continue は「最新の会話」を再開するが、別のタスクの会話が再開される可能性がある
    let agentConfig: AgentConfigInput = {
      type: "claude-code",
      name: "Claude Code Agent",
      workingDirectory,
      timeout: options.timeout || 900000, // 15分
      dangerouslySkipPermissions: true,
      resumeSessionId: claudeSessionId || undefined,
      continueConversation: false, // セッションIDがある場合のみ再開を試みる
    };

    if (execution.agentConfigId) {
      const dbConfig = await this.prisma.aIAgentConfig.findUnique({
        where: { id: execution.agentConfigId },
      });
      if (dbConfig) {
        // APIキーが暗号化されて保存されている場合は復号
        let decryptedApiKey: string | undefined;
        if (dbConfig.apiKeyEncrypted) {
          try {
            decryptedApiKey = decrypt(dbConfig.apiKeyEncrypted);
          } catch (e) {
            logger.error(
              { err: e, agentId: dbConfig.id },
              `[Orchestrator] Failed to decrypt API key for agent`,
            );
          }
        }

        agentConfig = {
          type: (dbConfig.agentType as AgentType) || "claude-code",
          name: dbConfig.name,
          endpoint: dbConfig.endpoint || undefined,
          apiKey: decryptedApiKey,
          modelId: dbConfig.modelId || undefined,
          workingDirectory,
          timeout: options.timeout || 900000,
          dangerouslySkipPermissions: true,
          yoloMode: true,
          resumeSessionId: claudeSessionId || undefined,
          continueConversation: false, // セッションIDがある場合のみ再開を試みる
        };
      }
    }

    // エージェントを作成
    const agent = agentFactory.createAgent(agentConfig);

    // タスクIDを取得
    const taskId = task.id;

    // ファイルロガーを初期化（再開実行用）
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

    // 実行状態を追跡
    const state: ExecutionState = {
      executionId: execution.id,
      sessionId: execution.sessionId,
      agentId: agent.id,
      taskId,
      status: "running",
      startedAt: new Date(),
      output: previousOutput, // 前回の出力を引き継ぐ
    };
    this.activeExecutions.set(execution.id, state);

    // アクティブエージェントを登録
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
    this.activeAgents.set(execution.id, agentInfo);

    // シャットダウン中は新しい実行を拒否
    if (this.isShuttingDown) {
      this.activeAgents.delete(execution.id);
      this.activeExecutions.delete(execution.id);
      fileLogger.logError("Server is shutting down, cannot resume execution");
      await fileLogger.flush();
      throw new Error("Server is shutting down, cannot resume execution");
    }

    // 質問検出ハンドラを設定
    agent.setQuestionDetectedHandler(async (info) => {
      logger.info(`[Orchestrator] Question detected during resume!`);
      logger.info(
        `[Orchestrator] Question: ${info.question.substring(0, 100)}`,
      );
      logger.info(
        `[Orchestrator] Claude Session ID: ${info.claudeSessionId || "(なし)"}`,
      );
      fileLogger.logQuestionDetected(
        info.question,
        info.questionType,
        info.claudeSessionId,
      );

      try {
        await this.prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: "waiting_for_input",
            question: info.question || null,
            questionType: info.questionType || null,
            questionDetails: toJsonString(info.questionDetails),
            claudeSessionId:
              info.claudeSessionId || execution.claudeSessionId || null,
          },
        });

        state.status = "waiting_for_input";
        this.startQuestionTimeout(execution.id, taskId, info.questionKey);

        const timeoutInfo = this.getQuestionTimeoutInfo(execution.id);

        this.emitEvent({
          type: "execution_output",
          executionId: execution.id,
          sessionId: execution.sessionId,
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
          `[Orchestrator] Failed to update DB on question detection`,
        );
      }
    });

    // 出力ハンドラを設定
    let lastDbUpdate = Date.now();
    const DB_UPDATE_INTERVAL = 200;
    let pendingDbUpdate = false;

    // 既存のログのシーケンス番号を取得
    const existingLogs = await this.prisma.agentExecutionLog.findMany({
      where: { executionId: execution.id },
      orderBy: { sequenceNumber: "desc" },
      take: 1,
    });
    let logSequenceNumber =
      existingLogs.length > 0 ? existingLogs[0].sequenceNumber + 1 : 0;
    let pendingLogChunks: {
      chunk: string;
      isError: boolean;
      timestamp: Date;
    }[] = [];
    let pendingLogSave = false;
    const LOG_BATCH_INTERVAL = 500;

    const flushLogChunks = async () => {
      if (pendingLogSave || pendingLogChunks.length === 0) return;
      pendingLogSave = true;
      const chunksToSave = [...pendingLogChunks];
      pendingLogChunks = [];

      try {
        const logEntries = chunksToSave.map((chunk) => ({
          executionId: execution.id,
          logChunk: chunk.chunk,
          logType: chunk.isError ? "stderr" : "stdout",
          sequenceNumber: logSequenceNumber++,
          timestamp: chunk.timestamp,
        }));

        await this.prisma.agentExecutionLog.createMany({
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

    const cleanupLogHandler = async () => {
      clearInterval(logFlushInterval);
      await flushLogChunks();
    };

    agent.setOutputHandler(async (output, isError) => {
      try {
        state.output += output;

        // ファイルロガーに出力を記録
        fileLogger.logOutput(output, isError ?? false);

        if (agentInfo) {
          agentInfo.lastOutput = state.output.slice(-2000);
          agentInfo.lastSavedAt = new Date();
        }

        pendingLogChunks.push({
          chunk: output,
          isError: isError ?? false,
          timestamp: new Date(),
        });

        if (isError && output.trim()) {
          try {
            await this.prisma.agentExecution.update({
              where: { id: execution.id },
              data: {
                output: state.output,
                errorMessage: output.slice(-500),
              },
            });
            lastDbUpdate = Date.now();
          } catch (e) {
            logger.error({ err: e }, "Failed to save error output immediately");
          }
        }

        if (options.onOutput) {
          try {
            options.onOutput(output, isError);
          } catch (e) {
            logger.error({ err: e }, "Error in onOutput callback");
          }
        }

        try {
          this.emitEvent({
            type: "execution_output",
            executionId: execution.id,
            sessionId: execution.sessionId,
            taskId,
            data: { output, isError },
            timestamp: new Date(),
          });
        } catch (e) {
          logger.error({ err: e }, "Error emitting event");
        }

        const now = Date.now();
        if (now - lastDbUpdate > DB_UPDATE_INTERVAL && !pendingDbUpdate) {
          pendingDbUpdate = true;
          lastDbUpdate = now;
          try {
            await this.prisma.agentExecution.update({
              where: { id: execution.id },
              data: { output: state.output },
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

    // 再開メッセージを追加
    const resumeMessage = `\n[再開] 中断された作業を再開します...\n`;
    state.output += resumeMessage;

    // 実行レコードを更新（再開）
    await this.prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "running",
        errorMessage: null, // エラーメッセージをクリア
        output: state.output,
      },
    });

    // 実行開始イベント
    this.emitEvent({
      type: "execution_started",
      executionId: execution.id,
      sessionId: execution.sessionId,
      taskId,
      data: { resumed: true },
      timestamp: new Date(),
    });

    try {
      // 再開用タスクを作成
      const agentTask: AgentTask = {
        id: taskId,
        title: task.title,
        description: resumePrompt,
        workingDirectory,
      };

      // エージェントを実行
      const result = await agent.execute(agentTask);

      // ステータス判定
      let executionStatus: string;
      if (result.waitingForInput) {
        executionStatus = "waiting_for_input";
        state.status = "waiting_for_input";
        fileLogger.logStatusChange(
          "running",
          "waiting_for_input",
          "Question detected during resume",
        );
      } else if (result.success) {
        executionStatus = "completed";
        state.status = "completed";
        fileLogger.logExecutionEnd("completed", {
          success: true,
          tokensUsed: result.tokensUsed,
          executionTimeMs: result.executionTimeMs,
        });
      } else {
        executionStatus = "failed";
        state.status = "failed";
        fileLogger.logExecutionEnd("failed", {
          success: false,
          tokensUsed: result.tokensUsed,
          executionTimeMs: result.executionTimeMs,
          errorMessage: result.errorMessage,
        });
      }

      // 実行レコードを更新
      // state.outputにはexecution.output（既存出力）+ 新しい出力チャンクが蓄積済み
      // result.outputはエージェントの生出力のみなので、state.outputを使用する
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: executionStatus,
          output: state.output,
          artifacts: result.artifacts
            ? toJsonString(result.artifacts)
            : execution.artifacts,
          completedAt: result.waitingForInput ? null : new Date(),
          tokensUsed: (execution.tokensUsed || 0) + (result.tokensUsed || 0),
          executionTimeMs:
            (execution.executionTimeMs || 0) + (result.executionTimeMs || 0),
          errorMessage: result.errorMessage,
          question: result.question || null,
          questionType: result.questionType || null,
          questionDetails: toJsonString(result.questionDetails),
          claudeSessionId:
            result.claudeSessionId || execution.claudeSessionId || null,
        },
      });

      // セッションのトークン使用量を更新
      if (result.tokensUsed) {
        await this.prisma.agentSession.update({
          where: { id: execution.sessionId },
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
          await this.prisma.gitCommit.create({
            data: {
              executionId: execution.id,
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

      // イベント発火
      if (result.waitingForInput) {
        this.emitEvent({
          type: "execution_output",
          executionId: execution.id,
          sessionId: execution.sessionId,
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
        this.emitEvent({
          type: result.success ? "execution_completed" : "execution_failed",
          executionId: execution.id,
          sessionId: execution.sessionId,
          taskId,
          data: result,
          timestamp: new Date(),
        });
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      state.status = "failed";

      fileLogger.logError(
        "Resume execution failed with uncaught error",
        error instanceof Error ? error : new Error(errorMessage),
      );
      fileLogger.logExecutionEnd("failed", {
        success: false,
        errorMessage,
      });

      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: "failed",
          output: state.output,
          completedAt: new Date(),
          errorMessage,
        },
      });

      this.emitEvent({
        type: "execution_failed",
        executionId: execution.id,
        sessionId: execution.sessionId,
        taskId,
        data: { errorMessage },
        timestamp: new Date(),
      });

      throw error;
    } finally {
      await cleanupLogHandler();
      await fileLogger.flush(); // ファイルロガーをフラッシュ
      this.activeExecutions.delete(execution.id);
      this.activeAgents.delete(execution.id);
      await agentFactory.removeAgent(agent.id);
    }
  }

  /**
   * 再開用のプロンプトを構築
   */
  private buildResumePrompt(
    task: { title: string; description: string | null },
    lastOutput: string,
    logSummary: string,
    errorMessage: string | null,
  ): string {
    let prompt = `# 作業再開

このタスクは以前のセッションで中断されました。作業を途中から再開してください。

## タスク情報
- タイトル: ${task.title}
- 説明: ${task.description || "なし"}

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

  /**
   * アクティブな実行を取得
   */
  getActiveExecutions(): ExecutionState[] {
    return Array.from(this.activeExecutions.values());
  }

  /**
   * 特定のセッションの実行を取得
   */
  getSessionExecutions(sessionId: number): ExecutionState[] {
    return Array.from(this.activeExecutions.values()).filter(
      (state) => state.sessionId === sessionId,
    );
  }

  /**
   * 実行状態を取得
   */
  getExecutionState(executionId: number): ExecutionState | undefined {
    return this.activeExecutions.get(executionId);
  }

  // ==================== Git操作 ====================

  /**
   * 作業ディレクトリのgit diffを取得
   */
  async getGitDiff(workingDirectory: string): Promise<string> {
    try {
      const { stdout } = await execAsync("git diff", {
        cwd: workingDirectory,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      logger.error({ err: error }, "Failed to get git diff");
      return "";
    }
  }

  /**
   * ステージされていない変更も含めた全diffを取得
   */
  async getFullGitDiff(workingDirectory: string): Promise<string> {
    try {
      // ステージされた変更
      const { stdout: staged } = await execAsync("git diff --cached", {
        cwd: workingDirectory,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      // ステージされていない変更
      const { stdout: unstaged } = await execAsync("git diff", {
        cwd: workingDirectory,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      // 新規ファイル
      const { stdout: untracked } = await execAsync(
        "git ls-files --others --exclude-standard",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      let result = "";
      if (staged) result += "=== Staged Changes ===\n" + staged + "\n";
      if (unstaged) result += "=== Unstaged Changes ===\n" + unstaged + "\n";
      if (untracked.trim()) result += "=== New Files ===\n" + untracked + "\n";

      return result || "No changes detected";
    } catch (error) {
      logger.error({ err: error }, "Failed to get full git diff");
      return "";
    }
  }

  /**
   * 変更をコミット
   */
  async commitChanges(
    workingDirectory: string,
    message: string,
    taskTitle?: string,
  ): Promise<{ success: boolean; commitHash?: string; error?: string }> {
    try {
      // すべての変更をステージ
      await execAsync("git add -A", { cwd: workingDirectory });

      // コミットメッセージを作成
      const fullMessage = taskTitle
        ? `${message}\n\nTask: ${taskTitle}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`
        : `${message}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;

      // コミット
      const { stdout } = await execAsync(
        `git commit -m "${fullMessage.replace(/"/g, '\\"')}"`,
        { cwd: workingDirectory, encoding: "utf8" },
      );

      // コミットハッシュを取得
      const { stdout: hash } = await execAsync("git rev-parse HEAD", {
        cwd: workingDirectory,
        encoding: "utf8",
      });

      return { success: true, commitHash: hash.trim() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * PRを作成
   */
  async createPullRequest(
    workingDirectory: string,
    title: string,
    body: string,
    baseBranch: string = "main",
  ): Promise<{
    success: boolean;
    prUrl?: string;
    prNumber?: number;
    error?: string;
  }> {
    try {
      // ghコマンドのパス
      const ghPath =
        process.platform === "win32"
          ? '"C:\\Program Files\\GitHub CLI\\gh.exe"'
          : "gh";

      // 現在のブランチ名を取得
      const { stdout: currentBranch } = await execAsync(
        "git branch --show-current",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      // リモートにプッシュ
      await execAsync(`git push -u origin ${currentBranch.trim()}`, {
        cwd: workingDirectory,
      });

      // PR作成
      const { stdout } = await execAsync(
        `${ghPath} pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --base ${baseBranch}`,
        { cwd: workingDirectory, encoding: "utf8" },
      );

      // PR URLからPR番号を抽出
      const prUrl = stdout.trim();
      const prMatch = prUrl.match(/\/pull\/(\d+)/);

      if (!prMatch || !prMatch[1]) {
        return { success: false, error: "Failed to parse PR number from URL" };
      }

      const prNumber = prMatch ? parseInt(prMatch[1], 10) : undefined;

      return { success: true, prUrl, prNumber };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * PRを自動マージする
   * コミット数が閾値以上の場合はsquash merge、未満の場合は通常のmerge commitを使用
   */
  async mergePullRequest(
    workingDirectory: string,
    prNumber: number,
    commitThreshold: number = 5,
    baseBranch: string = "master",
  ): Promise<{
    success: boolean;
    mergeStrategy?: "squash" | "merge";
    error?: string;
  }> {
    try {
      const ghPath =
        process.platform === "win32"
          ? '"C:\\Program Files\\GitHub CLI\\gh.exe"'
          : "gh";

      // PRのコミット数を取得
      const { stdout } = await execAsync(
        `${ghPath} pr view ${prNumber} --json commits --jq ".commits | length"`,
        { cwd: workingDirectory, encoding: "utf8" },
      );
      const commitCount = parseInt(stdout.trim(), 10) || 1;
      const mergeStrategy =
        commitCount >= commitThreshold ? "squash" : "merge";
      const mergeFlag =
        mergeStrategy === "squash" ? "--squash" : "--merge";

      // マージ + リモートブランチ削除
      await execAsync(
        `${ghPath} pr merge ${prNumber} ${mergeFlag} --delete-branch`,
        { cwd: workingDirectory, encoding: "utf8" },
      );

      // ベースブランチに戻って最新化
      await execAsync(`git checkout ${baseBranch}`, {
        cwd: workingDirectory,
      });
      await execAsync("git pull", { cwd: workingDirectory });

      return { success: true, mergeStrategy };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 変更を元に戻す
   */
  async revertChanges(workingDirectory: string): Promise<boolean> {
    try {
      // ステージされた変更を取り消し
      await execAsync("git reset HEAD", { cwd: workingDirectory });
      // 変更を破棄
      await execAsync("git checkout -- .", { cwd: workingDirectory });
      // 新規ファイルを削除
      await execAsync("git clean -fd", { cwd: workingDirectory });
      return true;
    } catch (error) {
      logger.error({ err: error }, "Failed to revert changes");
      return false;
    }
  }

  /**
   * 新しいブランチを作成してチェックアウト
   */
  async createBranch(
    workingDirectory: string,
    branchName: string,
  ): Promise<boolean> {
    try {
      // 既存ブランチの存在チェック
      const { stdout } = await execAsync(`git branch --list ${branchName}`, {
        cwd: workingDirectory,
      });

      if (stdout.trim()) {
        // 既存ブランチが存在する場合はチェックアウト
        logger.info(`[createBranch] Branch ${branchName} already exists, checking out`);
        await execAsync(`git checkout ${branchName}`, {
          cwd: workingDirectory,
        });
      } else {
        // 新規ブランチを作成
        logger.info(`[createBranch] Creating new branch ${branchName}`);
        await execAsync(`git checkout -b ${branchName}`, {
          cwd: workingDirectory,
        });
      }
      return true;
    } catch (error) {
      logger.error({ err: error }, "Failed to create/checkout branch");
      return false;
    }
  }

  /**
   * コミットを作成（フル機能版）
   */
  async createCommit(
    workingDirectory: string,
    message: string,
  ): Promise<{
    hash: string;
    branch: string;
    filesChanged: number;
    additions: number;
    deletions: number;
  }> {
    // 現在のブランチ名を取得
    const { stdout: currentBranch } = await execAsync(
      "git branch --show-current",
      {
        cwd: workingDirectory,
        encoding: "utf8",
      },
    );
    const branch = currentBranch.trim();

    // フィーチャーブランチでない場合は新規作成
    if (branch === "main" || branch === "master" || branch === "develop") {
      const timestamp = Date.now();
      const featureBranch = `feature/auto-${timestamp}`;
      await execAsync(`git checkout -b ${featureBranch}`, {
        cwd: workingDirectory,
      });
    }

    // すべての変更をステージ
    await execAsync("git add -A", { cwd: workingDirectory });

    // 変更統計を取得
    const { stdout: diffStat } = await execAsync(
      "git diff --cached --numstat",
      {
        cwd: workingDirectory,
        encoding: "utf8",
      },
    );

    let filesChanged = 0;
    let additions = 0;
    let deletions = 0;

    diffStat
      .split("\n")
      .filter(Boolean)
      .forEach((line) => {
        const parts = line.split("\t");
        if (parts.length >= 2) {
          filesChanged++;
          const added = parseInt(parts[0]!, 10) || 0;
          const deleted = parseInt(parts[1]!, 10) || 0;
          additions += added;
          deletions += deleted;
        }
      });

    // コミットメッセージを作成
    const fullMessage = `${message}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;

    // コミット
    await execAsync(`git commit -m "${fullMessage.replace(/"/g, '\\"')}"`, {
      cwd: workingDirectory,
      encoding: "utf8",
    });

    // コミットハッシュを取得
    const { stdout: hash } = await execAsync("git rev-parse HEAD", {
      cwd: workingDirectory,
      encoding: "utf8",
    });

    // 最新のブランチ名を取得
    const { stdout: finalBranch } = await execAsync(
      "git branch --show-current",
      {
        cwd: workingDirectory,
        encoding: "utf8",
      },
    );

    return {
      hash: hash.trim(),
      branch: finalBranch.trim(),
      filesChanged,
      additions,
      deletions,
    };
  }

  /**
   * 差分を構造化された形式で取得
   */
  async getDiff(workingDirectory: string): Promise<
    Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }>
  > {
    const files: Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }> = [];

    try {
      // ステージされた変更
      const { stdout: stagedNumstat } = await execAsync(
        "git diff --cached --numstat",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      // ステージされていない変更
      const { stdout: unstagedNumstat } = await execAsync(
        "git diff --numstat",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      // 新規ファイル
      const { stdout: untracked } = await execAsync(
        "git ls-files --others --exclude-standard",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      // ステータスを取得
      const { stdout: status } = await execAsync("git status --porcelain", {
        cwd: workingDirectory,
        encoding: "utf8",
      });

      // ファイル情報をマップに格納
      const fileMap = new Map<
        string,
        {
          additions: number;
          deletions: number;
          status: string;
        }
      >();

      // numstatを解析
      const parseNumstat = (numstat: string) => {
        numstat
          .split("\n")
          .filter(Boolean)
          .forEach((line) => {
            const parts = line.split("\t");
            if (parts.length >= 3) {
              const additions = parseInt(parts[0]!, 10) || 0;
              const deletions = parseInt(parts[1]!, 10) || 0;
              const filename = parts[2]!;
              const existing = fileMap.get(filename);
              fileMap.set(filename, {
                additions: (existing?.additions || 0) + additions,
                deletions: (existing?.deletions || 0) + deletions,
                status: existing?.status || "modified",
              });
            }
          });
      };

      parseNumstat(stagedNumstat);
      parseNumstat(unstagedNumstat);

      // 新規ファイルを追加
      untracked
        .split("\n")
        .filter(Boolean)
        .forEach((filename) => {
          if (!fileMap.has(filename)) {
            fileMap.set(filename, {
              additions: 0,
              deletions: 0,
              status: "added",
            });
          }
        });

      // ステータスからファイル状態を更新
      status
        .split("\n")
        .filter(Boolean)
        .forEach((line) => {
          const statusCode = line.substring(0, 2);
          const filename = line.substring(3);
          const existing = fileMap.get(filename);
          let fileStatus = "modified";

          if (statusCode.includes("A") || statusCode.includes("?")) {
            fileStatus = "added";
          } else if (statusCode.includes("D")) {
            fileStatus = "deleted";
          } else if (statusCode.includes("R")) {
            fileStatus = "renamed";
          }

          if (existing) {
            existing.status = fileStatus;
          } else {
            fileMap.set(filename, {
              additions: 0,
              deletions: 0,
              status: fileStatus,
            });
          }
        });

      // 各ファイルのパッチを取得
      for (const [filename, info] of fileMap) {
        let patch = "";
        try {
          if (info.status !== "added") {
            const { stdout: filePatch } = await execAsync(
              `git diff HEAD -- "${filename}"`,
              {
                cwd: workingDirectory,
                encoding: "utf8",
                maxBuffer: 5 * 1024 * 1024,
              },
            );
            patch = filePatch;
          }
        } catch {
          // パッチ取得に失敗した場合は空
        }

        files.push({
          filename,
          status: info.status,
          additions: info.additions,
          deletions: info.deletions,
          patch: patch || undefined,
        });
      }

      return files;
    } catch (error) {
      logger.error({ err: error }, "Failed to get diff");
      return [];
    }
  }
}

// ファクトリー関数
export function createOrchestrator(
  prisma: PrismaClientInstance,
): AgentOrchestrator {
  return AgentOrchestrator.getInstance(prisma);
}
