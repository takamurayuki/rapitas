import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Category, Theme } from '@/types';
import { apiFetch, clearApiCache } from '@/lib/api-client';
import { createLogger } from '@/lib/logger';
const logger = createLogger('filterDataStore');

interface FilterDataState {
  // Data
  categories: Category[];
  themes: Theme[];

  // State management
  lastUpdated: number | null;
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;

  // Cache settings
  cacheExpireTime: number; // milliseconds (default: 1 hour)
}

interface FilterDataActions {
  // Initialize/update
  initializeData: () => Promise<void>;
  refreshData: (force?: boolean) => Promise<void>;

  // Data setters
  setCategories: (categories: Category[]) => void;
  setThemes: (themes: Theme[]) => void;

  // Cache management
  clearCache: () => void;
  isDataFresh: () => boolean;
  shouldBackgroundRefresh: () => boolean;
  backgroundRefresh: () => Promise<void>;

  // Error handling
  setError: (error: string | null) => void;
  clearError: () => void;
}

type FilterDataStore = FilterDataState & FilterDataActions;

// Default cache expiration (1 hour)
const DEFAULT_CACHE_EXPIRE_TIME = 60 * 60 * 1000;

// Background refresh threshold (start refresh when 80% of expiration elapsed)
const BACKGROUND_REFRESH_THRESHOLD = 0.8;

// Retry settings
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second

// Timeout settings
const FETCH_TIMEOUT = 10000; // 10 seconds

/**
 * Utility function to wait for specified duration
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch function with timeout
 */
const fetchWithTimeout = async <T>(
  fetchFn: () => Promise<T>,
  timeout: number,
): Promise<T> => {
  const timeoutPromise = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out')), timeout),
  );

  return Promise.race([fetchFn(), timeoutPromise]);
};

/**
 * API call with retry
 */
const fetchWithRetry = async <T>(
  fetchFn: () => Promise<T>,
  attempts: number = RETRY_ATTEMPTS,
  delayMs: number = RETRY_DELAY,
): Promise<T> => {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchWithTimeout(fetchFn, FETCH_TIMEOUT);
    } catch (error) {
      logger.warn(`Fetch attempt ${i + 1} failed:`, error);

      if (i === attempts - 1) {
        throw error;
      }

      // Wait with exponential backoff
      await delay(delayMs * Math.pow(2, i));
    }
  }
  throw new Error('All retry attempts failed');
};

