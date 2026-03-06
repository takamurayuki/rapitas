/**
 * AIエージェント抽象化レイヤー - 型定義エントリーポイント
 */

// エージェント基本型
export type {
  AgentProviderId,
  AgentState,
  AgentCapabilities,
  AgentMetadata,
} from './agent-identification';

// タスク定義
export type {
  TaskAnalysisResult,
  SubtaskDefinition,
  TaskConstraints,
} from './task-definition';

// 実行コンテキスト
export type {
  AgentExecutionContext,
  AgentTaskDefinition,
} from './execution-context';

// 実行結果
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

// イベント
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

// プロバイダー設定
export type {
  AgentProviderConfigBase,
  ClaudeCodeProviderConfig,
  OpenAIProviderConfig,
  GeminiProviderConfig,
  GeminiCliProviderConfig,
  AnthropicAPIProviderConfig,
  AgentProviderConfig,
} from './provider-config';

// ライフサイクル
export type { AgentLifecycleHooks } from './lifecycle-hooks';

// ユーティリティ
export type {
  ContinuationContext,
  BatchExecutionOptions,
  AgentHealthStatus,
} from './utility-types';
