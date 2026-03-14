import { createLogger } from '@/lib/logger';

const logger = createLogger('Api');

/**
 * API Base URL
 * Retrieved from environment variable, falls back to default value
 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

/**
 * Helper function to construct API endpoints
 */
export function buildApiUrl(path: string): string {
  // Add leading / if missing
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

type FetchWithRetryOptions = {
  /** When true, downgrade final retry failure log from error to warn */
  silent?: boolean;
};

/** Determine if an HTTP status code is retryable */
function isRetryableStatus(status: number): boolean {
  // 5xx server errors + 429 Too Many Requests are retryable
  return status >= 500 || status === 429;
}

/**
 * Fetch with retry
 * Automatically recovers from transient network errors (TypeError: Failed to fetch) during server restart
 * Uses exponential backoff to gradually increase retry intervals, preventing excessive retries
 *
 * Retryable:
 * - Network errors (TypeError: Failed to fetch)
 * - Timeouts (from internal AbortController)
 * - Server errors (5xx)
 * - Rate limiting (429 Too Many Requests)
 *
 * Not retryable:
 * - Client errors (4xx, except 429) -> throw immediately
 * - Cancellation via caller's AbortSignal -> throw immediately
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  maxRetries = 3,
  retryDelayMs = 300,
  timeoutMs = 10000,
  options?: FetchWithRetryOptions,
): Promise<Response> {
  let lastError: Error | undefined;
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : 'unknown';

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      logger.debug(
        `[fetchWithRetry] Attempting ${attempt + 1}/${maxRetries} for ${url}`,
      );

      // Throw immediately if caller's signal is already aborted
      if (init?.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      // AbortController for timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Combine caller's signal with timeout signal
      const signals: AbortSignal[] = [controller.signal];
      if (init?.signal) {
        signals.push(init.signal);
      }
      const combinedSignal =
        signals.length > 1 ? AbortSignal.any(signals) : controller.signal;

      const response = await fetch(input, {
        ...init,
        signal: combinedSignal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // NOTE: 4xx client errors (except 429) will not succeed on retry, throw immediately
        if (!isRetryableStatus(response.status)) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        // Throw for 5xx/429 as retryable errors
        const retryError = new Error(
          `HTTP ${response.status} ${response.statusText}`,
        );
        (retryError as Error & { retryable: boolean }).retryable = true;
        throw retryError;
      }

      logger.debug(`[fetchWithRetry] Success for ${url}`);
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Identify error type
      const isCallerAbort =
        lastError.name === 'AbortError' && init?.signal?.aborted;
      const isTimeoutError =
        !isCallerAbort &&
        (lastError.name === 'AbortError' ||
          lastError.message.includes('aborted'));
      const isNetworkError =
        lastError.name === 'TypeError' &&
        lastError.message.includes('Failed to fetch');
      const isRetryableError =
        isNetworkError ||
        isTimeoutError ||
        (lastError as Error & { retryable?: boolean }).retryable === true;

      // Throw immediately for caller cancellation or non-retryable errors
      if (isCallerAbort || !isRetryableError) {
        const logFn = options?.silent ? logger.warn : logger.error;
        logFn(
          `[fetchWithRetry] Non-retryable error for ${url}: [${lastError.name}] ${lastError.message}`,
        );
        const enhancedError = new Error(
          `Failed to fetch from ${url}: ${lastError.message}`,
        );
        enhancedError.cause = lastError;
        throw enhancedError;
      }

      const isLastAttempt = attempt === maxRetries - 1;

      if (isLastAttempt) {
        const errorType = isTimeoutError
          ? 'Timeout'
          : isNetworkError
            ? 'NetworkError'
            : lastError.name;
        const message = `[fetchWithRetry] Final attempt ${attempt + 1}/${maxRetries} failed for ${url}: [${errorType}] ${lastError.message}`;

        if (options?.silent) {
          logger.warn(message);
        } else if (isNetworkError || isTimeoutError) {
          // Use transientError for temporary network/timeout errors
          logger.transientError(message, lastError);
        } else {
          logger.error(message);
        }
      } else if (isNetworkError || isTimeoutError) {
        logger.debug(
          `[fetchWithRetry] Attempt ${attempt + 1}/${maxRetries} failed for ${url} (retrying):`,
          lastError.message,
        );
      } else {
        logger.warn(
          `[fetchWithRetry] Attempt ${attempt + 1}/${maxRetries} failed for ${url} (retrying):`,
          lastError.message,
        );
      }

      // Exponential backoff: retryDelayMs * 2^attempt (300ms → 600ms → 1200ms)
      if (!isLastAttempt) {
        const delay = retryDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  const enhancedError = new Error(
    `Failed to fetch from ${url} after ${maxRetries} attempts. ${lastError?.message || 'Unknown error'}`,
  );
  enhancedError.cause = lastError;
  throw enhancedError;
}
