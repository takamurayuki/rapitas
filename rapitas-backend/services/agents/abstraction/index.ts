/**
 * AIエージェント抽象化レイヤー - エントリーポイント
 *
 * 各AIエージェント（Claude Code, OpenAI Codex, Gemini等）を統一的に扱うための抽象化レイヤー
 *
 * 主要コンポーネント:
 * - types: 型定義（AgentCapabilities, AgentExecutionContext, AgentExecutionResult等）
 * - interfaces: インターフェース定義（IAgentProvider, IAgent, IAgentRegistry等）
 * - AbstractAgent: 抽象エージェント基底クラス
 * - AgentEventEmitter: イベント発行・購読
 * - AgentRegistry: プロバイダー・エージェント管理
 *
 * 使用例:
 * ```typescript
 * import {
 *   AgentRegistry,
 *   AbstractAgent,
 *   AgentCapabilities,
 *   AgentExecutionContext,
 * } from './abstraction';
 *
 * // プロバイダーを登録
 * const registry = AgentRegistry.getInstance();
 * registry.registerProvider(myProvider);
 *
 * // エージェントを作成
 * const agent = registry.createAgent({
 *   providerId: 'claude-code',
 *   enabled: true,
 * });
 *
 * // タスクを実行
 * const result = await agent.execute(task, context);
 * ```
 */

// 型定義
export type {
  // 基本型
  AgentProviderId,
  AgentState,
  AgentCapabilities,
  AgentMetadata,

  // 実行コンテキスト
  AgentExecutionContext,
  AgentTaskDefinition,
  TaskAnalysisResult,
  SubtaskDefinition,
  TaskConstraints,

  // 実行結果
  AgentExecutionResult,
  AgentArtifact,
  GitCommitInfo,
  ExecutionMetrics,
  PendingQuestion,
  QuestionOption,
  ExecutionDebugInfo,
  DebugLogEntry,
  ToolCallInfo,

  // イベント
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

  // プロバイダー設定
  AgentProviderConfigBase,
  ClaudeCodeProviderConfig,
  OpenAIProviderConfig,
  GeminiProviderConfig,
  GeminiCliProviderConfig,
  AnthropicAPIProviderConfig,
  AgentProviderConfig,

  // ライフサイクル
  AgentLifecycleHooks,

  // ユーティリティ
  ContinuationContext,
  BatchExecutionOptions,
  AgentHealthStatus,
} from './types';

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
} from './interfaces';

// クラス
export { AgentError } from './interfaces';
export { AbstractAgent } from './abstract-agent';
export { AgentEventEmitter, createAgentEventEmitter } from './event-emitter';
export { AgentRegistry, agentRegistry } from './registry';

// 実行マネージャー
export {
  AgentExecutionManager,
  getDefaultExecutionManager,
  setDefaultExecutionManager,
} from './execution-manager';

// メトリクスコレクター
export {
  DefaultMetricsCollector,
  getDefaultMetricsCollector,
  setDefaultMetricsCollector,
} from './metrics-collector';

// エラーハンドラー
export {
  DefaultErrorHandler,
  getDefaultErrorHandler,
  setDefaultErrorHandler,
  wrapError,
  isAgentError,
  isRecoverableError,
} from './error-handler';

// ロガー
export {
  ConsoleLogger,
  SilentLogger,
  BufferingLogger,
  getDefaultLogger,
  setDefaultLogger,
  createAgentLogger,
  createExecutionLogger,
} from './logger';

// プロバイダー
export {
  ClaudeCodeProvider,
  claudeCodeProvider,
  ClaudeCodeAgentAdapter,
  registerBuiltinProviders,
  registerProvider,
  initializeProviders,
} from './providers';

// ============================================================================
// ユーティリティ関数
// ============================================================================

import type { AgentCapabilities, AgentState } from './types';

/**
 * デフォルトの能力設定を作成
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
 * 状態が終了状態かどうか判定
 */
export function isTerminalState(state: AgentState): boolean {
  return (
    state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'timeout'
  );
}

/**
 * 状態が実行中かどうか判定
 */
export function isActiveState(state: AgentState): boolean {
  return state === 'initializing' || state === 'running' || state === 'completing';
}

/**
 * 状態が待機状態かどうか判定
 */
export function isWaitingState(state: AgentState): boolean {
  return state === 'idle' || state === 'paused' || state === 'waiting_for_input';
}

/**
 * 標準の能力キー
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
 * 能力の表示名を取得
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
 * 状態の表示名を取得
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
 * ユニークな実行IDを生成
 */
export function generateExecutionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `exec-${timestamp}-${random}`;
}

/**
 * ユニークなエージェントIDを生成
 */
export function generateAgentId(providerId: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${providerId}-${timestamp}-${random}`;
}
