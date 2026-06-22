/**
 * ApiClient — Shared types
 *
 * Type definitions shared across the api-client sub-modules.
 * Not responsible for any runtime logic.
 */

export type RequestOptions = RequestInit & {
  skipCache?: boolean;
  /** Cache duration in milliseconds. / キャッシュ保持時間（ミリ秒） */
  cacheTime?: number;
  /** Per-attempt timeout override in ms. / 1試行あたりのタイムアウト上書き（ms） */
  timeoutMs?: number;
  /** Disable the transient-error retry for idempotent GETs. / GETの透過リトライを無効化 */
  skipRetry?: boolean;
};

export type BatchRequest = {
  id: string;
  method: string;
  url: string;
  body?: unknown;
};

export type BatchResponse = {
  id: string;
  status: number;
  body: unknown;
  error?: string;
};

export type CacheEntry = {
  data: unknown;
  timestamp: number;
  expiry: number;
};
