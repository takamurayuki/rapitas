/**
 * AI Agent Module - Main Entry Point
 *
 * Comprehensive agent abstraction layer for managing multiple AI providers
 * (Claude Code, Anthropic API, OpenAI, Gemini, etc.) through a unified interface.
 *
 * @example
 * ```typescript
 * import {
 *   agentService,
 *   executeWithAgent,
 * } from './services/agents';
 *
 * // Initialize the service
 * await agentService.initialize();
 *
 * // Execute a task
 * const result = await executeWithAgent(
 *   {
 *     id: 1,
 *     title: 'Code review',
 *     description: 'Please review src/app.ts',
 *   },
 *   {
 *     workingDirectory: '/path/to/project',
 *   },
 * );
 *
 * console.log(result.output);
 * ```
 */

// ============================================================================
// Legacy exports (maintained for backward compatibility)
// ============================================================================

export * from './base-agent';
export * from './question-detection';
export * from './claude-code-agent';
export * from './gemini-cli-agent';
export * from './codex-cli-agent';
export * from './agent-factory';
export * from './agent-orchestrator';

// ============================================================================
// Abstraction layer (core types & interfaces)
// Explicitly renamed exports to avoid name collisions
// ============================================================================

export type {
  AgentProviderId,
  AgentState,
  AgentCapabilities,
  AgentMetadata,
  AgentExecutionContext,
  AgentTaskDefinition,
  TaskAnalysisResult,
  SubtaskDefinition,
  TaskConstraints,
  AgentProviderConfigBase,
  ClaudeCodeProviderConfig,
  OpenAIProviderConfig,
  GeminiProviderConfig,
  AnthropicAPIProviderConfig,
  AgentProviderConfig,
  AgentLifecycleHooks,
  ContinuationContext,
  BatchExecutionOptions,
  AgentHealthStatus,
  AgentEventType,
  AgentEventBase,
  StateChangeEvent,
  OutputEvent,
  ErrorEvent as AbstractionErrorEvent,
  ToolStartEvent,
  ToolEndEvent,
  QuestionEvent,
  ProgressEvent,
  ArtifactEvent,
  CommitEvent,
  MetricsUpdateEvent,
  AgentEvent,
  AgentEventHandler,
  PendingQuestion,
  QuestionOption,
  ExecutionDebugInfo,
  DebugLogEntry,
  ToolCallInfo,
  ExecutionMetrics as AbstractionExecutionMetrics,
} from './abstraction/types';

// Abstraction layer execution result types (renamed to avoid collisions)
export type {
  AgentExecutionResult as UnifiedAgentExecutionResult,
  AgentArtifact as UnifiedAgentArtifact,
  GitCommitInfo as UnifiedGitCommitInfo,
} from './abstraction/types';

// Interfaces
export type {
  IAgentProvider,
  IAgent,
  IAgentExecutionManager,
  IAgentRegistry,
  ProviderInfo,
  IOutputStreamHandler,
  IEventStreamHandler,
  IMetricsCollector,
  IAgentLogger,
  LogLevel,
  IErrorHandler,
  AgentErrorType,
} from './abstraction/interfaces';

// Classes and utilities
export {
  AgentError as AbstractionAgentError,
  AbstractAgent,
  AgentEventEmitter,
  createAgentEventEmitter,
  AgentRegistry,
  agentRegistry,
  createDefaultCapabilities,
  isTerminalState,
  isActiveState,
  isWaitingState,
  getCapabilityDisplayName,
  getStateDisplayName,
  generateExecutionId,
  generateAgentId,
  // Execution manager
  AgentExecutionManager,
  getDefaultExecutionManager,
  setDefaultExecutionManager,
  // Metrics collector
  DefaultMetricsCollector,
  getDefaultMetricsCollector,
  setDefaultMetricsCollector,
  // Error handler
  DefaultErrorHandler,
  getDefaultErrorHandler,
  setDefaultErrorHandler,
  wrapError,
  isAgentError,
  isRecoverableError,
  // Logger
  ConsoleLogger,
  SilentLogger,
  BufferingLogger,
  getDefaultLogger,
  setDefaultLogger,
  createAgentLogger,
  createExecutionLogger,
} from './abstraction';

// Adapter exports from abstraction/providers
export { ClaudeCodeAgentAdapter } from './abstraction/providers';

// ============================================================================
// Provider implementations
// ============================================================================

export {
  // Claude Code
  ClaudeCodeProvider,
  ClaudeCodeAgentV2,
  claudeCodeProvider,

  // Anthropic API
  AnthropicApiProvider,
  AnthropicApiAgent,
  anthropicApiProvider,
  CLAUDE_MODELS,

  // OpenAI (stub)
  OpenAIProvider,
  OpenAIAgent,
  openaiProvider,
  OPENAI_MODELS,

  // Gemini (stub)
  GeminiProvider,
  GeminiAgent,
  geminiProvider,
  GEMINI_MODELS,

  // Registration functions
  registerDefaultProviders,
  registerAllProviders,
  AVAILABLE_PROVIDERS,
  PROVIDER_INFO,
} from './providers';

export type {
  ClaudeCodeConfig,
  AnthropicApiConfig,
  OpenAIConfig,
  GeminiConfig,
  RegisterProvidersOptions,
} from './providers';

// ============================================================================
// Unified service
// ============================================================================

export { AgentService, agentService, executeWithAgent, continueWithAgent } from './agent-service';

export type {
  ExecuteOptions,
  ProviderSelectionCriteria,
  AgentServiceConfig,
  ActiveExecution,
} from './agent-service';

// ============================================================================
// Convenience factory functions
// ============================================================================

import { agentService, type ExecuteOptions } from './agent-service';
import type {
  AgentTaskDefinition,
  AgentExecutionResult,
  AgentProviderId,
} from './abstraction/types';

/**
 * Initialize the agent service.
 */
export async function initializeAgents(): Promise<void> {
  await agentService.initialize();
}

/**
 * Execute a task using Claude Code agent.
 */
export async function executeWithClaudeCode(
  task: AgentTaskDefinition,
  options: ExecuteOptions,
): Promise<AgentExecutionResult> {
  return agentService.executeTask(task, options, { providerId: 'claude-code' });
}

/**
 * Execute a task using Anthropic API agent.
 */
export async function executeWithAnthropicApi(
  task: AgentTaskDefinition,
  options: ExecuteOptions,
): Promise<AgentExecutionResult> {
  return agentService.executeTask(task, options, { providerId: 'anthropic-api' });
}

/**
 * Helper to create a task definition.
 */
export function createTask(
  title: string,
  options?: {
    id?: string | number;
    description?: string;
    prompt?: string;
  },
): AgentTaskDefinition {
  return {
    id: options?.id ?? Date.now(),
    title,
    description: options?.description,
    prompt: options?.prompt,
  };
}

/**
 * Get a simple list of available providers.
 */
export async function listProviders(): Promise<
  Array<{
    id: AgentProviderId;
    name: string;
    available: boolean;
  }>
> {
  const providers = await agentService.getAvailableProviders();
  return providers.map((p) => ({
    id: p.providerId,
    name: p.providerName,
    available: p.isAvailable,
  }));
}
