type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const current: LogLevel =
  (process.env.NEXT_PUBLIC_LOG_LEVEL as LogLevel) ??
  (process.env.NODE_ENV === 'production' ? 'warn' : 'debug');

/**
 * スロットリング用の最終出力タイムスタンプ管理
 * key: "prefix|message先頭80文字" → 最終出力時刻
 */
const throttleMap = new Map<string, number>();
const THROTTLE_WINDOW_MS = 5_000;

function shouldThrottle(key: string): boolean {
  const now = Date.now();
  const last = throttleMap.get(key);
  if (last && now - last < THROTTLE_WINDOW_MS) {
    return true;
  }
  throttleMap.set(key, now);
  return false;
}

function makeThrottleKey(prefix: string, args: unknown[]): string {
  const msg = typeof args[0] === 'string' ? args[0].slice(0, 80) : '';
  return `${prefix}|${msg}`;
}

/**
 * ネットワーク系の一時的エラーかどうかを判定
 */
export function isTransientError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const err = error as { name?: string; message?: string; cause?: unknown };
  if (!err.name && !err.message) return false;
  const name = err.name ?? '';
  const message = err.message ?? '';
  // TypeError: Failed to fetch (ネットワーク切断)
  if (name === 'TypeError' && message.includes('Failed to fetch')) return true;
  // AbortError (タイムアウト)
  if (name === 'AbortError' || message.includes('aborted')) return true;
  // cause がある場合は再帰的にチェック
  if (err.cause != null) return isTransientError(err.cause);
  // メッセージにネットワーク関連のキーワード
  if (/network|timeout|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(message))
    return true;
  return false;
}

export function createLogger(name: string) {
  const p = `[${name}]`;
  const ok = (l: LogLevel) => LEVELS[l] >= LEVELS[current];
  return {
    debug: (...a: unknown[]) => ok('debug') && console.debug(p, ...a),
    info: (...a: unknown[]) => ok('info') && console.info(p, ...a),
    warn: (...a: unknown[]) => ok('warn') && console.warn(p, ...a),
    error: (...a: unknown[]) => ok('error') && console.error(p, ...a),

    /**
     * スロットリング付きエラーログ
     * 同一メッセージは THROTTLE_WINDOW_MS (5秒) 以内に1回だけ出力
     * 重複分はdebugレベルに降格
     */
    errorThrottled: (...a: unknown[]) => {
      if (!ok('warn')) return;
      const key = makeThrottleKey(p, a);
      if (shouldThrottle(key)) {
        ok('debug') && console.debug(p, '[throttled]', ...a);
        return;
      }
      ok('error') && console.error(p, ...a);
    },

    /**
     * 一時的エラー用ログ（NetworkError, Timeout等）
     * 一時的エラーはwarnレベルで出力し、そうでないエラーはerrorレベルで出力
     */
    transientError: (message: string, error?: unknown, ...rest: unknown[]) => {
      if (isTransientError(error)) {
        ok('warn') && console.warn(p, message, error, ...rest);
      } else {
        ok('error') && console.error(p, message, error, ...rest);
      }
    },
  };
}
