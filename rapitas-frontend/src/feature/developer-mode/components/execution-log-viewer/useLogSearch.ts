'use client';

/**
 * execution-log-viewer/useLogSearch.ts
 *
 * Owns the log search-query input state. The viewer FILTERS the formatted log
 * entries to those matching the query (rather than navigating raw-text offsets),
 * so this hook only manages the query string + a short debounce; the filtering
 * and highlighting live in useLogViewer.
 */

import type React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';

type UseLogSearchReturn = {
  searchQuery: string;
  /** Query after a 200 ms debounce — drives the (potentially large) filtering pass. */
  debouncedQuery: string;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  clearSearchQuery: () => void;
  handleSearchQueryChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSearchKeyDown: (e: React.KeyboardEvent) => void;
};

/**
 * Manages the search query for the log viewer, debounced by 200 ms so filtering
 * doesn't run on every keystroke. Escape clears + blurs the input.
 *
 * @returns Query state and stable input callbacks. / クエリ状態と入力コールバック。
 */
export function useLogSearch(): UseLogSearchReturn {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const clearSearchQuery = useCallback(() => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  }, []);

  const handleSearchQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchQuery('');
      searchInputRef.current?.blur();
    }
  }, []);

  return {
    searchQuery,
    debouncedQuery,
    searchInputRef,
    clearSearchQuery,
    handleSearchQueryChange,
    handleSearchKeyDown,
  };
}
