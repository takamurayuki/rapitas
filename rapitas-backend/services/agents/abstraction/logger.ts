/**
 * AIエージェント抽象化レイヤー - ロガー
 * エージェント実行のログ出力を管理
 */

import type { IAgentLogger, LogLevel } from './interfaces';
import { createLogger } from '../../../config/logger';

/**
 * ログエントリ
 */
interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * ロガーオプション
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
 * ログレベルの優先度
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * デフォルトのフォーマッター
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
 * コンソールロガー実装
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
   * ログを出力
   */
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    // ログレベルのチェック
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message: this.prefix ? `${this.prefix} ${message}` : message,
      context: { ...this.baseContext, ...context },
    };

    // 履歴に追加
    if (this.enableHistory) {
      this.history.push(entry);
      if (this.history.length > this.maxHistorySize) {
        this.history.shift();
      }
    }

    // pinoで出力
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
   * デバッグログ
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  /**
   * 情報ログ
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  /**
   * 警告ログ
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  /**
   * エラーログ
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
   * 子ロガーを作成（コンテキスト付き）
   */
  child(context: Record<string, unknown>): IAgentLogger {
    const childLoggerInstance = new ConsoleLogger({
      minLevel: this.minLevel,
      prefix: this.prefix,
      enableConsole: this.enableConsole,
      enableHistory: false, // 子ロガーは履歴を持たない
      formatter: this.formatter,
    });

    childLoggerInstance.baseContext = { ...this.baseContext, ...context };
    childLoggerInstance.pinoLogger = this.pinoLogger.child(context);

    return childLoggerInstance;
  }

  /**
   * ログ履歴を取得
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
   * 履歴をクリア
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * ログレベルを設定
   */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * プレフィックスを設定
   */
  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  /**
   * コンソール出力を有効/無効
   */
  setConsoleEnabled(enabled: boolean): void {
    this.enableConsole = enabled;
  }

  /**
   * 履歴を有効/無効
   */
  setHistoryEnabled(enabled: boolean): void {
    this.enableHistory = enabled;
  }
}

/**
 * サイレントロガー（何も出力しない）
 */
export class SilentLogger implements IAgentLogger {
  log(_level: LogLevel, _message: string, _context?: Record<string, unknown>): void {
    // 何もしない
  }

  debug(_message: string, _context?: Record<string, unknown>): void {
    // 何もしない
  }

  info(_message: string, _context?: Record<string, unknown>): void {
    // 何もしない
  }

  warn(_message: string, _context?: Record<string, unknown>): void {
    // 何もしない
  }

  error(_message: string, _error?: Error, _context?: Record<string, unknown>): void {
    // 何もしない
  }

  child(_context: Record<string, unknown>): IAgentLogger {
    return this;
  }
}

/**
 * バッファリングロガー（後でまとめて出力）
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
    // バッファリングロガーは子を持たない
    return this;
  }

  /**
   * バッファを取得してクリア
   */
  flush(): LogEntry[] {
    const entries = [...this.buffer];
    this.buffer = [];
    return entries;
  }

  /**
   * バッファを別のロガーに流す
   */
  flushTo(logger: IAgentLogger): void {
    for (const entry of this.buffer) {
      logger.log(entry.level, entry.message, entry.context);
    }
    this.buffer = [];
  }
}

/**
 * デフォルトのロガーインスタンス
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
 * エージェント用のロガーを作成
 */
export function createAgentLogger(agentId: string, options?: LoggerOptions): IAgentLogger {
  return new ConsoleLogger({
    prefix: `[Agent:${agentId}]`,
    minLevel: 'info',
    ...options,
  });
}

/**
 * 実行用のロガーを作成
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
