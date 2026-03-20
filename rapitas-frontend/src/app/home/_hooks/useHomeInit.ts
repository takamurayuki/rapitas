/**
 * useHomeInit
 *
 * Handles one-time initial data load for the home page on mount.
 * Fetches tasks, filter data, global settings, and statistics in parallel
 * with a 15-second timeout guard. Sets the default category based on
 * user settings or the first available category.
 */
'use client';
import { useEffect, useState } from 'react';
import type { UserSettings } from '@/types';
import { apiFetch } from '@/lib/api-client';
import { fetchTaskStatistics } from '@/lib/task-api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useHomeInit');
const INITIAL_LOAD_TIMEOUT = 15000;

interface UseHomeInitParams {
  taskCacheInitialized: boolean;
  fetchAllTasks: () => Promise<void>;
  fetchTaskUpdates: () => Promise<void>;
  initializeFilterData: () => Promise<void>;
  categoryFilter: number | null;
  categories: { id: number }[];
  setCategoryFilter: (id: number) => void;
  setGlobalSettings: (settings: UserSettings | null) => void;
}

/**
 * Runs the one-time home page initialization on mount.
 * Returns hasInitialized so callers can guard subsequent runs.
 *
 * @param params - Dependencies needed to bootstrap data.
 * @returns hasInitialized flag.
 */
export function useHomeInit({
  taskCacheInitialized,
  fetchAllTasks,
  fetchTaskUpdates,
  initializeFilterData,
  categoryFilter,
  categories,
  setCategoryFilter,
  setGlobalSettings,
}: UseHomeInitParams) {
  const [hasInitialized, setHasInitialized] = useState(false);

  // NOTE: Empty dep array is intentional — runs only once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (hasInitialized) return;

    const initialLoad = async () => {
      const requests = {
        tasks: taskCacheInitialized ? fetchTaskUpdates() : fetchAllTasks(),
        filterData: initializeFilterData(),
        settings: apiFetch<UserSettings>('/settings', { cacheTime: 300000 })
          .then((d) => { setGlobalSettings(d); return d; })
          .catch((e) => {
            logger.transientError('Failed to fetch settings:', e);
            return null;
          }),
        statistics: fetchTaskStatistics(),
      };

      let results: PromiseSettledResult<unknown>[];
      try {
        results = (await Promise.race([
          Promise.allSettled(Object.values(requests)),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), INITIAL_LOAD_TIMEOUT),
          ),
        ])) as PromiseSettledResult<unknown>[];
      } catch {
        logger.warn('Initial data load timed out — API may be unreachable');
        results = Object.values(requests).map(() => ({
          status: 'rejected' as const,
          reason: new Error('timeout'),
        }));
      }

      const [, , settingsResult] = results;
      const settings =
        settingsResult.status === 'fulfilled'
          ? (settingsResult.value as UserSettings)
          : null;

      if (categoryFilter === null) {
        if (settings?.defaultCategoryId) {
          setCategoryFilter(settings.defaultCategoryId);
        } else if (categories.length > 0) {
          setCategoryFilter(categories[0].id);
        }
      }
      setHasInitialized(true);
    };

    initialLoad();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { hasInitialized };
}
