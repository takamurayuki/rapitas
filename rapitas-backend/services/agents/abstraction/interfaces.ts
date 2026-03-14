/**
 * Agent Abstraction Layer - Interface Definitions
 *
 * Defines the contracts that AI agent providers must implement.
 */

import type {
  AgentProviderId,
  AgentState,
  AgentCapabilities,
  AgentMetadata,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  AgentProviderConfig,
  AgentLifecycleHooks,
  AgentHealthStatus,
  ContinuationContext,
  AgentEvent,
  AgentEventHandler,
  AgentEventType,
} from './types';
import type { AgentEventEmitter } from './event-emitter';

// ============================================================================
// Provider interface
// ============================================================================

/**
 * Agent provider interface.
 * Contract that AI agent implementations (Claude, OpenAI, Gemini, etc.) must satisfy.
 */
export interface IAgentProvider {
  /**
   * Provider identifier.
   */
  readonly providerId: AgentProviderId;

  /**
   * Provider display name.
   */
  readonly providerName: string;

  /**
   * Version string.
   */
  readonly version: string;

  /**
   * Returns provider capabilities.
   */
  getCapabilities(): AgentCapabilities;

  /**
   * Checks if the provider is available.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Validates the configuration.
   */
  validateConfig(config: AgentProviderConfig): Promise<{ valid: boolean; errors: string[] }>;

  /**
   * Performs a health check.
   */
  healthCheck(): Promise<AgentHealthStatus>;

  /**
   * Creates an agent instance.
   */
  createAgent(config: AgentProviderConfig): IAgent;
}

// ============================================================================
// Agent interface
// ============================================================================

/**
 * Agent interface.
 * Contract for individual agent instances.
 */
export interface IAgent {
  /**
   * Returns agent metadata.
   */
  readonly metadata: AgentMetadata;

  /**
   * Returns the current state.
   */
  readonly state: AgentState;

  /**
   * Returns agent capabilities.
   */
  readonly capabilities: AgentCapabilities;

  /**
   * Event emitter.
   */
  readonly events: AgentEventEmitter;

  /**
   * Executes a task.
   */
  execute(task: AgentTaskDefinition, context: AgentExecutionContext): Promise<AgentExecutionResult>;

  /**
   * Continues execution (e.g., after answering a question).
   */
  continue(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult>;

  /**
   * Stops execution.
   */
  stop(): Promise<void>;

  /**
   * Pauses execution.
   */
  pause(): Promise<boolean>;

  /**
   * Resumes execution.
   */
  resume(): Promise<boolean>;

  /**
   * Sets lifecycle hooks.
   */
  setLifecycleHooks(hooks: AgentLifecycleHooks): void;

  /**
   * Releases resources.
   */
  dispose(): Promise<void>;
}

// ============================================================================
// Execution manager interface
// ============================================================================

/**
 * Execution manager interface.
 * Manages execution of multiple agents.
 */
export interface IAgentExecutionManager {
  /**
   * Executes a task.
   */
  executeTask(
    agentId: string,
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult>;

  /**
   * Continues execution.
   */
  continueExecution(executionId: string, userResponse: string): Promise<AgentExecutionResult>;

  /**
   * Stops execution.
   */
  stopExecution(executionId: string): Promise<void>;

  /**
   * Returns execution state.
   */
  getExecutionStatus(executionId: string): AgentState | null;

  /**
   * Returns active executions.
   */
  getActiveExecutions(): Array<{
    executionId: string;
    agentId: string;
    state: AgentState;
    startTime: Date;
  }>;
}

// ============================================================================
// Registry interface
// ============================================================================

/**
 * Provider information.
 */
export interface ProviderInfo {
  providerId: AgentProviderId;
  providerName: string;
  version: string;
  capabilities: AgentCapabilities;
  isAvailable: boolean;
  healthStatus?: AgentHealthStatus;
}

/**
 * Agent registry interface.
 * Manages providers and agents.
 */
export interface IAgentRegistry {
  /**
   * Registers a provider.
   */
  registerProvider(provider: IAgentProvider): void;

  /**
   * Returns a provider.
   */
  getProvider(providerId: AgentProviderId): IAgentProvider | undefined;

  /**
   * Returns all providers.
   */
  getAllProviders(): IAgentProvider[];

  /**
   * Returns available providers.
   */
  getAvailableProviders(): Promise<ProviderInfo[]>;

  /**
   * Returns providers with a specific capability.
   */
  getProvidersByCapability(capability: keyof AgentCapabilities): IAgentProvider[];

  /**
   * Creates an agent.
   */
  createAgent(config: AgentProviderConfig): IAgent;

