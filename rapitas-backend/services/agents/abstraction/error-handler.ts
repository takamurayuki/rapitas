/**
 * AIエージェント抽象化レイヤー - エラーハンドラー
 * エラーの処理、リトライ戦略、エラーログの管理
 */

import { createLogger } from '../../../config/logger';

const pinoLog = createLogger('agent-error-handler');

import type {
  AgentExecutionContext,
  AgentExecutionResult,
} from './types';
import type {
  IErrorHandler,
  AgentErrorType,
  IAgentLogger,
} from './interfaces';
import { AgentError } from './interfaces';

/**
 * リトライ戦略設定
 */
interface RetryStrategyConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * デフォルトのリトライ戦略
 */
const DEFAULT_RETRY_STRATEGIES: Record<AgentErrorType, RetryStrategyConfig> = {
  configuration: {
    maxRetries: 0, // 設定エラーはリトライしない
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffMultiplier: 1,
  },
  authentication: {
    maxRetries: 1, // 認証エラーは1回だけリトライ
    initialDelayMs: 1000,
    maxDelayMs: 1000,
    backoffMultiplier: 1,
  },
  rate_limit: {
    maxRetries: 5, // レート制限は複数回リトライ
    initialDelayMs: 5000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
  },
  timeout: {
    maxRetries: 2, // タイムアウトは2回リトライ
    initialDelayMs: 10000,
    maxDelayMs: 30000,
    backoffMultiplier: 1.5,
  },
  network: {
    maxRetries: 3, // ネットワークエラーは3回リトライ
    initialDelayMs: 3000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  },
  execution: {
    maxRetries: 1, // 実行エラーは1回リトライ
    initialDelayMs: 5000,
    maxDelayMs: 5000,
    backoffMultiplier: 1,
  },
  validation: {
    maxRetries: 0, // バリデーションエラーはリトライしない
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffMultiplier: 1,
  },
  resource: {
    maxRetries: 2, // リソースエラーは2回リトライ
    initialDelayMs: 10000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
  },
  permission: {
    maxRetries: 0, // パーミッションエラーはリトライしない
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffMultiplier: 1,
  },
  internal: {
    maxRetries: 1, // 内部エラーは1回リトライ
    initialDelayMs: 5000,
    maxDelayMs: 5000,
    backoffMultiplier: 1,
  },
};

/**
 * エラーハンドラーオプション
 */
interface ErrorHandlerOptions {
  retryStrategies?: Partial<Record<AgentErrorType, Partial<RetryStrategyConfig>>>;
  logger?: IAgentLogger;
  onError?: (error: Error | AgentError, context: AgentExecutionContext) => Promise<void>;
}

/**
 * デフォルトのエラーハンドラー実装
 */
export class DefaultErrorHandler implements IErrorHandler {
  private retryStrategies: Record<AgentErrorType, RetryStrategyConfig>;
  private logger?: IAgentLogger;
  private onErrorCallback?: (error: Error | AgentError, context: AgentExecutionContext) => Promise<void>;
  private errorHistory: Array<{
    timestamp: Date;
    error: Error | AgentError;
    executionId: string;
    agentId?: string;
    handled: boolean;
  }> = [];
  private maxHistorySize = 100;

  constructor(options: ErrorHandlerOptions = {}) {
    // デフォルト戦略とカスタム戦略をマージ
    this.retryStrategies = { ...DEFAULT_RETRY_STRATEGIES };

    if (options.retryStrategies) {
      for (const [type, config] of Object.entries(options.retryStrategies)) {
        if (config && type in this.retryStrategies) {
          this.retryStrategies[type as AgentErrorType] = {
            ...this.retryStrategies[type as AgentErrorType],
            ...config,
          };
        }
      }
    }

    this.logger = options.logger;
    this.onErrorCallback = options.onError;
  }

  /**
   * エラーを処理
   */
  async handleError(
    error: Error | AgentError,
    context: AgentExecutionContext,
  ): Promise<{
    handled: boolean;
    retry: boolean;
    delay?: number;
    fallbackResult?: AgentExecutionResult;
  }> {
    // エラー履歴に追加
    this.addToHistory(error, context.executionId, true);

    // AgentErrorかどうかを判定
    const agentError = this.toAgentError(error);
    const errorType = agentError.type;

    // ログ出力
    this.log('error', `Error in execution ${context.executionId}: [${errorType}] ${agentError.message}`);

    // カスタムコールバックがあれば呼び出す
    if (this.onErrorCallback) {
      try {
        await this.onErrorCallback(error, context);
      } catch (callbackError) {
        this.log('warn', `Error callback failed: ${callbackError instanceof Error ? callbackError.message : String(callbackError)}`);
      }
    }

    // リトライ戦略を取得
    const strategy = this.retryStrategies[errorType];

    // リカバリー可能かつリトライ可能な場合
    if (agentError.recoverable && strategy.maxRetries > 0) {
      return {
        handled: true,
        retry: true,
        delay: strategy.initialDelayMs,
      };
    }

    // リカバリー不可能な場合のフォールバック結果を生成
    const fallbackResult: AgentExecutionResult = {
      success: false,
      state: 'failed',
      output: '',
      errorMessage: agentError.message,
      debugInfo: {
        logs: [{
          timestamp: new Date(),
          level: 'error',
          message: agentError.message,
          data: {
            type: errorType,
            recoverable: agentError.recoverable,
            context: agentError.context,
          },
        }],
      },
    };

    return {
      handled: true,
      retry: false,
      fallbackResult,
    };
  }

