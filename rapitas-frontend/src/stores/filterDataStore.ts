import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Category, Theme } from '@/types';
import { apiFetch } from '@/lib/api-client';

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
  cacheExpireTime: number; // ミリ秒（デフォルト: 1時間）
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

// デフォルトのキャッシュ期限（1時間）
const DEFAULT_CACHE_EXPIRE_TIME = 60 * 60 * 1000;

// バックグラウンド更新の閾値（期限の80%経過時に更新開始）
const BACKGROUND_REFRESH_THRESHOLD = 0.8;

// リトライ設定
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1秒

// タイムアウト設定
const FETCH_TIMEOUT = 10000; // 10秒

/**
 * 指定した時間待機するユーティリティ関数
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * タイムアウト付きのfetch関数
 */
const fetchWithTimeout = async (fetchFn: () => Promise<any>, timeout: number) => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out')), timeout)
  );

  return Promise.race([fetchFn(), timeoutPromise]);
};

/**
 * リトライ付きのAPI呼び出し
 */
const fetchWithRetry = async <T>(
  fetchFn: () => Promise<T>,
  attempts: number = RETRY_ATTEMPTS,
  delayMs: number = RETRY_DELAY
): Promise<T> => {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchWithTimeout(fetchFn, FETCH_TIMEOUT);
    } catch (error) {
      console.warn(`Fetch attempt ${i + 1} failed:`, error);

      if (i === attempts - 1) {
        throw error;
      }

      // 指数バックオフで待機
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

        // 既に初期化済みで、データが新しい場合はスキップ
        if (state.isInitialized && state.isDataFresh()) {
          console.log('[filterDataStore] initializeData: Using cached data');
          return;
        }

        console.log('[filterDataStore] initializeData: Starting initialization');
        set({ isLoading: true, error: null });

        try {
          // 並列でカテゴリ・テーマを取得
          const [categoriesResult, themesResult] = await Promise.allSettled([
            fetchWithRetry(() => apiFetch<Category[]>('/categories', { cacheTime: 300000 })),
            fetchWithRetry(() => apiFetch<Theme[]>('/themes', { cacheTime: 300000 }))
          ]);

          // カテゴリの結果処理
          if (categoriesResult.status === 'fulfilled') {
            set({ categories: categoriesResult.value });
          } else {
            console.error('[filterDataStore] Categories fetch failed:', categoriesResult.reason);
            throw new Error(`Categories fetch failed: ${categoriesResult.reason.message}`);
          }

          // テーマの結果処理
          if (themesResult.status === 'fulfilled') {
            set({ themes: themesResult.value });
          } else {
            console.error('[filterDataStore] Themes fetch failed:', themesResult.reason);
            throw new Error(`Themes fetch failed: ${themesResult.reason.message}`);
          }

          console.log(
            `[filterDataStore] initializeData: Success - Categories: ${categoriesResult.status === 'fulfilled' ? categoriesResult.value.length : 0}, Themes: ${themesResult.status === 'fulfilled' ? themesResult.value.length : 0}`
          );

          set({
            lastUpdated: Date.now(),
            isInitialized: true,
            isLoading: false,
            error: null,
          });
        } catch (error) {
          console.error('[filterDataStore] initializeData error:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

          set({
            isLoading: false,
            error: `Failed to load filter data: ${errorMessage}`,
            // エラーが発生してもキャッシュデータがある場合は使用を継続
            isInitialized: state.categories.length > 0 || state.themes.length > 0,
          });
        }
      },

      // データ更新
      refreshData: async (force = false) => {
        const state = get();

        // 強制更新でない場合、データが新しければスキップ
        if (!force && state.isDataFresh()) {
          console.log('[filterDataStore] refreshData: Data is fresh, skipping refresh');
          return;
        }

        console.log(`[filterDataStore] refreshData: Starting refresh (force: ${force})`);
        return state.initializeData();
      },

      // カテゴリ設定
      setCategories: (categories) => {
        console.log(`[filterDataStore] setCategories: Setting ${categories.length} categories`);
        set({ categories });
      },

      // テーマ設定
      setThemes: (themes) => {
        console.log(`[filterDataStore] setThemes: Setting ${themes.length} themes`);
        set({ themes });
      },

      // キャッシュクリア
      clearCache: () => {
        console.log('[filterDataStore] clearCache: Clearing all cache');
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
        const isExpired = (now - state.lastUpdated) > state.cacheExpireTime;

        console.log(
          `[filterDataStore] isDataFresh: ${!isExpired} (age: ${Math.round((now - state.lastUpdated) / 1000)}s, limit: ${Math.round(state.cacheExpireTime / 1000)}s)`
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

        console.log(
          `[filterDataStore] shouldBackgroundRefresh: ${shouldRefresh} (age: ${Math.round(age / 1000)}s, threshold: ${Math.round(threshold / 1000)}s)`
        );

        return shouldRefresh;
      },

      // バックグラウンド更新（ユーザーに気づかれないように）
      backgroundRefresh: async () => {
        const state = get();
        console.log('[filterDataStore] backgroundRefresh: Starting background update');

        try {
          // 並列でカテゴリ・テーマを取得（ローディング状態は変更しない）
          const [categoriesResult, themesResult] = await Promise.allSettled([
            fetchWithRetry(() => apiFetch<Category[]>('/categories', { cacheTime: 300000 })),
            fetchWithRetry(() => apiFetch<Theme[]>('/themes', { cacheTime: 300000 }))
          ]);

          let hasUpdates = false;

          // カテゴリの結果処理
          if (categoriesResult.status === 'fulfilled') {
            set({ categories: categoriesResult.value });
            hasUpdates = true;
          } else {
            console.warn('[filterDataStore] Background categories fetch failed:', categoriesResult.reason);
          }

          // テーマの結果処理
          if (themesResult.status === 'fulfilled') {
            set({ themes: themesResult.value });
            hasUpdates = true;
          } else {
            console.warn('[filterDataStore] Background themes fetch failed:', themesResult.reason);
          }

          if (hasUpdates) {
            console.log('[filterDataStore] backgroundRefresh: Background update completed successfully');
            set({
              lastUpdated: Date.now(),
              error: null,
            });
          }
        } catch (error) {
          console.warn('[filterDataStore] backgroundRefresh: Background update failed (silently ignored):', error);
          // バックグラウンド更新のエラーはサイレントに処理（ユーザーには表示しない）
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
        // 永続化するデータを選択
        categories: state.categories,
        themes: state.themes,
        lastUpdated: state.lastUpdated,
        isInitialized: state.isInitialized,
        cacheExpireTime: state.cacheExpireTime,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          console.log('[filterDataStore] Rehydrated from localStorage:', {
            categories: state.categories.length,
            themes: state.themes.length,
            lastUpdated: state.lastUpdated,
            isInitialized: state.isInitialized,
          });

          // リハイドレート後にデータの新鮮度をチェック
          if (state.isInitialized && !state.isDataFresh()) {
            console.log('[filterDataStore] Cached data is stale, will refresh on next access');
          }
        }
      },
    }
  )
);

// デバッグ用のヘルパー関数
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).filterDataStoreDebug = {
    getState: () => useFilterDataStore.getState(),
    clearCache: () => useFilterDataStore.getState().clearCache(),
    refreshData: (force = true) => useFilterDataStore.getState().refreshData(force),
    checkFreshness: () => useFilterDataStore.getState().isDataFresh(),
  };
}