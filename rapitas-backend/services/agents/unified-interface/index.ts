/**
 * AIエージェント統一インターフェース型定義
 *
 * 複数AIプロバイダー（Claude, OpenAI, Gemini等）を
 * 同一インターフェースで操作するための型定義
 *
 * このモジュールは以下の責務に分割されている:
 * - provider-config: プロバイダー設定関連の型
 * - agent-config: エージェント設定・実行オプション
 * - handlers: イベントハンドラー・コールバック
 * - results: 実行結果・メトリクス
 * - errors: エラーハンドリング
 * - interfaces: プロバイダー・エージェントインターフェース
 */

// プロバイダー設定
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

// エージェント設定・実行オプション
export type { AgentInstanceConfig, ExecutionOptions } from './agent-config';

// ハンドラー
export type {
  OutputHandler,
  QuestionInfo,
  QuestionHandler,
  ProgressStage,
  ProgressInfo,
  ProgressHandler,
} from './handlers';

// 実行結果・メトリクス
export type { ExecutionMetrics, ExtendedExecutionResult } from './results';

// エラー
export { AgentErrorCode, AgentError, isAgentError, isRecoverableError } from './errors';

// インターフェース
export type {
  IAgentProvider,
  IAgent,
  IAgentSession,
  SubAgentHandle,
  ParallelExecutionOptions,
  ISubAgentController,
  ProviderRegistration,
} from './interfaces';

// ユーティリティ関数
export { getDefaultExecutionOptions, mergeExecutionOptions } from './utilities';

// 既存の型を再エクスポート（利便性のため）
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
