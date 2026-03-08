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

/**
 * リトライ付きfetch
 * サーバー再起動中の一時的なネットワークエラー（TypeError: Failed to fetch）を自動リカバリ
 * 短い間隔で素早くリトライし、UIのブロックを最小限にする
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  maxRetries = 3,
  retryDelayMs = 300,
  timeoutMs = 10000,
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

      // HTTPステータスエラーの場合もエラーとして扱う
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      logger.debug(`[fetchWithRetry] Success for ${url}`);
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // エラーの種類を識別
      const isTimeoutError = lastError.name === 'AbortError' || lastError.message.includes('aborted');
      const isNetworkError = lastError.name === 'TypeError' && lastError.message.includes('Failed to fetch');

      // ログレベルを適切に設定
      const isLastAttempt = attempt === maxRetries - 1;

      if (isLastAttempt) {
        // 最後のリトライでも失敗した場合のみエラーレベル
        const errorType = isTimeoutError ? 'Timeout' : isNetworkError ? 'NetworkError' : lastError.name;
        logger.error(
          `[fetchWithRetry] Final attempt ${attempt + 1}/${maxRetries} failed for ${url}: [${errorType}] ${lastError.message}`,
        );
      } else if (isNetworkError || isTimeoutError) {
        // ネットワークエラーやタイムアウトはサーバー再起動中など正常な状況
        logger.debug(
          `[fetchWithRetry] Attempt ${attempt + 1}/${maxRetries} failed for ${url} (retrying):`,
          lastError.message,
        );
      } else {
        // HTTPエラーなど、その他のエラーは警告レベル
        logger.warn(
          `[fetchWithRetry] Attempt ${attempt + 1}/${maxRetries} failed for ${url} (retrying):`,
          lastError.message,
        );
      }

      // 最後のリトライでなければ短い待機後にリトライ
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  // エラーメッセージを改善
  const enhancedError = new Error(
    `Failed to fetch from ${url} after ${maxRetries} attempts. ${lastError?.message || 'Unknown error'}`,
  );
  enhancedError.cause = lastError;
  throw enhancedError;
}
