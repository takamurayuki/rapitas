/**
 * AbstractAgent
 *
 * Base class for all agent implementations. Provides common lifecycle
 * management, retry logic with exponential backoff, and event emission.
 *
 * Not responsible for provider-specific logic; subclasses handle that.
 * Heavy method bodies are delegated to agent-lifecycle-handlers.ts and
 * agent-event-helpers.ts to keep this file under 300 lines.
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
import * as EventHelpers from './agent-event-helpers';
import { runExecute, runContinue, type ExecutionCallbacks } from './agent-lifecycle-handlers';

/**
 * Abstract base class for all agent implementations.
 * Provides common lifecycle, retry, and event infrastructure; subclasses implement provider-specific logic.
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
  // Properties
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
  // Abstract methods (implemented by subclasses)
  // ============================================================================

  /** Performs the actual task execution. Must be implemented by subclasses. */
  protected abstract doExecute(
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult>;

  /** Performs continuation execution. Must be implemented by subclasses. */
  protected abstract doContinue(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult>;

  /** Stops execution. Must be implemented by subclasses. */
  protected abstract doStop(): Promise<void>;

  /** Checks whether the agent is available. Must be implemented by subclasses. */
  abstract isAvailable(): Promise<boolean>;

  /** Validates agent configuration. Must be implemented by subclasses. */
  abstract validateConfig(): Promise<{ valid: boolean; errors: string[] }>;

  // ============================================================================
  // Public lifecycle methods
  // ============================================================================

  /**
   * Executes a task with automatic retry on recoverable errors.
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
    return runExecute(
      task,
      context,
      this.makeCallbacks(),
      this._lifecycleHooks,
      this._events,
      this.doExecute.bind(this),
      this.transitionState.bind(this),
      this.log.bind(this),
    );
  }

  /**
   * Continues execution after user input, with retry on recoverable errors.
   *
   * @param continuation - Continuation context with user response / ユーザー応答を含む継続コンテキスト
   * @param context - Execution context / 実行コンテキスト
   * @returns Execution result / 実行結果
   * @throws {AgentError} If agent is not in 'waiting_for_input' state / エージェントが待機状態でない場合
   */
  async continue(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    this.ensureNotDisposed();
    return runContinue(
      continuation,
      context,
      this.makeCallbacks(),
      this._lifecycleHooks,
      this._events,
      this.doContinue.bind(this),
      this.transitionState.bind(this),
      this.log.bind(this),
    );
  }

  /** Stops the current execution if running. */
  async stop(): Promise<void> {
    if (this._state === 'idle' || this._state === 'completed' || this._state === 'failed') return;
    this.log('info', 'Stopping execution');
    try {
      await this.doStop();
      await this.transitionState('cancelled');
      if (this._lifecycleHooks.onShutdown && this._currentContext) {
        await this._lifecycleHooks.onShutdown(this._currentContext, 'cancelled');
      }
    } catch (error) {
      this.log('error', 'Error during stop', { error });
      await this.transitionState('failed');
    }
  }

  /** Pauses execution. Not supported by default; subclasses may override. */
  async pause(): Promise<boolean> {
    if (this._state !== 'running') return false;
    // NOTE: Pause not supported by default; subclasses may override.
    this.log('warn', 'Pause not supported by this agent');
    return false;
  }

  /** Resumes paused execution. Not supported by default; subclasses may override. */
  async resume(): Promise<boolean> {
    if (this._state !== 'paused') return false;
    // NOTE: Resume not supported by default; subclasses may override.
    this.log('warn', 'Resume not supported by this agent');
    return false;
  }

  /** Sets lifecycle hooks for execution events. */
  setLifecycleHooks(hooks: AgentLifecycleHooks): void {
    this._lifecycleHooks = { ...this._lifecycleHooks, ...hooks };
  }

  /** Releases all resources held by this agent. */
  async dispose(): Promise<void> {
    if (this._isDisposed) return;
    this.log('info', 'Disposing agent');
    if (this._state === 'running' || this._state === 'waiting_for_input') await this.stop();
    this._events.removeAllListeners();
    this._state = 'idle';
    this._currentContext = null;
    this._metrics = null;
    this._debugLogs = [];
    this._isDisposed = true;
  }

  // ============================================================================
  // Protected helpers (for use by subclasses)
  // ============================================================================

  /** Transitions the agent state and emits related events. */
  protected async transitionState(newState: string, reason?: string): Promise<void> {
    const previousState = this._state;
    this._state = newState as AgentState;
    this.log('debug', `State transition: ${previousState} -> ${newState}`, { reason });
    await this._events.emitStateChange(previousState, newState as AgentState, reason);
    if (this._lifecycleHooks.onStateChange && this._currentContext) {
      await this._lifecycleHooks.onStateChange(
        this._currentContext,
        previousState,
        newState as AgentState,
      );
    }
  }

  /** Emits output content. */
  protected async emitOutput(content: string, isError = false, isPartial = false): Promise<void> {
    await EventHelpers.emitOutput(this._events, content, isError, isPartial);
  }

  /** Emits a question for the user. */
  protected async emitQuestion(question: PendingQuestion): Promise<void> {
    if (!this._currentContext) return;
    await EventHelpers.emitQuestion(
      this._events,
      this._lifecycleHooks,
      this._currentContext,
      question,
      this.log.bind(this),
    );
  }

  /** Emits an artifact event. */
  protected async emitArtifact(artifact: AgentArtifact): Promise<void> {
    if (!this._currentContext) return;
    await EventHelpers.emitArtifact(
      this._events,
      this._lifecycleHooks,
      this._currentContext,
      artifact,
    );
  }

  /** Emits a Git commit event. */
  protected async emitCommit(commit: GitCommitInfo): Promise<void> {
    await EventHelpers.emitCommit(this._events, commit);
  }

  /**
   * Notifies listeners about a tool execution and returns a function to signal completion.
   *
   * @param toolId - Unique tool execution ID / ツール実行の一意ID
   * @param toolName - Tool name / ツール名
   * @param input - Tool input / ツール入力
   * @returns Object with an end() callback to signal tool completion / ツール完了を通知するend()コールバック付きオブジェクト
   */
  protected async notifyToolExecution(
    toolId: string,
    toolName: string,
    input: unknown,
  ): Promise<{ end: (output: unknown, success: boolean, error?: string) => Promise<void> }> {
    if (!this._currentContext) {
      // NOTE: Guard against subclasses calling this outside an active execution.
      return { end: async () => {} };
    }
    return EventHelpers.notifyToolExecution(
      this._events,
      this._lifecycleHooks,
      this._currentContext,
      toolId,
      toolName,
      input,
      this.log.bind(this),
    );
  }

  /** Updates execution metrics. */
  protected updateMetrics(updates: Partial<ExecutionMetrics>): void {
    EventHelpers.updateMetrics(this._events, this._metrics, updates);
  }

  /** Records a log entry to internal debug log and external logger. */
  protected log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    const entry: DebugLogEntry = { timestamp: new Date(), level, message, data };
    this._debugLogs.push(entry);

    if (this._logger) {
      const ctx: Record<string, unknown> = data
        ? { data, agentId: this._metadata.id }
        : { agentId: this._metadata.id };
      // NOTE: error() has a different signature (accepts Error as second param), so branch here.
      if (level === 'error') {
        this._logger.error(message, undefined, ctx);
      } else {
        this._logger[level](message, ctx);
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
  // Private helpers
  // ============================================================================

  private ensureNotDisposed(): void {
    if (this._isDisposed) throw new AgentError('Agent has been disposed', 'internal', false);
  }

  /**
   * Returns a callbacks object that gives lifecycle handlers live read/write access
   * to this agent's private fields. Arrow functions capture `this` at creation time.
   *
   * @returns ExecutionCallbacks object / 実行コールバックオブジェクト
   */
  private makeCallbacks(): ExecutionCallbacks {
    return {
      getState: () => this._state,
      getIsDisposed: () => this._isDisposed,
      getMetadata: () => this._metadata,
      setCurrentContext: (ctx) => {
        this._currentContext = ctx;
      },
      setMetrics: (m) => {
        this._metrics = m;
      },
      setDebugLogs: (logs) => {
        this._debugLogs = logs;
      },
      getMetrics: () => this._metrics,
      getDebugLogs: () => this._debugLogs,
    };
  }
}
