/**
 * エージェントオーケストレーター（ファサード）
 * 各サブモジュールへの委譲を行う薄いラッパー
 *
 * 責務ごとに以下のモジュールに分割:
 * - orchestrator/types.ts: 共通型定義
 * - orchestrator/lifecycle-manager.ts: シャットダウン・状態保存
 * - orchestrator/task-executor.ts: タスク実行
 * - orchestrator/continuation-executor.ts: 継続実行・タイムアウト処理
 * - orchestrator/recovery-manager.ts: 中断復旧・再開
 * - orchestrator/git-operations.ts: Git操作
 * - orchestrator/question-timeout-manager.ts: 質問タイムアウト・ロック管理
 * - orchestrator/execution-helpers.ts: 出力/質問検出ハンドラの共通化
 */
import { PrismaClient } from "@prisma/client";
type PrismaClientInstance = InstanceType<typeof PrismaClient>;

import type { AgentTask, AgentExecutionResult } from "./base-agent";
import type { AgentConfigInput, AgentType } from "./agent-factory";
import { decrypt } from "../../utils/encryption";
import type { QuestionKey } from "./question-detection";
import { agentFactory } from "./agent-factory";
import { createLogger } from "../../config/logger";
import { GitOperations } from "./orchestrator/git-operations";
import { QuestionTimeoutManager } from "./orchestrator/question-timeout-manager";
import type {
  ExecutionOptions,
  ExecutionState,
  OrchestratorEvent,
  EventListener,
  ActiveAgentInfo,
  OrchestratorContext,
} from "./orchestrator/types";
import {
  setupSignalHandlers,
  gracefulShutdown as doGracefulShutdown,
  saveAgentState,
  saveAllAgentStates,
} from "./orchestrator/lifecycle-manager";
import { executeTask as doExecuteTask } from "./orchestrator/task-executor";
import {
  executeContinuation as doExecuteContinuation,
  executeContinuationWithLock as doExecuteContinuationWithLock,
  handleQuestionTimeout as doHandleQuestionTimeout,
} from "./orchestrator/continuation-executor";
import {
  getInterruptedExecutions as doGetInterruptedExecutions,
  recoverStaleExecutions as doRecoverStaleExecutions,
  resumeInterruptedExecution as doResumeInterruptedExecution,
} from "./orchestrator/recovery-manager";
import { EventManager } from "./orchestrator/event-manager";

// 型の再エクスポート（後方互換性）
export type { ExecutionOptions, ExecutionState, OrchestratorEvent, EventListener };

const logger = createLogger("agent-orchestrator");

/**
 * エージェントオーケストレータークラス
 */
export class AgentOrchestrator {
  private static instance: AgentOrchestrator;
  private prisma: PrismaClientInstance;
  private activeExecutions: Map<number, ExecutionState> = new Map();
  private activeAgents: Map<number, ActiveAgentInfo> = new Map();
  private eventManager: EventManager = new EventManager();
  private _isShuttingDown: boolean = false;
  private shutdownPromise: Promise<void> | null = null;
  private serverStartedAt: Date = new Date();
  private serverStopCallback: (() => Promise<void> | void) | null = null;
  private gitOps: GitOperations = new GitOperations();
  private questionTimeoutManager: QuestionTimeoutManager = new QuestionTimeoutManager();

  private constructor(prisma: PrismaClientInstance) {
    this.prisma = prisma;
    setupSignalHandlers(
      () => this.gracefulShutdown(),
      () => saveAllAgentStates(this.prisma, this.activeAgents),
    );
    this.questionTimeoutManager.setTimeoutHandler(
      (executionId, taskId) => this.handleQuestionTimeout(executionId, taskId),
    );
    this.questionTimeoutManager.setEventEmitter(
      (event) => this.eventManager.emitEvent(event),
    );
  }

  static getInstance(prisma: PrismaClientInstance): AgentOrchestrator {
    if (!AgentOrchestrator.instance) {
      AgentOrchestrator.instance = new AgentOrchestrator(prisma);
    }
    return AgentOrchestrator.instance;
  }

