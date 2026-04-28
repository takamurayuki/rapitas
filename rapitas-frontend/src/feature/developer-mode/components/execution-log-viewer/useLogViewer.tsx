'use client';

/**
 * execution-log-viewer/useLogViewer.ts
 *
 * Custom hook that encapsulates layout state, auto-scroll, log transforms,
 * and clipboard logic for ExecutionLogViewer.
 *
 * Search state is delegated to useLogSearch.  Returns stable callbacks and
 * derived values so the component itself stays thin and focused on rendering.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  transformLogsToSimple,
  detectCurrentPhase,
  generateExecutionSummary,
} from '../../utils/log-message-transformer';
import type { ExecutionLogViewMode } from './types';
import { useLogSearch } from './useLogSearch';

type UseLogViewerOptions = {
  logs: string[];
  defaultExpanded: boolean;
  defaultFullscreen: boolean;
  defaultViewMode: ExecutionLogViewMode;
};

type UseLogViewerReturn = {
  // Layout state
  isExpanded: boolean;
  isFullscreen: boolean;
  viewMode: ExecutionLogViewMode;
  copied: boolean;
  autoScroll: boolean;

  // Search state (forwarded from useLogSearch)
  searchQuery: string;
  searchMatches: number[];
  currentMatchIndex: number;
  searchInputRef: React.RefObject<HTMLInputElement | null>;

  // Scroll ref for the log container
  logContainerRef: React.RefObject<HTMLDivElement | null>;

  // Animation tracking
  displayedLogsCount: number;

  // Derived / memoized
  simpleLogEntries: ReturnType<typeof transformLogsToSimple>;
  currentPhase: ReturnType<typeof detectCurrentPhase>;
  executionSummary: ReturnType<typeof generateExecutionSummary> | null;

  // Callbacks
  handleScroll: () => void;
  handleScrollStart: () => void;
  handleScrollEnd: () => void;
  scrollToBottom: () => void;
  toggleFullscreen: () => void;
  toggleExpanded: () => void;
  toggleViewMode: () => void;
  handleCopyLogs: () => void;
  clearSearchQuery: () => void;
  handleSearchQueryChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSearchKeyDown: (e: React.KeyboardEvent) => void;
  goToNextMatch: () => void;
  goToPreviousMatch: () => void;
  highlightText: (text: string, query: string) => React.ReactNode;
};

/**
 * Manages layout state, auto-scroll, clipboard, and derived values for the log viewer.
 * Delegates search behaviour to {@link useLogSearch}.
 *
 * @param options - Initial configuration derived from the component props. / コンポーネント props から導出した初期設定。
 * @returns Stable state, callbacks, and refs consumed by the view layer. / ビュー層が使うステート・コールバック・ref。
 */
export function useLogViewer({
  logs,
  defaultExpanded,
  defaultFullscreen,
  defaultViewMode,
}: UseLogViewerOptions): UseLogViewerReturn {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isFullscreen, setIsFullscreen] = useState(defaultFullscreen);
  const [viewMode, setViewMode] = useState<ExecutionLogViewMode>(defaultViewMode);
  const [copied, setCopied] = useState(false);

  const search = useLogSearch({ logs });

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

  // Scroll the container to the current search match position
  const jumpToMatchInContainer = useCallback(
    (matchIndex: number) => {
      if (
        search.searchMatches.length === 0 ||
        matchIndex < 0 ||
        matchIndex >= search.searchMatches.length
      )
        return;

      const fullText = logs.join('');
      const targetPosition = search.searchMatches[matchIndex];
      const textBefore = fullText.substring(0, targetPosition);
      const lineNumber = textBefore.split('\n').length;

      if (logContainerRef.current) {
        const estimatedLineHeight = 20;
        const scrollPosition = Math.max(0, (lineNumber - 3) * estimatedLineHeight);
        logContainerRef.current.scrollTo({
          top: scrollPosition,
          behavior: 'smooth',
        });
        setAutoScroll(false);
      }

      // Delegate index update to the search hook
      search.jumpToMatch(matchIndex);
    },
    [search, logs],
  );

  const goToNextMatch = useCallback(() => {
    if (search.searchMatches.length === 0) return;
    const nextIndex = (search.currentMatchIndex + 1) % search.searchMatches.length;
    jumpToMatchInContainer(nextIndex);
  }, [search.currentMatchIndex, search.searchMatches.length, jumpToMatchInContainer]);

  const goToPreviousMatch = useCallback(() => {
    if (search.searchMatches.length === 0) return;
    const prevIndex =
      (search.currentMatchIndex - 1 + search.searchMatches.length) % search.searchMatches.length;
    jumpToMatchInContainer(prevIndex);
  }, [search.currentMatchIndex, search.searchMatches.length, jumpToMatchInContainer]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        search.clearSearchQuery();
      } else if (e.key === 'Enter') {
        if (e.shiftKey) {
          goToPreviousMatch();
        } else {
          goToNextMatch();
        }
      }
    },
    [goToNextMatch, goToPreviousMatch, search],
  );

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

  const handleCopyLogs = useCallback(() => {
    navigator.clipboard.writeText(logs.join(''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [logs]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === 'simple' ? 'detailed' : 'simple'));
  }, []);

  // Helper to highlight matching text
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

  // Transform logs for simple mode
  const simpleLogEntries = useMemo(() => transformLogsToSimple(logs), [logs]);

  // Detect current phase for progress bar
  const currentPhase = useMemo(() => detectCurrentPhase(logs), [logs]);

  // Generate execution summary (live during execution, final on completion)
  const executionSummary = useMemo(() => {
    if (logs.length === 0) return null;
    return generateExecutionSummary(logs);
  }, [logs]);

  return {
    isExpanded,
    isFullscreen,
    viewMode,
    copied,
    autoScroll,
    searchQuery: search.searchQuery,
    searchMatches: search.searchMatches,
    currentMatchIndex: search.currentMatchIndex,
    searchInputRef: search.searchInputRef,
    logContainerRef,
    displayedLogsCount,
    simpleLogEntries,
    currentPhase,
    executionSummary,
    handleScroll,
    handleScrollStart,
    handleScrollEnd,
    scrollToBottom,
    toggleFullscreen,
    toggleExpanded,
    toggleViewMode,
    handleCopyLogs,
    clearSearchQuery: search.clearSearchQuery,
    handleSearchQueryChange: search.handleSearchQueryChange,
    handleSearchKeyDown,
    goToNextMatch,
    goToPreviousMatch,
    highlightText,
  };
}
