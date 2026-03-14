/**
 * AI Agent Unified Interface Type Definitions
 *
 * Provides a common interface for operating multiple AI providers
 * (Claude, OpenAI, Gemini, etc.) through a single API.
 *
 * This module is split into the following concerns:
 * - provider-config: Provider configuration types
 * - agent-config: Agent configuration & execution options
 * - handlers: Event handlers & callbacks
 * - results: Execution results & metrics
 * - errors: Error handling
 * - interfaces: Provider & agent interfaces
 */

// Provider configuration
export type {
  ProviderId,
  ModelInfo,
  ProxyConfig,
  RateLimitConfig,
  ProviderConfig,
  ValidationError,
  ValidationWarning,
  ValidationResult,
} from './provider-config';

// Agent configuration & execution options
export type { AgentInstanceConfig, ExecutionOptions } from './agent-config';

// Handlers
export type {
  OutputHandler,
  QuestionInfo,
  QuestionHandler,
  ProgressStage,
  ProgressInfo,
  ProgressHandler,
} from './handlers';

// Execution results & metrics
export type { ExecutionMetrics, ExtendedExecutionResult } from './results';

// Errors
export { AgentErrorCode, AgentError, isAgentError, isRecoverableError } from './errors';

// Interfaces
export type {
  IAgentProvider,
  IAgent,
  IAgentSession,
  SubAgentHandle,
  ParallelExecutionOptions,
  ISubAgentController,
  ProviderRegistration,
} from './interfaces';

// Utility functions
export { getDefaultExecutionOptions, mergeExecutionOptions } from './utilities';

// Re-export existing types for convenience
export type {
  AgentCapability,
  AgentStatus,
  AgentTask,
  AgentExecutionResult,
  AgentArtifact,
  GitCommitInfo,
  QuestionType,
} from '../base-agent';

export type { QuestionDetails, QuestionKey } from '../question-detection';
