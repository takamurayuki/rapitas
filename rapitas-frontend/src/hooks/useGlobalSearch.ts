/**
 * 横断検索用のカスタムフック
 * 新しいバックエンド /search エンドポイントを使用
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';

export type SearchResultType = 'task' | 'comment' | 'note' | 'resource';

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
}

export function useGlobalSearch(options: UseGlobalSearchOptions = {}) {
  const { debounceDelay = 300, types, limit = 20 } = options;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (abortRef.current) abortRef.current.abort();
    if (!q.trim()) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    abortRef.current = new AbortController();

    try {
      const params = new URLSearchParams({ q, limit: String(limit) });
      if (types?.length) params.set('type', types.join(','));

      const res = await fetch(`${API_BASE_URL}/search?${params}`, {
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error('検索に失敗しました');

      const data = await res.json();
      if (!abortRef.current.signal.aborted) {
        setResults(data.results || []);
        setTotal(data.total || 0);
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
  }, [types, limit]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query) {
      setResults([]);
      setTotal(0);
      return;
    }
    timerRef.current = setTimeout(() => search(query), debounceDelay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, debounceDelay, search]);

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

  return { query, setQuery, results, total, loading, error, clear };
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
          { signal: abortRef.current.signal }
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
