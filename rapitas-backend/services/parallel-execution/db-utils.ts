/**
 * ParallelExecution — DbUtils
 *
 * Database mutex and retry utilities for safe concurrent DB access
 * during parallel agent execution.
 * Not responsible for session management or task execution logic.
 */

import { createLogger } from '../../config/logger';

const logger = createLogger('parallel-executor:db-utils');

/**
 * Simple mutex to serialize concurrent DB writes and prevent Prisma connection pool exhaustion.
 */
export class DatabaseMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  /** Acquire the mutex; waits if already locked. */
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  /** Release the mutex and unblock the next waiter. */
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Execute a DB operation with exponential backoff retry for transient errors.
 *
 * Retries on: Socket timeout, deadlock detected, serialization failure.
 *
 * @param operation - Async DB operation to retry / リトライするDB操作
 * @param maxRetries - Maximum number of attempts (default 3) / 最大試行回数
 * @param baseDelay - Base delay in ms before first retry (default 100) / 初回リトライ遅延ms
 * @returns Result of the operation
 * @throws Last error if all retries exhausted
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 100,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isRetryable =
        lastError.message.includes('Socket timeout') ||
        lastError.message.includes('deadlock detected') ||
        lastError.message.includes('could not serialize access');

      if (!isRetryable || attempt === maxRetries - 1) {
        throw lastError;
      }

      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 100;
      logger.info(
        `[ParallelExecutor] DB operation failed, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/** Shared singleton mutex for all DB writes in parallel execution. */
export const dbMutex = new DatabaseMutex();
