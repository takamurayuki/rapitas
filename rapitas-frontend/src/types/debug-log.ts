/**
 * Debug log analyzer type definitions
 */

// Log types
export type LogType =
  | 'json'
  | 'syslog'
  | 'apache_common'
  | 'apache_combined'
  | 'nginx'
  | 'nodejs'
  | 'custom'
  | 'unknown';

// Log levels
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// Parsed log entry
export interface ParsedLogEntry {
  timestamp?: Date;
  level?: LogLevel;
  message?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  raw: string;
  type: LogType;
}

// Log pattern
export interface LogPattern {
  pattern: string;
  count: number;
  samples: ParsedLogEntry[];
  severity?: LogLevel;
}

// Log analysis result
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

// Log filter
export interface LogFilter {
  level?: LogLevel;
  startTime?: Date;
  endTime?: Date;
  source?: string;
  searchText?: string;
}

// Analysis options
export interface AnalyzeOptions {
  filter?: LogFilter;
  limit?: number;
}

// Custom field mapping
export interface CustomFieldMapping {
  groups: string[];
  timestampFormat?: string;
}

// API request/response
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
