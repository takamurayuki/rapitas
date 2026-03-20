/**
 * ExecutionFileLogger (barrel)
 *
 * Re-exports the full public API from the execution-file-logger sub-module.
 * Exists solely for backward compatibility — all new code should import
 * directly from ./execution-file-logger/*.
 */

export { ExecutionFileLogger, DEFAULT_CONFIG } from './execution-file-logger/index';
export type {
  LogEventType,
  StructuredLogEntry,
  ExecutionSummary,
  FileLoggerConfig,
} from './execution-file-logger/types';
export {
  listExecutionLogFiles,
  getExecutionLogFile,
  cleanupOldLogs,
} from './execution-file-logger/log-file-manager';
export type { LogFileMeta } from './execution-file-logger/log-file-manager';
