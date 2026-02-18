/**
 * デバッグログ解析ツールの型定義
 */

// ログタイプ
export type LogType =
  | "json"
  | "syslog"
  | "apache_common"
  | "apache_combined"
  | "nginx"
  | "nodejs"
  | "custom"
  | "unknown";

// ログレベル
export type LogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal";

// パースされたログエントリー
export interface ParsedLogEntry {
  timestamp?: Date;
  level?: LogLevel;
  message?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  raw: string;
  type: LogType;
}

// ログパターン
export interface LogPattern {
  pattern: string;
  count: number;
  samples: ParsedLogEntry[];
  severity?: LogLevel;
}

// ログ解析結果
export interface LogAnalysisResult {
  entries: ParsedLogEntry[];
  summary: {
    totalEntries: number;
    errorCount: number;
    warningCount: number;
    timeRange?: {
      start: Date;
      end: Date;
    };
    levelDistribution: Record<LogLevel, number>;
    sourceDistribution: Record<string, number>;
  };
  patterns: {
    errors: LogPattern[];
    warnings: LogPattern[];
    frequentMessages: LogPattern[];
  };
}

// ログフィルター
export interface LogFilter {
  level?: LogLevel;
  startTime?: Date;
  endTime?: Date;
  source?: string;
  searchText?: string;
}

// 解析オプション
export interface AnalyzeOptions {
  filter?: LogFilter;
  limit?: number;
}

// カスタムフィールドマッピング
export interface CustomFieldMapping {
  groups: string[];
  timestampFormat?: string;
}

// API リクエスト/レスポンス
export interface AnalyzeLogRequest {
  content: string;
  type?: LogType;
  options?: AnalyzeOptions;
}

export interface AnalyzeLogResponse {
  success: boolean;
  result?: LogAnalysisResult;
  error?: string;
}