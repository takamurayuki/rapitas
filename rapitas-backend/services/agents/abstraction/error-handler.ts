/**
 * Agent Abstraction Layer - Error Handler
 *
 * Handles error processing, retry strategies, and error history management.
 */

import { createLogger } from '../../../config/logger';

const pinoLog = createLogger('agent-error-handler');

import type { AgentExecutionContext, AgentExecutionResult } from './types';
import type { IErrorHandler, AgentErrorType, IAgentLogger } from './interfaces';
import { AgentError } from './interfaces';

/** Retry strategy configuration per error type. */
interface RetryStrategyConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/** Default retry strategies per error type. */
const DEFAULT_RETRY_STRATEGIES: Record<AgentErrorType, RetryStrategyConfig> = {
  configuration: {
    maxRetries: 0, // config errors are not retryable
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffMultiplier: 1,
  },
  authentication: {
    maxRetries: 1, // auth errors get 1 retry (token refresh)
    initialDelayMs: 1000,
    maxDelayMs: 1000,
    backoffMultiplier: 1,
  },
  rate_limit: {
    maxRetries: 5, // rate limit requires multiple retries with backoff
    initialDelayMs: 5000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
  },
  timeout: {
    maxRetries: 2,
    initialDelayMs: 10000,
    maxDelayMs: 30000,
    backoffMultiplier: 1.5,
  },
  network: {
    maxRetries: 3,
    initialDelayMs: 3000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  },
  execution: {
    maxRetries: 1,
    initialDelayMs: 5000,
    maxDelayMs: 5000,
    backoffMultiplier: 1,
  },
  validation: {
    maxRetries: 0, // validation errors are not retryable
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffMultiplier: 1,
  },
  resource: {
    maxRetries: 2,
    initialDelayMs: 10000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
  },
  permission: {
    maxRetries: 0, // permission errors are not retryable
    initialDelayMs: 0,
    maxDelayMs: 0,
    backoffMultiplier: 1,
  },
  internal: {
    maxRetries: 1,
    initialDelayMs: 5000,
    maxDelayMs: 5000,
    backoffMultiplier: 1,
  },
};

/** Error handler configuration options. */
interface ErrorHandlerOptions {
  retryStrategies?: Partial<Record<AgentErrorType, Partial<RetryStrategyConfig>>>;
  logger?: IAgentLogger;
  onError?: (error: Error | AgentError, context: AgentExecutionContext) => Promise<void>;
}

/** Default error handler implementation with retry strategies. */
export class DefaultErrorHandler implements IErrorHandler {
  private retryStrategies: Record<AgentErrorType, RetryStrategyConfig>;
  private logger?: IAgentLogger;
  private onErrorCallback?: (
    error: Error | AgentError,
    context: AgentExecutionContext,
  ) => Promise<void>;
  private errorHistory: Array<{
    timestamp: Date;
    error: Error | AgentError;
    executionId: string;
    agentId?: string;
    handled: boolean;
  }> = [];
  private maxHistorySize = 100;

  constructor(options: ErrorHandlerOptions = {}) {
    // Merge custom strategies with defaults
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

  /** Handles an error, deciding whether to retry or produce a fallback result. */
  async handleError(
    error: Error | AgentError,
    context: AgentExecutionContext,
  ): Promise<{
    handled: boolean;
    retry: boolean;
    delay?: number;
    fallbackResult?: AgentExecutionResult;
  }> {
    // Add to error history
    this.addToHistory(error, context.executionId, true);

    // Convert to AgentError if needed
    const agentError = this.toAgentError(error);
    const errorType = agentError.type;

    // Log error
    this.log(
      'error',
      `Error in execution ${context.executionId}: [${errorType}] ${agentError.message}`,
    );

    // Invoke custom error callback if configured
    if (this.onErrorCallback) {
      try {
        await this.onErrorCallback(error, context);
      } catch (callbackError) {
        this.log(
          'warn',
          `Error callback failed: ${callbackError instanceof Error ? callbackError.message : String(callbackError)}`,
        );
      }
    }

    // Get retry strategy for this error type
    const strategy = this.retryStrategies[errorType];

    // Retry if recoverable and retries remain
    if (agentError.recoverable && strategy.maxRetries > 0) {
      return {
        handled: true,
        retry: true,
        delay: strategy.initialDelayMs,
      };
    }

    // Generate fallback result for non-recoverable errors
    const fallbackResult: AgentExecutionResult = {
      success: false,
      state: 'failed',
      output: '',
      errorMessage: agentError.message,
      debugInfo: {
        logs: [
          {
            timestamp: new Date(),
            level: 'error',
            message: agentError.message,
            data: {
              type: errorType,
              recoverable: agentError.recoverable,
              context: agentError.context,
            },
          },
        ],
      },
    };

    return {
      handled: true,
      retry: false,
      fallbackResult,
    };
  }

  /** Returns the retry strategy for a given error type and retry count. */
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

    // Calculate delay with exponential backoff
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

  /** Returns the full error history. */
  getErrorHistory(): Array<{
    timestamp: Date;
    error: Error | AgentError;
    executionId: string;
    agentId?: string;
    handled: boolean;
  }> {
    return [...this.errorHistory];
  }

  /** Returns error history for a specific execution. */
  getErrorsForExecution(executionId: string): Array<{
    timestamp: Date;
    error: Error | AgentError;
    handled: boolean;
  }> {
    return this.errorHistory
      .filter((entry) => entry.executionId === executionId)
      .map(({ timestamp, error, handled }) => ({ timestamp, error, handled }));
  }

  /** Returns aggregated error statistics. */
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

  /** Clears error history. */
  clearHistory(): void {
    this.errorHistory = [];
  }

  /** Updates the retry strategy for a specific error type. */
  updateRetryStrategy(errorType: AgentErrorType, config: Partial<RetryStrategyConfig>): void {
    this.retryStrategies[errorType] = {
      ...this.retryStrategies[errorType],
      ...config,
    };
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private toAgentError(error: Error | AgentError): AgentError {
    if (error instanceof AgentError) {
      return error;
    }

    // Infer error type from message keywords
    const message = error.message.toLowerCase();
    let type: AgentErrorType = 'execution';
    let recoverable = false;

    if (message.includes('timeout') || message.includes('timed out')) {
      type = 'timeout';
      recoverable = true;
    } else if (
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('enotfound')
    ) {
      type = 'network';
      recoverable = true;
    } else if (message.includes('rate limit') || message.includes('too many requests')) {
      type = 'rate_limit';
      recoverable = true;
    } else if (
      message.includes('authentication') ||
      message.includes('unauthorized') ||
      message.includes('401')
    ) {
      type = 'authentication';
      recoverable = false;
    } else if (
      message.includes('permission') ||
      message.includes('forbidden') ||
      message.includes('403')
    ) {
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

    return new AgentError(error.message, type, recoverable, undefined, error);
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

    // Evict oldest entry when history exceeds max size
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

/** Default singleton error handler instance. */
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

/** Wraps an unknown error into an AgentError. */
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

/** Type guard for AgentError. */
export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError;
}

/** Checks whether an error is recoverable. */
export function isRecoverableError(error: unknown): boolean {
  if (error instanceof AgentError) {
    return error.recoverable;
  }
  return false;
}
