/**
 * AbstractAgent
 *
 * Base class for all agent implementations. Provides common lifecycle
 * management, retry logic with exponential backoff, and event emission.
 *
 * 全エージェント実装の基底クラス。共通のライフサイクル管理、
 * 指数バックオフ付きリトライロジック、イベント発行を提供する。
 */

import { createLogger } from '../../../config/logger';

const pinoLog = createLogger('abstract-agent');

import type {
  AgentProviderId,
  AgentState,
  AgentCapabilities,
  AgentMetadata,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  AgentLifecycleHooks,
  ContinuationContext,
  ExecutionMetrics,
  PendingQuestion,
  AgentArtifact,
  GitCommitInfo,
  DebugLogEntry,
} from './types';
import type { IAgent, IAgentLogger } from './interfaces';
import { AgentEventEmitter, createAgentEventEmitter } from './event-emitter';
import { AgentError } from './interfaces';

// NOTE(agent): Upper bound to prevent infinite retry loops regardless of hook/strategy configuration.
// onErrorフックや戦略設定に関わらず無限リトライを防ぐための上限値。
const MAX_RETRY_UPPER_BOUND = 10;

/**
 * Delays execution for the specified milliseconds.
 * 指定ミリ秒だけ実行を遅延させる。
 *
 * @param ms - Delay duration in milliseconds / 遅延時間（ミリ秒）
 * @returns Promise that resolves after the delay / 遅延後に解決するPromise
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 抽象エージェント基底クラス
 * 共通機能を提供し、派生クラスで具体的な実装を行う
 */
export abstract class AbstractAgent implements IAgent {
  protected _state: AgentState = 'idle';
  protected _metadata: AgentMetadata;
  protected _events: AgentEventEmitter;
  protected _lifecycleHooks: AgentLifecycleHooks = {};
  protected _currentContext: AgentExecutionContext | null = null;
  protected _metrics: ExecutionMetrics | null = null;
  protected _debugLogs: DebugLogEntry[] = [];
  protected _logger?: IAgentLogger;
  protected _isDisposed = false;

  constructor(
    id: string,
    name: string,
    providerId: AgentProviderId,
    options?: {
      version?: string;
      description?: string;
      modelId?: string;
      endpoint?: string;
      logger?: IAgentLogger;
    },
  ) {
    this._metadata = {
      id,
      providerId,
      name,
      version: options?.version,
      description: options?.description,
      modelId: options?.modelId,
      endpoint: options?.endpoint,
      createdAt: new Date(),
    };

    this._events = createAgentEventEmitter(id);
    this._logger = options?.logger;
  }

  // ============================================================================
  // プロパティ
  // ============================================================================

  get metadata(): AgentMetadata {
    return { ...this._metadata };
  }

  get state(): AgentState {
    return this._state;
  }

  get events(): AgentEventEmitter {
    return this._events;
  }

  abstract get capabilities(): AgentCapabilities;

  // ============================================================================
  // 抽象メソッド（派生クラスで実装）
  // ============================================================================