  /**
   * Returns an active agent.
   */
  getAgent(agentId: string): IAgent | undefined;

  /**
   * Returns all active agents.
   */
  getAllAgents(): Map<string, IAgent>;

  /**
   * Disposes an agent.
   */
  disposeAgent(agentId: string): Promise<void>;

  /**
   * Disposes all agents.
   */
  disposeAllAgents(): Promise<void>;
}

// ============================================================================
// Streaming interface
// ============================================================================

/**
 * Output stream handler.
 */
export interface IOutputStreamHandler {
  /**
   * Receives output.
   */
  onOutput(content: string, isError: boolean): void;

  /**
   * Stream ended.
   */
  onEnd(): void;

  /**
   * Error occurred.
   */
  onError(error: Error): void;
}

/**
 * Event stream handler.
 */
export interface IEventStreamHandler {
  /**
   * Receives an event.
   */
  onEvent(event: AgentEvent): void;

  /**
   * Subscribes to specific event types.
   */
  subscribe(types: AgentEventType[]): void;

  /**
   * Unsubscribes.
   */
  unsubscribe(): void;
}

// ============================================================================
// Metrics interface
// ============================================================================

/**
 * Metrics collector interface.
 */
export interface IMetricsCollector {
  /**
   * Starts execution tracking.
   */
  startExecution(executionId: string, agentId: string): void;

  /**
   * Ends execution tracking.
   */
  endExecution(executionId: string, success: boolean): void;

  /**
   * Records token usage.
   */
  recordTokenUsage(executionId: string, input: number, output: number): void;

  /**
   * Records a tool call.
   */
  recordToolCall(executionId: string, toolName: string, durationMs: number, success: boolean): void;

  /**
   * Records file changes.
   */
  recordFileChange(executionId: string, added: number, deleted: number): void;

  /**
   * Records cost.
   */
  recordCost(executionId: string, costUsd: number): void;

  /**
   * Returns metrics.
   */
  getMetrics(executionId: string): {
    durationMs: number;
    tokensUsed: { input: number; output: number };
    toolCalls: number;
    fileChanges: { added: number; deleted: number };
    costUsd: number;
  } | null;

  /**
   * Returns aggregated metrics.
   */
  getAggregateMetrics(
    agentId: string,
    period: 'hour' | 'day' | 'week' | 'month',
  ): {
    totalExecutions: number;
    successRate: number;
    avgDurationMs: number;
    totalTokens: number;
    totalCostUsd: number;
  };
}

// ============================================================================
// Logging interface
// ============================================================================

/**
 * Log level.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface.
 */
export interface IAgentLogger {
  /**
   * Outputs a log entry.
   */
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void;

  /**
   * Debug log.
   */
  debug(message: string, context?: Record<string, unknown>): void;

  /**
   * Info log.
   */
  info(message: string, context?: Record<string, unknown>): void;

  /**
   * Warning log.
   */
  warn(message: string, context?: Record<string, unknown>): void;

  /**
   * Error log.
   */
  error(message: string, error?: Error, context?: Record<string, unknown>): void;

  /**
   * Creates a child logger with additional context.
   */
  child(context: Record<string, unknown>): IAgentLogger;
}

// ============================================================================
// Error handling interface
// ============================================================================

/**
 * Agent error type classification.
 */
export type AgentErrorType =
  | 'configuration' 
  | 'authentication' 
  | 'rate_limit' 
  | 'timeout' 
  | 'network' 
  | 'execution' 
  | 'validation' 
  | 'resource' 
  | 'permission' 
  | 'internal'; 

/**
 * Agent error class.
 */
export class AgentError extends Error {
  constructor(
    message: string,
    public readonly type: AgentErrorType,
    public readonly recoverable: boolean = false,
    public readonly retryAfter?: number,
    public readonly cause?: Error,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AgentError';
  }

  /**
   * Returns a JSON representation.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      type: this.type,
      recoverable: this.recoverable,
      retryAfter: this.retryAfter,
      context: this.context,
      stack: this.stack,
    };
  }
}

/**
 * Error handler interface.
 */
export interface IErrorHandler {
  /**
   * Handles an error.
   */
  handleError(
    error: Error | AgentError,
    context: AgentExecutionContext,
  ): Promise<{
    handled: boolean;
    retry: boolean;
    delay?: number;
    fallbackResult?: AgentExecutionResult;
  }>;

  /**
   * Returns the retry strategy.
   */
  getRetryStrategy(
    errorType: AgentErrorType,
    retryCount: number,
  ): {
    shouldRetry: boolean;
    delay: number;
    maxRetries: number;
  };
}
