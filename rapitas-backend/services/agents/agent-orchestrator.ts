/**
 * エージェントオーケストレーター
 * エージェントの実行管理、状態追跡、イベント配信を担当
 */
// import { PrismaClient } from "@prisma/client";
import { exec } from "child_process";
import { promisify } from "util";
import { agentFactory } from "./agent-factory";
import type { AgentConfigInput } from "./agent-factory";
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

const execAsync = promisify(exec);

// JSONフィールドをSQLite互換の文字列に変換するヘルパー関数
function toJsonString(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
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
  private prisma: any;
  private activeExecutions: Map<number, ExecutionState> = new Map();
  private activeAgents: Map<number, ActiveAgentInfo> = new Map();
  private eventListeners: Set<EventListener> = new Set();
  private isShuttingDown: boolean = false;
  private shutdownPromise: Promise<void> | null = null;
  /** 質問タイムアウト管理用マップ（executionId -> QuestionTimeoutInfo） */
  private questionTimeouts: Map<number, QuestionTimeoutInfo> = new Map();
  /** 継続実行のロック管理用マップ（executionId -> ContinuationLockInfo）*/
  private continuationLocks: Map<number, ContinuationLockInfo> = new Map();

  private constructor(prisma: any) {
    this.prisma = prisma;
    this.setupSignalHandlers();
  }

  static getInstance(prisma: any): AgentOrchestrator {
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
      console.log(`[Orchestrator] Received ${signal}, initiating graceful shutdown...`);
      await this.gracefulShutdown();
    };

    // プロセス終了シグナルをキャッチ
    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));

    // 未処理の例外やリジェクションでもシャットダウン
    process.on("uncaughtException", async (error) => {
      console.error("[Orchestrator] Uncaught exception:", error);
      await this.gracefulShutdown();
      process.exit(1);
    });

    process.on("unhandledRejection", async (reason) => {
      console.error("[Orchestrator] Unhandled rejection:", reason);
      // シャットダウンはしないが、実行中のエージェントの状態を保存
      await this.saveAllAgentStates();
    });

    console.log("[Orchestrator] Signal handlers registered for graceful shutdown");
  }

  /**
   * グレースフルシャットダウン
   * 全てのアクティブなエージェントを停止し、状態を保存
   */
  async gracefulShutdown(): Promise<void> {
    if (this.isShuttingDown) {
      console.log("[Orchestrator] Shutdown already in progress, waiting...");
      return this.shutdownPromise || Promise.resolve();
    }

    this.isShuttingDown = true;
    console.log(`[Orchestrator] Starting graceful shutdown with ${this.activeAgents.size} active agents`);

    this.shutdownPromise = (async () => {
      const shutdownTimeout = 30000; // 30秒のタイムアウト
      const startTime = Date.now();

      try {
        // 全てのアクティブなエージェントを停止
        const stopPromises = Array.from(this.activeAgents.entries()).map(
          async ([executionId, info]) => {
            try {
              console.log(`[Orchestrator] Stopping agent for execution ${executionId}...`);

              // エージェントを停止
              await Promise.race([
                info.agent.stop(),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error("Stop timeout")), 10000)
                ),
              ]);

              // 最終状態をDBに保存
              await this.saveAgentState(executionId, info, "interrupted");
              console.log(`[Orchestrator] Agent for execution ${executionId} stopped and state saved`);
            } catch (error) {
              console.error(`[Orchestrator] Error stopping agent ${executionId}:`, error);
              // エラーでも状態保存を試みる
              try {
                await this.saveAgentState(executionId, info, "interrupted");
              } catch (saveError) {
                console.error(`[Orchestrator] Failed to save state for ${executionId}:`, saveError);
              }
            }
          }
        );

        // タイムアウト付きで全エージェントの停止を待機
        await Promise.race([
          Promise.all(stopPromises),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Shutdown timeout")),
              shutdownTimeout - (Date.now() - startTime)
            )
          ),
        ]);

        console.log("[Orchestrator] Graceful shutdown completed");
      } catch (error) {
        console.error("[Orchestrator] Graceful shutdown error:", error);
        // 強制的に状態を保存
        await this.saveAllAgentStates();
      } finally {
        this.activeAgents.clear();
        this.activeExecutions.clear();
      }
    })();

    return this.shutdownPromise;
  }

  /**
   * 特定のエージェントの状態をDBに保存
   */
  private async saveAgentState(
    executionId: number,
    info: ActiveAgentInfo,
    status: "interrupted" | "failed"
  ): Promise<void> {
    const errorMessage = status === "interrupted"
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
  }

  /**
   * 全てのアクティブなエージェントの状態を保存
   */
  private async saveAllAgentStates(): Promise<void> {
    console.log(`[Orchestrator] Saving state for ${this.activeAgents.size} active agents...`);

    for (const [executionId, info] of this.activeAgents) {
      try {
        await this.saveAgentState(executionId, info, "interrupted");
      } catch (error) {
        console.error(`[Orchestrator] Failed to save state for execution ${executionId}:`, error);
      }
    }
  }

  /**
   * 中断されたセッションを取得
   */
  async getInterruptedExecutions(): Promise<Array<{
    id: number;
    sessionId: number;
    taskId: number;
    status: string;
    claudeSessionId: string | null;
    output: string;
    createdAt: Date;
  }>> {
    return await this.prisma.agentExecution.findMany({
      where: {
        status: "interrupted",
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  /**
   * シャットダウン中かどうか
   */
  isInShutdown(): boolean {
    return this.isShuttingDown;
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
   * イベントを発火
   */
  private emitEvent(event: OrchestratorEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in event listener:", error);
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
    questionKey?: QuestionKey
  ): void {
    // 既存のタイムアウトがあればキャンセル
    this.cancelQuestionTimeout(executionId);

    const timeoutSeconds = questionKey?.timeout_seconds || DEFAULT_QUESTION_TIMEOUT_SECONDS;
    const timeoutMs = timeoutSeconds * 1000;

    console.log(`[Orchestrator] Starting question timeout for execution ${executionId}: ${timeoutSeconds}s`);

    const timeoutTimer = setTimeout(async () => {
      console.log(`[Orchestrator] Question timeout triggered for execution ${executionId}`);
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
      console.log(`[Orchestrator] Question timeout cancelled for execution ${executionId}`);
    }
  }

  /**
   * 継続実行のロックを取得
   * @returns ロック取得に成功した場合はtrue、既にロックされている場合はfalse
   */
  tryAcquireContinuationLock(executionId: number, source: "user_response" | "auto_timeout"): boolean {
    const existingLock = this.continuationLocks.get(executionId);
    if (existingLock) {
      console.log(`[Orchestrator] Continuation lock already held for execution ${executionId} by ${existingLock.source}`);
      return false;
    }

    this.continuationLocks.set(executionId, {
      executionId,
      lockedAt: new Date(),
      source,
    });
    console.log(`[Orchestrator] Continuation lock acquired for execution ${executionId} by ${source}`);
    return true;
  }

  /**
   * 継続実行のロックを解放
   */
  releaseContinuationLock(executionId: number): void {
    const lock = this.continuationLocks.get(executionId);
    if (lock) {
      this.continuationLocks.delete(executionId);
      console.log(`[Orchestrator] Continuation lock released for execution ${executionId}`);
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
  private async handleQuestionTimeout(executionId: number, taskId: number): Promise<void> {
    try {
      // タイムアウト情報を取得して削除
      const timeoutInfo = this.questionTimeouts.get(executionId);
      this.questionTimeouts.delete(executionId);

      // ロックを取得（既に処理中なら早期リターン）
      if (!this.tryAcquireContinuationLock(executionId, "auto_timeout")) {
        console.log(`[Orchestrator] Skipping timeout handling for execution ${executionId} - already being processed`);
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
          console.log(`[Orchestrator] Execution ${executionId} not found for timeout handling`);
          return;
        }

        // まだ waiting_for_input 状態かどうか確認
        if (execution.status !== "waiting_for_input") {
          console.log(`[Orchestrator] Execution ${executionId} is no longer waiting for input (status: ${execution.status})`);
          return;
        }

        // DBステータスを running に更新（競合防止）
        await this.prisma.agentExecution.update({
          where: { id: executionId },
          data: { status: "running" },
        });

        console.log(`[Orchestrator] Auto-continuing execution ${executionId} after timeout`);

        // 質問のタイプに応じてデフォルト回答を生成
        const defaultResponse = this.generateDefaultResponse(
          timeoutInfo?.questionKey,
          (execution as any).question,
          (execution as any).questionDetails
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
        await this.executeContinuationInternal(executionId, defaultResponse, {
          timeout: 900000,
        });
      } catch (error) {
        // エラー時はステータスを元に戻す
        await this.prisma.agentExecution.update({
          where: { id: executionId },
          data: { status: "waiting_for_input" },
        }).catch(() => {});
        throw error;
      } finally {
        // ロックを解放
        this.releaseContinuationLock(executionId);
      }
    } catch (error) {
      console.error(`[Orchestrator] Error handling question timeout for execution ${executionId}:`, error);
    }
  }

  /**
   * 質問タイプに応じたデフォルト回答を生成
   */
  private generateDefaultResponse(
    questionKey?: QuestionKey,
    questionText?: string,
    questionDetails?: any
  ): string {
    // 質問詳細からオプションがある場合は最初の選択肢を使用
    if (questionDetails) {
      let details = questionDetails;
      if (typeof questionDetails === "string") {
        try {
          details = JSON.parse(questionDetails);
        } catch {
          details = null;
        }
      }

      if (details?.options && Array.isArray(details.options) && details.options.length > 0) {
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
      if (text.includes("y/n") || text.includes("[y/n]") || text.includes("(yes/no)")) {
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

    const timeoutSeconds = timeoutInfo.questionKey?.timeout_seconds || DEFAULT_QUESTION_TIMEOUT_SECONDS;
    const deadline = new Date(timeoutInfo.questionStartedAt.getTime() + timeoutSeconds * 1000);
    const remainingSeconds = Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 1000));

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
    let agentConfig: AgentConfigInput = {
      type: "claude-code",
      name: "Claude Code Agent",
      workingDirectory: options.workingDirectory,
      timeout: options.timeout,
      dangerouslySkipPermissions: true, // 自動実行モード: ファイル変更を許可
    };

    if (options.agentConfigId) {
      const dbConfig = await this.prisma.aIAgentConfig.findUnique({
        where: { id: options.agentConfigId },
      });
      if (dbConfig) {
        agentConfig = {
          type: dbConfig.agentType as "claude-code",
          name: dbConfig.name,
          endpoint: dbConfig.endpoint || undefined,
          modelId: dbConfig.modelId || undefined,
          workingDirectory: options.workingDirectory,
          timeout: options.timeout,
          dangerouslySkipPermissions: true, // 自動実行モード: 常に有効
        };
      }
    }

    // エージェントを作成
    const agent = agentFactory.createAgent(agentConfig);

    // 実行レコードを作成
    const execution = await this.prisma.agentExecution.create({
      data: {
        sessionId: options.sessionId,
        agentConfigId: options.agentConfigId,
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

    // アクティブエージェントを登録（グレースフルシャットダウン用）
    const agentInfo: ActiveAgentInfo = {
      agent,
      executionId: execution.id,
      sessionId: options.sessionId,
      taskId: options.taskId,
      state,
      lastOutput: "",
      lastSavedAt: new Date(),
    };
    this.activeAgents.set(execution.id, agentInfo);

    // シャットダウン中は新しい実行を拒否
    if (this.isShuttingDown) {
      this.activeAgents.delete(execution.id);
      this.activeExecutions.delete(execution.id);
      throw new Error("Server is shutting down, cannot start new execution");
    }

    // 質問検出ハンドラを設定（質問が検出されたら即座にDBを更新）
    agent.setQuestionDetectedHandler(async (info) => {
      console.log(`[Orchestrator] Question detected during streaming!`);
      console.log(`[Orchestrator] Question: ${info.question.substring(0, 100)}`);
      console.log(`[Orchestrator] Question type: ${info.questionType}`);

      try {
        // 即座にDBステータスを waiting_for_input に更新
        await this.prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: "waiting_for_input",
            question: info.question || null,
            questionType: info.questionType || null,
            questionDetails: toJsonString(info.questionDetails),
          },
        });
        console.log(`[Orchestrator] DB updated to waiting_for_input for execution ${execution.id}`);

        // 状態も更新
        state.status = "waiting_for_input" as any;

        // 質問タイムアウトを開始
        this.startQuestionTimeout(execution.id, options.taskId, info.questionKey);

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
            questionTimeoutSeconds: timeoutInfo?.remainingSeconds || DEFAULT_QUESTION_TIMEOUT_SECONDS,
            questionTimeoutDeadline: timeoutInfo?.deadline?.toISOString(),
          },
          timestamp: new Date(),
        });
      } catch (error) {
        console.error(`[Orchestrator] Failed to update DB on question detection:`, error);
      }
    });

    // 出力ハンドラを設定（リアルタイムでDBに保存）
    let lastDbUpdate = Date.now();
    const DB_UPDATE_INTERVAL = 200; // 0.2秒ごとにDBを更新（リアルタイム表示のため）
    let pendingDbUpdate = false;
    let logSequenceNumber = 0; // ログのシーケンス番号
    let pendingLogChunks: { chunk: string; isError: boolean; timestamp: Date }[] = [];
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
        console.error("Failed to save log chunks:", e);
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
            console.error("Failed to save error output immediately:", e);
          }
        }

        if (options.onOutput) {
          try {
            options.onOutput(output, isError);
          } catch (e) {
            console.error("Error in onOutput callback:", e);
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
          console.error("Error emitting event:", e);
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
            console.error("Failed to update execution output:", e);
          } finally {
            pendingDbUpdate = false;
          }
        }
      } catch (e) {
        console.error("Critical error in output handler:", e);
      }
    });

    // クリーンアップ時にログをフラッシュ
    const cleanupLogHandler = async () => {
      clearInterval(logFlushInterval);
      await flushLogChunks(); // 残りのログを保存
    };

    // 実行開始イベント
    this.emitEvent({
      type: "execution_started",
      executionId: execution.id,
      sessionId: options.sessionId,
      taskId: options.taskId,
      timestamp: new Date(),
    });

    // 初期メッセージを設定
    const initialMessage = `[実行開始] タスクの実行を開始します...\n`;
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
        console.log(`[Orchestrator] AI task analysis enabled`);
        console.log(`[Orchestrator] Analysis summary: ${options.analysisInfo.summary?.substring(0, 100)}`);
        console.log(`[Orchestrator] Subtasks count: ${options.analysisInfo.subtasks?.length || 0}`);
      } else {
        console.log(`[Orchestrator] AI task analysis not provided`);
      }

      // エージェントを実行
      const result = await agent.execute(taskWithAnalysis);

      console.log(
        `[Orchestrator] Execution result - success: ${result.success}, waitingForInput: ${result.waitingForInput}, questionType: ${result.questionType}, question: ${result.question?.substring(0, 100)}`,
      );

      // ステータス判定: 質問待ちの場合は waiting_for_input
      let executionStatus: string;
      if (result.waitingForInput) {
        executionStatus = "waiting_for_input";
        state.status = "waiting_for_input" as any;
        console.log(`[Orchestrator] Setting status to waiting_for_input`);
      } else if (result.success) {
        executionStatus = "completed";
        state.status = "completed";
        console.log(`[Orchestrator] Setting status to completed`);
      } else {
        executionStatus = "failed";
        state.status = "failed";
        console.log(`[Orchestrator] Setting status to failed`);
      }

      // 実行レコードを更新（claudeSessionIdを含む）
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: executionStatus,
          output: result.output,
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
      console.log(`[Orchestrator] Skipping continuation for execution ${executionId} - already being processed`);
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
        console.log(`[Orchestrator] Execution ${executionId} is already running, skipping continuation`);
        return {
          success: false,
          output: "",
          errorMessage: "Execution is already running",
        };
      }

      if (execution.status !== "waiting_for_input") {
        console.log(`[Orchestrator] Execution ${executionId} is not waiting for input (status: ${execution.status})`);
        return {
          success: false,
          output: "",
          errorMessage: `Execution is not waiting for input: ${execution.status}`,
        };
      }

      // ユーザーからの応答があったので、既存の質問タイムアウトをキャンセル
      this.cancelQuestionTimeout(executionId);

      // 内部処理を実行（ロックは継承）
      return await this.executeContinuationInternal(executionId, response, options);
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
      return await this.executeContinuationInternal(executionId, response, options);
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
    const claudeSessionId = (execution as any).claudeSessionId as string | null;
    console.log(`[Orchestrator] Resuming execution with claudeSessionId: ${claudeSessionId}`);

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
        agentConfig = {
          type: dbConfig.agentType as "claude-code",
          name: dbConfig.name,
          endpoint: dbConfig.endpoint || undefined,
          modelId: dbConfig.modelId || undefined,
          workingDirectory: task?.workingDirectory || undefined,
          timeout: options.timeout,
          dangerouslySkipPermissions: true,
          resumeSessionId: claudeSessionId || undefined, // --resumeで使用
          continueConversation: !claudeSessionId, // セッションIDがない場合のフォールバック
        };
      }
    }

    // エージェントを作成
    const agent = agentFactory.createAgent(agentConfig);

    // タスクIDを取得
    const taskId = execution.session.config?.taskId || 0;

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
    };
    this.activeAgents.set(execution.id, agentInfo);

    // シャットダウン中は新しい実行を拒否
    if (this.isShuttingDown) {
      this.activeAgents.delete(execution.id);
      this.activeExecutions.delete(execution.id);
      throw new Error("Server is shutting down, cannot continue execution");
    }

    // 質問検出ハンドラを設定（質問が検出されたら即座にDBを更新）
    agent.setQuestionDetectedHandler(async (info) => {
      console.log(`[Orchestrator] Question detected during continuation!`);
      console.log(`[Orchestrator] Question: ${info.question.substring(0, 100)}`);
      console.log(`[Orchestrator] Question type: ${info.questionType}`);

      try {
        // 即座にDBステータスを waiting_for_input に更新
        await this.prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: "waiting_for_input",
            question: info.question || null,
            questionType: info.questionType || null,
            questionDetails: toJsonString(info.questionDetails),
          },
        });
        console.log(`[Orchestrator] DB updated to waiting_for_input for execution ${execution.id}`);

        // 状態も更新
        state.status = "waiting_for_input" as any;

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
            questionTimeoutSeconds: timeoutInfo?.remainingSeconds || DEFAULT_QUESTION_TIMEOUT_SECONDS,
            questionTimeoutDeadline: timeoutInfo?.deadline?.toISOString(),
          },
          timestamp: new Date(),
        });
      } catch (error) {
        console.error(`[Orchestrator] Failed to update DB on question detection:`, error);
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
    let logSequenceNumber = existingLogs.length > 0 ? existingLogs[0].sequenceNumber + 1 : 0;
    let pendingLogChunks: { chunk: string; isError: boolean; timestamp: Date }[] = [];
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
        console.error("Failed to save log chunks:", e);
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
            console.error("Failed to save error output immediately:", e);
          }
        }

        if (options.onOutput) {
          try {
            options.onOutput(output, isError);
          } catch (e) {
            console.error("Error in onOutput callback:", e);
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
          console.error("Error emitting event:", e);
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
            console.error("Failed to update execution output:", e);
          } finally {
            pendingDbUpdate = false;
          }
        }
      } catch (e) {
        console.error("Critical error in output handler:", e);
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
      const result = await agent.execute(agentTask);

      // ステータス判定
      let executionStatus: string;
      if (result.waitingForInput) {
        executionStatus = "waiting_for_input";
        state.status = "waiting_for_input" as any;
      } else if (result.success) {
        executionStatus = "completed";
        state.status = "completed";
      } else {
        executionStatus = "failed";
        state.status = "failed";
      }

      // 実行レコードを更新（claudeSessionIdを更新して会話継続に備える）
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: executionStatus,
          output: state.output + "\n" + result.output,
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
          claudeSessionId: result.claudeSessionId || (execution as any).claudeSessionId || null,
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
      console.log(`[Orchestrator] stopExecution: No active execution found for ${executionId}`);
      return false;
    }

    const agent = agentFactory.getAgent(state.agentId);
    if (!agent) {
      console.log(`[Orchestrator] stopExecution: No agent found for ${state.agentId}`);
      // エージェントが見つからなくてもDBとマップはクリーンアップ
      this.activeExecutions.delete(executionId);
      this.activeAgents.delete(executionId);
      return false;
    }

    try {
      await agent.stop();
    } catch (error) {
      console.error(`[Orchestrator] Error stopping agent:`, error);
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

    console.log(`[Orchestrator] Execution ${executionId} stopped and cleaned up`);
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

    const workingDirectory = task.theme?.workingDirectory || options.workingDirectory || process.cwd();
    const claudeSessionId = (execution as any).claudeSessionId as string | null;

    console.log(`[Orchestrator] Resuming interrupted execution ${executionId}`);
    console.log(`[Orchestrator] Task: ${task.title} (ID: ${task.id})`);
    console.log(`[Orchestrator] Claude Session ID: ${claudeSessionId}`);
    console.log(`[Orchestrator] Working Directory: ${workingDirectory}`);

    // 前回の実行ログを取得して要約を作成
    const previousOutput = execution.output || "";
    const lastOutput = previousOutput.slice(-3000); // 最後の3000文字

    // 実行ログからコンテキストを構築
    const logSummary = execution.executionLogs
      .slice(-50) // 最後の50件のログ
      .map((log: any) => log.logChunk)
      .join("");

    // 再開用のプロンプトを構築
    const resumePrompt = this.buildResumePrompt(
      task,
      lastOutput,
      logSummary.slice(-2000),
      (execution as any).errorMessage,
    );

    // エージェント設定を取得
    let agentConfig: AgentConfigInput = {
      type: "claude-code",
      name: "Claude Code Agent",
      workingDirectory,
      timeout: options.timeout || 900000, // 15分
      dangerouslySkipPermissions: true,
      resumeSessionId: claudeSessionId || undefined,
      continueConversation: !claudeSessionId,
    };

    if (execution.agentConfigId) {
      const dbConfig = await this.prisma.aIAgentConfig.findUnique({
        where: { id: execution.agentConfigId },
      });
      if (dbConfig) {
        agentConfig = {
          type: dbConfig.agentType as "claude-code",
          name: dbConfig.name,
          endpoint: dbConfig.endpoint || undefined,
          modelId: dbConfig.modelId || undefined,
          workingDirectory,
          timeout: options.timeout || 900000,
          dangerouslySkipPermissions: true,
          resumeSessionId: claudeSessionId || undefined,
          continueConversation: !claudeSessionId,
        };
      }
    }

    // エージェントを作成
    const agent = agentFactory.createAgent(agentConfig);

    // タスクIDを取得
    const taskId = task.id;

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
    };
    this.activeAgents.set(execution.id, agentInfo);

    // シャットダウン中は新しい実行を拒否
    if (this.isShuttingDown) {
      this.activeAgents.delete(execution.id);
      this.activeExecutions.delete(execution.id);
      throw new Error("Server is shutting down, cannot resume execution");
    }

    // 質問検出ハンドラを設定
    agent.setQuestionDetectedHandler(async (info) => {
      console.log(`[Orchestrator] Question detected during resume!`);
      console.log(`[Orchestrator] Question: ${info.question.substring(0, 100)}`);

      try {
        await this.prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: "waiting_for_input",
            question: info.question || null,
            questionType: info.questionType || null,
            questionDetails: toJsonString(info.questionDetails),
          },
        });

        state.status = "waiting_for_input" as any;
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
            questionTimeoutSeconds: timeoutInfo?.remainingSeconds || DEFAULT_QUESTION_TIMEOUT_SECONDS,
            questionTimeoutDeadline: timeoutInfo?.deadline?.toISOString(),
          },
          timestamp: new Date(),
        });
      } catch (error) {
        console.error(`[Orchestrator] Failed to update DB on question detection:`, error);
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
    let logSequenceNumber = existingLogs.length > 0 ? existingLogs[0].sequenceNumber + 1 : 0;
    let pendingLogChunks: { chunk: string; isError: boolean; timestamp: Date }[] = [];
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
        console.error("Failed to save log chunks:", e);
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
            console.error("Failed to save error output immediately:", e);
          }
        }

        if (options.onOutput) {
          try {
            options.onOutput(output, isError);
          } catch (e) {
            console.error("Error in onOutput callback:", e);
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
          console.error("Error emitting event:", e);
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
            console.error("Failed to update execution output:", e);
          } finally {
            pendingDbUpdate = false;
          }
        }
      } catch (e) {
        console.error("Critical error in output handler:", e);
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
        state.status = "waiting_for_input" as any;
      } else if (result.success) {
        executionStatus = "completed";
        state.status = "completed";
      } else {
        executionStatus = "failed";
        state.status = "failed";
      }

      // 実行レコードを更新
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: executionStatus,
          output: state.output + "\n" + result.output,
          artifacts: result.artifacts
            ? toJsonString(result.artifacts)
            : (execution as any).artifacts,
          completedAt: result.waitingForInput ? null : new Date(),
          tokensUsed: (execution.tokensUsed || 0) + (result.tokensUsed || 0),
          executionTimeMs:
            (execution.executionTimeMs || 0) + (result.executionTimeMs || 0),
          errorMessage: result.errorMessage,
          question: result.question || null,
          questionType: result.questionType || null,
          questionDetails: toJsonString(result.questionDetails),
          claudeSessionId: result.claudeSessionId || (execution as any).claudeSessionId || null,
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
      this.activeExecutions.delete(execution.id);
      this.activeAgents.delete(execution.id);
      await agentFactory.removeAgent(agent.id);
    }
  }

  /**
   * 再開用のプロンプトを構築
   */
  private buildResumePrompt(
    task: any,
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
      console.error("Failed to get git diff:", error);
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
      console.error("Failed to get full git diff:", error);
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
    } catch (error: any) {
      return { success: false, error: error.message };
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
    } catch (error: any) {
      return { success: false, error: error.message };
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
      console.error("Failed to revert changes:", error);
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
      await execAsync(`git checkout -b ${branchName}`, {
        cwd: workingDirectory,
      });
      return true;
    } catch (error) {
      console.error("Failed to create branch:", error);
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
      console.error("Failed to get diff:", error);
      return [];
    }
  }
}

// ファクトリー関数
export function createOrchestrator(prisma: any): AgentOrchestrator {
  return AgentOrchestrator.getInstance(prisma);
}
