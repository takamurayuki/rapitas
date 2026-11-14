/**
 * link-view-geometry
 *
 * Rectangle helpers for placing the docked webviews over their surface, and
 * the sequence counter that stamps every visibility command. Not responsible
 * for deciding visibility; `useLinkView`'s `applyVisibility` does that.
 */
import type { LinkViewBounds } from '@/utils/link-view';

/** Read an element's position in CSS pixels relative to the window. */
export function boundsOf(el: HTMLElement): LinkViewBounds {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/** A collapsed box — the surface is not really on screen. */
export function isCollapsed(b: LinkViewBounds): boolean {
  return b.width < 2 || b.height < 2;
}

/** Two rectangles close enough that moving the webview would be a no-op. */
export function sameBounds(a: LinkViewBounds | null, b: LinkViewBounds): boolean {
  if (!a) return false;
  return (
    Math.abs(a.x - b.x) < 1 &&
    Math.abs(a.y - b.y) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  );
}

/**
 * The visibility sequence, shared by every tab and every hook instance.
 *
 * Seeded from the clock rather than 0: the Rust side keeps the last applied
 * number per webview for the app's lifetime, and a reloaded frontend starting
 * again at 1 would have every command dropped as stale.
 */
let visibilitySeq = Date.now() * 1000;

/** The next sequence number. Only `applyVisibility` should call this. */
export function nextVisibilitySeq(): number {
  visibilitySeq += 1;
  return visibilitySeq;
}