  /** 共有コンテキストを構築 */
  private getContext(): OrchestratorContext {
    return {
      prisma: this.prisma,
      activeExecutions: this.activeExecutions,
      activeAgents: this.activeAgents,
      isShuttingDown: this._isShuttingDown,
      serverStartedAt: this.serverStartedAt,
      emitEvent: (event) => this.eventManager.emitEvent(event),
      startQuestionTimeout: (eid, tid, qk) => this.startQuestionTimeout(eid, tid, qk),
      cancelQuestionTimeout: (eid) => this.cancelQuestionTimeout(eid),
      getQuestionTimeoutInfo: (eid) => this.getQuestionTimeoutInfo(eid),
      tryAcquireContinuationLock: (eid, src) => this.tryAcquireContinuationLock(eid, src),
      releaseContinuationLock: (eid) => this.releaseContinuationLock(eid),
      buildAgentConfigFromDb: (dbConfig, options) => this.buildAgentConfigFromDb(dbConfig, options),
    };
  }

  // ==================== ライフサイクル ====================

  async gracefulShutdown(options?: { skipServerStop?: boolean }): Promise<void> {
    if (this._isShuttingDown) {
      logger.info("[Orchestrator] Shutdown already in progress, waiting...");
      return this.shutdownPromise || Promise.resolve();
    }

    this.shutdownPromise = doGracefulShutdown(
      {
        prisma: this.prisma,
        activeAgents: this.activeAgents,
        activeExecutions: this.activeExecutions,
        questionTimeoutManager: this.questionTimeoutManager,
        serverStopCallback: this.serverStopCallback,
        getIsShuttingDown: () => this._isShuttingDown,
        setIsShuttingDown: (v) => { this._isShuttingDown = v; },
      },
      options,
    );

    return this.shutdownPromise;
  }

  isInShutdown(): boolean {
    return this._isShuttingDown;
  }

  setServerStopCallback(callback: () => Promise<void> | void): void {
    this.serverStopCallback = callback;
  }

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

  // ==================== 実行状態クエリ ====================

  getActiveExecutionCount(): number {
    return this.activeAgents.size;
  }

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

  getActiveExecutions(): ExecutionState[] {
    return Array.from(this.activeExecutions.values());
  }

  getSessionExecutions(sessionId: number): ExecutionState[] {
    return Array.from(this.activeExecutions.values()).filter(
      (state) => state.sessionId === sessionId,
    );
  }

  getExecutionState(executionId: number): ExecutionState | undefined {
    return this.activeExecutions.get(executionId);
  }

  // ==================== イベント管理 ====================

  addEventListener(listener: EventListener): void {
    this.eventManager.addEventListener(listener);
  }

  removeEventListener(listener: EventListener): void {
    this.eventManager.removeEventListener(listener);
  }

  // ==================== 質問タイムアウト管理 ====================

  startQuestionTimeout(executionId: number, taskId: number, questionKey?: QuestionKey): void {
    this.questionTimeoutManager.startQuestionTimeout(executionId, taskId, questionKey);
  }

  cancelQuestionTimeout(executionId: number): void {
    this.questionTimeoutManager.cancelQuestionTimeout(executionId);
  }

  tryAcquireContinuationLock(executionId: number, source: "user_response" | "auto_timeout"): boolean {
    return this.questionTimeoutManager.tryAcquireContinuationLock(executionId, source);
  }

  releaseContinuationLock(executionId: number): void {
    this.questionTimeoutManager.releaseContinuationLock(executionId);
  }

  hasContinuationLock(executionId: number): boolean {
    return this.questionTimeoutManager.hasContinuationLock(executionId);
  }

  getQuestionTimeoutInfo(executionId: number): {
    remainingSeconds: number;
    deadline: Date;
    questionKey?: QuestionKey;
  } | null {
    return this.questionTimeoutManager.getQuestionTimeoutInfo(executionId);
  }

  private async handleQuestionTimeout(executionId: number, taskId: number): Promise<void> {
    return doHandleQuestionTimeout(
      this.getContext(),
      executionId,
      taskId,
      (qk, qt, qd) => this.questionTimeoutManager.generateDefaultResponse(qk as QuestionKey | undefined, qt, qd),
    );
  }

  // ==================== タスク実行 ====================

  async executeTask(task: AgentTask, options: ExecutionOptions): Promise<AgentExecutionResult> {
    return doExecuteTask(this.getContext(), task, options);
  }

  // ==================== 継続実行 ====================

