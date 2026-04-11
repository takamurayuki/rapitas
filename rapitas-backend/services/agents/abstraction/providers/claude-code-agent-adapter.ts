/**
 * Claude Code Agent Adapter
 *
 * Adapts the existing ClaudeCodeAgent to the IAgent interface of the abstraction layer.
 * Delegates result conversion to adapter-result-converter and task building to adapter-execution.
 */

import type {
  AgentState,
  AgentCapabilities,
  AgentMetadata,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  AgentLifecycleHooks,
  ContinuationContext,
  ClaudeCodeProviderConfig,
} from '../types';
import type { IAgent } from '../interfaces';
import { AgentEventEmitter, createAgentEventEmitter } from '../event-emitter';
import { AgentError } from '../interfaces';
import { createDefaultCapabilities, generateAgentId } from '../index';
import { ClaudeCodeAgent } from '../../claude-code-agent';
import {
  convertLegacyResult,
  createCancelledResult,
  createErrorResult,
  wrapError,
} from './adapter-result-converter';
import {
  buildLegacyConfig,
  buildContinuationConfig,
  buildLegacyTask,
  buildContinuationTask,
  attachQuestionHandler,
} from './adapter-execution';

/** Default capability flags for ClaudeCodeAgent — all file/terminal/git tools enabled. */
const CLAUDE_CODE_CAPABILITIES = {
  codeGeneration: true,
  codeReview: true,
  codeExecution: true,
  fileRead: true,
  fileWrite: true,
  fileEdit: true,
  terminalAccess: true,
  gitOperations: true,
  webSearch: true,
  webFetch: true,
  taskAnalysis: true,
  taskPlanning: true,
  parallelExecution: false,
  questionAsking: true,
  conversationMemory: true,
  sessionContinuation: true,
} as const;

/**
 * Claude Code Agent Adapter.
 * Adapts the legacy ClaudeCodeAgent to the new IAgent interface.
 */
export class ClaudeCodeAgentAdapter implements IAgent {
  private _state: AgentState = 'idle';
  private _metadata: AgentMetadata;
  private _events: AgentEventEmitter;
  private _lifecycleHooks: AgentLifecycleHooks = {};
  private _capabilities: AgentCapabilities;
  private _config: ClaudeCodeProviderConfig;
  private _isDisposed = false;

  // Legacy ClaudeCodeAgent used internally
  private _legacyAgent: ClaudeCodeAgent | null = null;
  private _currentSessionId: string | null = null;

  constructor(config: ClaudeCodeProviderConfig) {
    const id = generateAgentId('claude-code');

    this._config = config;
    this._metadata = {
      id,
      providerId: 'claude-code',
      name: `Claude Code Agent (${id})`,
      version: '1.0.0',
      description: 'Claude Code CLI based AI agent',
      createdAt: new Date(),
    };

    this._events = createAgentEventEmitter(id);

    this._capabilities = createDefaultCapabilities(CLAUDE_CODE_CAPABILITIES);
  }

  get metadata(): AgentMetadata {
    return { ...this._metadata };
  }
  get state(): AgentState {
    return this._state;
  }
  get capabilities(): AgentCapabilities {
    return { ...this._capabilities };
  }
  get events(): AgentEventEmitter {
    return this._events;
  }

  private async transitionState(newState: AgentState, reason?: string): Promise<void> {
    const previousState = this._state;
    this._state = newState;

    await this._events.emitStateChange(previousState, newState, reason);

    if (this._lifecycleHooks.onStateChange) {
      // Use dummy context when no real context is available
      const dummyContext: AgentExecutionContext = {
        executionId: 'state-change',
        workingDirectory: process.cwd(),
      };
      await this._lifecycleHooks.onStateChange(dummyContext, previousState, newState);
    }
  }

