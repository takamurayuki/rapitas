/**
 * Agent Worker Manager
 *
 * エージェントワーカープロセスの管理、IPC通信、ヘルスチェック、
 * リアルタイムイベントのブリッジを担当する。
 *
 * AgentOrchestrator と同じインターフェースを提供し、
 * agent-execution-router からの呼び出しを透過的にワーカーに委譲する。
 */

import type { ChildProcess } from 'child_process';
import { join } from 'path';
import { createLogger } from '../../config/logger';
import type { AgentTask, AgentExecutionResult } from './base-agent';
import type { ExecutionOptions, ExecutionState } from './orchestrator/types';
import type { QuestionKey } from './question-detection';
import { realtimeService } from '../realtime-service';

const logger = createLogger('agent-worker-manager');

interface IPCRequest {
  id: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface IPCResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  type: string;
}

export class AgentWorkerManager {
  private static instance: AgentWorkerManager;
  private workerProcess: ChildProcess | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private isWorkerReady = false;
  private isShuttingDown = false;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private restartPromise: Promise<void> | null = null;
  private requestIdCounter = 0;
  private readyResolve: (() => void) | null = null;

  private constructor() {}

  public static getInstance(): AgentWorkerManager {
    if (!AgentWorkerManager.instance) {
      AgentWorkerManager.instance = new AgentWorkerManager();
    }
    return AgentWorkerManager.instance;
  }