  async executeContinuation(
    executionId: number,
    response: string,
    options: Partial<ExecutionOptions> = {},
  ): Promise<AgentExecutionResult> {
    return doExecuteContinuation(this.getContext(), executionId, response, options);
  }

  async executeContinuationWithLock(
    executionId: number,
    response: string,
    options: Partial<ExecutionOptions> = {},
  ): Promise<AgentExecutionResult> {
    return doExecuteContinuationWithLock(this.getContext(), executionId, response, options);
  }

  // ==================== 実行停止 ====================

  async stopExecution(executionId: number): Promise<boolean> {
    this.cancelQuestionTimeout(executionId);
    this.releaseContinuationLock(executionId);

    const state = this.activeExecutions.get(executionId);
    if (!state) {
      logger.info(`[Orchestrator] stopExecution: No active execution found for ${executionId}`);
      return false;
    }

    const agent = agentFactory.getAgent(state.agentId);
    if (!agent) {
      logger.info(`[Orchestrator] stopExecution: No agent found for ${state.agentId}`);
      this.activeExecutions.delete(executionId);
      this.activeAgents.delete(executionId);
      return false;
    }

    try {
      await agent.stop();
    } catch (error) {
      logger.error({ err: error }, `[Orchestrator] Error stopping agent`);
    }

    await this.prisma.agentExecution.update({
      where: { id: executionId },
      data: {
        status: "cancelled",
        output: state.output,
        completedAt: new Date(),
        errorMessage: "Cancelled by user",
      },
    });

    this.activeExecutions.delete(executionId);
    this.activeAgents.delete(executionId);
    await agentFactory.removeAgent(state.agentId);

    this.eventManager.emitEvent({
      type: "execution_cancelled",
      executionId,
      sessionId: state.sessionId,
      taskId: state.taskId,
      timestamp: new Date(),
    });

    logger.info(`[Orchestrator] Execution ${executionId} stopped and cleaned up`);
    return true;
  }

  // ==================== リカバリ ====================

  async getInterruptedExecutions() {
    return doGetInterruptedExecutions(this.prisma);
  }

  async recoverStaleExecutions() {
    return doRecoverStaleExecutions(this.getContext());
  }

  async resumeInterruptedExecution(
    executionId: number,
    options: Partial<ExecutionOptions> = {},
  ): Promise<AgentExecutionResult> {
    return doResumeInterruptedExecution(this.getContext(), executionId, options);
  }

  // ==================== Git操作 ====================

  async getGitDiff(workingDirectory: string): Promise<string> {
    return this.gitOps.getGitDiff(workingDirectory);
  }

  async getFullGitDiff(workingDirectory: string): Promise<string> {
    return this.gitOps.getFullGitDiff(workingDirectory);
  }

  async commitChanges(
    workingDirectory: string,
    message: string,
    taskTitle?: string,
  ): Promise<{ success: boolean; commitHash?: string; error?: string }> {
    return this.gitOps.commitChanges(workingDirectory, message, taskTitle);
  }

  async createPullRequest(
    workingDirectory: string,
    title: string,
    body: string,
    baseBranch: string = "main",
  ): Promise<{ success: boolean; prUrl?: string; prNumber?: number; error?: string }> {
    return this.gitOps.createPullRequest(workingDirectory, title, body, baseBranch);
  }

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
    return this.gitOps.mergePullRequest(workingDirectory, prNumber, commitThreshold, baseBranch);
  }

  async revertChanges(workingDirectory: string): Promise<boolean> {
    return this.gitOps.revertChanges(workingDirectory);
  }

  async createBranch(workingDirectory: string, branchName: string): Promise<boolean> {
    return this.gitOps.createBranch(workingDirectory, branchName);
  }

  async createCommit(
    workingDirectory: string,
    message: string,
  ): Promise<{ hash: string; branch: string; filesChanged: number; additions: number; deletions: number }> {
    return this.gitOps.createCommit(workingDirectory, message);
  }

  async getDiff(workingDirectory: string): Promise<
    Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>
  > {
    return this.gitOps.getDiff(workingDirectory);
  }

  // ==================== ヘルパー ====================

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
      dangerouslySkipPermissions: true,
      yoloMode: true,
    };
  }
}

// ファクトリー関数
export function createOrchestrator(prisma: PrismaClientInstance): AgentOrchestrator {
  return AgentOrchestrator.getInstance(prisma);
}
