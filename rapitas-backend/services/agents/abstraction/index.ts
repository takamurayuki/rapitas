/**
 * Agent Abstraction Layer - Entry Point
 *
 * Unified abstraction for different AI agents (Claude Code, OpenAI Codex, Gemini, etc.).
 *
 * Key components:
 * - types: Type definitions (AgentCapabilities, AgentExecutionContext, AgentExecutionResult, etc.)
 * - interfaces: Interface definitions (IAgentProvider, IAgent, IAgentRegistry, etc.)
 * - AbstractAgent: Abstract base class for agents
 * - AgentEventEmitter: Event emission and subscription
 * - AgentRegistry: Provider and agent management
 *
 * Usage:
 * ```typescript
 * import {
 *   AgentRegistry,
 *   AbstractAgent,
 *   AgentCapabilities,
 *   AgentExecutionContext,
 * } from './abstraction';
 *
 * // Register a provider
 * const registry = AgentRegistry.getInstance();
 * registry.registerProvider(myProvider);
 *
 * // Create an agent
 * const agent = registry.createAgent({
 *   providerId: 'claude-code',
 *   enabled: true,
 * });
 *
 * // Execute a task
 * const result = await agent.execute(task, context);
 * ```
 */

// Type definitions
export type {
  // Base types
  AgentProviderId,
  AgentState,
  AgentCapabilities,
  AgentMetadata,

  // Execution context
  AgentExecutionContext,
  AgentTaskDefinition,
  TaskAnalysisResult,
  SubtaskDefinition,
  TaskConstraints,

  // Execution results
  AgentExecutionResult,
  AgentArtifact,
  GitCommitInfo,
  ExecutionMetrics,
  PendingQuestion,
  QuestionOption,
  ExecutionDebugInfo,
  DebugLogEntry,
  ToolCallInfo,

  // Events
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

  // Provider config
  AgentProviderConfigBase,
  ClaudeCodeProviderConfig,
  OpenAIProviderConfig,
  GeminiProviderConfig,
  GeminiCliProviderConfig,
  AnthropicAPIProviderConfig,
  AgentProviderConfig,

  // Lifecycle
  AgentLifecycleHooks,

  // Utilities
  ContinuationContext,
  BatchExecutionOptions,
  AgentHealthStatus,
} from './types';

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
} from './interfaces';

// Classes
export { AgentError } from './interfaces';
export { AbstractAgent } from './abstract-agent';
export { AgentEventEmitter, createAgentEventEmitter } from './event-emitter';
export { AgentRegistry, agentRegistry } from './registry';

// Execution manager
export {
  AgentExecutionManager,
  getDefaultExecutionManager,
  setDefaultExecutionManager,
} from './execution-manager';

// Metrics collector
export {
  DefaultMetricsCollector,
  getDefaultMetricsCollector,
  setDefaultMetricsCollector,
} from './metrics-collector';

// Error handler
export {
  DefaultErrorHandler,
  getDefaultErrorHandler,
  setDefaultErrorHandler,
  wrapError,
  isAgentError,
  isRecoverableError,
} from './error-handler';

// Logger
export {
  ConsoleLogger,
  SilentLogger,
  BufferingLogger,
  getDefaultLogger,
  setDefaultLogger,
  createAgentLogger,
  createExecutionLogger,
} from './logger';

// Providers
export {
  ClaudeCodeProvider,
  claudeCodeProvider,
  ClaudeCodeAgentAdapter,
  registerBuiltinProviders,
  registerProvider,
  initializeProviders,
} from './providers';

// ============================================================================
// Utility functions
// ============================================================================

import type { AgentCapabilities, AgentState } from './types';

/**
 * Creates a default capabilities object with all flags set to false.
 */
export function createDefaultCapabilities(
  overrides?: Partial<AgentCapabilities>,
): AgentCapabilities {
  return {
    codeGeneration: false,
    codeReview: false,
    codeExecution: false,
    fileRead: false,
    fileWrite: false,
    fileEdit: false,
    terminalAccess: false,
    gitOperations: false,
    webSearch: false,
    webFetch: false,
    taskAnalysis: false,
    taskPlanning: false,
    parallelExecution: false,
    questionAsking: false,
    conversationMemory: false,
    sessionContinuation: false,
    ...overrides,
  };
}

/**
 * Checks whether the state is a terminal state.
 */
export function isTerminalState(state: AgentState): boolean {
  return (
    state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'timeout'
  );
}

/**
 * Checks whether the state is an active state.
 */
export function isActiveState(state: AgentState): boolean {
  return state === 'initializing' || state === 'running' || state === 'completing';
}

/**
 * Checks whether the state is a waiting state.
 */
export function isWaitingState(state: AgentState): boolean {
  return state === 'idle' || state === 'paused' || state === 'waiting_for_input';
}

/**
 * Standard capability keys.
 */
export type StandardCapabilityKey =
  | 'codeGeneration'
  | 'codeReview'
  | 'codeExecution'
  | 'fileRead'
  | 'fileWrite'
  | 'fileEdit'
  | 'terminalAccess'
  | 'gitOperations'
  | 'webSearch'
  | 'webFetch'
  | 'taskAnalysis'
  | 'taskPlanning'
  | 'parallelExecution'
  | 'questionAsking'
  | 'conversationMemory'
  | 'sessionContinuation';

/**
 * Returns the display name for a capability key.
 */
export function getCapabilityDisplayName(capability: StandardCapabilityKey | string): string {
  const displayNames: Record<StandardCapabilityKey, string> = {
    codeGeneration: 'コード生成',
    codeReview: 'コードレビュー',
    codeExecution: 'コード実行',
    fileRead: 'ファイル読み取り',
    fileWrite: 'ファイル書き込み',
    fileEdit: 'ファイル編集',
    terminalAccess: 'ターミナルアクセス',
    gitOperations: 'Git操作',
    webSearch: 'Web検索',
    webFetch: 'Webページ取得',
    taskAnalysis: 'タスク分析',
    taskPlanning: '実行計画作成',
    parallelExecution: '並列実行',
    questionAsking: 'ユーザー質問',
    conversationMemory: '会話履歴保持',
    sessionContinuation: 'セッション継続',
  };

  return displayNames[capability as StandardCapabilityKey] || capability;
}

/**
 * Returns the display name for an agent state.
 */
export function getStateDisplayName(state: AgentState): string {
  const displayNames: Record<AgentState, string> = {
    idle: '待機中',
    initializing: '初期化中',
    running: '実行中',
    waiting_for_input: '入力待ち',
    paused: '一時停止中',
    completing: '完了処理中',
    completed: '完了',
    failed: '失敗',
    cancelled: 'キャンセル',
    timeout: 'タイムアウト',
  };

  return displayNames[state] || state;
}

/**
 * Generates a unique execution ID.
 */
export function generateExecutionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `exec-${timestamp}-${random}`;
}

/**
 * Generates a unique agent ID.
 */
export function generateAgentId(providerId: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${providerId}-${timestamp}-${random}`;
}
