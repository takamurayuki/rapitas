'use client';

/**
 * use-concern-search
 *
 * State for the PERF concern search: online search via GET /concerns/search,
 * automatic switch to a local search over the last cached list when offline or
 * when the API fails. NOT responsible for voice capture or rendering.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { searchLocal } from '../_components/search/concern-search-utils';
import type {
  ConcernSearchItem,
  ConcernSearchResponse,
} from '../_components/search/concern-search.types';

const log = createLogger('use-concern-search');
const FETCH_LIMIT = 100;

export interface UseConcernSearchReturn {
  items: ConcernSearchItem[];
  isOnline: boolean;
  isSearching: boolean;
  hasError: boolean;
  /** Number of completed searches; drives the live-region announcement. */
  searchCount: number;
  search: (query: string) => Promise<void>;
}

/**
 * Manages PERF concern search with an offline text-search fallback.
 *
 * @returns Search state and the search action / 検索状態と検索アクション
 */
export function useConcernSearch(): UseConcernSearchReturn {
  const [items, setItems] = useState<ConcernSearchItem[]>([]);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [isSearching, setIsSearching] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [searchCount, setSearchCount] = useState(0);
  // Full PERF list from the last empty-query fetch; source of truth for offline search.
  const cacheRef = useRef<ConcernSearchItem[]>([]);
  const onlineRef = useRef(isOnline);

  useEffect(() => {
    const on = () => {
      onlineRef.current = true;
      setIsOnline(true);
    };
    const off = () => {
      onlineRef.current = false;
      setIsOnline(false);
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const search = useCallback(async (query: string) => {
    const q = query.trim();
    setHasError(false);
    if (!onlineRef.current) {
      setItems(searchLocal(cacheRef.current, q));
      setSearchCount((n) => n + 1);
      return;
    }
    setIsSearching(true);
    try {
      const params = new URLSearchParams({ q, type: 'perf', limit: String(FETCH_LIMIT) });
      const res = await fetch(`${API_BASE_URL}/concerns/search?${params.toString()}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as ConcernSearchResponse;
      if (q === '') cacheRef.current = data.items;
      setItems(data.items);
    } catch (err) {
      log.warn({ err }, 'Concern search failed; falling back to cached results');
      setHasError(true);
      setItems(searchLocal(cacheRef.current, q));
    } finally {
      setIsSearching(false);
      setSearchCount((n) => n + 1);
    }
  }, []);

  // Initial load also primes the offline cache.
  useEffect(() => {
    void search('');
  }, [search]);

  return { items, isOnline, isSearching, hasError, searchCount, search };
}
