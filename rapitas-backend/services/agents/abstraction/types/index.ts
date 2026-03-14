/**
 * Agent Abstraction Layer - Type Definitions Entry Point
 */

// Agent base types
export type {
  AgentProviderId,
  AgentState,
  AgentCapabilities,
  AgentMetadata,
} from './agent-identification';

// Task definitions
export type { TaskAnalysisResult, SubtaskDefinition, TaskConstraints } from './task-definition';

// Execution context
export type { AgentExecutionContext, AgentTaskDefinition } from './execution-context';

// Execution results
export type {
  AgentExecutionResult,
  AgentArtifact,
  GitCommitInfo,
  ExecutionMetrics,
  PendingQuestion,
  QuestionOption,
  ExecutionDebugInfo,
  DebugLogEntry,
  ToolCallInfo,
} from './execution-result';

// Events
export type {
  AgentEventType,
  AgentEventBase,
  StateChangeEvent,
  OutputEvent,
  ErrorEvent,
  ToolStartEvent,
  ToolEndEvent,
  QuestionEvent,
  ProgressEvent,
  ArtifactEvent,
  CommitEvent,
  MetricsUpdateEvent,
  AgentEvent,
  AgentEventHandler,
} from './events';

// Provider config
export type {
  AgentProviderConfigBase,
  ClaudeCodeProviderConfig,
  OpenAIProviderConfig,
  GeminiProviderConfig,
  GeminiCliProviderConfig,
  AnthropicAPIProviderConfig,
  AgentProviderConfig,
} from './provider-config';

// Lifecycle
export type { AgentLifecycleHooks } from './lifecycle-hooks';

// Utilities
export type {
  ContinuationContext,
  BatchExecutionOptions,
  AgentHealthStatus,
} from './utility-types';
