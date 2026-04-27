'use client';

/**
 * execution-log-viewer/useLogSearch.ts
 *
 * Custom hook that encapsulates all search state and navigation logic
 * for the log viewer.  Kept separate from useLogViewer to respect the
 * 300-line file-size guideline.
 */

import type React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';

type UseLogSearchOptions = {
  logs: string[];
};

type UseLogSearchReturn = {
  searchQuery: string;
  searchMatches: number[];
  currentMatchIndex: number;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  clearSearchQuery: () => void;
  handleSearchQueryChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSearchKeyDown: (e: React.KeyboardEvent) => void;
  goToNextMatch: () => void;
  goToPreviousMatch: () => void;
  jumpToMatch: (matchIndex: number) => void;
};

/**
 * Manages search query state, match computation, and navigation for log content.
 *
 * Debounces query changes by 300 ms to avoid scanning large log arrays on every
 * keystroke.  Supports keyboard navigation via Enter / Shift+Enter / Escape.
 *
 * @param options.logs - Current log array; search is re-run when this changes. / 検索対象のログ配列。変化すると再検索される。
 * @returns Search state and stable callbacks for the view layer. / ビュー層が使う検索ステートと安定したコールバック。
 */
export function useLogSearch({
  logs,
}: UseLogSearchOptions): UseLogSearchReturn {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      if (searchMatches.length > 0 || currentMatchIndex !== 0) {
        const timer = setTimeout(() => {
          setSearchMatches([]);
          setCurrentMatchIndex(0);
        }, 0);
        return () => clearTimeout(timer);
      }
      return;
    }

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = setTimeout(() => {
      const fullText = logs.join('');
      const matches: number[] = [];
      const query = searchQuery.toLowerCase();
      let index = 0;
      let position = fullText.toLowerCase().indexOf(query, index);

      while (position !== -1) {
        matches.push(position);
        index = position + 1;
        position = fullText.toLowerCase().indexOf(query, index);
      }

      setSearchMatches(matches);
      setCurrentMatchIndex(matches.length > 0 ? 0 : -1);
    }, 300);

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, logs]);

  const jumpToMatch = useCallback(
    (matchIndex: number) => {
      if (
        searchMatches.length === 0 ||
        matchIndex < 0 ||
        matchIndex >= searchMatches.length
      )
        return;
      setCurrentMatchIndex(matchIndex);
    },
    [searchMatches],
  );

  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
    jumpToMatch(nextIndex);
  }, [currentMatchIndex, searchMatches.length, jumpToMatch]);

  const goToPreviousMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    const prevIndex =
      (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    jumpToMatch(prevIndex);
  }, [currentMatchIndex, searchMatches.length, jumpToMatch]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchQuery('');
        searchInputRef.current?.blur();
      } else if (e.key === 'Enter') {
        if (e.shiftKey) {
          goToPreviousMatch();
        } else {
          goToNextMatch();
        }
      }
    },
    [goToNextMatch, goToPreviousMatch],
  );

  const clearSearchQuery = useCallback(() => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  }, []);

  const handleSearchQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    [],
  );

  return {
    searchQuery,
    searchMatches,
    currentMatchIndex,
    searchInputRef,
    clearSearchQuery,
    handleSearchQueryChange,
    handleSearchKeyDown,
    goToNextMatch,
    goToPreviousMatch,
    jumpToMatch,
  };
}
