/**
 * Debug Log Analyzer - Type Definitions
 *
 * All types, enums, and interfaces used for log analysis.
 */

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

export enum LogLevel {
  TRACE = 'trace',
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

export interface ParsedLogEntry {
  timestamp?: Date;
  level?: LogLevel;
  message?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  raw: string;
  type: LogType;
}

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

export interface LogPattern {
  pattern: string;
  count: number;
  samples: ParsedLogEntry[];
  severity?: LogLevel;
}

export interface LogParser {
  canParse(logLine: string): boolean;
  parse(logLine: string): ParsedLogEntry | null;
  type: LogType;
}

export interface AnalyzeOptions {
  filter?: LogFilter;
  limit?: number;
}

export interface LogFilter {
  level?: LogLevel;
  startTime?: Date;
  endTime?: Date;
  source?: string;
  searchText?: string;
}
