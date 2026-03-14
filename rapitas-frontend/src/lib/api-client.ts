/**
 * Optimized API client
 * Supports batch requests, caching, debouncing, and throttling
 */

import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ApiClient');

type RequestOptions = RequestInit & {
  skipCache?: boolean;
  cacheTime?: number; // milliseconds
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
  private cache = new Map<
    string,
    { data: unknown; timestamp: number; expiry: number }
  >();
  private localStorageKey = 'rapitas-api-cache';
  private persistentCacheEnabled = true;
  private pendingBatch: BatchRequest[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private batchResolvers = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
    }
  >();
  private requestQueue = new Map<string, Promise<unknown>>();

  // Map for debouncing
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  // Map for throttling
  private throttleLastCall = new Map<string, number>();

  constructor() {
    // Load persisted cache from localStorage on startup
    this.loadPersistentCache();
  }

  /**
   * Basic fetch wrapper with caching
   */
  async fetch<T = unknown>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = `${API_BASE_URL}${path}`;
    const cacheKey = `${options.method || 'GET'}:${url}:${JSON.stringify(options.body || {})}`;

    // Check cache (treat unspecified method as GET)
    if (!options.skipCache && (!options.method || options.method === 'GET')) {
      const cached = this.getFromCache<T>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Deduplicate identical requests
    const existingRequest = this.requestQueue.get(cacheKey);
    if (existingRequest) {
      return existingRequest as Promise<T>;
    }

    const request = this.performFetch<T>(url, options)
      .then((data) => {
        // Cache GET request results
        if (options.method === 'GET' || !options.method) {
          this.setCache(cacheKey, data, options.cacheTime);
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
   * Batch request
   * Combine multiple API requests into a single HTTP request
   */
  async batchFetch<T = unknown>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const id = Math.random().toString(36).substring(7);
    const request: BatchRequest = {
      id,
      method: options.method || 'GET',
      url: path,
      body: options.body,
    };

    return new Promise<T>((resolve, reject) => {
      this.batchResolvers.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pendingBatch.push(request);

      // Reset batch timer
      if (this.batchTimeout) {
        clearTimeout(this.batchTimeout);
      }

      // Wait 10ms before sending batch (wait for other requests)
      this.batchTimeout = setTimeout(() => {
        this.sendBatch();
      }, 10);
    });
  }

  /**
   * Debounced fetch
   * Execute only the last of consecutive identical requests
   */
  async debouncedFetch<T = unknown>(
    path: string,
    options: RequestOptions = {},
    delay: number = 300,
  ): Promise<T> {
    const key = `${path}:${JSON.stringify(options)}`;

    return new Promise((resolve, reject) => {
      // Cancel existing timer
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
   * Throttled fetch
   * Execute request only once within specified interval
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
      // Return previous result from cache if within interval
      const cacheKey = `${options.method || 'GET'}:${API_BASE_URL}${path}:${JSON.stringify(options.body || {})}`;
      const cached = this.getFromCache<T>(cacheKey);
      if (cached) {
        return cached;
      }
      // Error if no cache available
      throw new Error('Request throttled and no cache available');
    }

    this.throttleLastCall.set(key, now);
    return this.fetch<T>(path, options);
  }

  /**
   * Optimize parallel requests
   * Use Promise.allSettled so other requests continue even if some fail
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
      if (result.status === 'fulfilled') {
        response[key] = result.value;
      } else {
        response[key] = { error: result.reason };
      }
    });

    return response as T;
  }

  /**
   * Prefetch
   * Fetch data in advance and save to cache
   */
  async prefetch(paths: string[], cacheTime?: number): Promise<void> {
    await Promise.allSettled(
      paths.map((path) => this.fetch(path, { cacheTime })),
    );
  }

  /**
   * Clear cache
   */
  clearCache(pattern?: string): void {
    if (pattern) {
      Array.from(this.cache.keys())
        .filter((key) => key.includes(pattern))
        .forEach((key) => {
          this.cache.delete(key);
          this.removePersistentCacheEntry(key);
        });
    } else {
      this.cache.clear();
      // Delete all persisted cache too
      if (this.persistentCacheEnabled && typeof window !== 'undefined') {
        localStorage.removeItem(this.localStorageKey);
      }
    }
  }

  /**
   * Get cache statistics
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
   * Actual fetch processing
   */
  private async performFetch<T>(
    url: string,
    options: RequestOptions,
  ): Promise<T> {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
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
   * Send batch request
   */
  private async sendBatch(): Promise<void> {
    if (this.pendingBatch.length === 0) return;

    const batch = [...this.pendingBatch];
    this.pendingBatch = [];
    this.batchTimeout = null;

    try {
      const response = await fetch(`${API_BASE_URL}/batch`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests: batch }),
      });

      if (!response.ok) {
        throw new Error(`Batch request failed: ${response.status}`);
      }

      const results: BatchResponse[] = await response.json();

      // Send each request result to corresponding resolver
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
      // Retry as individual requests if entire batch fails
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
   * Get from cache
   */
  private getFromCache<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    // Check cache expiration
    const isExpired = Date.now() > cached.expiry;
    if (isExpired) {
      this.cache.delete(key);
      this.removePersistentCacheEntry(key);
      return null;
    }

    return cached.data as T;
  }

  /**
   * Save to cache
   */
  private setCache(
    key: string,
    data: unknown,
    cacheTime: number = 24 * 60 * 60 * 1000,
  ): void {
    // Default 24-hour cache (significantly extended from previous 5 minutes)
    const expiry = Date.now() + cacheTime;

    const cacheEntry = {
      data,
      timestamp: Date.now(),
      expiry,
    };

    this.cache.set(key, cacheEntry);

    // Persist (only important data like task details)
    if (this.persistentCacheEnabled && key.includes('/tasks/')) {
      this.savePersistentCacheEntry(key, cacheEntry);
    }

    // Cache size limit (increased to 200 entries)
    if (this.cache.size > 200) {
      // Delete oldest entry
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const oldestKey = entries[0][0];
      this.cache.delete(oldestKey);
      this.removePersistentCacheEntry(oldestKey);
    }
  }

  /**
   * Load persisted cache
   */
  private loadPersistentCache(): void {
    if (!this.persistentCacheEnabled || typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.localStorageKey);
      if (!stored) return;

      const persistentCache = JSON.parse(stored);
      const now = Date.now();

      // Load only valid cache entries to memory
      (
        Object.entries(persistentCache) as [
          string,
          { data: unknown; timestamp: number; expiry: number },
        ][]
      ).forEach(([key, entry]) => {
        if (entry.expiry > now) {
          this.cache.set(key, entry);
        }
      });

      // Cleanup expired entries
      this.cleanupPersistentCache();
    } catch (error) {
      logger.warn('Failed to load persistent cache:', error);
    }
  }

  /**
   * Persist single cache entry
   */
  private savePersistentCacheEntry(
    key: string,
    entry: { data: unknown; timestamp: number; expiry: number },
  ): void {
    if (!this.persistentCacheEnabled || typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.localStorageKey) || '{}';
      const persistentCache = JSON.parse(stored);

      // Save max 50 task detail caches
      const taskCacheKeys = Object.keys(persistentCache).filter((k) =>
        k.includes('/tasks/'),
      );
      if (taskCacheKeys.length >= 50) {
        // Delete from oldest
        const sorted = taskCacheKeys.sort(
          (a, b) => persistentCache[a].timestamp - persistentCache[b].timestamp,
        );
        delete persistentCache[sorted[0]];
      }

      persistentCache[key] = entry;
      localStorage.setItem(
        this.localStorageKey,
        JSON.stringify(persistentCache),
      );
    } catch (error) {
      // Cleanup on localStorage quota error
      if (
        error instanceof DOMException &&
        error.name === 'QuotaExceededError'
      ) {
        this.cleanupPersistentCache();
      }
      logger.warn('Failed to save persistent cache:', error);
    }
  }

  /**
   * Remove single cache entry from persistence
   */
  private removePersistentCacheEntry(key: string): void {
    if (!this.persistentCacheEnabled || typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.localStorageKey) || '{}';
      const persistentCache = JSON.parse(stored);
      delete persistentCache[key];
      localStorage.setItem(
        this.localStorageKey,
        JSON.stringify(persistentCache),
      );
    } catch (error) {
      logger.warn('Failed to remove persistent cache entry:', error);
    }
  }

  /**
   * Cleanup expired persisted cache
   */
  private cleanupPersistentCache(): void {
    if (!this.persistentCacheEnabled || typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.localStorageKey) || '{}';
      const persistentCache = JSON.parse(stored);
      const now = Date.now();

      type CacheEntry = { data: unknown; timestamp: number; expiry: number };
      const cleaned = Object.entries(persistentCache).reduce<
        Record<string, CacheEntry>
      >((acc, [key, entry]) => {
        const cacheEntry = entry as CacheEntry;
        if (cacheEntry.expiry > now) {
          acc[key] = cacheEntry;
        }
        return acc;
      }, {});

      localStorage.setItem(this.localStorageKey, JSON.stringify(cleaned));
    } catch (error) {
      logger.warn('Failed to cleanup persistent cache:', error);
    }
  }
}

// Singleton instance
export const apiClient = new APIClient();

// Export convenience functions
export const apiFetch = apiClient.fetch.bind(apiClient);
export const batchFetch = apiClient.batchFetch.bind(apiClient);
export const debouncedFetch = apiClient.debouncedFetch.bind(apiClient);
export const throttledFetch = apiClient.throttledFetch.bind(apiClient);
export const parallelFetch = apiClient.parallelFetch.bind(apiClient);
export const prefetch = apiClient.prefetch.bind(apiClient);
export const clearApiCache = apiClient.clearCache.bind(apiClient);