  /**
   * リトライ戦略を取得
   */
  getRetryStrategy(
    errorType: AgentErrorType,
    retryCount: number,
  ): {
    shouldRetry: boolean;
    delay: number;
    maxRetries: number;
  } {
    const strategy = this.retryStrategies[errorType];

    if (retryCount >= strategy.maxRetries) {
      return {
        shouldRetry: false,
        delay: 0,
        maxRetries: strategy.maxRetries,
      };
    }

    // 指数バックオフでディレイを計算
    const delay = Math.min(
      strategy.initialDelayMs * Math.pow(strategy.backoffMultiplier, retryCount),
      strategy.maxDelayMs,
    );

    return {
      shouldRetry: true,
      delay: Math.floor(delay),
      maxRetries: strategy.maxRetries,
    };
  }

  /**
   * エラー履歴を取得
   */
  getErrorHistory(): Array<{
    timestamp: Date;
    error: Error | AgentError;
    executionId: string;
    agentId?: string;
    handled: boolean;
  }> {
    return [...this.errorHistory];
  }

  /**
   * 特定の実行のエラー履歴を取得
   */
  getErrorsForExecution(executionId: string): Array<{
    timestamp: Date;
    error: Error | AgentError;
    handled: boolean;
  }> {
    return this.errorHistory
      .filter((entry) => entry.executionId === executionId)
      .map(({ timestamp, error, handled }) => ({ timestamp, error, handled }));
  }

  /**
   * エラー統計を取得
   */
  getErrorStats(): {
    total: number;
    byType: Record<string, number>;
    handledCount: number;
    unhandledCount: number;
  } {
    const byType: Record<string, number> = {};
    let handledCount = 0;
    let unhandledCount = 0;

    for (const entry of this.errorHistory) {
      const error = entry.error;
      const type = error instanceof AgentError ? error.type : 'unknown';

      byType[type] = (byType[type] || 0) + 1;

      if (entry.handled) {
        handledCount++;
      } else {
        unhandledCount++;
      }
    }

    return {
      total: this.errorHistory.length,
      byType,
      handledCount,
      unhandledCount,
    };
  }

  /**
   * 履歴をクリア
   */
  clearHistory(): void {
    this.errorHistory = [];
  }

  /**
   * リトライ戦略を更新
   */
  updateRetryStrategy(
    errorType: AgentErrorType,
    config: Partial<RetryStrategyConfig>,
  ): void {
    this.retryStrategies[errorType] = {
      ...this.retryStrategies[errorType],
      ...config,
    };
  }

  // ============================================================================
  // プライベートメソッド
  // ============================================================================

  private toAgentError(error: Error | AgentError): AgentError {
    if (error instanceof AgentError) {
      return error;
    }

    // エラーメッセージからタイプを推測
    const message = error.message.toLowerCase();
    let type: AgentErrorType = 'execution';
    let recoverable = false;

    if (message.includes('timeout') || message.includes('timed out')) {
      type = 'timeout';
      recoverable = true;
    } else if (message.includes('network') || message.includes('econnrefused') || message.includes('enotfound')) {
      type = 'network';
      recoverable = true;
    } else if (message.includes('rate limit') || message.includes('too many requests')) {
      type = 'rate_limit';
      recoverable = true;
    } else if (message.includes('authentication') || message.includes('unauthorized') || message.includes('401')) {
      type = 'authentication';
      recoverable = false;
    } else if (message.includes('permission') || message.includes('forbidden') || message.includes('403')) {
      type = 'permission';
      recoverable = false;
    } else if (message.includes('not found') || message.includes('404')) {
      type = 'resource';
      recoverable = false;
    } else if (message.includes('validation') || message.includes('invalid')) {
      type = 'validation';
      recoverable = false;
    } else if (message.includes('config')) {
      type = 'configuration';
      recoverable = false;
    }

    return new AgentError(
      error.message,
      type,
      recoverable,
      undefined,
      error,
    );
  }

  private addToHistory(
    error: Error | AgentError,
    executionId: string,
    handled: boolean,
    agentId?: string,
  ): void {
    this.errorHistory.push({
      timestamp: new Date(),
      error,
      executionId,
      agentId,
      handled,
    });

    // 履歴サイズを制限
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    if (this.logger) {
      this.logger[level](message);
    } else {
      switch (level) {
        case 'error':
          pinoLog.error(message);
          break;
        case 'warn':
          pinoLog.warn(message);
          break;
        default:
          pinoLog.info(message);
      }
    }
  }
}

/**
 * デフォルトのエラーハンドラーインスタンス
 */
let defaultHandler: DefaultErrorHandler | null = null;

export function getDefaultErrorHandler(): DefaultErrorHandler {
  if (!defaultHandler) {
    defaultHandler = new DefaultErrorHandler();
  }
  return defaultHandler;
}

export function setDefaultErrorHandler(handler: DefaultErrorHandler): void {
  defaultHandler = handler;
}

/**
 * エラーをAgentErrorにラップするユーティリティ
 */
export function wrapError(
  error: unknown,
  type: AgentErrorType = 'execution',
  recoverable: boolean = false,
): AgentError {
  if (error instanceof AgentError) {
    return error;
  }

  if (error instanceof Error) {
    return new AgentError(error.message, type, recoverable, undefined, error);
  }

  return new AgentError(String(error), type, recoverable);
}

/**
 * エラーがAgentErrorかどうかを判定
 */
export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError;
}

/**
 * リカバリー可能なエラーかどうかを判定
 */
export function isRecoverableError(error: unknown): boolean {
  if (error instanceof AgentError) {
    return error.recoverable;
  }
  return false;
}
