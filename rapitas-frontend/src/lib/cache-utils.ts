/**
 * Utility for HTTP cache and ETag management
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('CacheUtils');

interface CacheEntry<T = unknown> {
  etag?: string;
  lastModified?: string;
  data: T;
  timestamp: number;
}

class CacheManager {
  private etagCache = new Map<string, CacheEntry<unknown>>();
  private cacheVersion = '1.0';

  /**
   * Conditional request using ETag
   */
  async fetchWithETag<T = unknown>(
    url: string,
    options: RequestInit = {},
  ): Promise<{ data: T; fromCache: boolean }> {
    const cacheKey = `${url}:${JSON.stringify(options.body || {})}`;
    const cached = this.etagCache.get(cacheKey);

    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
    };

    // Add conditional headers if cache exists
    if (cached) {
      if (cached.etag) {
        headers['If-None-Match'] = cached.etag;
      }
      if (cached.lastModified) {
        headers['If-Modified-Since'] = cached.lastModified;
      }
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      // 304 Not Modified - use cache
      if (response.status === 304 && cached) {
        return { data: cached.data as T, fromCache: true };
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Save new ETag information
      const etag = response.headers.get('ETag');
      const lastModified = response.headers.get('Last-Modified');

      if (etag || lastModified) {
        this.etagCache.set(cacheKey, {
          etag: etag || undefined,
          lastModified: lastModified || undefined,
          data,
          timestamp: Date.now(),
        });
      }

      return { data, fromCache: false };
    } catch (error) {
      // Use cache if available on network error
      if (cached && this.isCacheValid(cached)) {
        logger.warn('Network error, using cached data:', error);
        return { data: cached.data as T, fromCache: true };
      }
      throw error;
    }
  }

  /**
   * Cache strategy for Service Worker
   */
  async applyCacheStrategy<T = unknown>(
    url: string,
    strategy: 'cache-first' | 'network-first' | 'stale-while-revalidate' = 'network-first',
    options: RequestInit = {},
  ): Promise<T> {
    const cacheKey = `${url}:${JSON.stringify(options.body || {})}`;
    const cached = this.etagCache.get(cacheKey);

    switch (strategy) {
      case 'cache-first':
        // Use cache if available, otherwise network
        if (cached && this.isCacheValid(cached)) {
          return cached.data as T;
        }
        return this.fetchAndCache(url, cacheKey, options);

      case 'network-first':
        // Prioritize network, use cache if fails
        try {
          return await this.fetchAndCache(url, cacheKey, options);
        } catch (error) {
          if (cached && this.isCacheValid(cached)) {
            return cached.data as T;
          }
          throw error;
        }

      case 'stale-while-revalidate':
        // Return stale data immediately, update in background
        if (cached) {
          // Update in background
          this.fetchAndCache(url, cacheKey, options).catch((err) => logger.error(err));
          return cached.data as T;
        }
        return this.fetchAndCache(url, cacheKey, options);
    }
  }

  /**
   * Preload and warmup
   */
  async warmupCache(urls: string[]): Promise<void> {
    await Promise.allSettled(
      urls.map((url) =>
        this.fetchWithETag(url).catch((err) =>
          logger.warn(`Failed to warmup cache for ${url}:`, err),
        ),
      ),
    );
  }

  /**
   * Cache validity check
   */
  private isCacheValid(entry: CacheEntry, maxAge: number = 5 * 60 * 1000): boolean {
    return Date.now() - entry.timestamp < maxAge;
  }

  /**
   * Fetch data and cache
   */
  private async fetchAndCache<T = unknown>(
    url: string,
    cacheKey: string,
    options: RequestInit,
  ): Promise<T> {
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const etag = response.headers.get('ETag');
    const lastModified = response.headers.get('Last-Modified');

    this.etagCache.set(cacheKey, {
      etag: etag || undefined,
      lastModified: lastModified || undefined,
      data,
      timestamp: Date.now(),
    });

    return data;
  }

  /**
   * Clear cache
   */
  clearCache(pattern?: RegExp): void {
    if (pattern) {
      Array.from(this.etagCache.keys())
        .filter((key) => pattern.test(key))
        .forEach((key) => this.etagCache.delete(key));
    } else {
      this.etagCache.clear();
    }
  }

  /**
   * Cache statistics
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ key: string; size: number; age: number }>;
  } {
    const entries = Array.from(this.etagCache.entries()).map(([key, entry]) => ({
      key,
      size: JSON.stringify(entry.data).length,
      age: Date.now() - entry.timestamp,
    }));

    return {
      size: entries.reduce((sum, e) => sum + e.size, 0),
      entries: entries.sort((a, b) => b.size - a.size),
    };
  }
}

export const cacheManager = new CacheManager();

/**
 * Optimize compression and encoding
 */
export function enableCompressionHeaders(headers: HeadersInit = {}): HeadersInit {
  return {
    ...headers,
    'Accept-Encoding': 'gzip, deflate, br',
  };
}

/**
 * Keep-Alive and connection pooling
 */
export function enableConnectionPooling(headers: HeadersInit = {}): HeadersInit {
  return {
    ...headers,
    Connection: 'keep-alive',
  };
}

/**
 * Optimize response size
 */
export function requestPartialFields(fields: string[]): string {
  return `?fields=${fields.join(',')}`;
}

/**
 * Versioning and cache busting
 */
export function addCacheVersion(url: string, version: string = '1.0'): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${version}`;
}
