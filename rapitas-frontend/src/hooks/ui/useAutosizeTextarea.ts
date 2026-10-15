/**
 * useAutosizeTextarea
 *
 * Grows a textarea's height to fit its content whenever the value changes.
 * Not responsible for width, max-height clamping, or scroll management.
 */

import { useEffect, type RefObject } from 'react';

/**
 * Auto-sizes a textarea to its content height on every value change.
 *
 * Resetting to 'auto' first lets the element shrink when content is deleted;
 * scrollHeight then reflects the true content height.
 *
 * @param ref - Ref to the textarea element / 対象テキストエリアのref
 * @param value - Current textarea value (effect dependency) / 現在の入力値
 */
export function useAutosizeTextarea(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}
