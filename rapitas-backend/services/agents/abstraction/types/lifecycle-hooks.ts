/**
 * Lifecycle hook definitions.
 */

import type { AgentState } from './agent-identification';
import type { AgentExecutionContext, AgentTaskDefinition } from './execution-context';
import type { AgentExecutionResult, AgentArtifact, PendingQuestion } from './execution-result';

/**
 * Lifecycle hooks.
 */
export interface AgentLifecycleHooks {
  /**
   * Called before execution starts.
   * Return false to cancel execution.
   */
  beforeExecute?: (
    context: AgentExecutionContext,
    task: AgentTaskDefinition,
  ) => Promise<boolean | void>;

  /**
   * Called after execution completes.
   */
  afterExecute?: (context: AgentExecutionContext, result: AgentExecutionResult) => Promise<void>;

  /**
   * Called on error.
   * Return value controls retry behavior.
   */
  onError?: (
    context: AgentExecutionContext,
    error: Error,
    retryCount: number,
  ) => Promise<{ retry: boolean; delay?: number }>;

  /**
   * Called when a question is generated.
   * Return a string for auto-response, or null to wait for user input.
   */
  onQuestion?: (
    context: AgentExecutionContext,
    question: PendingQuestion,
  ) => Promise<string | null>;

  /**
   * Called on state change.
   */
  onStateChange?: (
    context: AgentExecutionContext,
    previousState: AgentState,
    newState: AgentState,
  ) => Promise<void>;

  /**
   * Called before tool execution.
   * Return false to skip the tool call.
   */
  beforeToolCall?: (
    context: AgentExecutionContext,
    toolName: string,
    input: unknown,
  ) => Promise<boolean | void>;

  /**
   * Called after tool execution.
   */
  afterToolCall?: (
    context: AgentExecutionContext,
    toolName: string,
    input: unknown,
    output: unknown,
    success: boolean,
  ) => Promise<void>;

  /**
   * Called when an artifact is generated.
   */
  onArtifact?: (context: AgentExecutionContext, artifact: AgentArtifact) => Promise<void>;

  /**
   * Called on shutdown.
   */
  onShutdown?: (
    context: AgentExecutionContext,
    reason: 'completed' | 'cancelled' | 'error' | 'timeout',
  ) => Promise<void>;
}
