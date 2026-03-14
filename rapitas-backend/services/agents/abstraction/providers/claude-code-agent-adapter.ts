/**
 * Claude Code Agent Adapter
 *
 * Adapts the existing ClaudeCodeAgent to the IAgent interface of the abstraction layer.
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
  PendingQuestion,
  ExecutionMetrics,
} from '../types';
import type { IAgent } from '../interfaces';
import { AgentEventEmitter, createAgentEventEmitter } from '../event-emitter';
import { AgentError } from '../interfaces';
import { createDefaultCapabilities, generateAgentId } from '../index';
import { ClaudeCodeAgent, ClaudeCodeAgentConfig } from '../../claude-code-agent';
import type { AgentTask, AgentExecutionResult as LegacyExecutionResult } from '../../base-agent';

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

    this._capabilities = createDefaultCapabilities({
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
    });
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

  get capabilities(): AgentCapabilities {
    return { ...this._capabilities };
  }

  get events(): AgentEventEmitter {
    return this._events;
  }

  // ============================================================================
  // State management
  // ============================================================================

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

  // ============================================================================
  // Public methods
  // ============================================================================

  /**
   * Executes a task.
   */
  async execute(
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    this.ensureNotDisposed();

    // Set execution ID
    this._events.setExecutionId(context.executionId);

    const startTime = new Date();

    try {
      // beforeExecute hook
      if (this._lifecycleHooks.beforeExecute) {
        const shouldContinue = await this._lifecycleHooks.beforeExecute(context, task);
        if (shouldContinue === false) {
          return this.createCancelledResult(context, 'Cancelled by beforeExecute hook');
        }
      }

      // State transition: idle -> initializing -> running
      await this.transitionState('initializing');

      // Create legacy ClaudeCodeAgent
      const legacyConfig: ClaudeCodeAgentConfig = {
        workingDirectory: context.workingDirectory,
        timeout: context.timeout || this._config.defaultTimeout || 900000,
        dangerouslySkipPermissions:
          context.dangerouslySkipPermissions || this._config.dangerouslySkipPermissions,
        continueConversation: !!context.sessionId,
        resumeSessionId: context.sessionId,
      };

      this._legacyAgent = new ClaudeCodeAgent(
        `legacy-${this._metadata.id}`,
        this._metadata.name,
        legacyConfig,
      );

      // Set up output handler
      this._legacyAgent.setOutputHandler((output: string, isError?: boolean) => {
        this._events.emitOutput(output, isError || false, true);
      });

      // Set up question detection handler
      this._legacyAgent.setQuestionDetectedHandler((info) => {
        const question: PendingQuestion = {
          questionId: info.questionKey?.question_id || `q-${Date.now()}`,
          text: info.question,
          category: this.mapQuestionType(info.questionType),
          options: info.questionDetails?.options?.map((opt) => ({
            label: opt.label,
            value: opt.label,
            description: opt.description,
          })),
          multiSelect: info.questionDetails?.multiSelect,
          timeout: context.timeout ? Math.floor(context.timeout / 1000) : 300,
        };
        this._events.emitQuestion(question);
      });

      await this.transitionState('running');

      // Create legacy task
      // NOTE: Convert string ID to number since the legacy API expects number type
      const taskId = typeof task.id === 'string' ? parseInt(task.id, 10) || 0 : task.id;

      const legacyTask: AgentTask = {
        id: taskId,
        title: task.title,
        description: task.description,
        workingDirectory: context.workingDirectory,
        optimizedPrompt: task.optimizedPrompt,
        analysisInfo: task.analysis
          ? {
              summary: task.analysis.summary,
              complexity: task.analysis.complexity,
              estimatedTotalHours: task.analysis.estimatedDuration
                ? task.analysis.estimatedDuration / 60
                : 0,
              subtasks:
                task.analysis.subtasks?.map((st) => ({
                  order: st.order,
                  title: st.title,
                  description: st.description,
                  estimatedHours: st.estimatedDuration ? st.estimatedDuration / 60 : 0,
                  priority: st.priority,
                  dependencies: st.dependencies,
                })) || [],
              reasoning: '',
              tips: task.analysis.tips || [],
            }
          : undefined,
      };

      // Execute task
      const legacyResult = await this._legacyAgent.execute(legacyTask);

      // Convert result
      const result = this.convertLegacyResult(legacyResult, startTime, context);

      // Save session ID for continuation
      if (legacyResult.claudeSessionId) {
        this._currentSessionId = legacyResult.claudeSessionId;
      }

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

      // Update metadata
      this._metadata.lastUsedAt = new Date();

      return result;
    } catch (error) {
      const agentError = this.wrapError(error);

      // onError hook
      if (this._lifecycleHooks.onError) {
        await this._lifecycleHooks.onError(context, agentError, 0);
      }

      await this.transitionState('failed');
      await this._events.emitError(agentError, agentError.recoverable);

      return this.createErrorResult(context, agentError, startTime);
    }
  }

  /**
   * Continues execution after user response.
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

      // Create new ClaudeCodeAgent with --continue flag
      const legacyConfig: ClaudeCodeAgentConfig = {
        workingDirectory: context.workingDirectory,
        timeout: context.timeout || this._config.defaultTimeout || 900000,
        dangerouslySkipPermissions:
          context.dangerouslySkipPermissions || this._config.dangerouslySkipPermissions,
        continueConversation: true,
        resumeSessionId: continuation.sessionId || this._currentSessionId || undefined,
      };

      this._legacyAgent = new ClaudeCodeAgent(
        `legacy-${this._metadata.id}`,
        this._metadata.name,
        legacyConfig,
      );

      // Set up output handler
      this._legacyAgent.setOutputHandler((output: string, isError?: boolean) => {
        this._events.emitOutput(output, isError || false, true);
      });

      // Execute user response as a task
      // NOTE: Convert string previousExecutionId to number for legacy API
      const taskId =
        typeof continuation.previousExecutionId === 'string'
          ? parseInt(continuation.previousExecutionId, 10) || 0
          : 0;

      const legacyTask: AgentTask = {
        id: taskId,
        title: 'User Response',
        description: continuation.userResponse || '',
        workingDirectory: context.workingDirectory,
      };

      const legacyResult = await this._legacyAgent.execute(legacyTask);
      const result = this.convertLegacyResult(legacyResult, startTime, context);

      // Update session ID
      if (legacyResult.claudeSessionId) {
        this._currentSessionId = legacyResult.claudeSessionId;
      }

      // Transition state based on result
      if (result.pendingQuestion) {
        await this.transitionState('waiting_for_input');
      } else if (result.success) {
        await this.transitionState('completed');
      } else {
        await this.transitionState('failed');
      }

      return result;
    } catch (error) {
      const agentError = this.wrapError(error);
      await this.transitionState('failed');
      await this._events.emitError(agentError, agentError.recoverable);
      return this.createErrorResult(context, agentError, startTime);
    }
  }

  /**
   * Stops execution.
   */
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

    // Stop if currently running
    if (this._state === 'running' || this._state === 'waiting_for_input') {
      await this.stop();
    }

    // Remove event listeners
    this._events.removeAllListeners();

    // Clear legacy agent reference
    this._legacyAgent = null;

    // Reset state
    this._state = 'idle';
    this._currentSessionId = null;

    this._isDisposed = true;
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private ensureNotDisposed(): void {
    if (this._isDisposed) {
      throw new AgentError('Agent has been disposed', 'internal', false);
    }
  }

  private wrapError(error: unknown): AgentError {
    if (error instanceof AgentError) {
      return error;
    }

    if (error instanceof Error) {
      return new AgentError(error.message, 'execution', false, undefined, error);
    }

    return new AgentError(String(error), 'internal', false);
  }

  private mapQuestionType(
    legacyType: string,
  ): 'clarification' | 'confirmation' | 'selection' | 'input' {
    switch (legacyType) {
      case 'clarification':
        return 'clarification';
      case 'confirmation':
        return 'confirmation';
      case 'selection':
        return 'selection';
      default:
        return 'input';
    }
  }

  private convertLegacyResult(
    legacyResult: LegacyExecutionResult,
    startTime: Date,
    context: AgentExecutionContext,
  ): AgentExecutionResult {
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    const metrics: ExecutionMetrics = {
      startTime,
      endTime,
      durationMs,
    };

    // Determine state
    let state: AgentState;
    if (legacyResult.waitingForInput) {
      state = 'waiting_for_input';
    } else if (legacyResult.success) {
      state = 'completed';
    } else {
      state = 'failed';
    }

    // Convert pending question
    let pendingQuestion: PendingQuestion | undefined;
    if (legacyResult.waitingForInput && legacyResult.question) {
      pendingQuestion = {
        questionId: legacyResult.questionKey?.question_id || `q-${Date.now()}`,
        text: legacyResult.question,
        category: this.mapQuestionType(legacyResult.questionType || 'input'),
        options: legacyResult.questionDetails?.options?.map((opt) => ({
          label: opt.label,
          value: opt.label,
          description: opt.description,
        })),
        multiSelect: legacyResult.questionDetails?.multiSelect,
      };
    }

    return {
      success: legacyResult.success,
      state,
      output: legacyResult.output,
      errorMessage: legacyResult.errorMessage,
      artifacts: legacyResult.artifacts?.map((a) => ({
        type: a.type as 'file' | 'code' | 'diff' | 'log' | 'image' | 'data',
        name: a.name,
        content: a.content,
        path: a.path,
      })),
      commits: legacyResult.commits?.map((c) => ({
        hash: c.hash,
        message: c.message,
        branch: c.branch,
        filesChanged: c.filesChanged,
        additions: c.additions,
        deletions: c.deletions,
      })),
      metrics,
      pendingQuestion,
      sessionId: legacyResult.claudeSessionId,
      debugInfo: {
        logs: [],
      },
    };
  }

  private createCancelledResult(
    context: AgentExecutionContext,
    reason: string,
  ): AgentExecutionResult {
    return {
      success: false,
      state: 'cancelled',
      output: '',
      errorMessage: reason,
      debugInfo: {
        logs: [],
      },
    };
  }

  private createErrorResult(
    context: AgentExecutionContext,
    error: AgentError,
    startTime: Date,
  ): AgentExecutionResult {
    const endTime = new Date();

    return {
      success: false,
      state: 'failed',
      output: '',
      errorMessage: error.message,
      metrics: {
        startTime,
        endTime,
        durationMs: endTime.getTime() - startTime.getTime(),
      },
      debugInfo: {
        logs: [],
      },
    };
  }
}
