/**
 * 実行コンテキスト・タスク定義
 */

import type { TaskAnalysisResult, TaskConstraints } from './task-definition';

/**
 * エージェント実行時のコンテキスト情報
 */
export interface AgentExecutionContext {
  // 実行識別
  executionId: string;          // 実行ID
  sessionId?: string;           // セッションID（継続実行用）
  parentExecutionId?: string;   // 親実行ID（サブタスク用）

  // 作業環境
  workingDirectory: string;     // 作業ディレクトリ
  repositoryUrl?: string;       // リポジトリURL
  branch?: string;              // ブランチ名

  // 実行オプション
  timeout?: number;             // タイムアウト（ミリ秒）
  maxRetries?: number;          // 最大リトライ回数
  priority?: 'low' | 'normal' | 'high' | 'urgent';

  // フラグ
  dryRun?: boolean;             // ドライラン（変更を実際には適用しない）
  verbose?: boolean;            // 詳細ログ出力
  autoApprove?: boolean;        // 自動承認
  dangerouslySkipPermissions?: boolean; // パーミッションチェックをスキップ

  // メタデータ
  metadata?: Record<string, unknown>;
}

/**
 * タスク定義
 */
export interface AgentTaskDefinition {
  // 基本情報
  id: string | number;
  title: string;
  description?: string;

  // プロンプト
  prompt?: string;              // 直接プロンプト
  optimizedPrompt?: string;     // 最適化されたプロンプト

  // タスク分析情報
  analysis?: TaskAnalysisResult;

  // 依存関係
  dependencies?: Array<string | number>;

  // 制約
  constraints?: TaskConstraints;
}
