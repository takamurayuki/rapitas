/**
 * キャッシュのウォームアップ処理
 * アプリケーション起動時に重要なデータを事前キャッシュ
 */

import { apiClient } from './api-client';
import { cacheManager } from './cache-utils';

/**
 * アプリケーション起動時のキャッシュウォームアップ
 */
export async function warmupApplicationCache(): Promise<void> {
  console.log('[Cache] Starting application cache warmup...');

  try {
    // 最近アクセスしたタスクのIDを取得（localStorageから）
    const recentTaskIds = getRecentTaskIds();

    // ユーザー設定を事前キャッシュ（6時間）
    await apiClient.fetch('/settings', {
      cacheTime: 6 * 60 * 60 * 1000,
    });

    // よく使うカテゴリやラベルを事前キャッシュ（24時間）
    const coreEndpoints = [
      '/categories',
      '/labels',
      '/themes',
      '/agents',
      '/templates',
    ];

    await Promise.allSettled(
      coreEndpoints.map(endpoint =>
        apiClient.fetch(endpoint, {
          cacheTime: 24 * 60 * 60 * 1000,
        })
      )
    );

    // 最近アクセスしたタスクをプリロード（24時間キャッシュ）
    if (recentTaskIds.length > 0) {
      const taskPrefetchPromises = recentTaskIds.slice(0, 10).map(id =>
        apiClient.fetch(`/tasks/${id}`, {
          cacheTime: 24 * 60 * 60 * 1000,
        })
      );

      await Promise.allSettled(taskPrefetchPromises);
    }

    // アクティブなタスク（todoとprogress）を事前キャッシュ（12時間）
    await apiClient.fetch('/tasks?status=todo,progress', {
      cacheTime: 12 * 60 * 60 * 1000,
    });

    console.log('[Cache] Application cache warmup completed');
  } catch (error) {
    console.warn('[Cache] Warmup error (non-critical):', error);
  }
}

/**
 * 最近アクセスしたタスクIDを取得
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
 * 最近アクセスしたタスクIDを記録
 */
export function recordTaskAccess(taskId: number): void {
  try {
    const stored = localStorage.getItem('rapitas-recent-tasks') || '{}';
    const recentTasks = JSON.parse(stored);

    const ids: number[] = recentTasks.ids || [];

    // 既存のIDを削除して先頭に追加
    const filteredIds = ids.filter(id => id !== taskId);
    filteredIds.unshift(taskId);

    // 最大20個まで保持
    const limitedIds = filteredIds.slice(0, 20);

    localStorage.setItem('rapitas-recent-tasks', JSON.stringify({
      ids: limitedIds,
      updatedAt: Date.now(),
    }));
  } catch (error) {
    console.warn('Failed to record task access:', error);
  }
}

/**
 * キャッシュ統計情報の取得
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
 * キャッシュのクリーンアップ（期限切れデータの削除）
 */
export function cleanupExpiredCache(): void {
  // APIクライアントのキャッシュクリーンアップは自動で行われる

  // 永続化されたキャッシュのクリーンアップ
  try {
    const stored = localStorage.getItem('rapitas-api-cache');
    if (!stored) return;

    const persistentCache = JSON.parse(stored);
    const now = Date.now();

    const cleaned = Object.entries(persistentCache).reduce((acc, [key, entry]: [string, any]) => {
      if (entry.expiry > now) {
        acc[key] = entry;
      }
      return acc;
    }, {} as Record<string, any>);

    localStorage.setItem('rapitas-api-cache', JSON.stringify(cleaned));
  } catch (error) {
    console.warn('Failed to cleanup cache:', error);
  }
}