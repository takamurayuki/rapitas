'use client';
/**
 * useTaskPanelWidth
 *
 * How much of the viewport the task detail panel is occupying, in vw, so the
 * link pane can run up to its edge instead of guessing.
 *
 * Measured rather than derived from a constant because the panel's width is
 * not one: it is `md:w-[50vw]` when tiled, and `md:w-3/4 lg:w-2/3 xl:w-1/2`
 * when overlaid — 50vw, 66.7vw or 75vw depending on the breakpoint.
 * #1068 widened the pane by the tiled constant alone, which left the default
 * (overlay) case still showing a strip of page between the two (#1072). Any
 * second constant would only move the problem to the next breakpoint.
 */
import { useCallback, useEffect, useState } from 'react';

/** The attribute the task detail panel is found by. */
export const TASK_PANEL_SELECTOR = '[data-task-slide-panel]';

/**
 * The task detail panel's width as a share of the viewport.
 *
 * @param visible - Whether the panel is on screen at all / パネルが表示中か
 * @returns Its width in vw, or 0 when there is none / 幅(vw)、無ければ 0
 */
export function useTaskPanelWidthVw(visible: boolean): number {
  const [vw, setVw] = useState(0);

  const measure = useCallback(() => {
    if (!visible || typeof document === 'undefined') {
      setVw(0);
      return;
    }
    const el = document.querySelector(TASK_PANEL_SELECTOR);
    if (!el) {
      setVw(0);
      return;
    }
    const width = el.getBoundingClientRect().width;
    const total = window.innerWidth || 1;
    setVw((width / total) * 100);
  }, [visible]);

  useEffect(() => {
    measure();
    if (!visible) return;

    // The panel slides in, so its width is not final on the first frame.
    const settle = window.setTimeout(measure, 300);
    window.addEventListener('resize', measure);

    const el = document.querySelector(TASK_PANEL_SELECTOR);
    const observer =
      typeof ResizeObserver === 'undefined' || !el ? null : new ResizeObserver(measure);
    if (el) observer?.observe(el);

    return () => {
      window.clearTimeout(settle);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [visible, measure]);

  return vw;
}
