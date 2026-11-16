// settings-cache — localStorage cache utilities for the settings page.
import { createLogger } from '@/lib/logger';
import { isDevHost } from '@/lib/dev-mode';

const logger = createLogger('settings-cache');

export const CACHE_KEYS = {
  settings: 'settings-cache',
  models: 'models-cache',
  apiKeys: 'api-keys-cache',
} as const;

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Read a time-stamped entry from localStorage.
 *
 * Returns null in development so code edits to the underlying API/UI are
 * reflected on every reload without manually clearing site data.
 *
 * @param key - localStorage key.
 * @returns Cached data or null if missing/expired/dev.
 */
export function getCachedData<T>(key: string): T | null {
  if (isDevHost()) return null;
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > CACHE_DURATION) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Write a time-stamped entry to localStorage.
 *
 * Skipped in development to avoid stale entries leaking into the next reload.
 *
 * @param key - localStorage key.
 * @param data - Data to persist.
 */
export function setCachedData<T>(key: string, data: T): void {
  if (isDevHost()) return;
  try {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (error) {
    logger.error('Failed to cache data:', error);
  }
}
