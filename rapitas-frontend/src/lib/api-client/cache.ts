/**
 * ApiClientCache
 *
 * In-memory and localStorage-backed cache for API responses.
 * Handles expiry, eviction, and persistence scoped to task detail entries.
 */

import { createLogger } from '@/lib/logger';
import type { CacheEntry } from './types';

const logger = createLogger('ApiClientCache');

export class ApiClientCache {
  private cache = new Map<string, CacheEntry>();
  private readonly localStorageKey = 'rapitas-api-cache';
  private readonly persistentCacheEnabled = true;

  constructor() {
    this.loadPersistentCache();
  }

  /**
   * Retrieve a non-expired entry from the cache.
   *
   * @param key - Cache key / キャッシュキー
   * @returns Typed value or null when missing or expired / 存在しない・期限切れの場合はnull
   */
  get<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (Date.now() > cached.expiry) {
      this.cache.delete(key);
      this.removePersistentEntry(key);
      return null;
    }

    return cached.data as T;
  }

  /**
   * Store a value in the cache with an optional TTL.
   *
   * @param key - Cache key / キャッシュキー
   * @param data - Value to store / 保存する値
   * @param cacheTime - TTL in milliseconds; defaults to 24 hours / ミリ秒単位のTTL（デフォルト24時間）
   */
  set(key: string, data: unknown, cacheTime: number = 24 * 60 * 60 * 1000): void {
    // Default 24-hour cache (significantly extended from previous 5 minutes)
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      expiry: Date.now() + cacheTime,
    };

    this.cache.set(key, entry);

    // Persist only task-detail entries to avoid over-filling localStorage
    if (this.persistentCacheEnabled && key.includes('/tasks/')) {
      this.savePersistentEntry(key, entry);
    }

    // Evict oldest entry when cache exceeds 200 items
    if (this.cache.size > 200) {
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const oldestKey = entries[0][0];
      this.cache.delete(oldestKey);
      this.removePersistentEntry(oldestKey);
    }
  }

  /**
   * Delete cache entries whose keys contain the given pattern, or clear all.
   *
   * @param pattern - Optional substring filter / 任意のサブ文字列フィルター
   */
  clear(pattern?: string): void {
    if (pattern) {
      Array.from(this.cache.keys())
        .filter((key) => key.includes(pattern))
        .forEach((key) => {
          this.cache.delete(key);
          this.removePersistentEntry(key);
        });
    } else {
      this.cache.clear();
      if (this.persistentCacheEnabled && typeof window !== 'undefined') {
        localStorage.removeItem(this.localStorageKey);
      }
    }
  }

  /**
   * Return aggregate size and per-entry metadata for diagnostics.
   *
   * @returns Cache statistics object / キャッシュ統計オブジェクト
   */
  getStats(): { size: number; entries: Array<{ key: string; size: number; age: number }> } {
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

  private loadPersistentCache(): void {
    if (!this.persistentCacheEnabled || typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.localStorageKey);
      if (!stored) return;

      const persistentCache = JSON.parse(stored) as Record<string, CacheEntry>;
      const now = Date.now();

      Object.entries(persistentCache).forEach(([key, entry]) => {
        if (entry.expiry > now) {
          this.cache.set(key, entry);
        }
      });

      this.cleanupPersistentCache();
    } catch (error) {
      logger.warn('Failed to load persistent cache:', error);
    }
  }

  private savePersistentEntry(key: string, entry: CacheEntry): void {
    if (!this.persistentCacheEnabled || typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.localStorageKey) || '{}';
      const persistentCache = JSON.parse(stored) as Record<string, CacheEntry>;

      // Cap task-detail entries at 50 to avoid quota exhaustion
      const taskKeys = Object.keys(persistentCache).filter((k) => k.includes('/tasks/'));
      if (taskKeys.length >= 50) {
        const sorted = taskKeys.sort(
          (a, b) => persistentCache[a].timestamp - persistentCache[b].timestamp,
        );
        delete persistentCache[sorted[0]];
      }

      persistentCache[key] = entry;
      localStorage.setItem(this.localStorageKey, JSON.stringify(persistentCache));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        this.cleanupPersistentCache();
      }
      logger.warn('Failed to save persistent cache:', error);
    }
  }

  private removePersistentEntry(key: string): void {
    if (!this.persistentCacheEnabled || typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.localStorageKey) || '{}';
      const persistentCache = JSON.parse(stored) as Record<string, CacheEntry>;
      delete persistentCache[key];
      localStorage.setItem(this.localStorageKey, JSON.stringify(persistentCache));
    } catch (error) {
      logger.warn('Failed to remove persistent cache entry:', error);
    }
  }

  private cleanupPersistentCache(): void {
    if (!this.persistentCacheEnabled || typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.localStorageKey) || '{}';
      const persistentCache = JSON.parse(stored) as Record<string, CacheEntry>;
      const now = Date.now();

      const cleaned = Object.entries(persistentCache).reduce<Record<string, CacheEntry>>(
        (acc, [key, entry]) => {
          if (entry.expiry > now) acc[key] = entry;
          return acc;
        },
        {},
      );

      localStorage.setItem(this.localStorageKey, JSON.stringify(cleaned));
    } catch (error) {
      logger.warn('Failed to cleanup persistent cache:', error);
    }
  }
}