export const useFilterDataStore = create<FilterDataStore>()(
  persist(
    (set, get) => ({
      categories: [],
      themes: [],
      lastUpdated: null,
      isInitialized: false,
      isLoading: false,
      error: null,
      cacheExpireTime: DEFAULT_CACHE_EXPIRE_TIME,

      initializeData: async () => {
        const state = get();

        // Skip if already initialized and data is fresh
        if (state.isInitialized && state.isDataFresh()) {
          logger.debug('[filterDataStore] initializeData: Using cached data');
          return;
        }

        logger.info(
          '[filterDataStore] initializeData: Starting initialization',
        );
        set({ isLoading: true, error: null });

        try {
          // Fetch categories and themes in parallel
          const [categoriesResult, themesResult] = await Promise.allSettled([
            fetchWithRetry(() =>
              apiFetch<Category[]>('/categories', { cacheTime: 300000 }),
            ),
            fetchWithRetry(() =>
              apiFetch<Theme[]>('/themes', { cacheTime: 300000 }),
            ),
          ]);

          // Process category results
          if (categoriesResult.status === 'fulfilled') {
            set({ categories: categoriesResult.value });
          } else {
            logger.error(
              '[filterDataStore] Categories fetch failed:',
              categoriesResult.reason,
            );
            throw new Error(
              `Categories fetch failed: ${categoriesResult.reason.message}`,
            );
          }

          // Process theme results
          if (themesResult.status === 'fulfilled') {
            set({ themes: themesResult.value });
          } else {
            logger.error(
              '[filterDataStore] Themes fetch failed:',
              themesResult.reason,
            );
            throw new Error(
              `Themes fetch failed: ${themesResult.reason.message}`,
            );
          }

          logger.info(
            `[filterDataStore] initializeData: Success - Categories: ${categoriesResult.status === 'fulfilled' ? categoriesResult.value.length : 0}, Themes: ${themesResult.status === 'fulfilled' ? themesResult.value.length : 0}`,
          );

          set({
            lastUpdated: Date.now(),
            isInitialized: true,
            isLoading: false,
            error: null,
          });
        } catch (error) {
          logger.error('[filterDataStore] initializeData error:', error);
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error occurred';

          const hasCachedData =
            state.categories.length > 0 || state.themes.length > 0;
          set({
            isLoading: false,
            // NOTE: Suppress error display when cached data is available (e.g., during server restart).
            // The user already has usable data; showing an error card is disruptive.
            error: hasCachedData
              ? null
              : `Failed to load filter data: ${errorMessage}`,
            isInitialized: hasCachedData,
          });
        }
      },

      refreshData: async (force = false) => {
        const state = get();

        // Skip if data is fresh and not force-updating
        if (!force && state.isDataFresh()) {
          logger.debug(
            '[filterDataStore] refreshData: Data is fresh, skipping refresh',
          );
          return;
        }

        if (force) {
          logger.info(
            '[filterDataStore] refreshData: Force refresh - clearing caches',
          );
          // Also clear api-client cache
          clearApiCache('/categories');
          clearApiCache('/themes');
          // Reset lastUpdated to bypass freshness check in initializeData
          set({ lastUpdated: null, isInitialized: false });
        }

        logger.debug(
          `[filterDataStore] refreshData: Starting refresh (force: ${force})`,
        );
        return get().initializeData();
      },

      setCategories: (categories) => {
        logger.debug(
          `[filterDataStore] setCategories: Setting ${categories.length} categories`,
        );
        set({ categories });
      },

      setThemes: (themes) => {
        logger.debug(
          `[filterDataStore] setThemes: Setting ${themes.length} themes`,
        );
        set({ themes });
      },

      clearCache: () => {
        logger.info('[filterDataStore] clearCache: Clearing all cache');
        set({
          categories: [],
          themes: [],
          lastUpdated: null,
          isInitialized: false,
          error: null,
        });
      },

      // Check data freshness
      isDataFresh: () => {
        const state = get();
        if (!state.lastUpdated) return false;

        const now = Date.now();
        const isExpired = now - state.lastUpdated > state.cacheExpireTime;

        logger.debug(
          `[filterDataStore] isDataFresh: ${!isExpired} (age: ${Math.round((now - state.lastUpdated) / 1000)}s, limit: ${Math.round(state.cacheExpireTime / 1000)}s)`,
        );

        return !isExpired;
      },

      // Check if background update is needed
      shouldBackgroundRefresh: () => {
        const state = get();
        if (!state.lastUpdated || state.isLoading) return false;

        const now = Date.now();
        const age = now - state.lastUpdated;
        const threshold = state.cacheExpireTime * BACKGROUND_REFRESH_THRESHOLD;

        const shouldRefresh = age > threshold;

        logger.debug(
          `[filterDataStore] shouldBackgroundRefresh: ${shouldRefresh} (age: ${Math.round(age / 1000)}s, threshold: ${Math.round(threshold / 1000)}s)`,
        );

        return shouldRefresh;
      },

      // Background update (transparent to user)
      backgroundRefresh: async () => {
        const state = get();
        logger.debug(
          '[filterDataStore] backgroundRefresh: Starting background update',
        );

        try {
          // Fetch categories and themes in parallel (don't change loading state)
          const [categoriesResult, themesResult] = await Promise.allSettled([
            fetchWithRetry(() =>
              apiFetch<Category[]>('/categories', { cacheTime: 300000 }),
            ),
            fetchWithRetry(() =>
              apiFetch<Theme[]>('/themes', { cacheTime: 300000 }),
            ),
          ]);

          let hasUpdates = false;

          // Process category results
          if (categoriesResult.status === 'fulfilled') {
            set({ categories: categoriesResult.value });
            hasUpdates = true;
          } else {
            logger.warn(
              '[filterDataStore] Background categories fetch failed:',
              categoriesResult.reason,
            );
          }

          // Process theme results
          if (themesResult.status === 'fulfilled') {
            set({ themes: themesResult.value });
            hasUpdates = true;
          } else {
            logger.warn(
              '[filterDataStore] Background themes fetch failed:',
              themesResult.reason,
            );
          }

          if (hasUpdates) {
            logger.info(
              '[filterDataStore] backgroundRefresh: Background update completed successfully',
            );
            set({
              lastUpdated: Date.now(),
              error: null,
            });
          }
        } catch (error) {
          logger.warn(
            '[filterDataStore] backgroundRefresh: Background update failed (silently ignored):',
            error,
          );
          // Background update errors handled silently (not shown to user)
        }
      },

      setError: (error) => {
        set({ error });
      },

      clearError: () => {
        set({ error: null });
      },
    }),
    {
      name: 'filter-data-store', // localStorage key
      partialize: (state) => ({
        // Select data to persist
        categories: state.categories,
        themes: state.themes,
        lastUpdated: state.lastUpdated,
        isInitialized: state.isInitialized,
        cacheExpireTime: state.cacheExpireTime,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          logger.info('[filterDataStore] Rehydrated from localStorage:', {
            categories: state.categories.length,
            themes: state.themes.length,
            lastUpdated: state.lastUpdated,
            isInitialized: state.isInitialized,
          });

          // Check data freshness after rehydration
          if (state.isInitialized && !state.isDataFresh()) {
            logger.debug(
              '[filterDataStore] Cached data is stale, will refresh on next access',
            );
          }
        }
      },
    },
  ),
);

// Debug helper functions
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as Record<string, unknown>).filterDataStoreDebug = {
    getState: () => useFilterDataStore.getState(),
    clearCache: () => useFilterDataStore.getState().clearCache(),
    refreshData: (force = true) =>
      useFilterDataStore.getState().refreshData(force),
    checkFreshness: () => useFilterDataStore.getState().isDataFresh(),
  };
}
