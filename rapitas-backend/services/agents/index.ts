/**
 * AIエージェント モジュール - メインエントリーポイント
 *
 * 複数のAIプロバイダー（Claude Code, Anthropic API, OpenAI, Gemini等）を
 * 統一的なインターフェースで扱うための包括的なエージェント抽象化レイヤー
 *
 * @example
 * ```typescript
 * import {
 *   agentService,
 *   executeWithAgent,
 * } from './services/agents';
 *
 * // サービスを初期化
 * await agentService.initialize();
 *
 * // タスクを実行
 * const result = await executeWithAgent(
 *   {
 *     id: 1,
 *     title: 'コードレビュー',
 *     description: 'src/app.ts をレビューしてください',
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
// 既存のレガシーエクスポート（後方互換性のため維持）
// ============================================================================

export * from './base-agent';
export * from './question-detection';
export * from './claude-code-agent';
export * from './gemini-cli-agent';
export * from './codex-cli-agent';
export * from './agent-factory';
export * from './agent-orchestrator';

// ============================================================================
// 抽象化レイヤー（コアタイプ・インターフェース）
// 名前の衝突を避けるため、明示的にリネームしてエクスポート
// ============================================================================

// 型定義（名前空間として使用）
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

// 新しい抽象化レイヤーの実行結果型（既存との衝突を避ける）
export type {
  AgentExecutionResult as UnifiedAgentExecutionResult,
  AgentArtifact as UnifiedAgentArtifact,
  GitCommitInfo as UnifiedGitCommitInfo,
} from './abstraction/types';

// インターフェース
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

// クラスとユーティリティ
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
  // 実行マネージャー
  AgentExecutionManager,
  getDefaultExecutionManager,
  setDefaultExecutionManager,
  // メトリクスコレクター
  DefaultMetricsCollector,
  getDefaultMetricsCollector,
  setDefaultMetricsCollector,
  // エラーハンドラー
  DefaultErrorHandler,
  getDefaultErrorHandler,
  setDefaultErrorHandler,
  wrapError,
  isAgentError,
  isRecoverableError,
  // ロガー
  ConsoleLogger,
  SilentLogger,
  BufferingLogger,
  getDefaultLogger,
  setDefaultLogger,
  createAgentLogger,
  createExecutionLogger,
} from './abstraction';

// abstraction/providersからアダプターをエクスポート
export { ClaudeCodeAgentAdapter } from './abstraction/providers';

// ============================================================================
// プロバイダー実装
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

  // 登録関数
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
// 統一サービス
// ============================================================================

export {
  AgentService,
  agentService,
  executeWithAgent,
  continueWithAgent,
} from './agent-service';

export type {
  ExecuteOptions,
  ProviderSelectionCriteria,
  AgentServiceConfig,
  ActiveExecution,
} from './agent-service';

// ============================================================================
// 便利なファクトリー関数
// ============================================================================

import { agentService, type ExecuteOptions } from './agent-service';
import type { AgentTaskDefinition, AgentExecutionResult, AgentProviderId } from './abstraction/types';

/**
 * エージェントサービスを初期化して準備完了状態にする
 */
export async function initializeAgents(): Promise<void> {
  await agentService.initialize();
}

/**
 * Claude Code エージェントでタスクを実行
 */
export async function executeWithClaudeCode(
  task: AgentTaskDefinition,
  options: ExecuteOptions,
): Promise<AgentExecutionResult> {
  return agentService.executeTask(task, options, { providerId: 'claude-code' });
}

/**
 * Anthropic API エージェントでタスクを実行
 */
export async function executeWithAnthropicApi(
  task: AgentTaskDefinition,
  options: ExecuteOptions,
): Promise<AgentExecutionResult> {
  return agentService.executeTask(task, options, { providerId: 'anthropic-api' });
}

/**
 * タスクを簡単に作成するヘルパー
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
 * 利用可能なプロバイダーの簡易一覧を取得
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
