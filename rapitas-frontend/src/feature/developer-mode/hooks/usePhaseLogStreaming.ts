'use client';

/**
 * usePhaseLogStreaming
 *
 * Tail-follow state for the currently-running phase section of the
 * PhaseTimeline (task #785) — ports the auto-scroll / user-scroll-detection
 * logic from execution-log-viewer/useLogViewer.tsx so both viewers behave
 * identically. NOT responsible for fetching log content — the caller passes
 * in the raw live log lines (from useExecutionManager) and a ref to the
 * scrollable container.
 */

import { useState, useCallback, useRef, useEffect, type RefObject } from 'react';

export interface UsePhaseLogStreamingResult {
  /** True while the view should auto-scroll to the newest log line. */
  autoScroll: boolean;
  /** Attach to the scrollable container's onScroll. */
  handleScroll: () => void;
  /** Attach to onMouseDown / onTouchStart / onWheel to mark scrolling as user-driven. */
  handleScrollStart: () => void;
  /** Attach to onMouseUp / onTouchEnd to end user-driven scrolling. */
  handleScrollEnd: () => void;
  /** Re-enables auto-scroll and jumps to the bottom — bound to the "末尾へ" button. */
  scrollToBottom: () => void;
}

/**
 * @param liveLogLineCount - Current number of live log lines for the running phase / 現在のライブログ行数
 * @param containerRef - Ref to the scrollable log container / スクロール対象のref
 * @returns Auto-scroll state and the handlers that drive it / 自動追従の状態とハンドラ
 */
export function usePhaseLogStreaming(
  liveLogLineCount: number,
  containerRef: RefObject<HTMLElement | null>,
): UsePhaseLogStreamingResult {
  const [autoScroll, setAutoScroll] = useState(true);
  const isUserScrollingRef = useRef(false);
  const isAutoScrollingRef = useRef(false);
  const prevCountRef = useRef(0);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScroll = useCallback(() => {
    if (isAutoScrollingRef.current) return;
    if (!containerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;

    if (!isUserScrollingRef.current) {
      setAutoScroll(isNearBottom);
    }
  }, [containerRef]);

  const handleScrollStart = useCallback(() => {
    isUserScrollingRef.current = true;
  }, []);

  const handleScrollEnd = useCallback(() => {
    isUserScrollingRef.current = false;
    handleScroll();
  }, [handleScroll]);

  useEffect(() => {
    if (liveLogLineCount > prevCountRef.current) {
      if (containerRef.current && autoScroll && !isUserScrollingRef.current) {
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = setTimeout(() => {
          if (containerRef.current && autoScroll) {
            isAutoScrollingRef.current = true;
            containerRef.current.scrollTo({
              top: containerRef.current.scrollHeight,
              behavior: 'smooth',
            });
            setTimeout(() => {
              isAutoScrollingRef.current = false;
            }, 300);
          }
        }, 100);
      }
    }
    prevCountRef.current = liveLogLineCount;

    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [liveLogLineCount, autoScroll, containerRef]);

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
      setAutoScroll(true);
    }
  }, [containerRef]);

  return { autoScroll, handleScroll, handleScrollStart, handleScrollEnd, scrollToBottom };
}
