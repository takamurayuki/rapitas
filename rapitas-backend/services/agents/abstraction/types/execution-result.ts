/**
 * 実行結果・成果物・メトリクス・デバッグ情報
 */

import type { AgentState } from './agent-identification';

/**
 * エージェント実行結果
 */
export interface AgentExecutionResult {
  // 基本結果
  success: boolean;
  state: AgentState;

  // 出力
  output: string;               // 主要出力
  structuredOutput?: unknown;   // 構造化出力（JSON等）
  errorMessage?: string;        // エラーメッセージ

  // 成果物
  artifacts?: AgentArtifact[];
  commits?: GitCommitInfo[];

  // メトリクス
  metrics?: ExecutionMetrics;

  // 質問/入力待ち状態
  pendingQuestion?: PendingQuestion;

  // セッション情報
  sessionId?: string;           // 継続用セッションID

  // デバッグ情報
  debugInfo?: ExecutionDebugInfo;
}

/**
 * 成果物（ファイル変更、コード生成等）
 */
export interface AgentArtifact {
  type: 'file' | 'code' | 'diff' | 'log' | 'image' | 'data';
  name: string;
  content: string;
  path?: string;
  language?: string;            // プログラミング言語
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Gitコミット情報
 */
export interface GitCommitInfo {
  hash: string;
  message: string;
  branch: string;
  author?: string;
  timestamp?: Date;
  filesChanged: number;
  additions: number;
  deletions: number;
}

/**
 * 実行メトリクス
 */
export interface ExecutionMetrics {
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  tokensUsed?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  apiCalls?: number;
  toolCalls?: number;
  filesModified?: number;
  linesAdded?: number;
  linesDeleted?: number;
}

/**
 * 保留中の質問
 */
export interface PendingQuestion {
  questionId: string;
  text: string;
  category: 'clarification' | 'confirmation' | 'selection' | 'input';
  options?: QuestionOption[];
  multiSelect?: boolean;
  defaultValue?: string;
  timeout?: number;             // 質問のタイムアウト（秒）
  metadata?: Record<string, unknown>;
}

/**
 * 質問の選択肢
 */
export interface QuestionOption {
  label: string;
  value: string;
  description?: string;
  isDefault?: boolean;
}

/**
 * 実行デバッグ情報
 */
export interface ExecutionDebugInfo {
  logs: DebugLogEntry[];
  toolCalls?: ToolCallInfo[];
  rawOutput?: string;
  processInfo?: {
    pid?: number;
    exitCode?: number;
    signal?: string;
  };
}

/**
 * デバッグログエントリ
 */
export interface DebugLogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: unknown;
}

/**
 * ツール呼び出し情報
 */
export interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  startTime: Date;
  endTime?: Date;
  success: boolean;
  error?: string;
}
