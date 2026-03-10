/**
 * AIエージェント抽象化レイヤー - インターフェース定義
 * 各AIエージェントプロバイダーが実装すべきインターフェースを定義
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
// プロバイダーインターフェース
// ============================================================================

/**
 * エージェントプロバイダーインターフェース
 * 各AIエージェント（Claude, OpenAI, Gemini等）の実装が満たすべき契約
 */
export interface IAgentProvider {
  /**
   * プロバイダーID
   */
  readonly providerId: AgentProviderId;

  /**
   * プロバイダー名
   */
  readonly providerName: string;

  /**
   * バージョン情報
   */
  readonly version: string;

  /**
   * プロバイダーの能力を取得
   */
  getCapabilities(): AgentCapabilities;

  /**
   * プロバイダーが利用可能かチェック
   */
  isAvailable(): Promise<boolean>;

  /**
   * 設定を検証
   */
  validateConfig(config: AgentProviderConfig): Promise<{ valid: boolean; errors: string[] }>;

  /**
   * ヘルスチェック
   */
  healthCheck(): Promise<AgentHealthStatus>;

  /**
   * エージェントインスタンスを作成
   */
  createAgent(config: AgentProviderConfig): IAgent;
}

// ============================================================================
// エージェントインターフェース
// ============================================================================

/**
 * エージェントインターフェース
 * 個々のエージェントインスタンスが実装すべき契約
 */
export interface IAgent {
  /**
   * メタデータを取得
   */
  readonly metadata: AgentMetadata;

  /**
   * 現在の状態を取得
   */
  readonly state: AgentState;

  /**
   * 能力を取得
   */
  readonly capabilities: AgentCapabilities;

  /**
   * イベントエミッター
   */
  readonly events: AgentEventEmitter;

  /**
   * タスクを実行
   */
  execute(task: AgentTaskDefinition, context: AgentExecutionContext): Promise<AgentExecutionResult>;

  /**
   * 継続実行（質問への回答後など）
   */
  continue(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult>;

  /**
   * 実行を停止
   */
  stop(): Promise<void>;

  /**
   * 実行を一時停止
   */
  pause(): Promise<boolean>;

  /**
   * 実行を再開
   */
  resume(): Promise<boolean>;

  /**
   * ライフサイクルフックを設定
   */
  setLifecycleHooks(hooks: AgentLifecycleHooks): void;

  /**
   * リソースを解放
   */
  dispose(): Promise<void>;
}

// ============================================================================
// 実行マネージャーインターフェース
// ============================================================================

/**
 * 実行マネージャーインターフェース
 * 複数エージェントの実行を管理
 */
export interface IAgentExecutionManager {
  /**
   * タスクを実行
   */
  executeTask(
    agentId: string,
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult>;

  /**
   * 実行を継続
   */
  continueExecution(executionId: string, userResponse: string): Promise<AgentExecutionResult>;

  /**
   * 実行を停止
   */
  stopExecution(executionId: string): Promise<void>;

  /**
   * 実行状態を取得
   */
  getExecutionStatus(executionId: string): AgentState | null;

  /**
   * アクティブな実行一覧を取得
   */
  getActiveExecutions(): Array<{
    executionId: string;
    agentId: string;
    state: AgentState;
    startTime: Date;
  }>;
}

// ============================================================================
// レジストリインターフェース
// ============================================================================

/**
 * プロバイダー情報
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
 * エージェントレジストリインターフェース
 * プロバイダーとエージェントの管理
 */
export interface IAgentRegistry {
  /**
   * プロバイダーを登録
   */
  registerProvider(provider: IAgentProvider): void;

  /**
   * プロバイダーを取得
   */
  getProvider(providerId: AgentProviderId): IAgentProvider | undefined;

  /**
   * 全プロバイダーを取得
   */
  getAllProviders(): IAgentProvider[];

  /**
   * 利用可能なプロバイダーを取得
   */
  getAvailableProviders(): Promise<ProviderInfo[]>;

