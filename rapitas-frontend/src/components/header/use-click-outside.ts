'use client';
/**
 * header/use-click-outside.ts
 *
 * Reusable hook that calls a callback when a mousedown event occurs
 * outside the element referenced by the given ref.
 * Attaches the listener only when `enabled` is true.
 */

import { useEffect, type RefObject } from 'react';

/**
 * Calls `onClickOutside` when a mousedown event fires outside `ref`.
 *
 * @param ref - Ref to the element to watch / 監視する要素のRef
 * @param onClickOutside - Callback fired on outside click / 外側クリック時のコールバック
 * @param enabled - Whether the listener is active / リスナーが有効かどうか
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClickOutside: () => void,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClickOutside();
      }
    };

    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
    };
  }, [ref, onClickOutside, enabled]);
}
