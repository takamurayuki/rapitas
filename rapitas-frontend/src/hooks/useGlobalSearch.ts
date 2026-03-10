/**
 * 横断検索用のカスタムフック
 * 新しいバックエンド /search エンドポイントを使用
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';

export type SearchResultType = 'task' | 'comment' | 'note' | 'resource';

// Simple cache for search results
interface CacheEntry {
  results: SearchResult[];
  total: number;
  timestamp: number;
}

const searchCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 20;

// Cache management helpers
function generateCacheKey(
  query: string,
  types?: SearchResultType[],
  limit?: number,
  offset?: number,
): string {
  return `${query}-${types?.join(',') || 'all'}-${limit || 20}-${offset || 0}`;
}

function getCachedResult(key: string): CacheEntry | null {
  const cached = searchCache.get(key);
  if (!cached) return null;

  if (Date.now() - cached.timestamp > CACHE_TTL) {
    searchCache.delete(key);
    return null;
  }

  return cached;
}

function setCachedResult(
  key: string,
  results: SearchResult[],
  total: number,
): void {
  // Remove oldest entries if cache is full
  if (searchCache.size >= MAX_CACHE_SIZE) {
    const firstKey = searchCache.keys().next().value;
    if (firstKey) searchCache.delete(firstKey);
  }

  searchCache.set(key, {
    results,
    total,
    timestamp: Date.now(),
  });
}

export interface SearchResult {
  id: number;
  type: SearchResultType;
  title: string;
  excerpt: string;
  relevance: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

export interface SearchSuggestion {
  id: number;
  title: string;
  type: 'task';
  status: string;
}

interface UseGlobalSearchOptions {
  debounceDelay?: number;
  types?: SearchResultType[];
  limit?: number;
  initialQuery?: string;
}

export function useGlobalSearch(options: UseGlobalSearchOptions = {}) {
  const {
    debounceDelay = 300,
    types,
    limit: initialLimit = 20,
    initialQuery = '',
  } = options;

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  // 初期クエリがある場合は即座にローディング表示
  const [loading, setLoading] = useState(!!initialQuery.trim());
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [limit, setLimitState] = useState(initialLimit);
  const [typesState, setTypesState] = useState<SearchResultType[] | undefined>(
    types,
  );

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 安定した参照を持つため、useRefで最新の値を管理
  const typesRef = useRef(typesState);
  const limitRef = useRef(limit);

  // typesStateとlimitの参照を常に最新に保つ
  typesRef.current = typesState;
  limitRef.current = limit;

  const search = useCallback(async (q: string, searchOffset = 0) => {
    if (abortRef.current) abortRef.current.abort();
    if (!q.trim()) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    // Check cache first
    const cacheKey = generateCacheKey(
      q,
      typesRef.current,
      limitRef.current,
      searchOffset,
    );
    const cachedResult = getCachedResult(cacheKey);

    if (cachedResult) {
      // Cache hit - return immediately
      setResults(cachedResult.results);
      setTotal(cachedResult.total);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    abortRef.current = new AbortController();

    try {
      const params = new URLSearchParams({
        q,
        limit: String(limitRef.current),
        offset: String(searchOffset),
      });
      if (typesRef.current?.length)
        params.set('type', typesRef.current.join(','));

      const res = await fetch(`${API_BASE_URL}/search?${params}`, {
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error('検索に失敗しました');

      const data = await res.json();
      if (!abortRef.current.signal.aborted) {
        const results = data.results || [];
        const total = data.total || 0;

        setResults(results);
        setTotal(total);

        // Cache the results
        setCachedResult(cacheKey, results, total);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      if (!abortRef.current?.signal.aborted) {
        setLoading(false);
      }
    }
  }, []); // 安定した依存配列 - 循環参照を防ぐ

  // 初期クエリの即座実行フラグ
  const isInitialQuery = useRef(!!initialQuery.trim());

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    // 初期クエリの場合は即座に実行、それ以外はデバウンス
    const delay = isInitialQuery.current ? 0 : debounceDelay;
    isInitialQuery.current = false; // 一度実行後は通常のデバウンス

    timerRef.current = setTimeout(() => search(query, offset), delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, offset, debounceDelay, typesState]); // typesStateを依存配列に追加

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
    setTotal(0);
    setError(null);
    abortRef.current?.abort();
  }, []);

  const setLimit = useCallback((newLimit: number) => {
    setLimitState(newLimit);
    setOffset(0); // Reset to first page when changing limit
  }, []);

  const setTypes = useCallback((newTypes: SearchResultType[] | undefined) => {
    setTypesState(newTypes);
    setOffset(0); // Reset to first page when changing filter
  }, []);

  return {
    query,
    setQuery,
    results,
    total,
    loading,
    error,
    clear,
    offset,
    setOffset,
    limit,
    setLimit,
    types: typesState,
    setTypes,
  };
}

/**
 * 検索サジェスト用のフック
 */
export function useSearchSuggest() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }

    timerRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();

      try {
        const res = await fetch(
          `${API_BASE_URL}/search/suggest?q=${encodeURIComponent(query)}`,
          { signal: abortRef.current.signal },
        );
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions || []);
        }
      } catch {
        // ignore abort errors
      }
    }, 200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { query, setQuery, suggestions };
}