  /**
   * Executes a task.
   * @param task - Task definition to execute / 実行するタスク定義
   * @param context - Execution context including working directory / 作業ディレクトリを含む実行コンテキスト
   * @returns Execution result / 実行結果
   */
  async execute(
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    this.ensureNotDisposed();

    this._events.setExecutionId(context.executionId);

    const startTime = new Date();

    try {
      if (this._lifecycleHooks.beforeExecute) {
        const shouldContinue = await this._lifecycleHooks.beforeExecute(context, task);
        if (shouldContinue === false) {
          return createCancelledResult(context, 'Cancelled by beforeExecute hook');
        }
      }

      await this.transitionState('initializing');

      this._legacyAgent = new ClaudeCodeAgent(
        `legacy-${this._metadata.id}`,
        this._metadata.name,
        buildLegacyConfig(context, this._config),
      );

      this._legacyAgent.setOutputHandler((output: string, isError?: boolean) => {
        this._events.emitOutput(output, isError || false, true);
      });

      attachQuestionHandler(this._legacyAgent, context, (q) => this._events.emitQuestion(q));

      await this.transitionState('running');

      const result = await this._runLegacyAgent(buildLegacyTask(task, context), startTime, context);

      if (this._lifecycleHooks.afterExecute) {
        await this._lifecycleHooks.afterExecute(context, result);
      }
      this._metadata.lastUsedAt = new Date();

      return result;
    } catch (error) {
      const agentError = wrapError(error);
      if (this._lifecycleHooks.onError) {
        await this._lifecycleHooks.onError(context, agentError, 0);
      }
      await this.transitionState('failed');
      await this._events.emitError(agentError, agentError.recoverable);
      return createErrorResult(context, agentError, startTime);
    }
  }

  /**
   * Continues execution after user response.
   * @throws {AgentError} When agent is not in waiting_for_input state / waiting_for_input状態でない場合
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
    const startTime = new Date();

    try {
      await this.transitionState('running');

      this._legacyAgent = new ClaudeCodeAgent(
        `legacy-${this._metadata.id}`,
        this._metadata.name,
        buildContinuationConfig(context, this._config, continuation, this._currentSessionId),
      );
      this._legacyAgent.setOutputHandler((output: string, isError?: boolean) => {
        this._events.emitOutput(output, isError || false, true);
      });

      return await this._runLegacyAgent(
        buildContinuationTask(continuation, context),
        startTime,
        context,
      );
    } catch (error) {
      const agentError = wrapError(error);
      await this.transitionState('failed');
      await this._events.emitError(agentError, agentError.recoverable);
      return createErrorResult(context, agentError, startTime);
    }
  }

  /** Stops execution. */
  async stop(): Promise<void> {
    if (this._state === 'idle' || this._state === 'completed' || this._state === 'failed') {
      return;
    }

    if (this._legacyAgent) {
      await this._legacyAgent.stop();
      this._legacyAgent = null;
    }

    await this.transitionState('cancelled');
  }

  /**
   * Pauses execution.
   * @returns true if paused successfully / 正常に一時停止した場合true
   */
  async pause(): Promise<boolean> {
    if (this._state !== 'running' || !this._legacyAgent) {
      return false;
    }

    const result = await this._legacyAgent.pause();
    if (result) {
      await this.transitionState('paused');
    }
    return result;
  }

  /**
   * Resumes execution.
   * @returns true if resumed successfully / 正常に再開した場合true
   */
  async resume(): Promise<boolean> {
    if (this._state !== 'paused' || !this._legacyAgent) {
      return false;
    }

    const result = await this._legacyAgent.resume();
    if (result) {
      await this.transitionState('running');
    }
    return result;
  }

  /**
   * Sets lifecycle hooks.
   * @param hooks - Partial lifecycle hooks to merge in / マージするライフサイクルフック
   */
  setLifecycleHooks(hooks: AgentLifecycleHooks): void {
    this._lifecycleHooks = { ...this._lifecycleHooks, ...hooks };
  }

  /**
   * Releases all resources.
   */
  async dispose(): Promise<void> {
    if (this._isDisposed) {
      return;
    }

    if (this._state === 'running' || this._state === 'waiting_for_input') {
      await this.stop();
    }

    this._events.removeAllListeners();
    this._legacyAgent = null;
    this._state = 'idle';
    this._currentSessionId = null;
    this._isDisposed = true;
  }

  /** Executes a legacy task and transitions state based on the result. */
  private async _runLegacyAgent(
    legacyTask: import('../../base-agent').AgentTask,
    startTime: Date,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    const legacyResult = await this._legacyAgent!.execute(legacyTask);
    const result = convertLegacyResult(legacyResult, startTime, context);

    if (legacyResult.claudeSessionId) {
      this._currentSessionId = legacyResult.claudeSessionId;
    }

    if (result.pendingQuestion) {
      await this.transitionState('waiting_for_input');
    } else if (result.success) {
      await this.transitionState('completed');
    } else {
      await this.transitionState('failed');
    }

    return result;
  }

  private ensureNotDisposed(): void {
    if (this._isDisposed) {
      throw new AgentError('Agent has been disposed', 'internal', false);
    }
  }
}
