/**
 * Agent Abstraction Layer - Logger
 *
 * Manages log output for agent execution.
 */

import type { IAgentLogger, LogLevel } from './interfaces';
import { createLogger } from '../../../config/logger';

/**
 * Log entry.
 */
interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Logger options.
 */
interface LoggerOptions {
  minLevel?: LogLevel;
  prefix?: string;
  enableConsole?: boolean;
  enableHistory?: boolean;
  maxHistorySize?: number;
  formatter?: (entry: LogEntry) => string;
}

/**
 * Log level priorities.
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Default log formatter.
 */
function defaultFormatter(entry: LogEntry): string {
  const timestamp = entry.timestamp.toISOString();
  const level = entry.level.toUpperCase().padEnd(5);
  let message = `[${timestamp}] [${level}] ${entry.message}`;

  if (entry.context && Object.keys(entry.context).length > 0) {
    message += ` ${JSON.stringify(entry.context)}`;
  }

  return message;
}

/**
 * Console logger implementation.
 */
export class ConsoleLogger implements IAgentLogger {
  private minLevel: LogLevel;
  private prefix: string;
  private enableConsole: boolean;
  private enableHistory: boolean;
  private maxHistorySize: number;
  private formatter: (entry: LogEntry) => string;
  private history: LogEntry[] = [];
  private baseContext: Record<string, unknown>;
  private pinoLogger;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.minLevel ?? 'info';
    this.prefix = options.prefix ?? '';
    this.enableConsole = options.enableConsole ?? true;
    this.enableHistory = options.enableHistory ?? true;
    this.maxHistorySize = options.maxHistorySize ?? 1000;
    this.formatter = options.formatter ?? defaultFormatter;
    this.baseContext = {};
    this.pinoLogger = createLogger(this.prefix || 'agent');
  }

  /**
   * Outputs a log entry.
   */
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    // Check log level threshold
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message: this.prefix ? `${this.prefix} ${message}` : message,
      context: { ...this.baseContext, ...context },
    };

    // Add to history
    if (this.enableHistory) {
      this.history.push(entry);
      if (this.history.length > this.maxHistorySize) {
        this.history.shift();
      }
    }

    // Output via pino
    if (this.enableConsole) {
      const ctx =
        entry.context && Object.keys(entry.context).length > 0 ? entry.context : undefined;
      switch (level) {
        case 'error':
          this.pinoLogger.error(ctx ?? {}, entry.message);
          break;
        case 'warn':
          this.pinoLogger.warn(ctx ?? {}, entry.message);
          break;
        case 'debug':
          this.pinoLogger.debug(ctx ?? {}, entry.message);
          break;
        default:
          this.pinoLogger.info(ctx ?? {}, entry.message);
      }
    }
  }

  /**
   * Debug log.
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  /**
   * Info log.
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  /**
   * Warning log.
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  /**
   * Error log.
   */
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    const errorContext = error
      ? {
          ...context,
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
        }
      : context;

    this.log('error', message, errorContext);
  }

  /**
   * Creates a child logger with additional context.
   */
  child(context: Record<string, unknown>): IAgentLogger {
    const childLoggerInstance = new ConsoleLogger({
      minLevel: this.minLevel,
      prefix: this.prefix,
      enableConsole: this.enableConsole,
      enableHistory: false, // child loggers do not keep their own history
      formatter: this.formatter,
    });

    childLoggerInstance.baseContext = { ...this.baseContext, ...context };
    childLoggerInstance.pinoLogger = this.pinoLogger.child(context);

    return childLoggerInstance;
  }

  /**
   * Returns the log history.
   */
  getHistory(options?: { level?: LogLevel; since?: Date; limit?: number }): LogEntry[] {
    let entries = [...this.history];

    if (options?.level) {
      const minPriority = LOG_LEVEL_PRIORITY[options.level];
      entries = entries.filter((entry) => LOG_LEVEL_PRIORITY[entry.level] >= minPriority);
    }

    if (options?.since) {
      const sinceTime = options.since.getTime();
      entries = entries.filter((entry) => entry.timestamp.getTime() >= sinceTime);
    }

    if (options?.limit && options.limit > 0) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  }

  /**
   * Clears the log history.
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Sets the minimum log level.
   */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Sets the log prefix.
   */
  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  /**
   * Enables or disables console output.
   */
  setConsoleEnabled(enabled: boolean): void {
    this.enableConsole = enabled;
  }

  /**
   * Enables or disables history recording.
   */
  setHistoryEnabled(enabled: boolean): void {
    this.enableHistory = enabled;
  }
}

/**
 * Silent logger (no-op).
 */
export class SilentLogger implements IAgentLogger {
  log(_level: LogLevel, _message: string, _context?: Record<string, unknown>): void {
    // no-op
  }

  debug(_message: string, _context?: Record<string, unknown>): void {
    // no-op
  }

  info(_message: string, _context?: Record<string, unknown>): void {
    // no-op
  }

  warn(_message: string, _context?: Record<string, unknown>): void {
    // no-op
  }

  error(_message: string, _error?: Error, _context?: Record<string, unknown>): void {
    // no-op
  }

  child(_context: Record<string, unknown>): IAgentLogger {
    return this;
  }
}

/**
 * Buffering logger (collects entries for later output).
 */
export class BufferingLogger implements IAgentLogger {
  private buffer: LogEntry[] = [];
  private maxBufferSize: number;

  constructor(maxBufferSize: number = 10000) {
    this.maxBufferSize = maxBufferSize;
  }

  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    this.buffer.push({
      timestamp: new Date(),
      level,
      message,
      context,
    });

    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    const errorContext = error
      ? {
          ...context,
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
        }
      : context;

    this.log('error', message, errorContext);
  }

  child(context: Record<string, unknown>): IAgentLogger {
    // Buffering logger does not create children
    return this;
  }

  /**
   * Flushes and returns the buffer.
   */
  flush(): LogEntry[] {
    const entries = [...this.buffer];
    this.buffer = [];
    return entries;
  }

  /**
   * Flushes the buffer to another logger.
   */
  flushTo(logger: IAgentLogger): void {
    for (const entry of this.buffer) {
      logger.log(entry.level, entry.message, entry.context);
    }
    this.buffer = [];
  }
}

/**
 * Default logger singleton.
 */
let defaultLogger: IAgentLogger | null = null;

export function getDefaultLogger(): IAgentLogger {
  if (!defaultLogger) {
    defaultLogger = new ConsoleLogger({
      prefix: '[Agent]',
      minLevel: 'info',
    });
  }
  return defaultLogger;
}

export function setDefaultLogger(logger: IAgentLogger): void {
  defaultLogger = logger;
}

/**
 * Creates a logger for a specific agent.
 */
export function createAgentLogger(agentId: string, options?: LoggerOptions): IAgentLogger {
  return new ConsoleLogger({
    prefix: `[Agent:${agentId}]`,
    minLevel: 'info',
    ...options,
  });
}

/**
 * Creates a logger for a specific execution.
 */
export function createExecutionLogger(
  executionId: string,
  agentId: string,
  options?: LoggerOptions,
): IAgentLogger {
  return new ConsoleLogger({
    prefix: `[Exec:${executionId.substring(0, 8)}]`,
    minLevel: 'debug',
    ...options,
  }).child({ agentId, executionId });
}
