/**
 * 高速化されたAPIクライアント
 * バッチリクエスト、キャッシング、デバウンス、スロットリングをサポート
 */

import { API_BASE_URL } from '@/utils/api';

type RequestOptions = RequestInit & {
  skipCache?: boolean;
  cacheTime?: number; // ミリ秒
};

type BatchRequest = {
  id: string;
  method: string;
  url: string;
  body?: unknown;
};

type BatchResponse = {
  id: string;
  status: number;
  body: unknown;
  error?: string;
};

class APIClient {
  private cache = new Map<string, { data: unknown; timestamp: number; expiry: number }>();
  private localStorageKey = 'rapitas-api-cache';
  private persistentCacheEnabled = true;
  private pendingBatch: BatchRequest[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private batchResolvers = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }>();
  private requestQueue = new Map<string, Promise<unknown>>();

  // デバウンス用のマップ
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  // スロットリング用のマップ
  private throttleLastCall = new Map<string, number>();

  constructor() {
    // 起動時にlocalStorageから永続化されたキャッシュを読み込む
    this.loadPersistentCache();
  }

  /**
   * 基本的なfetchラッパー（キャッシング付き）
   */
  async fetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = `${API_BASE_URL}${path}`;
    const cacheKey = `${options.method || 'GET'}:${url}:${JSON.stringify(options.body || {})}`;

    // キャッシュチェック（method未指定もGETとして扱う）
    if (!options.skipCache && (!options.method || options.method === 'GET')) {
      const cached = this.getFromCache<T>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // 同一リクエストの重複排除
    const existingRequest = this.requestQueue.get(cacheKey);
    if (existingRequest) {
      return existingRequest as Promise<T>;
    }

    const request = this.performFetch<T>(url, options).then((data) => {
      // GETリクエストの結果をキャッシュ
      if (options.method === 'GET' || !options.method) {
        this.setCache(cacheKey, data, options.cacheTime);
      }
      this.requestQueue.delete(cacheKey);
      return data;
    }).catch((error) => {
      this.requestQueue.delete(cacheKey);
      throw error;
    });

    this.requestQueue.set(cacheKey, request);
    return request;
  }

  /**
   * バッチリクエスト
   * 複数のAPIリクエストを1つのHTTPリクエストにまとめる
   */
  async batchFetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const id = Math.random().toString(36).substring(7);
    const request: BatchRequest = {
      id,
      method: options.method || 'GET',
      url: path,
      body: options.body
    };

    return new Promise<T>((resolve, reject) => {
      this.batchResolvers.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject
      });
      this.pendingBatch.push(request);

      // バッチタイマーをリセット
      if (this.batchTimeout) {
        clearTimeout(this.batchTimeout);
      }

