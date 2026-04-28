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

      const resizeObserver = new ResizeObserver(() => checkThemeScrollPosition());
      resizeObserver.observe(scrollElement);

      return () => {
        clearTimeout(timeoutId);
        scrollElement.removeEventListener('scroll', handleScroll);
        resizeObserver.disconnect();
      };
    }

    return () => clearTimeout(timeoutId);
    // NOTE: deps is intentionally spread here — callers control what triggers re-check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

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
