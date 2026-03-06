/**
 * タスク分析・サブタスク・制約の型定義
 */

/**
 * タスク分析結果
 */
export interface TaskAnalysisResult {
  summary: string;
  complexity: 'simple' | 'medium' | 'complex';
  estimatedDuration?: number;   // 推定時間（分）
  subtasks?: SubtaskDefinition[];
  tips?: string[];
  risks?: string[];
}

/**
 * サブタスク定義
 */
export interface SubtaskDefinition {
  order: number;
  title: string;
  description: string;
  estimatedDuration?: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dependencies?: number[];
  parallelizable?: boolean;
}

/**
 * タスク制約
 */
export interface TaskConstraints {
  maxFiles?: number;            // 変更可能なファイル数上限
  allowedPaths?: string[];      // 変更可能なパス（glob）
  forbiddenPaths?: string[];    // 変更禁止パス（glob）
  allowedCommands?: string[];   // 実行可能なコマンド
  forbiddenCommands?: string[]; // 実行禁止コマンド
}