  /**
   * 特定の能力を持つプロバイダーを取得
   */
  getProvidersByCapability(capability: keyof AgentCapabilities): IAgentProvider[];

  /**
   * エージェントを作成
   */
  createAgent(config: AgentProviderConfig): IAgent;

  /**
   * アクティブなエージェントを取得
   */
  getAgent(agentId: string): IAgent | undefined;

  /**
   * 全アクティブエージェントを取得
   */
  getAllAgents(): Map<string, IAgent>;

  /**
   * エージェントを解放
   */
  disposeAgent(agentId: string): Promise<void>;

  /**
   * 全エージェントを解放
   */
  disposeAllAgents(): Promise<void>;
}

// ============================================================================
// ストリーミングインターフェース
// ============================================================================

/**
 * 出力ストリームハンドラ
 */
export interface IOutputStreamHandler {
  /**
   * 出力を受信
   */
  onOutput(content: string, isError: boolean): void;

  /**
   * ストリーム終了
   */
  onEnd(): void;

  /**
   * エラー発生
   */
  onError(error: Error): void;
}

/**
 * イベントストリームハンドラ
 */
export interface IEventStreamHandler {
  /**
   * イベントを受信
   */
  onEvent(event: AgentEvent): void;

  /**
   * 特定タイプのイベントのみ購読
   */
  subscribe(types: AgentEventType[]): void;

  /**
   * 購読解除
   */
  unsubscribe(): void;
}

// ============================================================================
// メトリクスインターフェース
// ============================================================================

/**
 * メトリクスコレクターインターフェース
 */
export interface IMetricsCollector {
  /**
   * 実行を開始
   */
  startExecution(executionId: string, agentId: string): void;

  /**
   * 実行を終了
   */
  endExecution(executionId: string, success: boolean): void;

  /**
   * トークン使用量を記録
   */
  recordTokenUsage(executionId: string, input: number, output: number): void;

  /**
   * ツール呼び出しを記録
   */
  recordToolCall(executionId: string, toolName: string, durationMs: number, success: boolean): void;

  /**
   * ファイル変更を記録
   */
  recordFileChange(executionId: string, added: number, deleted: number): void;

  /**
   * コストを記録
   */
  recordCost(executionId: string, costUsd: number): void;

  /**
   * メトリクスを取得
   */
  getMetrics(executionId: string): {
    durationMs: number;
    tokensUsed: { input: number; output: number };
    toolCalls: number;
    fileChanges: { added: number; deleted: number };
    costUsd: number;
  } | null;

  /**
   * 集計メトリクスを取得
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
// ロギングインターフェース
// ============================================================================

/**
 * ログレベル
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * ロガーインターフェース
 */
export interface IAgentLogger {
  /**
   * ログを出力
   */
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void;

  /**
   * デバッグログ
   */
  debug(message: string, context?: Record<string, unknown>): void;

  /**
   * 情報ログ
   */
  info(message: string, context?: Record<string, unknown>): void;

  /**
   * 警告ログ
   */
  warn(message: string, context?: Record<string, unknown>): void;

  /**
   * エラーログ
   */
  error(message: string, error?: Error, context?: Record<string, unknown>): void;

  /**
   * 子ロガーを作成（コンテキスト付き）
   */
  child(context: Record<string, unknown>): IAgentLogger;
}

// ============================================================================
// エラーハンドリングインターフェース
// ============================================================================

/**
 * エージェントエラーの種類
 */
export type AgentErrorType =
  | 'configuration' // 設定エラー
  | 'authentication' // 認証エラー
  | 'rate_limit' // レート制限
  | 'timeout' // タイムアウト
  | 'network' // ネットワークエラー
  | 'execution' // 実行エラー
  | 'validation' // バリデーションエラー
  | 'resource' // リソースエラー
  | 'permission' // パーミッションエラー
  | 'internal'; // 内部エラー

/**
 * エージェントエラー
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
   * JSON表現を取得
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
 * エラーハンドラインターフェース
 */
export interface IErrorHandler {
  /**
   * エラーを処理
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
   * リトライ戦略を取得
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
