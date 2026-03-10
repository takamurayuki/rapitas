/**
 * 実行結果・メトリクスの型定義
 *
 * エージェント実行の結果とパフォーマンスメトリクスを定義
 */

import type { AgentExecutionResult } from '../base-agent';

// ==================== 実行結果（拡張） ====================

/**
 * 実行メトリクス
 */
export type ExecutionMetrics = {
  /** APIコール回数 */
  apiCalls: number;

  /** ファイル読み取り数 */
  filesRead: number;

  /** ファイル書き込み数 */
  filesWritten: number;

  /** コマンド実行数 */
  commandsExecuted: number;

  /** 推定コスト（USD） */
  estimatedCost?: number;
};

/**
 * 拡張実行結果
 */
export type ExtendedExecutionResult = AgentExecutionResult & {
  /** 入力トークン数 */
  inputTokens?: number;

  /** 出力トークン数 */
  outputTokens?: number;

  /** エラーコード */
  errorCode?: string;

  /** セッションID（プロバイダー共通形式） */
  sessionId?: string;

  /** モデルID（使用されたモデル） */
  modelId?: string;

  /** 警告メッセージ */
  warnings?: string[];

  /** 実行メトリクス */
  metrics?: ExecutionMetrics;
};
