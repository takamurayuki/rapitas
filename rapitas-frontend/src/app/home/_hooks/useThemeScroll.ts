'use client';
// useThemeScroll
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hook providing theme filter scroll controls and visibility state.
 *
 * @returns Ref to attach to the scroll container, scroll state flags, and scroll handlers.
 */
export function useThemeScroll(deps: unknown[]) {
  const themeScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isScrollNeeded, setIsScrollNeeded] = useState(false);
  // NOTE: Counts each new row element. The row can mount long after the deps
  // last changed — the home filter can be folded away and starts folded when
  // that was saved (2026-11-21) — and the effects below only measured on a
  // deps change, so a row shown later never got its "<" / ">" (2026-11-24).
  const attachedElementRef = useRef<HTMLDivElement | null>(null);
  const [elementVersion, setElementVersion] = useState(0);
  // Runs after every render on purpose: a ref change does not re-render. It
  // cannot loop — it sets state only when the element differs, then records it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (themeScrollRef.current !== attachedElementRef.current) {
      attachedElementRef.current = themeScrollRef.current;
      setElementVersion((v) => v + 1);
    }
  });

  const checkThemeScrollPosition = useCallback(() => {
    const scrollElement = themeScrollRef.current;
    if (!scrollElement) {
      setIsScrollNeeded(false);
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    const { scrollLeft, scrollWidth, clientWidth } = scrollElement;
    const needsScroll = scrollWidth > clientWidth;

    setIsScrollNeeded(needsScroll);
    setCanScrollLeft(needsScroll && scrollLeft > 0);
    setCanScrollRight(needsScroll && scrollLeft < scrollWidth - clientWidth - 1);
  }, []);

  const scrollThemeLeft = useCallback(() => {
    themeScrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' });
  }, []);

  const scrollThemeRight = useCallback(() => {
    themeScrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' });
  }, []);

  // Re-check when deps change (e.g. category or theme list changes)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      checkThemeScrollPosition();
    }, 0);

    const scrollElement = themeScrollRef.current;
    if (scrollElement) {
      const handleScroll = () => checkThemeScrollPosition();
      scrollElement.addEventListener('scroll', handleScroll);

      let rafId: number;
      // NOTE: RAF defers the three setState calls in checkThemeScrollPosition to
      // the next frame, preventing "ResizeObserver loop completed with undelivered
      // notifications" caused by synchronous re-renders changing the observed width.
      const resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(checkThemeScrollPosition);
      });
      resizeObserver.observe(scrollElement);

      return () => {
        clearTimeout(timeoutId);
        cancelAnimationFrame(rafId);
        scrollElement.removeEventListener('scroll', handleScroll);
        resizeObserver.disconnect();
      };
    }

    return () => clearTimeout(timeoutId);
    // NOTE: deps is intentionally spread here — callers control what triggers
    // re-check; elementVersion adds "the row element itself was replaced".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, elementVersion]);

  // Additional delayed checks to ensure correct init after page transitions
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      checkThemeScrollPosition();
    }, 100);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps[0]]); // re-run when first dep (themes.length) changes

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      checkThemeScrollPosition();
    }, 200);
    return () => clearTimeout(timeoutId);
  }, [checkThemeScrollPosition]);

  return {
    themeScrollRef,
    canScrollLeft,
    canScrollRight,
    isScrollNeeded,
    scrollThemeLeft,
    scrollThemeRight,
  };
}
