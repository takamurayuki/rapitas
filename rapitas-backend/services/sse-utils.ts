/**
 * SSE (Server-Sent Events) Utilities
 *
 * Includes retry logic and rollback handling.
 */

import { createLogger } from '../config/logger';

const log = createLogger('sse-utils');

// SSE event type definitions
export type SSEEventType =
  | 'start'
  | 'progress'
  | 'data'
  | 'error'
  | 'retry'
  | 'rollback'
  | 'complete';

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  timestamp: string;
  retryCount?: number;
  maxRetries?: number;
}

// Retry configuration
export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

// Helper for generating SSE responses
export function createSSEHeaders(): Headers {
  const headers = new Headers();
  headers.set('Content-Type', 'text/event-stream');
  headers.set('Cache-Control', 'no-cache');
  headers.set('Connection', 'keep-alive');
  return headers;
}

// Format an SSE message
export function formatSSEMessage(event: SSEEvent): string {
  const eventType = event.type;
  const data = JSON.stringify({
    ...event,
    timestamp: new Date().toISOString(),
  });
  return `event: ${eventType}\ndata: ${data}\n\n`;
}

// Calculate retry delay (exponential backoff)
export function calculateRetryDelay(
  retryCount: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  const delay = config.initialDelay * Math.pow(config.backoffMultiplier, retryCount);
  return Math.min(delay, config.maxDelay);
}

// Wait for delay
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Determine if an error is retryable.
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Network errors, timeouts, temporary server errors
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('temporarily') ||
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('503') ||
      message.includes('504')
    );
  }
  return false;
}

// Rollback info
export interface RollbackInfo {
  originalState: unknown;
  rollbackReason: string;
  timestamp: string;
  errorDetails: string;
}

// SSE stream controller
export class SSEStreamController {
  private encoder = new TextEncoder();
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private isClosed = false;
  private retryCount = 0;
  private retryConfig: RetryConfig;
  private rollbackState: unknown = null;

  constructor(config: Partial<RetryConfig> = {}) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  // Create a stream.
  createStream(): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.isClosed = true;
      },
    });
  }

  // Save state for rollback.
  saveState(state: unknown): void {
    this.rollbackState = JSON.parse(JSON.stringify(state));
  }

  // Get saved state.
  getSavedState(): unknown {
    return this.rollbackState;
  }

  // Send an event.
  send(event: SSEEvent): void {
    if (this.isClosed || !this.controller) return;

    try {
      const message = formatSSEMessage(event);
      this.controller.enqueue(this.encoder.encode(message));
    } catch (error) {
      log.error({ err: error }, 'SSE send error');
    }
  }

  // Send start event.
  sendStart(data: unknown = {}): void {
    this.send({
      type: 'start',
      data,
      timestamp: new Date().toISOString(),
    });
  }

  // Send progress event.
  sendProgress(progress: number, message: string, data: unknown = {}): void {
    this.send({
      type: 'progress',
      data: {
        progress,
        message,
        ...(typeof data === 'object' && data !== null ? data : {}),
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Send data event.
  sendData(data: unknown): void {
    this.send({
      type: 'data',
      data,
      timestamp: new Date().toISOString(),
    });
  }

  // Send retry event.
  sendRetry(retryCount: number, reason: string): void {
    this.send({
      type: 'retry',
      data: {
        retryCount,
        maxRetries: this.retryConfig.maxRetries,
        reason,
        nextRetryIn: calculateRetryDelay(retryCount, this.retryConfig),
      },
      timestamp: new Date().toISOString(),
      retryCount,
      maxRetries: this.retryConfig.maxRetries,
    });
  }

  // Send error event.
  sendError(error: string, details?: unknown): void {
    this.send({
      type: 'error',
      data: { error, details },
      timestamp: new Date().toISOString(),
    });
  }

  // Send rollback event.
  sendRollback(info: RollbackInfo): void {
    this.send({
      type: 'rollback',
      data: info,
      timestamp: new Date().toISOString(),
    });
  }

  // Send complete event.
  sendComplete(data: unknown = {}): void {
    this.send({
      type: 'complete',
      data,
      timestamp: new Date().toISOString(),
    });
  }

  // Close the stream.
  close(): void {
    if (this.isClosed || !this.controller) return;

    try {
      this.controller.close();
    } catch (error) {
      // Ignore if already closed
    }
    this.isClosed = true;
  }

  // Execute an operation with retry logic.
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    onRetry?: (retryCount: number, error: Error) => void,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.retryCount = attempt;
          const delayMs = calculateRetryDelay(attempt - 1, this.retryConfig);
          this.sendRetry(attempt, lastError?.message || '不明なエラーが発生しました');
          await delay(delayMs);
          onRetry?.(attempt, lastError!);
        }

        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!isRetryableError(error) || attempt === this.retryConfig.maxRetries) {
          // Non-retryable error or retry limit reached
          const rollbackInfo: RollbackInfo = {
            originalState: this.rollbackState,
            rollbackReason:
              attempt === this.retryConfig.maxRetries
                ? `リトライ上限(${this.retryConfig.maxRetries}回)に達しました`
                : 'リトライ不可能なエラーが発生しました',
            timestamp: new Date().toISOString(),
            errorDetails: lastError.message,
          };

          this.sendRollback(rollbackInfo);
          this.sendError(lastError.message, {
            rollback: true,
            retryCount: attempt,
            maxRetries: this.retryConfig.maxRetries,
          });

          throw lastError;
        }
      }
    }

    throw lastError || new Error('予期しないエラーが発生しました');
  }
}

// Generate a user-friendly error message.
export function getUserFriendlyErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('rate limit') || message.includes('429')) {
      return 'APIのレート制限に達しました。しばらく待ってから再試行してください。';
    }
    if (message.includes('timeout')) {
      return 'リクエストがタイムアウトしました。ネットワーク接続を確認してください。';
    }
    if (message.includes('network') || message.includes('econnrefused')) {
      return 'ネットワークエラーが発生しました。インターネット接続を確認してください。';
    }
    if (message.includes('api key') || message.includes('unauthorized')) {
      return 'APIキーが無効です。設定を確認してください。';
    }
    if (message.includes('not found') || message.includes('404')) {
      return 'リソースが見つかりませんでした。';
    }

    return error.message;
  }

  return '予期しないエラーが発生しました。';
}
