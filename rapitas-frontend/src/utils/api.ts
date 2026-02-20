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
  timeoutMs = 5000,
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
      console.log(`[fetchWithRetry] Attempting ${attempt + 1}/${maxRetries} for ${url}`);

      // タイムアウト処理のためのAbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      });

      // タイムアウトをクリア
      clearTimeout(timeoutId);

      // HTTPステータスエラーの場合もエラーとして扱う
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      console.log(`[fetchWithRetry] Success for ${url}`);
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // エラーの種類を識別
      const isTimeoutError = lastError.name === 'AbortError' || lastError.message.includes('aborted');
      const isNetworkError = lastError.name === 'TypeError' && lastError.message.includes('Failed to fetch');

      // ネットワークエラーの場合、より詳細なログを出力
      console.error(
        `[fetchWithRetry] Attempt ${attempt + 1}/${maxRetries} failed for ${url}:`,
        {
          message: lastError.message,
          type: lastError.name,
          stack: lastError.stack,
          isTimeout: isTimeoutError,
          isNetworkError: isNetworkError,
        },
      );

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