      // 10ms待ってからバッチを送信（他のリクエストを待つ）
      this.batchTimeout = setTimeout(() => {
        this.sendBatch();
      }, 10);
    });
  }

  /**
   * デバウンス付きfetch
   * 連続した同じリクエストを最後の1つだけ実行
   */
  async debouncedFetch<T = unknown>(
    path: string,
    options: RequestOptions = {},
    delay: number = 300
  ): Promise<T> {
    const key = `${path}:${JSON.stringify(options)}`;

    return new Promise((resolve, reject) => {
      // 既存のタイマーをキャンセル
      const existingTimer = this.debounceTimers.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

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
   * スロットリング付きfetch
   * 一定時間内に1回だけリクエストを実行
   */
  async throttledFetch<T = unknown>(
    path: string,
    options: RequestOptions = {},
    interval: number = 1000
  ): Promise<T> {
    const key = `${path}:${JSON.stringify(options)}`;
    const now = Date.now();
    const lastCall = this.throttleLastCall.get(key) || 0;

    if (now - lastCall < interval) {
      // インターバル内の場合は前回の結果をキャッシュから返す
      const cacheKey = `${options.method || 'GET'}:${API_BASE_URL}${path}:${JSON.stringify(options.body || {})}`;
      const cached = this.getFromCache<T>(cacheKey);
      if (cached) {
        return cached;
      }
      // キャッシュがない場合はエラー
      throw new Error('Request throttled and no cache available');
    }

    this.throttleLastCall.set(key, now);
    return this.fetch<T>(path, options);
  }

  /**
   * 並列リクエストの最適化
   * Promise.allSettledを使用して、一部が失敗しても他のリクエストは継続
   */
  async parallelFetch<T extends Record<string, unknown>>(
    requests: Record<string, { path: string; options?: RequestOptions }>
  ): Promise<T> {
    const entries = Object.entries(requests);
    const results = await Promise.allSettled(
      entries.map(([_, req]) => this.fetch(req.path, req.options))
    );

    const response: Record<string, unknown> = {};
    entries.forEach(([key], index) => {
      const result = results[index];
      if (result.status === 'fulfilled') {
        response[key] = result.value;
      } else {
        response[key] = { error: result.reason };
      }
    });

    return response as T;
  }

  /**
   * プリフェッチ
   * 事前にデータを取得してキャッシュに保存
   */
  async prefetch(paths: string[], cacheTime?: number): Promise<void> {
    await Promise.allSettled(
      paths.map(path => this.fetch(path, { cacheTime }))
    );
  }

  /**
   * キャッシュクリア
   */
  clearCache(pattern?: string): void {
    if (pattern) {
      Array.from(this.cache.keys())
        .filter(key => key.includes(pattern))
        .forEach(key => {
          this.cache.delete(key);
          this.removePersistentCacheEntry(key);
        });
    } else {
      this.cache.clear();
      // 永続化キャッシュも全削除
      if (this.persistentCacheEnabled && typeof window !== 'undefined') {
        localStorage.removeItem(this.localStorageKey);
      }
    }
  }

  /**
   * キャッシュ統計情報を取得
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ key: string; size: number; age: number }>;
  } {
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      size: JSON.stringify(entry.data).length,
      age: Date.now() - entry.timestamp,
    }));

    return {
      size: entries.reduce((sum, e) => sum + e.size, 0),
      entries: entries.sort((a, b) => b.size - a.size),
    };
  }

  /**
   * 実際のfetch処理
   */
  private async performFetch<T>(url: string, options: RequestOptions): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`API Error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * バッチリクエストの送信
   */
  private async sendBatch(): Promise<void> {
    if (this.pendingBatch.length === 0) return;

    const batch = [...this.pendingBatch];
    this.pendingBatch = [];
    this.batchTimeout = null;

    try {
      const response = await fetch(`${API_BASE_URL}/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests: batch }),
      });

      if (!response.ok) {
        throw new Error(`Batch request failed: ${response.status}`);
      }

      const results: BatchResponse[] = await response.json();

      // 各リクエストの結果を対応するリゾルバーに送信
      results.forEach((result) => {
        const resolver = this.batchResolvers.get(result.id);
        if (resolver) {
          if (result.error) {
            resolver.reject(new Error(result.error));
          } else {
            resolver.resolve(result.body);
          }
          this.batchResolvers.delete(result.id);
        }
      });
    } catch (error) {
      // バッチ全体が失敗した場合、個別のリクエストとして再試行
      batch.forEach(async (request) => {
        const resolver = this.batchResolvers.get(request.id);
        if (resolver) {
          try {
            const result = await this.fetch(request.url, {
              method: request.method,
              body: request.body as BodyInit | undefined,
            });
            resolver.resolve(result);
          } catch (err) {
            resolver.reject(err);
          }
          this.batchResolvers.delete(request.id);
        }
      });
    }
  }

  /**
   * キャッシュから取得
   */
  private getFromCache<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    // キャッシュの有効期限をチェック
    const isExpired = Date.now() > cached.expiry;
    if (isExpired) {
      this.cache.delete(key);
      this.removePersistentCacheEntry(key);
      return null;
    }

    return cached.data as T;
  }

  /**
   * キャッシュに保存
   */
  private setCache(key: string, data: unknown, cacheTime: number = 24 * 60 * 60 * 1000): void {
    // デフォルトで24時間キャッシュ（従来の5分から大幅延長）
    const expiry = Date.now() + cacheTime;

    const cacheEntry = {
      data,
      timestamp: Date.now(),
      expiry
    };

    this.cache.set(key, cacheEntry);

    // 永続化（タスク詳細などの重要なデータのみ）
    if (this.persistentCacheEnabled && key.includes('/tasks/')) {
      this.savePersistentCacheEntry(key, cacheEntry);
    }

    // キャッシュサイズ制限（200エントリーに増加）
    if (this.cache.size > 200) {
      // 最も古いエントリーを削除
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const oldestKey = entries[0][0];
      this.cache.delete(oldestKey);
      this.removePersistentCacheEntry(oldestKey);
    }
  }

  /**
   * 永続化されたキャッシュを読み込む
   */
  private loadPersistentCache(): void {
    if (!this.persistentCacheEnabled || typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.localStorageKey);
      if (!stored) return;

      const persistentCache = JSON.parse(stored);
      const now = Date.now();

      // 有効なキャッシュエントリーのみメモリに読み込む
      Object.entries(persistentCache).forEach(([key, entry]: [string, any]) => {
        if (entry.expiry > now) {
          this.cache.set(key, entry);
        }
      });

      // 期限切れのエントリーをクリーンアップ
      this.cleanupPersistentCache();
    } catch (error) {
      console.warn('Failed to load persistent cache:', error);
    }
  }

  /**
   * 単一のキャッシュエントリーを永続化
   */
  private savePersistentCacheEntry(key: string, entry: { data: unknown; timestamp: number; expiry: number }): void {
    if (!this.persistentCacheEnabled || typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.localStorageKey) || '{}';
      const persistentCache = JSON.parse(stored);

      // タスク詳細キャッシュは最大50個まで保存
      const taskCacheKeys = Object.keys(persistentCache).filter(k => k.includes('/tasks/'));
      if (taskCacheKeys.length >= 50) {
        // 最も古いものから削除
        const sorted = taskCacheKeys.sort((a, b) =>
          persistentCache[a].timestamp - persistentCache[b].timestamp
        );
        delete persistentCache[sorted[0]];
      }

      persistentCache[key] = entry;
      localStorage.setItem(this.localStorageKey, JSON.stringify(persistentCache));
    } catch (error) {
      // localStorage容量エラーの場合はクリーンアップ
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        this.cleanupPersistentCache();
      }
      console.warn('Failed to save persistent cache:', error);
    }
  }

  /**
   * 単一のキャッシュエントリーを永続化から削除
   */
  private removePersistentCacheEntry(key: string): void {
    if (!this.persistentCacheEnabled || typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.localStorageKey) || '{}';
      const persistentCache = JSON.parse(stored);
      delete persistentCache[key];
      localStorage.setItem(this.localStorageKey, JSON.stringify(persistentCache));
    } catch (error) {
      console.warn('Failed to remove persistent cache entry:', error);
    }
  }

  /**
   * 期限切れの永続化キャッシュをクリーンアップ
   */
  private cleanupPersistentCache(): void {
    if (!this.persistentCacheEnabled || typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.localStorageKey) || '{}';
      const persistentCache = JSON.parse(stored);
      const now = Date.now();

      const cleaned = Object.entries(persistentCache).reduce((acc, [key, entry]: [string, any]) => {
        if (entry.expiry > now) {
          acc[key] = entry;
        }
        return acc;
      }, {} as Record<string, any>);

      localStorage.setItem(this.localStorageKey, JSON.stringify(cleaned));
    } catch (error) {
      console.warn('Failed to cleanup persistent cache:', error);
    }
  }
}

// シングルトンインスタンス
export const apiClient = new APIClient();

// 便利な関数をエクスポート
export const apiFetch = apiClient.fetch.bind(apiClient);
export const batchFetch = apiClient.batchFetch.bind(apiClient);
export const debouncedFetch = apiClient.debouncedFetch.bind(apiClient);
export const throttledFetch = apiClient.throttledFetch.bind(apiClient);
export const parallelFetch = apiClient.parallelFetch.bind(apiClient);
export const prefetch = apiClient.prefetch.bind(apiClient);
export const clearApiCache = apiClient.clearCache.bind(apiClient);