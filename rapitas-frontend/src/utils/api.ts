import { createLogger } from '@/lib/logger';

const logger = createLogger("Api");

/**
 * API Base URL
 * 環境変数から取得し、設定されていない場合はデフォルト値を使用
 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

/**
 * APIエンドポイントを構築するヘルパー関数
 */
export function buildApiUrl(path: string): string {
  // パスが / で始まっていない場合は追加
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

type FetchWithRetryOptions = {
  /** trueの場合、最終リトライ失敗時のログをerror→warnにダウングレード */
  silent?: boolean;
};

/** HTTPステータスコードがリトライ対象かどうかを判定 */
function isRetryableStatus(status: number): boolean {
  // 5xx サーバーエラー + 429 Too Many Requests はリトライ対象
  return status >= 500 || status === 429;
}

/**
 * リトライ付きfetch
 * サーバー再起動中の一時的なネットワークエラー（TypeError: Failed to fetch）を自動リカバリ
 * Exponential backoffで段階的にリトライ間隔を延長し、過剰なリトライを防止
 *
 * リトライ対象:
 * - ネットワークエラー（TypeError: Failed to fetch）
 * - タイムアウト（内部AbortController由来）
 * - サーバーエラー（5xx）
 * - レート制限（429 Too Many Requests）
 *
 * リトライ対象外:
 * - クライアントエラー（4xx、429を除く）→ 即座にthrow
 * - 呼び出し元のAbortSignalによるキャンセル → 即座にthrow
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
      logger.debug(`[fetchWithRetry] Attempting ${attempt + 1}/${maxRetries} for ${url}`);

      // 呼び出し元のsignalが既にabortされている場合は即座にエラー
      if (init?.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      // タイムアウト処理のためのAbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // 呼び出し元のsignalとタイムアウトsignalを結合
      const signals: AbortSignal[] = [controller.signal];
      if (init?.signal) {
        signals.push(init.signal);
      }
      const combinedSignal = signals.length > 1
        ? AbortSignal.any(signals)
        : controller.signal;

      const response = await fetch(input, {
        ...init,
        signal: combinedSignal,
      });

      // タイムアウトをクリア
      clearTimeout(timeoutId);

      if (!response.ok) {
        // 4xxクライアントエラー（429除く）はリトライしても成功しないため即座にthrow
        if (!isRetryableStatus(response.status)) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        // 5xx/429はリトライ対象としてエラーをthrow
        const retryError = new Error(`HTTP ${response.status} ${response.statusText}`);
        (retryError as Error & { retryable: boolean }).retryable = true;
        throw retryError;
      }

      logger.debug(`[fetchWithRetry] Success for ${url}`);
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // エラーの種類を識別
      const isCallerAbort = lastError.name === 'AbortError' && init?.signal?.aborted;
      const isTimeoutError = !isCallerAbort && (lastError.name === 'AbortError' || lastError.message.includes('aborted'));
      const isNetworkError = lastError.name === 'TypeError' && lastError.message.includes('Failed to fetch');
      const isRetryableError = isNetworkError || isTimeoutError || (lastError as Error & { retryable?: boolean }).retryable === true;

      // 呼び出し元のキャンセルやリトライ不可のエラーは即座にthrow
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
        const errorType = isTimeoutError ? 'Timeout' : isNetworkError ? 'NetworkError' : lastError.name;
        const logFn = options?.silent ? logger.warn : logger.error;
        logFn(
          `[fetchWithRetry] Final attempt ${attempt + 1}/${maxRetries} failed for ${url}: [${errorType}] ${lastError.message}`,
        );
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
