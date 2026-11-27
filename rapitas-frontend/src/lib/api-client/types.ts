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
  /**
   * A user operation (search, opening a detail) issued this GET, so it is sent
   * as `X-Rapitas-Source: ui` and counts as activity. Omit for polling and
   * background reads, which are sent as `ui-poll`. Mutations are always `ui`.
   * / 利用者の操作由来のGET（未指定のGETは ui-poll として送る）
   */
  userAction?: boolean;
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
