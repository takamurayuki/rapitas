import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Category, Theme } from '@/types';
import { apiFetch, clearApiCache } from '@/lib/api-client';
import { createLogger } from '@/lib/logger';
const logger = createLogger('filterDataStore');

interface FilterDataState {
  // データ
  categories: Category[];
  themes: Theme[];

  // 状態管理
  lastUpdated: number | null;
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;

  // キャッシュ設定
  cacheExpireTime: number; // milliseconds (default: 1 hour)
}

interface FilterDataActions {
  // 初期化・更新
  initializeData: () => Promise<void>;
  refreshData: (force?: boolean) => Promise<void>;

  // データ設定
  setCategories: (categories: Category[]) => void;
  setThemes: (themes: Theme[]) => void;

  // キャッシュ管理
  clearCache: () => void;
  isDataFresh: () => boolean;
  shouldBackgroundRefresh: () => boolean;
  backgroundRefresh: () => Promise<void>;

  // エラーハンドリング
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
 * 指定した時間待機するユーティリティ関数
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * タイムアウト付きのfetch関数
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
 * リトライ付きのAPI呼び出し
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
      // 初期状態
      categories: [],
      themes: [],
      lastUpdated: null,
      isInitialized: false,
      isLoading: false,
      error: null,
      cacheExpireTime: DEFAULT_CACHE_EXPIRE_TIME,

      // データ初期化
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

          // カテゴリの結果処理
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

          // テーマの結果処理
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

          set({
            isLoading: false,
            error: `Failed to load filter data: ${errorMessage}`,
            // Continue using cache data even if error occurs
            isInitialized:
              state.categories.length > 0 || state.themes.length > 0,
          });
        }
      },

      // データ更新
      refreshData: async (force = false) => {
        const state = get();

        // 強制更新でない場合、データが新しければスキップ
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

      // カテゴリ設定
      setCategories: (categories) => {
        logger.debug(
          `[filterDataStore] setCategories: Setting ${categories.length} categories`,
        );
        set({ categories });
      },

      // テーマ設定
      setThemes: (themes) => {
        logger.debug(
          `[filterDataStore] setThemes: Setting ${themes.length} themes`,
        );
        set({ themes });
      },

      // キャッシュクリア
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

      // データ新鮮度チェック
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

      // バックグラウンド更新が必要かチェック
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

      // バックグラウンド更新（ユーザーに気づかれないように）
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

          // カテゴリの結果処理
          if (categoriesResult.status === 'fulfilled') {
            set({ categories: categoriesResult.value });
            hasUpdates = true;
          } else {
            logger.warn(
              '[filterDataStore] Background categories fetch failed:',
              categoriesResult.reason,
            );
          }

          // テーマの結果処理
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

      // エラー設定
      setError: (error) => {
        set({ error });
      },

      // エラークリア
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

          // リハイドレート後にデータの新鮮度をチェック
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

// デバッグ用のヘルパー関数
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as Record<string, unknown>).filterDataStoreDebug = {
    getState: () => useFilterDataStore.getState(),
    clearCache: () => useFilterDataStore.getState().clearCache(),
    refreshData: (force = true) =>
      useFilterDataStore.getState().refreshData(force),
    checkFreshness: () => useFilterDataStore.getState().isDataFresh(),
  };
}
