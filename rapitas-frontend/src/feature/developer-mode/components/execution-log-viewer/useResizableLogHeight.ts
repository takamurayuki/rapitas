'use client';

/**
 * execution-log-viewer/useResizableLogHeight
 *
 * Drag/keyboard height resizing for the log viewer with localStorage
 * persistence (shared key, so the chosen height applies to every resizable
 * log viewer and survives remounts). Pointer capture keeps the drag on the
 * handle, so no document-level listeners are needed.
 */

import { useCallback, useRef, useState } from 'react';
import { useLocalStorageState } from '@/hooks/common/useLocalStorageState';

export const MIN_LOG_HEIGHT = 160;
const KEYBOARD_STEP = 32;
const STORAGE_KEY = 'rapitas.executionLogHeight';

/** Clamp to the sensible range: 160px – 80% of the viewport height. */
function clampHeight(value: number): number {
  const max = typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.8) : 800;
  return Math.min(Math.max(Math.round(value), MIN_LOG_HEIGHT), max);
}

export interface UseResizableLogHeightReturn {
  /** Current height in px (draft while dragging, persisted otherwise). */
  height: number;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}

/**
 * Manages a persisted, clamped log-viewer height driven by a bottom drag
 * handle (pointer events) or ArrowUp/ArrowDown on the focused handle.
 *
 * @param fallback - Initial height when nothing is persisted yet. / 未保存時の初期高さ
 * @returns Height plus the handle's event handlers. / 高さとハンドル用イベントハンドラ
 */
export function useResizableLogHeight(fallback: number): UseResizableLogHeightReturn {
  const [storedHeight, setStoredHeight] = useLocalStorageState<number>(STORAGE_KEY, fallback);
  // NOTE: drafting during drag avoids a localStorage write per pointermove;
  // the value is persisted once on pointer-up.
  const [draft, setDraft] = useState<number | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number; lastHeight: number } | null>(null);

  const height = clampHeight(draft ?? storedHeight);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dragRef.current = { startY: e.clientY, startHeight: height, lastHeight: height };
    },
    [height],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = clampHeight(drag.startHeight + (e.clientY - drag.startY));
    drag.lastHeight = next;
    setDraft(next);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      setStoredHeight(drag.lastHeight);
      setDraft(null);
    },
    [setStoredHeight],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const delta = e.key === 'ArrowUp' ? -KEYBOARD_STEP : KEYBOARD_STEP;
      setStoredHeight(clampHeight(height + delta));
    },
    [height, setStoredHeight],
  );

  return { height, onPointerDown, onPointerMove, onPointerUp, onKeyDown };
}
