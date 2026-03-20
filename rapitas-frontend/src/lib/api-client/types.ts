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
