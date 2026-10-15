'use client';

/**
 * use-focus-trap
 *
 * Traps keyboard focus inside a container while active, and restores focus to
 * the previously-focused element when it deactivates. Shared by Modal and
 * ConfirmDialog (via Modal) so every overlay gets the same accessible
 * keyboard behavior.
 */

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab / Shift+Tab focus inside `containerRef` while `active` is true:
 * moves initial focus into the container, cycles Tab at the container's
 * edges, and restores focus to the element that had it beforehand once
 * `active` becomes false (or the component unmounts).
 *
 * @param containerRef - Ref to the focus-trap container (e.g. the modal panel) / トラップ対象のコンテナref
 * @param active - Whether the trap is engaged, e.g. the modal is open / トラップ有効フラグ
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    const getFocusable = () =>
      container ? Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];

    // Move focus into the dialog so keyboard/screen-reader users land inside
    // it instead of on whatever was behind the overlay.
    const initialTarget = getFocusable()[0] ?? container;
    initialTarget?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const elements = getFocusable();
      if (elements.length === 0) {
        e.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const activeEl = document.activeElement;

      if (e.shiftKey) {
        if (activeEl === first || !container?.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !container?.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // NOTE: restore focus to whatever triggered the overlay so keyboard
      // users don't lose their place in the page once it closes.
      previouslyFocused.current?.focus?.();
    };
  }, [active, containerRef]);
}