  /**
   * ワーカープロセスを起動し、Ready状態になるまで待機する。
   * index.ts のサーバー起動時に呼び出す。
   */
  public async initialize(): Promise<void> {
    await this.setupWorker();
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${++this.requestIdCounter}`;
  }

  private async setupWorker(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    try {
      const workerPath = join(process.cwd(), 'workers', 'agent-worker.ts');
      logger.info({ workerPath }, '[AgentWorkerManager] Starting agent worker process');

      // Bun環境では spawn を使って起動
      const { spawn } = await import('child_process');
      this.workerProcess = spawn('bun', [workerPath], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          NODE_ENV: process.env.NODE_ENV || 'development',
          AGENT_WORKER: '1',
        },
        cwd: process.cwd(),
      });

      // Ready状態の Promise を作成
      const readyPromise = new Promise<void>((resolve) => {
        this.readyResolve = resolve;
      });

      // IPCメッセージハンドラー
      this.workerProcess.on('message', (message: Record<string, unknown>) => {
        this.handleWorkerMessage(message);
      });

      this.workerProcess.on('error', (error) => {
        logger.error({ err: error }, '[AgentWorkerManager] Worker process error');
        this.handleWorkerCrash();
      });

      this.workerProcess.on('exit', (code, signal) => {
        logger.warn({ code, signal }, '[AgentWorkerManager] Worker process exited');
        this.isWorkerReady = false;

        if (!this.isShuttingDown) {
          this.handleWorkerCrash();
        }
      });

      // STDIOストリーム処理
      if (this.workerProcess.stdout) {
        this.workerProcess.stdout.on('data', (data: Buffer) => {
          const lines = data.toString().trim();
          if (lines) {
            logger.debug(`[AgentWorker stdout] ${lines}`);
          }
        });
      }

      if (this.workerProcess.stderr) {
        this.workerProcess.stderr.on('data', (data: Buffer) => {
          const lines = data.toString().trim();
          if (lines) {
            logger.warn(`[AgentWorker stderr] ${lines}`);
          }
        });
      }

      // ワーカーの起動完了を待機（タイムアウト: 30秒）
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Worker startup timeout')), 30000);
      });

      await Promise.race([readyPromise, timeoutPromise]);

      // ヘルスチェック開始
      this.startHealthCheck();

      logger.info('[AgentWorkerManager] Agent worker manager initialized successfully');
    } catch (error) {
      logger.error({ err: error }, '[AgentWorkerManager] Failed to setup worker');
      throw error;
    }
  }

  private handleWorkerMessage(message: Record<string, unknown>): void {
    try {
      const type = message.type as string;
      const data = message.data as Record<string, unknown>;

      switch (type) {
        case 'worker-ready':
          this.isWorkerReady = true;
          logger.info({ pid: data?.pid }, '[AgentWorkerManager] Worker ready');
          if (this.readyResolve) {
            this.readyResolve();
            this.readyResolve = null;
          }
          break;

        case 'worker-shutting-down':
          logger.info({ signal: data?.signal }, '[AgentWorkerManager] Worker shutting down');
          this.isWorkerReady = false;
          break;

        case 'response':
          this.handleIPCResponse(data as unknown as IPCResponse);
          break;

        case 'orchestrator-event':
          this.handleOrchestratorEvent(data);
          break;

        default:
          logger.warn({ type }, '[AgentWorkerManager] Unknown message type from worker');
      }
    } catch (error) {
      logger.error({ err: error }, '[AgentWorkerManager] Error handling worker message');
    }
  }

  private handleIPCResponse(responseData: IPCResponse): void {
    const { id, success, data, error } = responseData;
    const pendingRequest = this.pendingRequests.get(id);

    if (!pendingRequest) {
      logger.warn({ id }, '[AgentWorkerManager] Received response for unknown request');
      return;
    }

    clearTimeout(pendingRequest.timeout);
    this.pendingRequests.delete(id);

    if (success) {
      pendingRequest.resolve(data);
    } else {
      pendingRequest.reject(new Error(error || 'Unknown worker error'));
    }
  }

  private handleOrchestratorEvent(eventData: Record<string, unknown>): void {
    const executionId = eventData.executionId as number;
    const sessionId = eventData.sessionId as number;
    const taskId = eventData.taskId as number;
    const eventType = eventData.eventType as string;
    const timestamp = eventData.timestamp as string;

    const executionChannel = `execution:${executionId}`;
    const sessionChannel = `session:${sessionId}`;

    const broadcastToBoth = (type: string, data: Record<string, unknown>) => {
      realtimeService.broadcast(executionChannel, type, data);
      realtimeService.broadcast(sessionChannel, type, data);
    };

    switch (eventType) {
      case 'execution_started':
        broadcastToBoth('execution_started', {
          executionId,
          sessionId,
          taskId,
          timestamp,
        });
        break;

      case 'execution_output': {
        const outputData = eventData.data as { output: string; isError: boolean } | undefined;
        if (outputData) {
          realtimeService.broadcast(executionChannel, 'execution_output', {
            executionId,
            output: outputData.output,
            isError: outputData.isError,
            timestamp: new Date().toISOString(),
          });
          realtimeService.broadcast(sessionChannel, 'execution_output', {
            executionId,
            output: outputData.output,
            isError: outputData.isError,
            timestamp: new Date().toISOString(),
          });
        }
        break;
      }

      case 'execution_completed':
        broadcastToBoth('execution_completed', {
          executionId,
          sessionId,
          taskId,
          result: eventData.data,
          timestamp,
        });
        break;

      case 'execution_failed':
        broadcastToBoth('execution_failed', {
          executionId,
          sessionId,
          taskId,
          error: eventData.data,
          timestamp,
        });
        break;

      case 'execution_cancelled':
        broadcastToBoth('execution_cancelled', {
          executionId,
          sessionId,
          taskId,
          timestamp,
        });
        break;

      default:
        logger.debug({ eventType }, '[AgentWorkerManager] Unhandled orchestrator event');
    }
  }

  private async handleWorkerCrash(): Promise<void> {
    if (this.isShuttingDown || this.restartPromise) {
      return;
    }

    logger.warn('[AgentWorkerManager] Worker crashed, attempting restart...');
    this.rejectPendingRequests(new Error('Worker process crashed'));

    this.restartPromise = this.restartWorker();
    await this.restartPromise;
    this.restartPromise = null;
  }

  private async restartWorker(): Promise<void> {
    try {
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
      await this.setupWorker();
      logger.info('[AgentWorkerManager] Worker successfully restarted');
    } catch (error) {
      logger.error({ err: error }, '[AgentWorkerManager] Failed to restart worker');

      setTimeout(() => {
        if (!this.isShuttingDown) {
          this.handleWorkerCrash();
        }
      }, 5000);
    }
  }

  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      if (this.isShuttingDown || !this.isWorkerReady) {
        return;
      }

      try {
        const result = await this.sendIPCRequest('get-status', {}, 5000);
        const status = result as { activeExecutionCount: number };
        this._cachedActiveCount = status.activeExecutionCount;
      } catch (error) {
        logger.error({ err: error }, '[AgentWorkerManager] Health check failed');
        this.handleWorkerCrash();
      }
    }, 30000);
  }

  private rejectPendingRequests(error: Error): void {
    for (const request of this.pendingRequests.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pendingRequests.clear();
  }

  private async sendIPCRequest(
    type: string,
    data: Record<string, unknown>,
    timeoutMs: number = 60000,
  ): Promise<unknown> {
    if (!this.workerProcess || !this.isWorkerReady) {
      throw new Error('Worker not ready');
    }

    const id = this.generateRequestId();
    const request: IPCRequest = {
      id,
      type,
      data,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`IPC request timeout: ${type}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout,
        type,
      });

      this.workerProcess!.send(request);
    });
  }

  // ==================== Public API (Orchestrator互換) ====================

  async executeTask(task: AgentTask, options: ExecutionOptions): Promise<AgentExecutionResult> {
    logger.info({ taskId: task.id }, '[AgentWorkerManager] Delegating task execution to worker');
    return this.sendIPCRequest(
      'execute-task',
      { task, options } as unknown as Record<string, unknown>,
      1200000,
    ) as Promise<AgentExecutionResult>;
  }

  async executeContinuation(
    executionId: number,
    response: string,
    options: Partial<ExecutionOptions> = {},
  ): Promise<AgentExecutionResult> {
    return this.sendIPCRequest(
      'continue-execution',
      { executionId, response, options } as unknown as Record<string, unknown>,
      1200000,
    ) as Promise<AgentExecutionResult>;
  }

  async executeContinuationWithLock(
    executionId: number,
    response: string,
    options: Partial<ExecutionOptions> = {},
  ): Promise<AgentExecutionResult> {
    return this.sendIPCRequest(
      'continue-with-lock',
      { executionId, response, options } as unknown as Record<string, unknown>,
      1200000,
    ) as Promise<AgentExecutionResult>;
  }

  async stopExecution(executionId: number): Promise<boolean> {
    return this.sendIPCRequest('stop-execution', { executionId }, 10000) as Promise<boolean>;
  }

  /**
   * セッション内のアクティブな実行を取得（非同期）
   */
  async getSessionExecutionsAsync(sessionId: number): Promise<ExecutionState[]> {
    const result = await this.sendIPCRequest('get-session-executions', { sessionId }, 5000);
    return (
      result as Array<{
        executionId: number;
        sessionId: number;
        agentId: string;
        taskId: number;
        status: string;
        startedAt: string;
        output: string;
      }>
    ).map((s) => ({
      executionId: s.executionId,
      sessionId: s.sessionId,
      agentId: s.agentId,
      taskId: s.taskId,
      status: s.status as ExecutionState['status'],
      startedAt: new Date(s.startedAt),
      output: s.output,
    }));
  }

  private _cachedActiveCount = 0;

  /**
   * アクティブな実行数を取得（非同期）
   */
  async getActiveExecutionCountAsync(): Promise<number> {
    const result = await this.sendIPCRequest('get-active-count', {}, 5000);
    const count = result as number;
    this._cachedActiveCount = count;
    return count;
  }

  /**
   * アクティブな実行数を同期的に取得（キャッシュ値）
   */
  getActiveExecutionCount(): number {
    return this._cachedActiveCount;
  }

  /**
   * ロック取得の非同期版
   */
  async tryAcquireContinuationLockAsync(
    executionId: number,
    source: 'user_response' | 'auto_timeout',
  ): Promise<boolean> {
    const result = await this.sendIPCRequest('try-acquire-lock', { executionId, source }, 5000);
    return result as boolean;
  }

  cancelQuestionTimeout(executionId: number): void {
    this.sendIPCRequest('cancel-timeout', { executionId }, 5000).catch((err) => {
      logger.error({ err }, '[AgentWorkerManager] Failed to cancel timeout');
    });
  }

  /**
   * タイムアウト情報の非同期取得
   */
  async getQuestionTimeoutInfoAsync(executionId: number): Promise<{
    remainingSeconds: number;
    deadline: Date;
    questionKey?: QuestionKey;
  } | null> {
    const result = await this.sendIPCRequest('get-timeout-info', { executionId }, 5000);
    if (!result) return null;
    const info = result as {
      remainingSeconds: number;
      deadline: string;
      questionKey?: QuestionKey;
    };
    return {
      ...info,
      deadline: new Date(info.deadline),
    };
  }

  async createBranch(workingDirectory: string, branchName: string): Promise<boolean> {
    return this.sendIPCRequest(
      'create-branch',
      { workingDirectory, branchName },
      30000,
    ) as Promise<boolean>;
  }

  async revertChanges(workingDirectory: string): Promise<boolean> {
    return this.sendIPCRequest('revert-changes', { workingDirectory }, 10000) as Promise<boolean>;
  }

  async getFullGitDiff(workingDirectory: string): Promise<string> {
    return this.sendIPCRequest('get-full-git-diff', { workingDirectory }, 10000) as Promise<string>;
  }

  async getDiff(workingDirectory: string): Promise<
    Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }>
  > {
    return this.sendIPCRequest('get-diff', { workingDirectory }, 10000) as Promise<
      Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        patch?: string;
      }>
    >;
  }

  async recoverStaleExecutions(): Promise<{
    recoveredExecutions: number;
    updatedTasks: number;
    updatedSessions: number;
    interruptedExecutionIds: number[];
  }> {
    return this.sendIPCRequest('recover-stale', {}, 30000) as Promise<{
      recoveredExecutions: number;
      updatedTasks: number;
      updatedSessions: number;
      interruptedExecutionIds: number[];
    }>;
  }

  async resumeInterruptedExecution(
    executionId: number,
    options: Partial<ExecutionOptions> = {},
  ): Promise<AgentExecutionResult> {
    return this.sendIPCRequest(
      'resume-execution',
      { executionId, options } as unknown as Record<string, unknown>,
      1200000,
    ) as Promise<AgentExecutionResult>;
  }

  // ==================== Git操作 ====================

  async commitChanges(
    workingDirectory: string,
    message: string,
    taskTitle?: string,
  ): Promise<{ success: boolean; commitHash?: string; error?: string }> {
    return this.sendIPCRequest(
      'commit-changes',
      { workingDirectory, message, taskTitle },
      30000,
    ) as Promise<{ success: boolean; commitHash?: string; error?: string }>;
  }

  async createPullRequest(
    workingDirectory: string,
    title: string,
    body: string,
    baseBranch: string = 'main',
  ): Promise<{ success: boolean; prUrl?: string; prNumber?: number; error?: string }> {
    return this.sendIPCRequest(
      'create-pull-request',
      { workingDirectory, title, body, baseBranch },
      60000,
    ) as Promise<{ success: boolean; prUrl?: string; prNumber?: number; error?: string }>;
  }

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
    return this.sendIPCRequest('create-commit', { workingDirectory, message }, 30000) as Promise<{
      hash: string;
      branch: string;
      filesChanged: number;
      additions: number;
      deletions: number;
    }>;
  }

  async mergePullRequest(
    workingDirectory: string,
    prNumber: number,
    commitThreshold: number = 5,
    baseBranch: string = 'master',
  ): Promise<{
    success: boolean;
    mergeStrategy?: 'squash' | 'merge';
    error?: string;
  }> {
    return this.sendIPCRequest(
      'merge-pull-request',
      { workingDirectory, prNumber, commitThreshold, baseBranch },
      60000,
    ) as Promise<{
      success: boolean;
      mergeStrategy?: 'squash' | 'merge';
      error?: string;
    }>;
  }

  async getGitDiff(workingDirectory: string): Promise<string> {
    return this.sendIPCRequest('get-git-diff', { workingDirectory }, 10000) as Promise<string>;
  }

  // ==================== 同期互換メソッド ====================

  /**
   * getSessionExecutions の同期版（互換性用）
   * ワーカーとの通信は非同期のため、空配列を返す。
   * 正確な値が必要な場合は getSessionExecutionsAsync() を使用すること。
   */
  getSessionExecutions(_sessionId: number): ExecutionState[] {
    return [];
  }

  getActiveAgentInfos(): Array<{
    executionId: number;
    sessionId: number;
    taskId: number;
    startedAt: Date;
    lastOutput: string;
  }> {
    return [];
  }

  getActiveExecutions(): ExecutionState[] {
    return [];
  }

  getExecutionState(_executionId: number): ExecutionState | undefined {
    return undefined;
  }

  // ==================== ダミーメソッド (Orchestrator互換) ====================

  addEventListener(_listener: (event: unknown) => void): void {
    // イベントは handleOrchestratorEvent で SSE にブリッジ済み
  }

  removeEventListener(_listener: (event: unknown) => void): void {}

  isInShutdown(): boolean {
    return this.isShuttingDown;
  }

  setServerStopCallback(_callback: () => Promise<void> | void): void {
    // ワーカーはサーバーを停止しない
  }

  async stopServer(): Promise<void> {
    // ワーカーマネージャーではサーバー停止は不要
    // メインプロセスの index.ts で直接処理する
  }

  // ==================== ライフサイクル ====================

  public getIsWorkerReady(): boolean {
    return this.isWorkerReady;
  }

  public async gracefulShutdown(_options?: { skipServerStop?: boolean }): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.info('[AgentWorkerManager] Starting graceful shutdown');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // ワーカーにシャットダウンを通知
    if (this.workerProcess && this.isWorkerReady) {
      try {
        await this.sendIPCRequest('shutdown', {}, 8000);
      } catch (error) {
        logger.warn({ err: error }, '[AgentWorkerManager] Shutdown request to worker failed');
      }
    }

    this.rejectPendingRequests(new Error('Manager is shutting down'));

    if (this.workerProcess) {
      try {
        if (!this.workerProcess.killed) {
          this.workerProcess.kill('SIGTERM');
        }

        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (this.workerProcess && !this.workerProcess.killed) {
              logger.warn('[AgentWorkerManager] Force killing worker process');
              this.workerProcess.kill('SIGKILL');
            }
            resolve();
          }, 5000);

          this.workerProcess!.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      } catch (error) {
        logger.error({ err: error }, '[AgentWorkerManager] Error during worker shutdown');
      }

      this.workerProcess = null;
    }

    logger.info('[AgentWorkerManager] Graceful shutdown complete');
  }
}
