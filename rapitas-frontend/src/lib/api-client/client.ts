/**
 * APIClient
 *
 * Optimized HTTP client providing caching, request deduplication, debouncing,
 * throttling, parallel fetching, prefetching, and batch support.
 * Not responsible for persistence — that is delegated to ApiClientCache.
 */

import { API_BASE_URL } from '@/utils/api';
import { offlineFetch } from '@/lib/offline-queue';
import { ApiClientCache } from './cache';
import { ApiClientBatch } from './batch';
import type { RequestOptions } from './types';

export class APIClient {
  private cache = new ApiClientCache();
  private batch = new ApiClientBatch();
  private requestQueue = new Map<string, Promise<unknown>>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private throttleLastCall = new Map<string, number>();

  /**
   * Basic fetch with caching and in-flight deduplication.
   *
   * @param path - API path relative to base URL / ベースURLからの相対パス
   * @param options - Fetch options including cache control / キャッシュ制御を含むフェッチオプション
   * @returns Response typed as T / レスポンス
   */
  async fetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = `${API_BASE_URL}${path}`;
    const cacheKey = `${options.method || 'GET'}:${url}:${JSON.stringify(options.body || {})}`;

    if (!options.skipCache && (!options.method || options.method === 'GET')) {
      const cached = this.cache.get<T>(cacheKey);
      if (cached) return cached;
    }

    const existingRequest = this.requestQueue.get(cacheKey);
    if (existingRequest) return existingRequest as Promise<T>;

    const request = this.performFetch<T>(url, options)
      .then((data) => {
        if (options.method === 'GET' || !options.method) {
          this.cache.set(cacheKey, data, options.cacheTime);
        }
        this.requestQueue.delete(cacheKey);
        return data;
      })
      .catch((error) => {
        this.requestQueue.delete(cacheKey);
        throw error;
      });

    this.requestQueue.set(cacheKey, request);
    return request;
  }

  /**
   * Queue a request into the next batch window.
   *
   * @param path - API path / APIパス
   * @param options - Fetch options / フェッチオプション
   * @returns Response typed as T / レスポンス
   */
  async batchFetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.batch.enqueue<T>(path, options, (p, o) => this.fetch(p, o));
  }

  /**
   * Execute only the last of consecutive identical requests within the delay window.
   *
   * @param path - API path / APIパス
   * @param options - Fetch options / フェッチオプション
   * @param delay - Debounce delay in milliseconds / デバウンス遅延（ミリ秒）
   * @returns Response typed as T / レスポンス
   */
  async debouncedFetch<T = unknown>(
    path: string,
    options: RequestOptions = {},
    delay: number = 300,
  ): Promise<T> {
    const key = `${path}:${JSON.stringify(options)}`;

    return new Promise((resolve, reject) => {
      const existing = this.debounceTimers.get(key);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(async () => {
        try {
          const result = await this.fetch<T>(path, options);
          resolve(result);
          this.debounceTimers.delete(key);
        } catch (error) {
          reject(error);
          this.debounceTimers.delete(key);
        }
      }, delay);

      this.debounceTimers.set(key, timer);
    });
  }

  /**
   * Execute a request at most once per interval; returns cached data when throttled.
   *
   * @param path - API path / APIパス
   * @param options - Fetch options / フェッチオプション
   * @param interval - Minimum interval between calls in milliseconds / 最小呼び出し間隔（ミリ秒）
   * @returns Response typed as T / レスポンス
   * @throws {Error} When throttled and no cached data is available / スロットル中かつキャッシュなしの場合
   */
  async throttledFetch<T = unknown>(
    path: string,
    options: RequestOptions = {},
    interval: number = 1000,
  ): Promise<T> {
    const key = `${path}:${JSON.stringify(options)}`;
    const now = Date.now();
    const lastCall = this.throttleLastCall.get(key) || 0;

    if (now - lastCall < interval) {
      const cacheKey = `${options.method || 'GET'}:${API_BASE_URL}${path}:${JSON.stringify(options.body || {})}`;
      const cached = this.cache.get<T>(cacheKey);
      if (cached) return cached;
      throw new Error('Request throttled and no cache available');
    }

    this.throttleLastCall.set(key, now);
    return this.fetch<T>(path, options);
  }

  /**
   * Execute multiple named requests in parallel; individual failures do not abort others.
   *
   * @param requests - Map of result key to request descriptor / 結果キーとリクエスト定義のマップ
   * @returns Record keyed by request name; failures contain `{ error }` / リクエスト名をキーとするレコード
   */
  async parallelFetch<T extends Record<string, unknown>>(
    requests: Record<string, { path: string; options?: RequestOptions }>,
  ): Promise<T> {
    const entries = Object.entries(requests);
    const results = await Promise.allSettled(
      entries.map(([_, req]) => this.fetch(req.path, req.options)),
    );

    const response: Record<string, unknown> = {};
    entries.forEach(([key], index) => {
      const result = results[index];
      response[key] = result.status === 'fulfilled' ? result.value : { error: result.reason };
    });

    return response as T;
  }

  /**
   * Warm up the cache by pre-fetching a list of paths.
   *
   * @param paths - API paths to prefetch / プリフェッチするAPIパス一覧
   * @param cacheTime - TTL in milliseconds / ミリ秒単位のTTL
   */
  async prefetch(paths: string[], cacheTime?: number): Promise<void> {
    await Promise.allSettled(paths.map((path) => this.fetch(path, { cacheTime })));
  }

  /**
   * Clear cache entries matching a pattern, or clear all entries.
   *
   * @param pattern - Optional substring to match against cache keys / キャッシュキーに対するサブ文字列フィルター
   */
  clearCache(pattern?: string): void {
    this.cache.clear(pattern);
  }

  /**
   * Return aggregate cache statistics for diagnostics.
   *
   * @returns Size in bytes and per-entry metadata / バイト単位のサイズとエントリメタデータ
   */
  getCacheStats(): { size: number; entries: Array<{ key: string; size: number; age: number }> } {
    return this.cache.getStats();
  }

  /**
   * Low-level fetch with auth credentials and JSON content-type.
   *
   * Uses `offlineFetch` from lib/offline-queue so that write requests
   * (POST/PUT/PATCH/DELETE) are automatically queued in IndexedDB when
   * the network is unavailable and replayed when it comes back.
   * GET requests pass through to native fetch — they are not queued.
   *
   * When a mutation is queued offline, `offlineFetch` returns a synthetic
   * `202 Accepted` with body `{ queued: true }`. We detect this case and
   * return it as `T` (the caller will see a partial response, but the
   * mutation is durably persisted and will replay on reconnection).
   *
   * @param url - Full URL / 完全なURL
   * @param options - Fetch options / フェッチオプション
   * @returns Parsed JSON response / パース済みJSONレスポンス
   * @throws {Error} On non-2xx responses / 2xx以外のレスポンス時
   */
  private async performFetch<T>(url: string, options: RequestOptions): Promise<T> {
    const fetchInit: RequestInit = {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    // NOTE: offlineFetch relies on IndexedDB and navigator.onLine which
    // only exist in the browser. During SSR (Next.js server components)
    // fall back to native fetch — offline queuing is a client-only concern.
    let response: Response;
    if (typeof window !== 'undefined') {
      const method = (options.method || 'GET').toUpperCase();
      const pathname = (() => { try { return new URL(url).pathname; } catch { return url; } })();
      response = await offlineFetch(url, fetchInit, `${method} ${pathname}`);
    } else {
      response = await fetch(url, fetchInit);
    }

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`API Error: ${response.status} - ${error}`);
    }

    return response.json();
  }
}
