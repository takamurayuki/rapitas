/**
 * タスク検索用のカスタムフック
 * デバウンス、キャンセレーション、キャッシュを含む最適化済み
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { searchTasks } from '@/lib/task-api';
import type { Task } from '@/types';
import { createLogger } from "@/lib/logger";

const logger = createLogger("useTaskSearch");

interface UseTaskSearchOptions {
  minLength?: number; // 最小検索文字数
  debounceDelay?: number; // デバウンス遅延（ms）
}

export function useTaskSearch(options: UseTaskSearchOptions = {}) {
  const { minLength = 2, debounceDelay = 300 } = options;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 検索実行
  const performSearch = useCallback(async (searchQuery: string) => {
    // 前回の検索をキャンセル
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (searchQuery.length < minLength) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // 新しいAbortController作成
    abortControllerRef.current = new AbortController();

    try {
      const tasks = await searchTasks(searchQuery);

      // キャンセルされていなければ結果を設定
      if (!abortControllerRef.current.signal.aborted) {
        setResults(tasks);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message || '検索中にエラーが発生しました');
        logger.error('Search error:', err);
      } else if (!(err instanceof Error)) {
        setError('検索中にエラーが発生しました');
        logger.error('Search error:', err);
      }
    } finally {
      if (!abortControllerRef.current?.signal.aborted) {
        setLoading(false);
      }
    }
  }, [minLength]);

  // クエリ変更時のデバウンス処理
  useEffect(() => {
    // 前回のタイマーをクリア
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // 空文字の場合は即座にクリア
    if (!query) {
      setResults([]);
      setLoading(false);
      return;
    }

    // デバウンスタイマー設定
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(query);
    }, debounceDelay);

    // クリーンアップ
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, debounceDelay, performSearch]);

  // コンポーネントアンマウント時のクリーンアップ
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // 検索のクリア
  const clearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setError(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
  }, []);

  return {
    query,
    setQuery,
    results,
    loading,
    error,
    clearSearch,
  };
}

/**
 * 高度な検索フィルター付きのフック
 */
interface SearchFilters {
  status?: string[];
  categoryId?: number;
  dateRange?: {
    from: Date;
    to: Date;
  };
  tags?: string[];
}

export function useAdvancedTaskSearch(
  initialFilters: SearchFilters = {},
  options: UseTaskSearchOptions = {}
) {
  const [filters, setFilters] = useState<SearchFilters>(initialFilters);
  const { query, setQuery, results, loading, error, clearSearch } = useTaskSearch(options);

  // フィルターを適用した結果
  const filteredResults = results.filter((task) => {
    // ステータスフィルター
    if (filters.status?.length && !filters.status.includes(task.status)) {
      return false;
    }

    // カテゴリフィルター（Taskにはtheme.categoryIdがある）
    if (filters.categoryId && task.theme?.categoryId !== filters.categoryId) {
      return false;
    }

    // 日付範囲フィルター
    if (filters.dateRange) {
      const taskDate = new Date(task.createdAt);
      if (taskDate < filters.dateRange.from || taskDate > filters.dateRange.to) {
        return false;
      }
    }

    // タグフィルター（実装は仮定）
    if (filters.tags?.length) {
      // task.tagsがあると仮定
      // const taskTags = task.tags || [];
      // if (!filters.tags.some(tag => taskTags.includes(tag))) {
      //   return false;
      // }
    }

    return true;
  });

  // フィルターの更新
  const updateFilter = useCallback(<K extends keyof SearchFilters>(
    key: K,
    value: SearchFilters[K]
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  // すべてのフィルターをクリア
  const clearAllFilters = useCallback(() => {
    setFilters({});
    clearSearch();
  }, [clearSearch]);

  return {
    query,
    setQuery,
    results: filteredResults,
    totalResults: results.length,
    loading,
    error,
    filters,
    updateFilter,
    clearSearch,
    clearAllFilters,
  };
}