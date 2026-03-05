/**
 * ユーティリティ型定義
 */

/**
 * 継続実行用のコンテキスト
 */
export interface ContinuationContext {
  sessionId: string;
  previousExecutionId: string;
  userResponse?: string;
  additionalContext?: string;
}

/**
 * バッチ実行用の設定
 */
export interface BatchExecutionOptions {
  maxConcurrency: number;       // 最大同時実行数
  continueOnError: boolean;     // エラー時も続行
  timeout?: number;             // 全体タイムアウト
  ordering?: 'sequential' | 'parallel' | 'dependency-based';
}

/**
 * エージェントヘルスチェック結果
 */
export interface AgentHealthStatus {
  healthy: boolean;
  available: boolean;
  latency?: number;             // レスポンス時間（ms）
  errors?: string[];
  lastCheck: Date;
  details?: Record<string, unknown>;
}
