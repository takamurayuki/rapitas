/**
 * Cache warmup processing
 * Pre-cache important data on application startup
 */

import { apiClient } from './api-client';
import { cacheManager } from './cache-utils';
import { createLogger } from '@/lib/logger';

const logger = createLogger('CacheWarmup');

/**
 * Cache warmup on application startup
 */
export async function warmupApplicationCache(): Promise<void> {
  logger.info('[Cache] Starting application cache warmup...');

  try {
    // Fetch recently accessed task IDs (from localStorage)
    const recentTaskIds = getRecentTaskIds();

    // Pre-cache user settings (6 hours)
    await apiClient.fetch('/settings', {
      cacheTime: 6 * 60 * 60 * 1000,
    });

    // Pre-cache frequently used categories and labels (24 hours)
    const coreEndpoints = [
      '/categories',
      '/labels',
      '/themes',
      '/agents',
      '/templates',
    ];

    await Promise.allSettled(
      coreEndpoints.map((endpoint) =>
        apiClient.fetch(endpoint, {
          cacheTime: 24 * 60 * 60 * 1000,
        }),
      ),
    );

    // Preload recently accessed tasks (24 hour cache)
    if (recentTaskIds.length > 0) {
      const taskPrefetchPromises = recentTaskIds.slice(0, 10).map((id) =>
        apiClient.fetch(`/tasks/${id}`, {
          cacheTime: 24 * 60 * 60 * 1000,
        }),
      );

      await Promise.allSettled(taskPrefetchPromises);
    }

    // Pre-cache active tasks (todo and progress) (12 hours)
    await apiClient.fetch('/tasks?status=todo,progress', {
      cacheTime: 12 * 60 * 60 * 1000,
    });

    logger.info('[Cache] Application cache warmup completed');
  } catch (error) {
    logger.warn('[Cache] Warmup error (non-critical):', error);
  }
}

/**
 * Fetch recently accessed task IDs
 */
function getRecentTaskIds(): number[] {
  try {
    const stored = localStorage.getItem('rapitas-recent-tasks');
    if (!stored) return [];

    const recentTasks = JSON.parse(stored);
    return recentTasks.ids || [];
  } catch {
    return [];
  }
}

/**
 * Record recently accessed task ID
 */
export function recordTaskAccess(taskId: number): void {
  try {
    const stored = localStorage.getItem('rapitas-recent-tasks') || '{}';
    const recentTasks = JSON.parse(stored);

    const ids: number[] = recentTasks.ids || [];

    // Delete existing ID and add to front
    const filteredIds = ids.filter((id) => id !== taskId);
    filteredIds.unshift(taskId);

    // Keep max 20 items
    const limitedIds = filteredIds.slice(0, 20);

    localStorage.setItem(
      'rapitas-recent-tasks',
      JSON.stringify({
        ids: limitedIds,
        updatedAt: Date.now(),
      }),
    );
  } catch (error) {
    logger.warn('Failed to record task access:', error);
  }
}

/**
 * Fetch cache statistics
 */
export async function getCacheStatistics() {
  const apiStats = apiClient.getCacheStats?.() || { size: 0, entries: [] };
  const cacheManagerStats = cacheManager.getCacheStats();

  return {
    apiClient: apiStats,
    cacheManager: cacheManagerStats,
    totalSize: apiStats.size + cacheManagerStats.size,
    totalEntries: apiStats.entries.length + cacheManagerStats.entries.length,
  };
}

/**
 * Cache cleanup (remove expired data)
 */
export function cleanupExpiredCache(): void {
  // API client cache cleanup is done automatically

  // Cleanup persisted cache
  try {
    const stored = localStorage.getItem('rapitas-api-cache');
    if (!stored) return;

    const persistentCache = JSON.parse(stored);
    const now = Date.now();

    interface PersistentCacheEntry {
      data: unknown;
      timestamp: number;
      expiry: number;
    }

    const cleaned = Object.entries(persistentCache).reduce<
      Record<string, PersistentCacheEntry>
    >((acc, [key, entry]) => {
      const cacheEntry = entry as PersistentCacheEntry;
      if (cacheEntry.expiry > now) {
        acc[key] = cacheEntry;
      }
      return acc;
    }, {});

    localStorage.setItem('rapitas-api-cache', JSON.stringify(cleaned));
  } catch (error) {
    logger.warn('Failed to cleanup cache:', error);
  }
}
