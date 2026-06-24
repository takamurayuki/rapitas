'use client';

/**
 * execution-log-viewer/useLogViewer.ts
 *
 * Custom hook that encapsulates layout state, auto-scroll, log transforms,
 * clipboard logic, and search FILTERING for ExecutionLogViewer.
 *
 * The viewer always renders the formatted "simple" entries; search filters those
 * entries (by message/detail) and an optional "errors only" quick-filter narrows
 * them further. Query state is delegated to useLogSearch. Returns stable callbacks
 * and derived values so the component itself stays thin and focused on rendering.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  transformLogsToSimple,
  generateExecutionSummary,
} from '../../utils/log-message-transformer';
import type { UserFriendlyLogEntry } from '../../utils/log-pattern-rules';
import { useLogSearch } from './useLogSearch';

type UseLogViewerOptions = {
  logs: string[];
  defaultExpanded: boolean;
  defaultFullscreen: boolean;
};

type UseLogViewerReturn = {
  // Layout state
  isExpanded: boolean;
  isFullscreen: boolean;
  copied: boolean;
  autoScroll: boolean;

  // Search / filter state
  searchQuery: string;
  /** Debounced query used for highlighting (kept in sync with the filtered set). */
  highlightQuery: string;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  errorOnly: boolean;
  /** True when any filter (search text or errors-only) is narrowing the entries. */
  hasActiveFilter: boolean;
  /** Number of entries currently shown (after filtering). */
  matchCount: number;

  // Scroll ref for the log container
  logContainerRef: React.RefObject<HTMLDivElement | null>;

  // Animation tracking
  displayedLogsCount: number;

  // Derived / memoized
  simpleLogEntries: UserFriendlyLogEntry[];
  /** simpleLogEntries after applying the search + errors-only filters. */
  filteredSimpleEntries: UserFriendlyLogEntry[];
  executionSummary: ReturnType<typeof generateExecutionSummary> | null;

  // Callbacks
  handleScroll: () => void;
  handleScrollStart: () => void;
  handleScrollEnd: () => void;
  scrollToBottom: () => void;
  toggleFullscreen: () => void;
  toggleExpanded: () => void;
  toggleErrorOnly: () => void;
  handleCopyLogs: () => void;
  clearSearchQuery: () => void;
  handleSearchQueryChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSearchKeyDown: (e: React.KeyboardEvent) => void;
  highlightText: (text: string, query: string) => React.ReactNode;
};

/**
 * Manages layout state, auto-scroll, clipboard, and derived/filtered values for
 * the log viewer. Delegates search-query state to {@link useLogSearch}.
 *
 * @param options - Initial configuration derived from the component props. / コンポーネント props から導出した初期設定。
 * @returns Stable state, callbacks, and refs consumed by the view layer. / ビュー層が使うステート・コールバック・ref。
 */
