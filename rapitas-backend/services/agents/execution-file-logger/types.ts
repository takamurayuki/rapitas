/**
 * ExecutionFileLogger / Types
 *
 * Shared type definitions for the execution file logger subsystem.
 * Not responsible for I/O or log formatting logic.
 */

/**
 * Log event types.
 */
export type LogEventType =
  | 'execution_start'
  | 'execution_end'
  | 'output'
  | 'error'
  | 'question_detected'
  | 'question_answered'
  | 'status_change'
  | 'git_commit'
  | 'config_loaded'
  | 'timeout'
  | 'shutdown'
  | 'recovery';

/**
 * Structured log entry.
 */
export type StructuredLogEntry = {
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  eventType: LogEventType;
  executionId: number;
  sessionId: number;
  taskId: number;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  duration?: number;
};

/**
 * Execution summary appended at the end of each log file.
 */
export type ExecutionSummary = {
  executionId: number;
  sessionId: number;
  taskId: number;
  taskTitle: string;
  agentType: string;
  agentName: string;
  modelId?: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  tokensUsed?: number;
  totalLogEntries: number;
  errorCount: number;
  warningCount: number;
  lastError?: string;
  outputSizeBytes: number;
};

/**
 * File logger configuration.
 */
export type FileLoggerConfig = {
  logDir: string;
  maxLogFiles: number;
  maxLogSizeBytes: number;
  enableConsolePassthrough: boolean;
};
