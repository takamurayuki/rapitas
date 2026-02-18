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
  body?: any;
};

type BatchResponse = {
  id: string;
  status: number;
  body: any;
  error?: string;
};

class APIClient {
  private cache = new Map<string, { data: any; timestamp: number }>();
  private pendingBatch: BatchRequest[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private batchResolvers = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }>();
  private requestQueue = new Map<string, Promise<any>>();

  // デバウンス用のマップ
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  // スロットリング用のマップ
  private throttleLastCall = new Map<string, number>();

  /**
   * 基本的なfetchラッパー（キャッシング付き）
   */
  async fetch<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = `${API_BASE_URL}${path}`;
    const cacheKey = `${options.method || 'GET'}:${url}:${JSON.stringify(options.body || {})}`;

    // キャッシュチェック
    if (!options.skipCache && options.method === 'GET') {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // 同一リクエストの重複排除
    const existingRequest = this.requestQueue.get(cacheKey);
    if (existingRequest) {
      return existingRequest;
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
  async batchFetch<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
    const id = Math.random().toString(36).substring(7);
    const request: BatchRequest = {
      id,
      method: options.method || 'GET',
      url: path,
      body: options.body
    };

    return new Promise((resolve, reject) => {
      this.batchResolvers.set(id, { resolve, reject });
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
  async debouncedFetch<T = any>(
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
  async throttledFetch<T = any>(
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
      const cached = this.getFromCache(cacheKey);
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
  async parallelFetch<T extends Record<string, any>>(
    requests: Record<string, { path: string; options?: RequestOptions }>
  ): Promise<T> {
    const entries = Object.entries(requests);
    const results = await Promise.allSettled(
      entries.map(([_, req]) => this.fetch(req.path, req.options))
    );

    const response: Record<string, any> = {};
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
        .forEach(key => this.cache.delete(key));
    } else {
      this.cache.clear();
    }
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
              body: request.body,
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
  private getFromCache(key: string): any | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > (cached.timestamp || 5 * 60 * 1000);
    if (isExpired) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * キャッシュに保存
   */
  private setCache(key: string, data: any, cacheTime: number = 5 * 60 * 1000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });

    // キャッシュサイズ制限（100エントリー）
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
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