export function useLogViewer({
  logs,
  defaultExpanded,
  defaultFullscreen,
}: UseLogViewerOptions): UseLogViewerReturn {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isFullscreen, setIsFullscreen] = useState(defaultFullscreen);
  const [copied, setCopied] = useState(false);
  const [errorOnly, setErrorOnly] = useState(false);

  const search = useLogSearch();

  const logContainerRef = useRef<HTMLDivElement>(null);
  // NOTE: Flag to control auto-scroll behaviour
  const [autoScroll, setAutoScroll] = useState(true);
  const isUserScrollingRef = useRef(false);
  const isAutoScrollingRef = useRef(false);
  const prevLogsLengthRef = useRef(0);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Monitor scroll position to control auto-scroll
  const handleScroll = useCallback(() => {
    if (isAutoScrollingRef.current) return;
    if (!logContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;

    if (!isUserScrollingRef.current) {
      setAutoScroll(isNearBottom);
    }
  }, []);

  const handleScrollStart = useCallback(() => {
    isUserScrollingRef.current = true;
  }, []);

  const handleScrollEnd = useCallback(() => {
    isUserScrollingRef.current = false;
    handleScroll();
  }, [handleScroll]);

  // Auto-scroll on log update (with 100ms buffering to batch rapid updates)
  useEffect(() => {
    if (logs.length > prevLogsLengthRef.current) {
      if (logContainerRef.current && autoScroll && !isUserScrollingRef.current) {
        if (scrollTimerRef.current) {
          clearTimeout(scrollTimerRef.current);
        }

        scrollTimerRef.current = setTimeout(() => {
          if (logContainerRef.current && autoScroll) {
            isAutoScrollingRef.current = true;

            logContainerRef.current.scrollTo({
              top: logContainerRef.current.scrollHeight,
              behavior: 'smooth',
            });

            setTimeout(() => {
              isAutoScrollingRef.current = false;
            }, 300);
          }
        }, 100);
      }
    }
    prevLogsLengthRef.current = logs.length;

    return () => {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
    };
  }, [logs.length, autoScroll]);

  const scrollToBottom = useCallback(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTo({
        top: logContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
      setAutoScroll(true);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const toggleErrorOnly = useCallback(() => {
    setErrorOnly((prev) => !prev);
  }, []);

  const handleCopyLogs = useCallback(() => {
    navigator.clipboard.writeText(logs.join(''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [logs]);

  // Helper to highlight matching text inside a rendered message.
  const highlightText = useCallback((text: string, query: string): React.ReactNode => {
    if (!query.trim()) return text;

    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));

    return parts.map((part, i) => {
      if (part.toLowerCase() === query.toLowerCase()) {
        return (
          <mark key={i} className="bg-yellow-600/50 text-yellow-200 rounded px-0.5">
            {part}
          </mark>
        );
      }
      return part;
    });
  }, []);

  // Track previous log count to identify new entries for animation
  const [displayedLogsCount, setDisplayedLogsCount] = useState(0);
  useEffect(() => {
    if (logs.length > displayedLogsCount) {
      const timer = setTimeout(() => {
        setDisplayedLogsCount(logs.length);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [logs.length, displayedLogsCount]);

  // Transform logs into the formatted, always-on "simple" entries.
  const simpleLogEntries = useMemo(() => transformLogsToSimple(logs), [logs]);

  // Apply the errors-only quick filter then the (debounced) text search. Filtering
  // the already-formatted entries — rather than the raw log lines — keeps the
  // structured rendering (icons, phase dividers) intact for the matches.
  const filteredSimpleEntries = useMemo(() => {
    const q = search.debouncedQuery.trim().toLowerCase();
    let entries = simpleLogEntries;
    if (errorOnly) {
      entries = entries.filter((e) => e.category === 'error' || e.category === 'warning');
    }
    if (q) {
      entries = entries.filter(
        (e) =>
          e.message.toLowerCase().includes(q) || (e.detail?.toLowerCase().includes(q) ?? false),
      );
    }
    return entries;
  }, [simpleLogEntries, search.debouncedQuery, errorOnly]);

  const hasActiveFilter = search.debouncedQuery.trim().length > 0 || errorOnly;

  // Generate execution summary (live during execution, final on completion)
  const executionSummary = useMemo(() => {
    if (logs.length === 0) return null;
    return generateExecutionSummary(logs);
  }, [logs]);

  return {
    isExpanded,
    isFullscreen,
    copied,
    autoScroll,
    searchQuery: search.searchQuery,
    highlightQuery: search.debouncedQuery,
    searchInputRef: search.searchInputRef,
    errorOnly,
    hasActiveFilter,
    matchCount: filteredSimpleEntries.length,
    logContainerRef,
    displayedLogsCount,
    simpleLogEntries,
    filteredSimpleEntries,
    executionSummary,
    handleScroll,
    handleScrollStart,
    handleScrollEnd,
    scrollToBottom,
    toggleFullscreen,
    toggleExpanded,
    toggleErrorOnly,
    handleCopyLogs,
    clearSearchQuery: search.clearSearchQuery,
    handleSearchQueryChange: search.handleSearchQueryChange,
    handleSearchKeyDown: search.handleSearchKeyDown,
    highlightText,
  };
}
