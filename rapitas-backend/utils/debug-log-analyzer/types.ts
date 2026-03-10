/**
 * デバッグログ解析ツール - 型定義
 * ログ解析に使用するすべての型、列挙型、インターフェースを定義
 */

// ログのタイプ定義
export enum LogType {
  JSON = 'json',
  SYSLOG = 'syslog',
  APACHE_COMMON = 'apache_common',
  APACHE_COMBINED = 'apache_combined',
  NGINX = 'nginx',
  NODEJS = 'nodejs',
  CUSTOM = 'custom',
  UNKNOWN = 'unknown',
}

// ログレベルの定義
export enum LogLevel {
  TRACE = 'trace',
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

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

// ログパターン
export interface LogPattern {
  pattern: string;
  count: number;
  samples: ParsedLogEntry[];
  severity?: LogLevel;
}

// ログパーサーインターフェース
export interface LogParser {
  canParse(logLine: string): boolean;
  parse(logLine: string): ParsedLogEntry | null;
  type: LogType;
}

// 解析オプション
export interface AnalyzeOptions {
  filter?: LogFilter;
  limit?: number;
}

// ログフィルター
export interface LogFilter {
  level?: LogLevel;
  startTime?: Date;
  endTime?: Date;
  source?: string;
  searchText?: string;
}
