/**
 * AbstractAgent
 *
 * Base class for all agent implementations. Provides common lifecycle
 * management, retry logic with exponential backoff, and event emission.
 *
 * Not responsible for provider-specific logic; subclasses handle that.
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
const MAX_RETRY_UPPER_BOUND = 10;

/**
 * Delays execution for the specified milliseconds.
 *
 * @param ms - Delay duration in milliseconds
 * @returns Promise that resolves after the delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  // Public methods
  // ============================================================================

  /**
   * Executes a task with automatic retry on recoverable errors.
   *
   * @param task - Task definition to execute
   * @param context - Execution context
   * @returns Execution result
   */
  async execute(
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    this.ensureNotDisposed();

    // Set execution ID for events
    this._events.setExecutionId(context.executionId);
    this._currentContext = context;

    // Initialize metrics
    this._metrics = {
      startTime: new Date(),
    };

    // Reset debug logs
    this._debugLogs = [];

    try {
      // beforeExecute hook
      if (this._lifecycleHooks.beforeExecute) {
        const shouldContinue = await this._lifecycleHooks.beforeExecute(context, task);
        if (shouldContinue === false) {
          this.log('info', 'Execution cancelled by beforeExecute hook');
          return this.createCancelledResult(context, 'Cancelled by beforeExecute hook');
        }
      }

      await this.transitionState('initializing');

      await this.transitionState('running');

      // NOTE(agent): Retry loop wraps doExecute() to handle transient errors with exponential backoff.
      const result = await this.executeWithRetry(task, context);

      // Finalize metrics
      this._metrics.endTime = new Date();
      this._metrics.durationMs =
        this._metrics.endTime.getTime() - this._metrics.startTime.getTime();

      // Transition state based on result
      if (result.pendingQuestion) {
        await this.transitionState('waiting_for_input');
      } else if (result.success) {
        await this.transitionState('completed');
      } else {
        await this.transitionState('failed');
      }

      // afterExecute hook
      if (this._lifecycleHooks.afterExecute) {
        await this._lifecycleHooks.afterExecute(context, result);
      }

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
   *
   * @param continuation - Continuation context with user response
   * @param context - Execution context
   * @returns Execution result
   * @throws {AgentError} If agent is not in 'waiting_for_input' state
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
      const result = await this.continueWithRetry(continuation, context);

      // Transition state based on result
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

  /** Stops the current execution if running. */
  async stop(): Promise<void> {
    if (this._state === 'idle' || this._state === 'completed' || this._state === 'failed') {
      return;
    }

    this.log('info', 'Stopping execution');

    try {
      await this.doStop();
      await this.transitionState('cancelled');

      // onShutdown hook
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
    if (this._state !== 'running') {
      return false;
    }

    // NOTE: Pause not supported by default; subclasses may override.
    this.log('warn', 'Pause not supported by this agent');
    return false;
  }

  /** Resumes paused execution. Not supported by default; subclasses may override. */
  async resume(): Promise<boolean> {
    if (this._state !== 'paused') {
      return false;
    }

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
    if (this._isDisposed) {
      return;
    }

    this.log('info', 'Disposing agent');

    // Stop if currently running
    if (this._state === 'running' || this._state === 'waiting_for_input') {
      await this.stop();
    }

    // Remove all event listeners
    this._events.removeAllListeners();

    // Reset state
    this._state = 'idle';
    this._currentContext = null;
    this._metrics = null;
    this._debugLogs = [];

    this._isDisposed = true;
  }

  // ============================================================================
  // Protected methods (for use by subclasses)
  // ============================================================================

  /** Transitions the agent state and emits related events. */
  protected async transitionState(newState: AgentState, reason?: string): Promise<void> {
    const previousState = this._state;
    this._state = newState;

    this.log('debug', `State transition: ${previousState} -> ${newState}`, { reason });

    // Emit state change event
    await this._events.emitStateChange(previousState, newState, reason);

    // onStateChange hook
    if (this._lifecycleHooks.onStateChange && this._currentContext) {
      await this._lifecycleHooks.onStateChange(this._currentContext, previousState, newState);
    }
  }

  /** Emits output content. */
  protected async emitOutput(content: string, isError = false, isPartial = false): Promise<void> {
    await this._events.emitOutput(content, isError, isPartial);
  }

  /** Emits a question for the user. */
  protected async emitQuestion(question: PendingQuestion): Promise<void> {
    await this._events.emitQuestion(question);

    // onQuestion hook
    if (this._lifecycleHooks.onQuestion && this._currentContext) {
      const autoResponse = await this._lifecycleHooks.onQuestion(this._currentContext, question);
      if (autoResponse !== null) {
        this.log('info', `Auto-response from hook: ${autoResponse}`);
        // NOTE: Auto-response handling is delegated to subclasses.
      }
    }
  }

  /** Emits an artifact event. */
  protected async emitArtifact(artifact: AgentArtifact): Promise<void> {
    await this._events.emitArtifact(artifact);

    // onArtifact hook
    if (this._lifecycleHooks.onArtifact && this._currentContext) {
      await this._lifecycleHooks.onArtifact(this._currentContext, artifact);
    }
  }

  /** Emits a Git commit event. */
  protected async emitCommit(commit: GitCommitInfo): Promise<void> {
    await this._events.emitCommit(commit);
  }

  /** Notifies listeners about a tool execution and returns a function to signal completion. */
  protected async notifyToolExecution(
    toolId: string,
    toolName: string,
    input: unknown,
  ): Promise<{ end: (output: unknown, success: boolean, error?: string) => Promise<void> }> {
    const startTime = Date.now();

    // beforeToolCall hook
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

        // afterToolCall hook
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

  /** Updates execution metrics. */
  protected updateMetrics(updates: Partial<ExecutionMetrics>): void {
    if (this._metrics) {
      Object.assign(this._metrics, updates);
      this._events.emitMetricsUpdate(updates);
    }
  }

  /** Records a log entry to internal debug log and external logger. */
  protected log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    const entry: DebugLogEntry = {
      timestamp: new Date(),
      level,
      message,
      data,
    };

    this._debugLogs.push(entry);

    // Forward to external logger if configured
    if (this._logger) {
      const context: Record<string, unknown> = data
        ? { data, agentId: this._metadata.id }
        : { agentId: this._metadata.id };

      // NOTE: error() has a different signature (accepts Error as second param), so branch here.
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
  // Retry Logic
  // ============================================================================

  /**
   * Executes doExecute() with automatic retry on recoverable errors.
   * Uses the onError lifecycle hook to determine retry behavior, falling back
   * to the error's recoverable flag and a default delay.
   *
   * @param task - Task definition
   * @param context - Execution context
   * @returns Execution result
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
        if (this._isDisposed || this._state === 'cancelled') {
          throw new AgentError(
            'Agent was disposed or cancelled during retry delay',
            'internal',
            false,
          );
        }

        // NOTE(agent): Transition back to running state for the retry attempt.
        await this.transitionState('running', `Retry attempt ${retryCount}`);
      }
    }
  }

  /**
   * Executes doContinue() with automatic retry on recoverable errors.
   *
   * @param continuation - Continuation context
   * @param context - Execution context
   * @returns Execution result
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
   * @param error - The error that occurred
   * @param context - Execution context
   * @param retryCount - Current retry count (0-based)
   * @returns Retry decision
   */
  private async evaluateRetry(
    error: AgentError,
    context: AgentExecutionContext,
    retryCount: number,
  ): Promise<{ shouldRetry: boolean; delay: number }> {
    // NOTE(agent): Hard upper bound prevents infinite retries even if hooks always return true.
    if (retryCount >= MAX_RETRY_UPPER_BOUND) {
      this.log('error', `Max retry upper bound (${MAX_RETRY_UPPER_BOUND}) reached, giving up`);
      return { shouldRetry: false, delay: 0 };
    }

    // Delegate retry decision to onError hook if configured
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
    const DEFAULT_MAX_RETRIES = 3;
    const DEFAULT_DELAY_MS = 3000;

    if (error.recoverable && retryCount < DEFAULT_MAX_RETRIES) {
      return { shouldRetry: true, delay: DEFAULT_DELAY_MS };
    }

    return { shouldRetry: false, delay: 0 };
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /** Throws if this agent has been disposed. */
  private ensureNotDisposed(): void {
    if (this._isDisposed) {
      throw new AgentError('Agent has been disposed', 'internal', false);
    }
  }

  /** Wraps an unknown error into an AgentError. */
  private wrapError(error: unknown): AgentError {
    if (error instanceof AgentError) {
      return error;
    }

    if (error instanceof Error) {
      return new AgentError(error.message, 'execution', false, undefined, error);
    }

    return new AgentError(String(error), 'internal', false);
  }

  /** Enriches the result with metrics and debug info. */
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

  /** Creates a cancelled execution result. */
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

  /** Creates a failed execution result from an error. */
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
