'use client';
/**
 * useFloatHitRects
 *
 * Tells the Rust side where ラピ is drawn in her own window, so clicks land
 * on her there and pass through to the main window everywhere else.
 *
 * Not responsible for the pass-through itself — `rapi_float.rs` tests the
 * cursor against these rectangles.
 */
import { useEffect } from 'react';
import { hitRectsOf, type HitRect } from './rapi-float-protocol';
import { invokeQuietly } from './tauri-bus';

/**
 * Everything of hers that takes a click: the avatar, her bubbles (the status
 * line and the panel) and the conversation list, which can drop past the
 * panel's edge on a short window.
 */
export const HIT_SELECTOR =
  '[data-rapi-avatar="true"], [data-speech-bubble="true"], [role="listbox"]';

/**
 * How often her rectangles are re-measured.
 *
 * Polled rather than observed: she moves by inline style, opens by
 * `display`, and animates, and no one observer sees all three. Each pass is
 * three `getBoundingClientRect` calls and a send only when something moved.
 */
const MEASURE_MS = 100;

/** Shadows reach a few pixels past the boxes; a click there should be hers. */
const PAD_PX = 4;

type Send = (rects: HitRect[]) => void;

/** Module-level so the effect below is not torn down on every render. */
const sendToRust: Send = (rects) => invokeQuietly('set_rapi_float_hit_rects', { rects });

/**
 * Keep the Rust side's copy of her rectangles current.
 *
 * While a press that started on her is held, the whole window is reported
 * instead: a drag carries the pointer off her faster than she follows, and
 * the moment it left her rectangles the window would stop receiving the
 * moves and drop her mid-air.
 *
 * @param active - False while she is hidden; then nothing is hers / 表示中か
 * @param send - Where the rectangles go; injectable for tests / 送信先
 */
export function useFloatHitRects(active: boolean, send: Send = sendToRust): void {
  useEffect(() => {
    let last = '';
    let holding = false;

    const report = () => {
      // Hidden by `visibility`, she still has boxes; reporting them would
      // swallow clicks meant for a dialog drawn under her.
      const rects = !active
        ? []
        : holding
          ? [{ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }]
          : hitRectsOf(document.querySelectorAll(HIT_SELECTOR), PAD_PX);
      const key = JSON.stringify(rects);
      if (key === last) return;
      last = key;
      send(rects);
    };

    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(HIT_SELECTOR)) return;
      holding = true;
      report();
    };
    const onUp = () => {
      if (!holding) return;
      holding = false;
      report();
    };

    report();
    const timer = window.setInterval(report, MEASURE_MS);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
    };
  }, [active, send]);
}