  /**
   * 実際のタスク実行処理
   * 派生クラスで実装
   */
  protected abstract doExecute(
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult>;

  /**
   * 継続実行処理
   * 派生クラスで実装
   */
  protected abstract doContinue(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult>;

  /**
   * 停止処理
   * 派生クラスで実装
   */
  protected abstract doStop(): Promise<void>;

  /**
   * 利用可能チェック
   * 派生クラスで実装
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * 設定検証
   * 派生クラスで実装
   */
  abstract validateConfig(): Promise<{ valid: boolean; errors: string[] }>;

  // ============================================================================
  // 公開メソッド
  // ============================================================================

  /**
   * Executes a task with automatic retry on recoverable errors.
   * リカバリー可能なエラー発生時に自動リトライ付きでタスクを実行する。
   *
   * @param task - Task definition to execute / 実行するタスク定義
   * @param context - Execution context / 実行コンテキスト
   * @returns Execution result / 実行結果
   */
  async execute(
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    this.ensureNotDisposed();

    // 実行IDを設定
    this._events.setExecutionId(context.executionId);
    this._currentContext = context;

    // メトリクス初期化
    this._metrics = {
      startTime: new Date(),
    };

    // デバッグログ初期化
    this._debugLogs = [];

    try {
      // beforeExecuteフック
      if (this._lifecycleHooks.beforeExecute) {
        const shouldContinue = await this._lifecycleHooks.beforeExecute(context, task);
        if (shouldContinue === false) {
          this.log('info', 'Execution cancelled by beforeExecute hook');
          return this.createCancelledResult(context, 'Cancelled by beforeExecute hook');
        }
      }

      // 状態遷移: idle -> initializing
      await this.transitionState('initializing');

      // 状態遷移: initializing -> running
      await this.transitionState('running');

      // NOTE(agent): Retry loop wraps doExecute() to handle transient errors with exponential backoff.
      // doExecute()を指数バックオフ付きリトライで実行する。
      const result = await this.executeWithRetry(task, context);

      // メトリクス完了
      this._metrics.endTime = new Date();
      this._metrics.durationMs =
        this._metrics.endTime.getTime() - this._metrics.startTime.getTime();

      // 結果に基づいて状態遷移
      if (result.pendingQuestion) {
        await this.transitionState('waiting_for_input');
      } else if (result.success) {
        await this.transitionState('completed');
      } else {
        await this.transitionState('failed');
      }

      // afterExecuteフック
      if (this._lifecycleHooks.afterExecute) {
        await this._lifecycleHooks.afterExecute(context, result);
      }

      // メタデータ更新
      this._metadata.lastUsedAt = new Date();

      return this.enrichResult(result);
    } catch (error) {
      const agentError = this.wrapError(error);

      await this.transitionState('failed');
      await this._events.emitError(agentError, agentError.recoverable);

      return this.createErrorResult(context, agentError);
    } finally {
      this._currentContext = null;
    }
  }

  /**
   * Continues execution after user input, with retry on recoverable errors.
   * ユーザー入力後に実行を継続する。リカバリー可能なエラーにはリトライを行う。
   *
   * @param continuation - Continuation context with user response / ユーザー応答を含む継続コンテキスト
   * @param context - Execution context / 実行コンテキスト
   * @returns Execution result / 実行結果
   * @throws {AgentError} If agent is not in 'waiting_for_input' state
   *                      エージェントが 'waiting_for_input' 状態でない場合
   */
  async continue(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    this.ensureNotDisposed();

    if (this._state !== 'waiting_for_input') {
      throw new AgentError(
        `Cannot continue execution: agent is in state '${this._state}', expected 'waiting_for_input'`,
        'execution',
        false,
      );
    }

    this._events.setExecutionId(context.executionId);
    this._currentContext = context;

    try {
      await this.transitionState('running');

      // NOTE(agent): Retry loop for continuation, same pattern as executeWithRetry.
      // 継続実行にもexecuteWithRetryと同じリトライパターンを適用。
      const result = await this.continueWithRetry(continuation, context);

      // 結果に基づいて状態遷移
      if (result.pendingQuestion) {
        await this.transitionState('waiting_for_input');
      } else if (result.success) {
        await this.transitionState('completed');
      } else {
        await this.transitionState('failed');
      }

      return this.enrichResult(result);
    } catch (error) {
      const agentError = this.wrapError(error);
      await this.transitionState('failed');
      await this._events.emitError(agentError, agentError.recoverable);
      return this.createErrorResult(context, agentError);
    } finally {
      this._currentContext = null;
    }
  }

  /**
   * 実行を停止
   */
  async stop(): Promise<void> {
    if (this._state === 'idle' || this._state === 'completed' || this._state === 'failed') {
      return;
    }

    this.log('info', 'Stopping execution');

    try {
      await this.doStop();
      await this.transitionState('cancelled');

      // onShutdownフック
      if (this._lifecycleHooks.onShutdown && this._currentContext) {
        await this._lifecycleHooks.onShutdown(this._currentContext, 'cancelled');
      }
    } catch (error) {
      this.log('error', 'Error during stop', { error });
      await this.transitionState('failed');
    }
  }

  /**
   * 実行を一時停止
   */
  async pause(): Promise<boolean> {
    if (this._state !== 'running') {
      return false;
    }

    // デフォルトでは一時停止をサポートしない
    // 派生クラスでオーバーライド可能
    this.log('warn', 'Pause not supported by this agent');
    return false;
  }

  /**
   * 実行を再開
   */
  async resume(): Promise<boolean> {
    if (this._state !== 'paused') {
      return false;
    }

    // デフォルトでは再開をサポートしない
    // 派生クラスでオーバーライド可能
    this.log('warn', 'Resume not supported by this agent');
    return false;
  }

  /**
   * ライフサイクルフックを設定
   */
  setLifecycleHooks(hooks: AgentLifecycleHooks): void {
    this._lifecycleHooks = { ...this._lifecycleHooks, ...hooks };
  }

  /**
   * リソースを解放
   */
  async dispose(): Promise<void> {
    if (this._isDisposed) {
      return;
    }

    this.log('info', 'Disposing agent');

    // 実行中の場合は停止
    if (this._state === 'running' || this._state === 'waiting_for_input') {
      await this.stop();
    }

    // イベントリスナーを削除
    this._events.removeAllListeners();

    // 状態をリセット
    this._state = 'idle';
    this._currentContext = null;
    this._metrics = null;
    this._debugLogs = [];

    this._isDisposed = true;
  }

  // ============================================================================
  // 保護メソッド（派生クラスから使用）
  // ============================================================================

  /**
   * 状態を遷移
   */
  protected async transitionState(newState: AgentState, reason?: string): Promise<void> {
    const previousState = this._state;
    this._state = newState;

    this.log('debug', `State transition: ${previousState} -> ${newState}`, { reason });

    // イベント発行
    await this._events.emitStateChange(previousState, newState, reason);

    // onStateChangeフック
    if (this._lifecycleHooks.onStateChange && this._currentContext) {
      await this._lifecycleHooks.onStateChange(this._currentContext, previousState, newState);
    }
  }

  /**
   * 出力を送信
   */
  protected async emitOutput(content: string, isError = false, isPartial = false): Promise<void> {
    await this._events.emitOutput(content, isError, isPartial);
  }

  /**
   * 質問を送信
   */
  protected async emitQuestion(question: PendingQuestion): Promise<void> {
    await this._events.emitQuestion(question);

    // onQuestionフック
    if (this._lifecycleHooks.onQuestion && this._currentContext) {
      const autoResponse = await this._lifecycleHooks.onQuestion(this._currentContext, question);
      if (autoResponse !== null) {
        this.log('info', `Auto-response from hook: ${autoResponse}`);
        // 自動応答の処理は派生クラスで実装
      }
    }
  }

  /**
   * 成果物を送信
   */
  protected async emitArtifact(artifact: AgentArtifact): Promise<void> {
    await this._events.emitArtifact(artifact);

    // onArtifactフック
    if (this._lifecycleHooks.onArtifact && this._currentContext) {
      await this._lifecycleHooks.onArtifact(this._currentContext, artifact);
    }
  }

  /**
   * コミットを送信
   */
  protected async emitCommit(commit: GitCommitInfo): Promise<void> {
    await this._events.emitCommit(commit);
  }

  /**
   * ツール実行を通知
   */
  protected async notifyToolExecution(
    toolId: string,
    toolName: string,
    input: unknown,
  ): Promise<{ end: (output: unknown, success: boolean, error?: string) => Promise<void> }> {
    const startTime = Date.now();

    // beforeToolCallフック
    if (this._lifecycleHooks.beforeToolCall && this._currentContext) {
      const shouldContinue = await this._lifecycleHooks.beforeToolCall(
        this._currentContext,
        toolName,
        input,
      );
      if (shouldContinue === false) {
        this.log('info', `Tool ${toolName} skipped by beforeToolCall hook`);
      }
    }

    await this._events.emitToolStart(toolId, toolName, input);

    return {
      end: async (output: unknown, success: boolean, error?: string) => {
        const durationMs = Date.now() - startTime;
        await this._events.emitToolEnd(toolId, toolName, output, success, durationMs, error);

        // afterToolCallフック
        if (this._lifecycleHooks.afterToolCall && this._currentContext) {
          await this._lifecycleHooks.afterToolCall(
            this._currentContext,
            toolName,
            input,
            output,
            success,
          );
        }
      },
    };
  }

  /**
   * メトリクスを更新
   */
  protected updateMetrics(updates: Partial<ExecutionMetrics>): void {
    if (this._metrics) {
      Object.assign(this._metrics, updates);
      this._events.emitMetricsUpdate(updates);
    }
  }

  /**
   * ログを記録
   */
  protected log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    const entry: DebugLogEntry = {
      timestamp: new Date(),
      level,
      message,
      data,
    };

    this._debugLogs.push(entry);

    // 外部ロガーにも出力
    if (this._logger) {
      const context: Record<string, unknown> = data
        ? { data, agentId: this._metadata.id }
        : { agentId: this._metadata.id };

      // errorメソッドは別のシグネチャを持つため、分岐処理
      if (level === 'error') {
        this._logger.error(message, undefined, context);
      } else {
        this._logger[level](message, context);
      }
    } else {
      const logMsg = `[${this._metadata.name}] [${level.toUpperCase()}] ${message}`;
      if (level === 'error') {
        pinoLog.error({ data }, logMsg);
      } else {
        pinoLog.info({ data }, logMsg);
      }
    }
  }

  // ============================================================================
  // リトライロジック / Retry Logic
  // ============================================================================

  /**
   * Executes doExecute() with automatic retry on recoverable errors.
   * Uses the onError lifecycle hook to determine retry behavior, falling back
   * to the error's recoverable flag and a default delay.
   *
   * リカバリー可能なエラー時にdoExecute()を自動リトライする。
   * onErrorフックでリトライ動作を制御し、フック未設定時はエラーの
   * recoverableフラグとデフォルト遅延を使用する。
   *
   * @param task - Task definition / タスク定義
   * @param context - Execution context / 実行コンテキスト
   * @returns Execution result / 実行結果
   */
  private async executeWithRetry(
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    let retryCount = 0;

    while (true) {
      try {
        return await this.doExecute(task, context);
      } catch (error) {
        const agentError = this.wrapError(error);
        const retryDecision = await this.evaluateRetry(agentError, context, retryCount);

        if (!retryDecision.shouldRetry) {
          throw agentError;
        }

        retryCount++;
        this.log(
          'warn',
          `Retrying execution (attempt ${retryCount}) after ${retryDecision.delay}ms delay. Error: ${agentError.message}`,
        );

        await sleep(retryDecision.delay);

        // NOTE(agent): Re-check disposal/cancellation state before each retry attempt.
        // リトライ前にdispose/キャンセル状態を再確認し、無駄な実行を防止。
        if (this._isDisposed || this._state === 'cancelled') {
          throw new AgentError(
            'Agent was disposed or cancelled during retry delay',
            'internal',
            false,
          );
        }

        // NOTE(agent): Transition back to running state for the retry attempt.
        // リトライ実行のためrunning状態に復帰。
        await this.transitionState('running', `Retry attempt ${retryCount}`);
      }
    }
  }

  /**
   * Executes doContinue() with automatic retry on recoverable errors.
   * リカバリー可能なエラー時にdoContinue()を自動リトライする。
   *
   * @param continuation - Continuation context / 継続コンテキスト
   * @param context - Execution context / 実行コンテキスト
   * @returns Execution result / 実行結果
   */
  private async continueWithRetry(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    let retryCount = 0;

    while (true) {
      try {
        return await this.doContinue(continuation, context);
      } catch (error) {
        const agentError = this.wrapError(error);
        const retryDecision = await this.evaluateRetry(agentError, context, retryCount);

        if (!retryDecision.shouldRetry) {
          throw agentError;
        }

        retryCount++;
        this.log(
          'warn',
          `Retrying continuation (attempt ${retryCount}) after ${retryDecision.delay}ms delay. Error: ${agentError.message}`,
        );

        await sleep(retryDecision.delay);

        if (this._isDisposed || this._state === 'cancelled') {
          throw new AgentError(
            'Agent was disposed or cancelled during retry delay',
            'internal',
            false,
          );
        }

        await this.transitionState('running', `Retry attempt ${retryCount}`);
      }
    }
  }

  /**
   * Evaluates whether an error should trigger a retry.
   * Consults the onError lifecycle hook first; if unavailable, uses the
   * error's recoverable flag with a default 3-second delay.
   *
   * エラーに対してリトライすべきかを判定する。
   * onErrorフックを優先的に使用し、フック未設定時はrecoverableフラグと
   * デフォルト3秒遅延を使用する。
   *
   * @param error - The error that occurred / 発生したエラー
   * @param context - Execution context / 実行コンテキスト
   * @param retryCount - Current retry count (0-based) / 現在のリトライ回数（0始まり）
   * @returns Retry decision / リトライ判定結果
   */
  private async evaluateRetry(
    error: AgentError,
    context: AgentExecutionContext,
    retryCount: number,
  ): Promise<{ shouldRetry: boolean; delay: number }> {
    // NOTE(agent): Hard upper bound prevents infinite retries even if hooks always return true.
    // フックが常にtrueを返す場合でも無限リトライを防ぐハードリミット。
    if (retryCount >= MAX_RETRY_UPPER_BOUND) {
      this.log('error', `Max retry upper bound (${MAX_RETRY_UPPER_BOUND}) reached, giving up`);
      return { shouldRetry: false, delay: 0 };
    }

    // onErrorフックが設定されている場合はフックに判断を委譲
    if (this._lifecycleHooks.onError) {
      try {
        const hookResult = await this._lifecycleHooks.onError(context, error, retryCount);
        return {
          shouldRetry: hookResult.retry,
          delay: hookResult.delay ?? 3000,
        };
      } catch (hookError) {
        this.log(
          'warn',
          `onError hook threw an error: ${hookError instanceof Error ? hookError.message : String(hookError)}`,
        );
        return { shouldRetry: false, delay: 0 };
      }
    }

    // NOTE(agent): Without an onError hook, fall back to the error's recoverable flag.
    // Limit default retries to 3 to avoid excessive retries without explicit configuration.
    // onErrorフック未設定時はrecoverableフラグにフォールバック。
    // 明示的な設定なしでの過剰リトライを防ぐため、デフォルト上限は3回。
    const DEFAULT_MAX_RETRIES = 3;
    const DEFAULT_DELAY_MS = 3000;

    if (error.recoverable && retryCount < DEFAULT_MAX_RETRIES) {
      return { shouldRetry: true, delay: DEFAULT_DELAY_MS };
    }

    return { shouldRetry: false, delay: 0 };
  }

  // ============================================================================
  // プライベートメソッド
  // ============================================================================

  /**
   * 破棄済みチェック
   */
  private ensureNotDisposed(): void {
    if (this._isDisposed) {
      throw new AgentError('Agent has been disposed', 'internal', false);
    }
  }

  /**
   * エラーをラップ
   */
  private wrapError(error: unknown): AgentError {
    if (error instanceof AgentError) {
      return error;
    }

    if (error instanceof Error) {
      return new AgentError(error.message, 'execution', false, undefined, error);
    }

    return new AgentError(String(error), 'internal', false);
  }

  /**
   * 結果を補完
   */
  private enrichResult(result: AgentExecutionResult): AgentExecutionResult {
    return {
      ...result,
      metrics: this._metrics || undefined,
      debugInfo: {
        logs: [...this._debugLogs],
        ...result.debugInfo,
      },
    };
  }

  /**
   * キャンセル結果を作成
   */
  private createCancelledResult(
    context: AgentExecutionContext,
    reason: string,
  ): AgentExecutionResult {
    return {
      success: false,
      state: 'cancelled',
      output: '',
      errorMessage: reason,
      metrics: this._metrics || undefined,
      debugInfo: {
        logs: [...this._debugLogs],
      },
    };
  }

  /**
   * エラー結果を作成
   */
  private createErrorResult(
    context: AgentExecutionContext,
    error: AgentError,
  ): AgentExecutionResult {
    return {
      success: false,
      state: 'failed',
      output: '',
      errorMessage: error.message,
      metrics: this._metrics || undefined,
      debugInfo: {
        logs: [...this._debugLogs],
      },
    };
  }
}
