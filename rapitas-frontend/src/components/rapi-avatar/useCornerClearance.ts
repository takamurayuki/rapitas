'use client';
/**
 * useCornerClearance
 *
 * How far the avatar has to sit above the bottom-right corner to stay out
 * from under whatever else is already there.
 *
 * The resumable-executions banner lives in the same corner
 * (`fixed bottom-6 right-6 z-[60]`) and appears exactly when there is work
 * running — which is the avatar's most important state, so the two collided
 * precisely when the avatar mattered most, and the banner's higher layer
 * won. Measured 2026-10-19 from a screenshot: the avatar was in the DOM at
 * the right size and position, and invisible.
 *
 * Measured rather than wired to the banner's own hook: that hook fetches,
 * and this sits on every page. It mirrors `useTaskPanelWidth`, which solves
 * the same problem for the link pane.
 */
import { useCallback, useEffect, useState } from 'react';

/** The attribute the banner is found by. */
export const CORNER_OCCUPANT_SELECTOR = '[data-bottom-right-dock]';

/** Space left between the avatar and whatever it is standing above. */
const GAP_PX = 12;

/**
 * The height to add to the avatar's bottom offset.
 *
 * @returns Pixels to lift by, or 0 when the corner is free / 持ち上げ量(px)
 */
export function useCornerClearance(): number {
  const [lift, setLift] = useState(0);

  const measure = useCallback(() => {
    if (typeof document === 'undefined') return;
    const el = document.querySelector(CORNER_OCCUPANT_SELECTOR);
    if (!el) {
      setLift(0);
      return;
    }
    const rect = el.getBoundingClientRect();
    // A banner that has animated out still exists for a moment; treat a
    // collapsed box as an empty corner rather than lifting by nothing.
    setLift(rect.height > 1 ? rect.height + GAP_PX : 0);
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);

    // The banner mounts and unmounts as executions come and go, so the
    // corner has to be watched, not sampled once.
    const observer =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            measure();
          });
    observer?.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [measure]);

  return lift;
}
